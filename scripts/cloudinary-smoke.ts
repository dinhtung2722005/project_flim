import "../apps/api/src/config";
import { verifyMediaPipeline } from "./worker-smoke";
import { readFile, mkdir, writeFile, open, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { totp } from "../apps/api/src/security";
import { CloudinaryProvider } from "../packages/media/src/cloudinary.provider";
import { cloudinaryConfiguration } from "../packages/media/src/cloudinary.config";

const reportPath = ".local/media/smoke-result.json";
const report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  passed: false,
};
let stage = "configuration";
let cleanup: { base: string; token: string } | undefined;
async function save() {
  await mkdir(".local/media", { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
function progress(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...details }));
}
async function main() {
  const source = process.argv[2] ?? process.env.CLOUDINARY_TEST_VIDEO;
  if (!source) throw new Error("VIDEO_PATH_REQUIRED");
  const c = cloudinaryConfiguration(),
    provider = new CloudinaryProvider();
  await provider.assertPreset();
  const path = resolve(source),
    info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > c.maxBytes)
    throw new Error("INVALID_VIDEO_FILE");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const sourceSha256 = digest.digest("hex");
  const base = process.env.PJ_FLIM_TEST_API_URL ?? "http://127.0.0.1:3000";
  const baseUrl = new URL(base);
  if (
    !["127.0.0.1", "localhost"].includes(baseUrl.hostname) ||
    baseUrl.protocol !== "http:"
  )
    throw new Error("LOCAL_API_REQUIRED");
  let token = "";
  async function api(
    method: string,
    route: string,
    body?: object,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.code === "string" ? data.code : "API_REQUEST_FAILED",
      );
    return data;
  }
  stage = "login";
  const admin = JSON.parse(
    await readFile(".local/api/bootstrap-admin.json", "utf8"),
  );
  const session = await api("POST", "/api/v1/auth/sessions", {
    email: admin.email,
    password: admin.password,
  });
  if (session.state !== "PENDING_MFA") throw new Error("ADMIN_MFA_REQUIRED");
  const auth = await api(
    "POST",
    "/api/v1/auth/mfa-challenges/" + session.challengeId + "/verifications",
    {
      challengeToken: session.challengeToken,
      code: totp(admin.totpSecret).generate(),
    },
    { "Idempotency-Key": randomUUID() },
  );
  token = auth.accessToken;
  cleanup = { base, token };
  report.cloudName = c.cloudName;
  let previous: any;
  try {
    previous = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {}
  if (previous?.sourceSha256 === sourceSha256 && previous.intentId) {
    Object.assign(report, previous, {
      passed: false,
      restartedAt: new Date().toISOString(),
    });
  } else {
    Object.assign(report, { sourceBytes: info.size, sourceSha256 });
    stage = "create-draft";
    const title = await api("POST", "/api/v1/admin/titles", {
      kind: "MOVIE",
      slug: "cloudinary-smoke-" + randomUUID(),
      localizedTitle: "Cloudinary upload test",
    });
    const seasons = await api(
      "GET",
      "/api/v1/admin/titles/" + title.id + "/seasons",
    );
    const episodes = await api(
      "GET",
      "/api/v1/admin/seasons/" + seasons.data[0].id + "/episodes",
    );
    report.titleId = title.id;
    report.episodeId = episodes.data[0].id;
    const intent = await api(
      "POST",
      "/api/v1/admin/episodes/" + report.episodeId + "/upload-intents",
      { expectedBytes: info.size, sourceFormat: "mp4" },
      { "Idempotency-Key": randomUUID() },
    );
    report.intentId = intent.id;
    report.assetId = intent.assetId;
    report.publicId = intent.upload.fields.public_id;
    await save();
  }
  stage = "upload";
  if (!report.sourceUploaded) {
    const intent = await api(
      "GET",
      "/api/v1/admin/upload-intents/" + report.intentId,
    );
    if (!intent.upload) throw new Error("UPLOAD_INTENT_UNAVAILABLE");
    const upload = intent.upload,
      chunkSize = upload.chunkSize,
      uploadId = randomUUID(),
      handle = await open(path, "r");
    const started = Date.now();
    try {
      for (let offset = 0; offset < info.size; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, info.size),
          buffer = Buffer.alloc(end - offset);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        if (bytesRead !== buffer.length)
          throw new Error("VIDEO_CHANGED_DURING_UPLOAD");
        const form = new FormData();
        for (const [key, value] of Object.entries(upload.fields))
          form.append(key, String(value));
        form.append("file", new Blob([buffer]), "smoke.mp4");
        const r = await fetch(upload.url, {
          method: "POST",
          body: form,
          headers: {
            "X-Unique-Upload-Id": uploadId,
            "Content-Range":
              "bytes " + offset + "-" + (end - 1) + "/" + info.size,
          },
          signal: AbortSignal.timeout(120000),
          redirect: "error",
        });
        const data = (await r.json()) as any;
        if (!r.ok) {
          report.providerStatus = r.status;
          // Provider upload messages are kept only in the ignored local report;
          // strip credentials/signed URLs even if the provider embeds request data.
          const message = String(data.error?.message ?? "Upload rejected");
          report.providerReason = message
            .replace(/https?:\/\/\S+/g, "[url]")
            .replaceAll(c.apiSecret, "[redacted]")
            .replace(/signature[=: ]+[a-f0-9]+/gi, "signature=[redacted]")
            .slice(0, 500);
          throw new Error("CLOUDINARY_UPLOAD_REJECTED");
        }
        progress("cloudinary.upload.progress", {
          bytes: end,
          total: info.size,
        });
        if (end === info.size) {
          if (!data.asset_id || data.done === false)
            throw new Error("UPLOAD_NOT_CONFIRMED");
          report.sourceUploaded = true;
          report.uploadDurationMs = Date.now() - started;
          report.durationSeconds = data.duration;
          report.width = data.width;
          report.height = data.height;
          report.providerAssetId = data.asset_id;
          report.providerVersion = String(data.version);
          await save();
        }
      }
    } finally {
      await handle.close();
    }
  }
  stage = "verification";
  const verified = await api(
    "POST",
    "/api/v1/admin/upload-intents/" + report.intentId + "/verifications",
    { episodeId: report.episodeId },
    { "Idempotency-Key": randomUUID() },
  );
  report.verified = verified.status === "VERIFIED";
  report.operationId = verified.operationId;
  await save();
  stage = "hls-transform";
  progress("cloudinary.hls.checking", {
    profile: c.profile,
    durationSeconds: report.durationSeconds,
  });
  const workerManaged =
    !!process.env.RABBITMQ_URL && process.env.PJ_FLIM_PROVIDER_ONLY !== "true";
  if (workerManaged) await verifyMediaPipeline(report.assetId);
  if (
    !workerManaged &&
    !report.hlsRequestedAt &&
    report.stage !== "hls-delivery"
  ) {
    report.hlsRequestedAt = new Date().toISOString();
    await save();
    try {
      const eager = await cloudinary.uploader.explicit(report.publicId, {
        ...provider.options(),
        resource_type: "video",
        type: "authenticated",
        eager: [{ streaming_profile: c.profile, format: "m3u8" }],
        eager_async: true,
        timeout: 20000,
      });
      if (eager.eager?.[0]?.status === "failed")
        throw new Error("HLS_TRANSFORM_FAILED");
    } catch (error: any) {
      const code = error?.http_code ?? error?.error?.http_code;
      // A response timeout can happen after the provider accepted the transformation.
      // Reconcile by checking the manifest instead of submitting another job.
      if (![408, 499, 504].includes(code))
        throw new Error("HLS_TRANSFORM_FAILED");
    }
  }
  stage = "hls-delivery";
  const manifestUrl = cloudinary.url(report.publicId, {
    cloud_name: c.cloudName,
    api_key: c.apiKey,
    api_secret: c.apiSecret,
    secure: true,
    resource_type: "video",
    type: "authenticated",
    version: report.providerVersion,
    streaming_profile: c.profile,
    format: "m3u8",
    sign_url: true,
  });
  // Every fetched playlist/segment must remain on the expected CDN environment.
  const allowed = (url: string) => {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "res.cloudinary.com" ||
      !u.pathname.startsWith("/" + c.cloudName + "/")
    )
      throw new Error("UNEXPECTED_HLS_ORIGIN");
    return u.toString();
  };
  async function playlist(url: string) {
    const started = Date.now();
    let r: Response;
    for (;;) {
      r = await fetch(allowed(url), {
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      report.lastCdnStatus = r.status;
      report.lastProviderMessage = r.headers
        .get("x-cld-error")
        ?.replaceAll(c.apiSecret, "[redacted]")
        .slice(0, 300);
      if (
        ![400, 404, 420, 423].includes(r.status) ||
        Date.now() - started > 15 * 60 * 1000
      )
        break;
      await r.body?.cancel();
      report.state = "WAITING_HLS";
      await save();
      progress("cloudinary.hls.waiting", {
        status: r.status,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
      });
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
    if (!r.ok) throw new Error("HLS_DELIVERY_" + r.status);
    const body = await r.text();
    if (!body.startsWith("#EXTM3U")) throw new Error("INVALID_HLS_MANIFEST");
    return body;
  }
  const master = await playlist(manifestUrl);
  const lines = master.split(/\r?\n/);
  const variants = lines.flatMap((line, i) =>
    line.startsWith("#EXT-X-STREAM-INF:") &&
    lines[i + 1] &&
    !lines[i + 1].startsWith("#")
      ? [{ attributes: line, uri: lines[i + 1] }]
      : [],
  );
  if (variants.length < 2) throw new Error("HLS_ABR_VARIANTS_MISSING");
  report.renditions = variants.map((v) => ({
    resolution: /RESOLUTION=([0-9]+x[0-9]+)/.exec(v.attributes)?.[1],
    bandwidth: Number(/BANDWIDTH=([0-9]+)/.exec(v.attributes)?.[1]),
  }));
  const selected = [...variants].sort(
    (a, b) =>
      Number(/RESOLUTION=[0-9]+x([0-9]+)/.exec(b.attributes)?.[1] ?? 0) -
      Number(/RESOLUTION=[0-9]+x([0-9]+)/.exec(a.attributes)?.[1] ?? 0),
  )[0];
  report.verifiedRendition = /RESOLUTION=([0-9]+x[0-9]+)/.exec(
    selected.attributes,
  )?.[1];
  const variantUrl = new URL(selected.uri, manifestUrl).toString(),
    media = await playlist(variantUrl);
  if (!media.includes("#EXTINF:") || !media.includes("#EXT-X-ENDLIST"))
    throw new Error("INVALID_HLS_MEDIA_PLAYLIST");
  const segment = media
    .split(/\r?\n/)
    .find((l) => l.trim() && !l.startsWith("#"));
  if (!segment) throw new Error("HLS_SEGMENT_MISSING");
  const segmentResponse = await fetch(
    allowed(new URL(segment, variantUrl).toString()),
    {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    },
  );
  if (![200, 206].includes(segmentResponse.status))
    throw new Error("HLS_SEGMENT_" + segmentResponse.status);
  const reader = segmentResponse.body?.getReader(),
    part = await reader?.read();
  await reader?.cancel();
  if (!part?.value?.byteLength) throw new Error("EMPTY_HLS_SEGMENT");
  Object.assign(report, {
    passed: true,
    completedAt: new Date().toISOString(),
    hlsManifestVerified: true,
    hlsSegmentVerified: true,
    state: "SUCCEEDED",
    applicationAssetState: workerManaged ? "READY" : "UPLOADED",
    applicationBackupState: workerManaged ? "VERIFIED" : "PENDING",
    note: workerManaged
      ? "Worker HLS/webhook/backup verified. The draft is not published."
      : "HLS tested at provider only. Worker/backup pipeline must complete before publishing.",
  });
  for (const key of [
    "errorCode",
    "failedAt",
    "stage",
    "providerReason",
    "providerStatus",
  ])
    delete report[key];
  await save();
  stage = "logout";
  await fetch(base + "/api/v1/auth/sessions/current", {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10000),
  });
  progress("cloudinary.smoke.passed", {
    durationSeconds: report.durationSeconds,
    sourceBytes: report.sourceBytes,
    renditions: report.renditions,
    report: reportPath,
  });
}
main()
  .catch(async (error: any) => {
    report.failedAt = new Date().toISOString();
    report.stage = stage;
    report.errorCode = /^[A-Z][A-Z0-9_]+$/.test(String(error?.message))
      ? error.message
      : "CLOUDINARY_SMOKE_FAILED";
    await save();
    progress("cloudinary.smoke.failed", {
      stage,
      errorCode: report.errorCode,
      providerStatus: report.providerStatus,
      report: reportPath,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (cleanup)
      await fetch(cleanup.base + "/api/v1/auth/sessions/current", {
        method: "DELETE",
        headers: { Authorization: "Bearer " + cleanup.token },
        signal: AbortSignal.timeout(10000),
      }).catch(() => undefined);
  });
