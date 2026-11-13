import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryProvider } from "../packages/media/src/cloudinary.provider";
import {
  ENCODING_PRESETS,
  createEncodingSnapshot,
  assertEncodingSnapshot,
  fittedDimensions,
  representations,
  canonicalRepresentations,
  processingConfigHash,
} from "../packages/media/src/encoding-profiles";
import { verifyHls } from "../packages/media/src/hls-verifier";
import { ApiError, hash } from "../packages/backend-core/src/errors";

export async function runEncodingChecks() {
  let checks = 0;
  const eq = (actual: unknown, expected: unknown) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const ok = (value: unknown) => {
    assert.ok(value);
    checks++;
  };
  const rejects = async (
    fn: () => Promise<unknown>,
    code = "MEDIA_PROVIDER_BAD_RESPONSE",
  ) => {
    await assert.rejects(
      fn,
      (e: any) => e instanceof ApiError && e.code === code,
    );
    checks++;
  };
  const source = { width: 1920, height: 1080, duration: 12 };
  const full = createEncodingSnapshot("balanced-1080p-v1", source);
  eq(
    full.rungs.map((r) => r.height),
    [240, 360, 480, 720, 1080],
  );
  eq(
    full.rungs.map((r) => r.videoBitrate),
    [350000, 650000, 1000000, 2200000, 4200000],
  );
  eq(
    createEncodingSnapshot("balanced-720p-v1", source).rungs.map(
      (r) => r.height,
    ),
    [240, 360, 480, 720],
  );
  eq(
    createEncodingSnapshot("data-saver-v1", source).rungs.map((r) => r.height),
    [240, 360, 480],
  );
  eq(
    createEncodingSnapshot("balanced-1080p-v1", {
      width: 640,
      height: 360,
    }).rungs.map((r) => r.height),
    [240, 360],
  );
  eq(
    createEncodingSnapshot("balanced-720p-v1", { width: 160, height: 90 }).rungs
      .length,
    1,
  );
  for (const src of [
    { width: 640, height: 360 },
    { width: 960, height: 540 },
    { width: 1080, height: 1920 },
    { width: 2560, height: 1080 },
    { width: 320, height: 240 },
    { width: 161, height: 91 },
  ]) {
    for (const preset of ENCODING_PRESETS) {
      const plan = createEncodingSnapshot(preset.id, src);
      const dims = plan.rungs.map((r) => fittedDimensions(r, src));
      ok(
        dims.every(
          (d) =>
            d.width <= src.width + 1 &&
            d.height <= src.height + 1 &&
            d.height <= preset.maxHeight + 1,
        ),
      );
      eq(new Set(dims.map((d) => d.width + "x" + d.height)).size, dims.length);
      ok(dims.length > 0 && dims.length <= 5);
      eq(
        assertEncodingSnapshot(JSON.parse(JSON.stringify(plan)), src)
          .definitionHash,
        plan.definitionHash,
      );
    }
  }
  const reordered = JSON.parse(
    JSON.stringify(full).replace('"revision":1', '"revision":1'),
  );
  eq(
    assertEncodingSnapshot(reordered, source).definitionHash,
    full.definitionHash,
  );
  await rejects(async () =>
    assertEncodingSnapshot({ ...full, codec: "h265" } as any, source),
  );
  await rejects(async () =>
    assertEncodingSnapshot({ ...full, rungs: full.rungs.slice(1) }, source),
  );
  await rejects(
    async () => createEncodingSnapshot("arbitrary" as any, source),
    "MEDIA_PROVIDER_UNAVAILABLE",
  );
  await rejects(async () =>
    createEncodingSnapshot("balanced-720p-v1", { width: 0, height: 720 }),
  );
  const legacy = {
    streamingProfile: "hd",
    profileVersion: "hls-hd-v1",
    deliveryType: "authenticated",
  };
  eq(
    processingConfigHash(legacy),
    hash(
      JSON.stringify({
        profile: "hd",
        profileVersion: "hls-hd-v1",
        deliveryType: "authenticated",
        format: "m3u8",
      }),
    ),
  );
  ok(
    processingConfigHash({ ...legacy, encoding: full }) !==
      processingConfigHash(legacy),
  );
  const stringRates = representations(full).map((r) => ({
    transformation: r.transformation.map((t) => ({
      ...t,
      bit_rate: t.bit_rate / 1000 + "k",
      keyframe_interval: "2",
    })),
  }));
  eq(
    canonicalRepresentations(stringRates),
    canonicalRepresentations(representations(full)),
  );

  const savedFetch = globalThis.fetch;
  let mode = "valid";
  let plan = full,
    src = source;
  const url =
    "https://res.cloudinary.com/test-cloud/video/authenticated/master.m3u8";
  globalThis.fetch = async (input) => {
    const request = new URL(String(input));
    assert.equal(request.hostname, "res.cloudinary.com");
    if (request.pathname.endsWith("/master.m3u8")) {
      let variants = plan.rungs.map((r, i) => {
        const d = fittedDimensions(r, src);
        return { d, i };
      });
      if (mode === "missing") variants = variants.slice(1);
      return new Response(
        "#EXTM3U\n" +
          variants
            .map(
              ({ d, i }) =>
                "#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=" +
                (mode === "upscale" && i === variants.length - 1
                  ? "3840x2160"
                  : d.width + "x" + d.height) +
                ',CODECS="' +
                (mode === "codec" ? "hvc1.1.6.L93" : "avc1.64001f,mp4a.40.2") +
                '"\n' +
                (mode === "foreign"
                  ? "https://attacker.invalid/0.m3u8"
                  : i + ".m3u8") +
                "\n",
            )
            .join(""),
      );
    }
    if (request.pathname.endsWith(".m3u8"))
      return new Response(
        "#EXTM3U\n#EXTINF:4,\n0.ts\n#EXTINF:4,\n1.ts\n#EXTINF:4,\n2.ts\n" +
          (mode === "live" ? "" : "#EXT-X-ENDLIST\n"),
      );
    return new Response(new Uint8Array([0x47, 1, 2, 3]), { status: 206 });
  };
  try {
    const summary = await verifyHls(url, "test-cloud", src, undefined, plan);
    eq(
      summary.map((r) => r.height),
      [240, 360, 480, 720, 1080],
    );
    ok(
      summary.every(
        (r) =>
          r.segmentVerified &&
          r.codecs?.startsWith("avc1") &&
          (r.estimatedMebibytesPerMinute ?? 0) > 0,
      ),
    );
    for (const bad of ["missing", "codec", "upscale", "foreign", "live"]) {
      mode = bad;
      await rejects(() => verifyHls(url, "test-cloud", src, undefined, plan));
    }
    mode = "valid";
    src = { width: 640, height: 360, duration: 12 };
    plan = createEncodingSnapshot("balanced-1080p-v1", src);
    eq(
      (await verifyHls(url, "test-cloud", src, undefined, plan)).map(
        (r) => r.height,
      ),
      [240, 360],
    );
  } finally {
    globalThis.fetch = savedFetch;
  }

  const keys = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  const oldEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const api = cloudinary.api as any,
    uploader = cloudinary.uploader as any;
  const oldGet = api.get_streaming_profile,
    oldCreate = api.create_streaming_profile,
    oldExplicit = uploader.explicit;
  let stored: any,
    creates = 0,
    explicit: any;
  try {
    process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "123456789";
    process.env.CLOUDINARY_API_SECRET = "encoding-test-secret";
    api.get_streaming_profile = async () => {
      if (!stored) throw { http_code: 404 };
      return { data: stored };
    };
    api.create_streaming_profile = async (name: string, options: any) => {
      creates++;
      stored = {
        name,
        predefined: false,
        representations: options.representations,
      };
      return { data: stored };
    };
    uploader.explicit = async (_publicId: string, options: any) => {
      explicit = options;
      return { batch_id: "test-batch" };
    };
    const provider = new CloudinaryProvider();
    await provider.assertStreamingProfile(full);
    eq(creates, 1);
    await provider.assertStreamingProfile(full);
    eq(creates, 1);
    const valid = structuredClone(stored);
    stored.representations[0].transformation[0].bit_rate = 99000000;
    await rejects(() => provider.assertStreamingProfile(full));
    eq(creates, 1);
    stored = valid;
    const policy: any = {
      cloudName: "test-cloud",
      apiKey: "123456789",
      parameters: { timestamp: 1 },
      signatureTimestamp: 1,
      deliveryType: "authenticated",
      streamingProfile: full.profileName,
      profileVersion: full.profileVersion,
      encoding: full,
    };
    await provider.requestHls(
      { public_id: "dedicated-test", ...source },
      policy,
      "https://callback.example.test",
    );
    eq(explicit.eager_async, true);
    eq(explicit.eager, [
      { streaming_profile: full.profileName, format: "m3u8" },
    ]);
    eq(explicit.eager_notification_url, "https://callback.example.test");
    stored = undefined;
    api.create_streaming_profile = async (name: string, options: any) => {
      stored = {
        name,
        predefined: false,
        representations: options.representations,
      };
      throw { http_code: 409 };
    };
    await provider.assertStreamingProfile(full);
    checks++;
    stored = { ...valid, predefined: true };
    await rejects(() => provider.assertStreamingProfile(full));
  } finally {
    api.get_streaming_profile = oldGet;
    api.create_streaming_profile = oldCreate;
    uploader.explicit = oldExplicit;
    for (const k of keys) {
      if (oldEnv[k] === undefined) delete process.env[k];
      else process.env[k] = oldEnv[k];
    }
  }
  return checks;
}
