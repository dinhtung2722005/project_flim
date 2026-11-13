import "../apps/api/src/config";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import {
  CloudinaryProvider,
  UploadPolicy,
} from "../packages/media/src/cloudinary.provider";
import { cloudinaryConfiguration } from "../packages/media/src/cloudinary.config";
import {
  ENCODING_PRESETS,
  createEncodingSnapshot,
} from "../packages/media/src/encoding-profiles";
import {
  verifyHls,
  MediaPending,
  cdnFetch,
  checkedCdnUrl,
} from "../packages/media/src/hls-verifier";
import { ApiError } from "../packages/backend-core/src/errors";
const fullHd = process.env.PJ_FLIM_ENCODING_FULL_HD === "true";
const folder = fullHd ? ".local/encoding/full-hd" : ".local/encoding";
let stage = "startup";
async function measureBytes(masterUrl: string, cloudName: string) {
  let downloaded = 0;
  async function read(
    url: string,
    limit: number,
    range?: { start: number; length: number },
  ) {
    const response = await cdnFetch(
      url,
      cloudName,
      undefined,
      range
        ? "bytes=" + range.start + "-" + (range.start + range.length - 1)
        : undefined,
    );
    if (!response.ok || (range && response.status !== 206)) {
      await response.body?.cancel();
      throw new Error("MEASUREMENT_FETCH_FAILED");
    }
    if (
      range &&
      response.headers.get("content-range")?.split("/")[0] !==
        "bytes " + range.start + "-" + (range.start + range.length - 1)
    ) {
      await response.body?.cancel();
      throw new Error("MEASUREMENT_RANGE_MISMATCH");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("MEASUREMENT_EMPTY_BODY");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        downloaded += part.value.length;
        if (bytes > limit || downloaded > 128 * 1024 * 1024)
          throw new Error("MEASUREMENT_BYTE_BUDGET");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (range && bytes !== range.length)
      throw new Error("MEASUREMENT_RANGE_LENGTH");
    return Buffer.concat(chunks);
  }
  const master = (await read(masterUrl, 512 * 1024))
    .toString("utf8")
    .split(/\r?\n/);
  const results: {
    width: number;
    height: number;
    segmentBytes: number;
    segments: number;
    initializationBytes: number;
  }[] = [];
  for (let i = 0; i < master.length; i++) {
    if (!master[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const dimensions = /RESOLUTION=(\d+)x(\d+)/.exec(master[i]);
    if (!dimensions || !master[i + 1])
      throw new Error("MEASUREMENT_INVALID_PLAYLIST");
    const url = checkedCdnUrl(
      new URL(master[i + 1], masterUrl).toString(),
      cloudName,
    );
    const media = (await read(url, 512 * 1024)).toString("utf8").split(/\r?\n/);
    let segmentBytes = 0,
      segments = 0,
      initializationBytes = 0,
      pending: string | undefined,
      previous: { url: string; end: number } | undefined;
    for (const line of media) {
      if (line.startsWith("#EXT-X-MAP:")) {
        const uri = /URI="([^"]+)"/.exec(line)?.[1],
          rangeText = /BYTERANGE="(\d+)(?:@(\d+))?"/.exec(line);
        if (!uri) throw new Error("MEASUREMENT_INVALID_INIT");
        const init = checkedCdnUrl(new URL(uri, url).toString(), cloudName);
        const range = rangeText
          ? { length: Number(rangeText[1]), start: Number(rangeText[2] ?? 0) }
          : undefined;
        const bytes = (await read(init, 16 * 1024 * 1024, range)).length;
        segmentBytes += bytes;
        initializationBytes += bytes;
        continue;
      }
      if (line.startsWith("#EXT-X-BYTERANGE:")) {
        pending = line.slice("#EXT-X-BYTERANGE:".length);
        continue;
      }
      if (!line.trim() || line.startsWith("#")) continue;
      const segment = checkedCdnUrl(new URL(line, url).toString(), cloudName);
      let range: { start: number; length: number } | undefined;
      if (pending) {
        const match = /^(\d+)(?:@(\d+))?$/.exec(pending);
        if (!match) throw new Error("MEASUREMENT_INVALID_RANGE");
        const length = Number(match[1]),
          start =
            match[2] !== undefined
              ? Number(match[2])
              : previous?.url === segment
                ? previous.end
                : NaN;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(length) ||
          start < 0 ||
          length < 1 ||
          length > 16 * 1024 * 1024
        )
          throw new Error("MEASUREMENT_INVALID_RANGE");
        range = { start, length };
        previous = { url: segment, end: start + length };
      } else previous = undefined;
      segmentBytes += (await read(segment, 16 * 1024 * 1024, range)).length;
      segments++;
      pending = undefined;
    }
    if (!segments || pending)
      throw new Error("MEASUREMENT_INCOMPLETE_PLAYLIST");
    results.push({
      width: Number(dimensions[1]),
      height: Number(dimensions[2]),
      segmentBytes,
      segments,
      initializationBytes,
    });
  }
  return results;
}
async function main() {
  if (process.env.PJ_FLIM_LIVE_ENCODING !== "true")
    throw new Error("LIVE_ENCODING_OPT_IN_REQUIRED");
  const file = process.argv[2] ?? ".local/media/streaming-short-test.mp4";
  const bytes = (await stat(file)).size;
  const cfg = cloudinaryConfiguration(),
    provider = new CloudinaryProvider();
  if (bytes > Math.min(cfg.maxBytes, 100 * 1024 * 1024))
    throw new Error("SMOKE_SOURCE_TOO_LARGE");
  await mkdir(folder, { recursive: true });
  const sourceSha256 = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  let state: any = JSON.parse(
    await readFile(folder + "/live-state.json", "utf8").catch(() => "{}"),
  );
  const save = () =>
    writeFile(folder + "/live-state.json", JSON.stringify(state, null, 2));
  if (
    state.publicId &&
    (state.sourceSha256 !== sourceSha256 || state.cloudName !== cfg.cloudName)
  )
    throw new Error("SMOKE_STATE_CONFLICT");
  if (!state.publicId) {
    stage = "upload";
    await provider.assertPreset();
    const publicId = "pj-flim/encoding-smoke/" + randomUUID();
    const raw: any = await cloudinary.uploader.upload(file, {
      ...provider.options(),
      resource_type: "video",
      type: "authenticated",
      public_id: publicId,
      overwrite: false,
      upload_preset: cfg.preset,
    });
    if (raw.public_id !== publicId || raw.bytes !== bytes)
      throw new Error("SMOKE_SOURCE_MISMATCH");
    state = {
      publicId,
      cloudName: cfg.cloudName,
      sourceSha256,
      source: {
        width: raw.width,
        height: raw.height,
        duration: raw.duration,
        bytes: raw.bytes,
        format: raw.format,
        version: String(raw.version),
      },
      requested: [],
      results: [],
    };
    await save();
  }
  const src = state.source;
  console.log(
    JSON.stringify({
      event: "encoding.live.source",
      width: src.width,
      height: src.height,
      durationSeconds: src.duration,
      bytes: src.bytes,
    }),
  );
  const asset = {
    public_id: state.publicId,
    provider_version: src.version,
    source_format: src.format,
    width: src.width,
    height: src.height,
  };
  for (const preset of ENCODING_PRESETS.filter(
    (p) => !fullHd || p.id === "balanced-1080p-v1",
  )) {
    const plan = createEncodingSnapshot(preset.id, src);
    const policy: UploadPolicy = {
      assetId: "smoke",
      internalVersion: 1,
      cloudName: cfg.cloudName,
      apiKey: cfg.apiKey,
      preset: cfg.preset,
      deliveryType: "authenticated",
      expectedBytes: src.bytes,
      sourceFormat: src.format,
      maxBytes: cfg.maxBytes,
      maxDurationSeconds: cfg.maxDurationSeconds,
      encodingPreset: preset.id,
      encoding: plan,
      streamingProfile: plan.profileName,
      profileVersion: plan.profileVersion,
      signatureTimestamp: Math.floor(Date.now() / 1000),
      parameters: { timestamp: Math.floor(Date.now() / 1000) },
    };
    stage = "profile:" + preset.id;
    await provider.assertStreamingProfile(plan);
    if (!state.requested.includes(plan.profileName)) {
      stage = "submit:" + preset.id;
      await provider.requestHls(asset, policy);
      state.requested.push(plan.profileName);
      await save();
    }
    stage = "verify:" + preset.id;
    const started = Date.now();
    let summary: Awaited<ReturnType<typeof verifyHls>>;
    for (;;) {
      try {
        summary = await verifyHls(
          provider.deliveryUrl(asset, policy, true),
          cfg.cloudName,
          src,
          undefined,
          plan,
        );
        break;
      } catch (e) {
        if (!(e instanceof MediaPending) || Date.now() - started > 300000)
          throw e;
        console.log(
          JSON.stringify({ event: "encoding.live.wait", preset: preset.id }),
        );
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    stage = "measure:" + preset.id;
    const measured = await measureBytes(
      provider.deliveryUrl(asset, policy, true),
      cfg.cloudName,
    );
    const result = {
      measured: measured.map((r) => ({
        ...r,
        ratioToOriginal: r.segmentBytes / src.bytes,
      })),
      presetId: preset.id,
      profileVersion: plan.profileVersion,
      definitionHash: plan.definitionHash,
      renditions: summary,
      sourceBytes: src.bytes,
      sourceDurationSeconds: src.duration,
      verifiedAt: new Date().toISOString(),
    };
    state.results = state.results.filter((r: any) => r.presetId !== preset.id);
    state.results.push(result);
    await save();
    console.log(
      JSON.stringify({
        event: "encoding.live.verified",
        preset: preset.id,
        resolutions: summary.map((r) => r.width + "x" + r.height),
        codecs: [...new Set(summary.map((r) => r.codecs))],
      }),
    );
  }
  const report = {
    passed: true,
    checkedAt: new Date().toISOString(),
    provider: "Cloudinary live",
    source: state.source,
    results: state.results,
    publication: "none",
    databaseUsed: false,
    note: "Manifest size per minute is estimated. measured.segmentBytes counts fetched media/init bytes (including exact byte-range requests) for each rendition, excluding playlists/HTTP overhead; comparisons change resolution/quality and are not a VMAF/equal-quality claim.",
  };
  await writeFile(
    folder + "/live-result.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      event: "encoding.live.passed",
      presets: state.results.length,
    }),
  );
}
main().catch((e: any) => {
  console.error(
    JSON.stringify({
      event: "encoding.live.failed",
      stage,
      code:
        e instanceof ApiError
          ? e.code
          : typeof e?.http_code === "number"
            ? "CLOUDINARY_" + e.http_code
            : "SMOKE_FAILED",
      reason:
        e instanceof ApiError
          ? e.message
          : typeof e?.message === "string" && /^[A-Z0-9_]+$/.test(e.message)
            ? e.message
            : undefined,
    }),
  );
  process.exitCode = 1;
});
