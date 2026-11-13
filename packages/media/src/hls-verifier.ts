import { ApiError } from "../../backend-core/src/errors";
import {
  EncodingSnapshot,
  assertEncodingSnapshot,
  fittedDimensions,
} from "./encoding-profiles";
export class MediaPending extends Error {}
export function checkedCdnUrl(url: string, cloudName: string) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "res.cloudinary.com" ||
    u.port ||
    u.username ||
    u.password ||
    !u.pathname.startsWith("/" + cloudName + "/")
  )
    throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
  return u.toString();
}
export async function cdnFetch(
  url: string,
  cloudName: string,
  signal?: AbortSignal,
  range?: string,
  timeoutMs = 30000,
) {
  const response = await fetch(checkedCdnUrl(url, cloudName), {
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
    headers: range ? { Range: range } : {},
  });
  return response;
}
async function textLimit(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > limit) throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function verifyHls(
  manifestUrl: string,
  cloudName: string,
  source: { width: number; height: number; duration: number },
  signal?: AbortSignal,
  encoding?: EncodingSnapshot,
) {
  if (encoding) assertEncodingSnapshot(encoding, source);
  async function playlist(url: string) {
    const response = await cdnFetch(url, cloudName, signal);
    if ([404, 420, 423].includes(response.status)) {
      await response.body?.cancel();
      throw new MediaPending();
    }
    if (
      response.status === 400 &&
      /process|pending|parallel|byproduct of a streaming profile.*cannot be derived directly/i.test(
        response.headers.get("x-cld-error") ?? "",
      )
    ) {
      await response.body?.cancel();
      throw new MediaPending();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    }
    const text = await textLimit(response, 512 * 1024);
    if (!text.startsWith("#EXTM3U"))
      throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    return text;
  }
  const master = await playlist(manifestUrl),
    lines = master.split(/\r?\n/);
  const variants = lines.flatMap((line, i) => {
    if (
      !line.startsWith("#EXT-X-STREAM-INF:") ||
      !lines[i + 1] ||
      lines[i + 1].startsWith("#")
    )
      return [];
    const dimensions = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    const bandwidth = Number(/(?:^|[,:])BANDWIDTH=(\d+)/.exec(line)?.[1]);
    if (!dimensions || !Number.isSafeInteger(bandwidth) || bandwidth < 1)
      throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    return [
      {
        width: Number(dimensions[1]),
        height: Number(dimensions[2]),
        bandwidth,
        codecs: /(?:^|[,:])CODECS="([^"]+)"/.exec(line)?.[1] ?? null,
        url: checkedCdnUrl(
          new URL(lines[i + 1], manifestUrl).toString(),
          cloudName,
        ),
      },
    ];
  });
  if (
    variants.length < 1 ||
    variants.length > 16 ||
    (!encoding &&
      !variants.some((v) => v.height >= Math.min(720, source.height)))
  )
    throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
  if (
    variants.some(
      (v) =>
        !Number.isSafeInteger(v.width) ||
        !Number.isSafeInteger(v.height) ||
        v.width < 2 ||
        v.height < 2 ||
        v.width > 16384 ||
        v.height > 16384,
    )
  )
    throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
  if (encoding) {
    if (variants.length !== encoding.rungs.length)
      throw new ApiError(
        "MEDIA_PROVIDER_BAD_RESPONSE",
        "Incomplete encoding ladder.",
      );
    const unused = new Set(variants.map((_, i) => i));
    for (const rung of encoding.rungs) {
      const expected = fittedDimensions(rung, source);
      const i = variants.findIndex(
        (v, i) =>
          unused.has(i) &&
          Math.abs(v.width - expected.width) <= 4 &&
          Math.abs(v.height - expected.height) <= 4,
      );
      if (i < 0)
        throw new ApiError(
          "MEDIA_PROVIDER_BAD_RESPONSE",
          "Unexpected output dimensions.",
        );
      unused.delete(i);
      const v = variants[i];
      const codecs = v.codecs?.split(",").map((c) => c.trim()) ?? [];
      if (
        v.width > source.width + 2 ||
        v.height > source.height + 2 ||
        !codecs.some((c) => /^avc1\.[a-f0-9]{6}$/i.test(c)) ||
        codecs.some(
          (c) => !/^avc1\.[a-f0-9]{6}$/i.test(c) && !/^mp4a\.40\.2$/i.test(c),
        )
      )
        throw new ApiError(
          "MEDIA_PROVIDER_BAD_RESPONSE",
          "Output codec or upscaling policy mismatch.",
        );
    }
  }
  const summary: {
    width: number;
    height: number;
    bandwidth: number;
    durationSeconds: number;
    segmentVerified: boolean;
    codecs?: string | null;
    estimatedMebibytesPerMinute?: number;
  }[] = [];
  // Every rendition must have a valid VOD timeline and a readable media segment.
  for (const variant of variants) {
    const playlistText = await playlist(variant.url),
      media = playlistText.split(/\r?\n/);
    if (!playlistText.includes("#EXT-X-ENDLIST"))
      throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    const durations = media
      .filter((l) => l.startsWith("#EXTINF:"))
      .map((l) => Number(l.slice(8).split(",")[0]));
    const total = durations.reduce((a, b) => a + b, 0);
    if (
      !durations.length ||
      durations.some((d) => !Number.isFinite(d) || d <= 0) ||
      Math.abs(total - source.duration) > Math.max(12, source.duration * 0.01)
    )
      throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    const segment = media.find((l) => l.trim() && !l.startsWith("#"));
    if (!segment) throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    const response = await cdnFetch(
      new URL(segment, variant.url).toString(),
      cloudName,
      signal,
      "bytes=0-1023",
    );
    if (![200, 206].includes(response.status)) {
      await response.body?.cancel();
      throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    }
    const reader = response.body?.getReader(),
      part = await reader?.read();
    await reader?.cancel();
    if (!part?.value?.byteLength)
      throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    summary.push({
      width: variant.width,
      height: variant.height,
      bandwidth: variant.bandwidth,
      durationSeconds: total,
      segmentVerified: true,
      ...(encoding
        ? {
            codecs: variant.codecs,
            estimatedMebibytesPerMinute:
              Math.round(((variant.bandwidth * 60) / 8 / 1024 / 1024) * 100) /
              100,
          }
        : {}),
    });
  }
  return summary;
}
