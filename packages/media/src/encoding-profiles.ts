import { hash, ApiError } from "../../backend-core/src/errors";
import {
  DEFAULT_ENCODING_PRESET,
  ENCODING_PRESETS,
  EncodingPresetId,
} from "../../contracts/src/encoding";
export { ENCODING_PRESETS, DEFAULT_ENCODING_PRESET, EncodingPresetId };
export type EncodingSource = { width: number; height: number };
export type EncodingRung = {
  width: number;
  height: number;
  videoBitrate: number;
};
export type EncodingSnapshot = {
  presetId: EncodingPresetId;
  revision: 1;
  codec: "h264";
  audioCodec: "aac";
  keyframeSeconds: 2;
  rungs: EncodingRung[];
  definitionHash: string;
  profileName: string;
  profileVersion: string;
};
export function encodingPreset(
  value: unknown = process.env.CLOUDINARY_ENCODING_PRESET ??
    DEFAULT_ENCODING_PRESET,
): EncodingPresetId {
  if (!ENCODING_PRESETS.some((p) => p.id === value))
    throw new ApiError(
      "MEDIA_PROVIDER_UNAVAILABLE",
      "Unknown encoding preset.",
    );
  return value as EncodingPresetId;
}
export function representations(
  plan: Pick<
    EncodingSnapshot,
    "rungs" | "codec" | "audioCodec" | "keyframeSeconds"
  >,
) {
  return plan.rungs.map((r) => ({
    transformation: [
      {
        width: r.width,
        height: r.height,
        crop: "limit",
        bit_rate: r.videoBitrate,
        video_codec: plan.codec,
        audio_codec: plan.audioCodec,
        keyframe_interval: plan.keyframeSeconds,
      },
    ],
  }));
}
export function fittedDimensions(rung: EncodingRung, source: EncodingSource) {
  const scale = Math.min(
    1,
    rung.width / source.width,
    rung.height / source.height,
  );
  return {
    width: Math.max(2, Math.round((source.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((source.height * scale) / 2) * 2),
  };
}
export function createEncodingSnapshot(
  preset: EncodingPresetId,
  source: EncodingSource,
): EncodingSnapshot {
  encodingPreset(preset);
  if (
    ![source.width, source.height].every(
      (n) => Number.isSafeInteger(n) && n >= 2 && n <= 16384,
    )
  )
    throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
  const maxHeight = ENCODING_PRESETS.find((p) => p.id === preset)!.maxHeight;
  const heights = [240, 360, 480, 720, 1080].filter((h) => h <= maxHeight);
  const rates =
    preset === "data-saver-v1"
      ? [220000, 400000, 700000]
      : [350000, 650000, 1000000, 2200000, 4200000];
  const rungs: EncodingRung[] = [];
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i],
      w = Math.ceil((h * 16) / 9 / 2) * 2;
    const rung = { width: w, height: h, videoBitrate: rates[i] };
    const fitted = fittedDimensions(rung, source);
    if (
      rungs.some((r) => {
        const d = fittedDimensions(r, source);
        return d.width === fitted.width && d.height === fitted.height;
      })
    )
      continue;
    rungs.push(rung);
    // Once a box covers the source, higher representations would only duplicate it.
    if (rung.width >= source.width && rung.height >= source.height) break;
  }
  const definition = {
    presetId: preset,
    revision: 1 as const,
    codec: "h264" as const,
    audioCodec: "aac" as const,
    keyframeSeconds: 2 as const,
    rungs,
  };
  const definitionHash = hash(JSON.stringify(definition));
  return {
    ...definition,
    definitionHash,
    profileName: "pjflim_h264_" + definitionHash.slice(0, 24),
    profileVersion: preset + "-" + definitionHash.slice(0, 24),
  };
}
export function assertEncodingSnapshot(
  plan: EncodingSnapshot,
  source: EncodingSource,
) {
  const expected = createEncodingSnapshot(plan.presetId, source);
  // Property order from JSONB is unspecified, compare fields rather than JSON serialization.
  if (
    plan.definitionHash !== expected.definitionHash ||
    plan.profileName !== expected.profileName ||
    plan.profileVersion !== expected.profileVersion ||
    plan.revision !== 1 ||
    plan.codec !== "h264" ||
    plan.audioCodec !== "aac" ||
    plan.keyframeSeconds !== 2 ||
    !Array.isArray(plan.rungs) ||
    plan.rungs.length !== expected.rungs.length ||
    plan.rungs.some(
      (r, i) =>
        r.width !== expected.rungs[i].width ||
        r.height !== expected.rungs[i].height ||
        r.videoBitrate !== expected.rungs[i].videoBitrate,
    )
  )
    throw new ApiError(
      "MEDIA_PROVIDER_BAD_RESPONSE",
      "Encoding snapshot does not match its immutable definition.",
    );
  return expected;
}
export function processingConfigHash(policy: {
  streamingProfile: string;
  profileVersion: string;
  deliveryType: string;
  encoding?: EncodingSnapshot;
}) {
  // Preserve the historical hash for legacy intents.
  return hash(
    JSON.stringify({
      profile: policy.streamingProfile,
      profileVersion: policy.profileVersion,
      deliveryType: policy.deliveryType,
      format: "m3u8",
      ...(policy.encoding
        ? { encodingDefinitionHash: policy.encoding.definitionHash }
        : {}),
    }),
  );
}
function parseBitrate(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return value;
  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(String(value));
  if (!match) throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
  return (
    Number(match[1]) *
    (match[2]?.toLowerCase() === "m" ? 1000000 : match[2] ? 1000 : 1)
  );
}
export function canonicalRepresentations(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5)
    throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
  return value
    .map((r: any) => {
      const ts = Array.isArray(r?.transformation)
        ? r.transformation
        : [r?.transformation];
      if (ts.length !== 1 || !ts[0] || typeof ts[0] !== "object")
        throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
      const t = ts[0];
      const allowed = [
        "width",
        "height",
        "crop",
        "bit_rate",
        "video_codec",
        "audio_codec",
        "keyframe_interval",
      ];
      if (Object.keys(t).some((k) => !allowed.includes(k)))
        throw new ApiError(
          "MEDIA_PROVIDER_BAD_RESPONSE",
          "Streaming profile has unexpected transformations.",
        );
      return {
        width: Number(t.width),
        height: Number(t.height),
        crop: t.crop,
        bit_rate: parseBitrate(t.bit_rate),
        video_codec: t.video_codec,
        audio_codec: t.audio_codec,
        keyframe_interval: Number(t.keyframe_interval),
      };
    })
    .sort(
      (a, b) =>
        a.height - b.height || a.width - b.width || a.bit_rate - b.bit_rate,
    );
}
