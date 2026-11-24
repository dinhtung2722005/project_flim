import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2),
  value = (k) => {
    const i = args.indexOf(k);
    return i < 0 ? undefined : args[i + 1];
  };
export function targetSizes(width, height) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 2 ||
    height < 2
  )
    throw Error("SOURCE_DIMENSIONS_INVALID");
  return [360, 480, 720, 1080]
    .filter((h) => h <= height)
    .map((h) => ({
      height: h,
      width: Math.floor((width * h) / height / 2) * 2,
    }));
}
async function main() {
  const source = path.resolve(value("--source") || ""),
    out = path.resolve(value("--out") || ".local/benchmarks/encoding"),
    ffmpeg = value("--ffmpeg") || "ffmpeg",
    ffprobe = value("--ffprobe") || "ffprobe",
    seconds = Number(value("--seconds") || 6),
    crf = Number(value("--crf") || 23);
  if (
    !/\.(mp4|mkv|mov|webm)$/i.test(source) ||
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > 15 ||
    !Number.isInteger(crf) ||
    crf < 16 ||
    crf > 35
  )
    throw Error("INPUT_INVALID");
  await stat(source);
  await mkdir(out, { recursive: true });
  const run = (bin, a, cwd = out) =>
    execFileSync(bin, a, {
      cwd,
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 12e6,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const probe = (f) =>
    JSON.parse(
      run(ffprobe, [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        f,
      ]),
    );
  const info = probe(source),
    video = info.streams.find((s) => s.codec_type === "video"),
    duration = Number(info.format.duration);
  if (
    !video ||
    !Number.isFinite(duration) ||
    duration < seconds ||
    ["smpte2084", "arib-std-b67"].includes(video.color_transfer)
  )
    throw Error("SOURCE_UNSUPPORTED_OR_HDR");
  if ((video.side_data_list || []).some((s) => s.rotation && s.rotation % 360))
    throw Error("ROTATED_SOURCE_UNSUPPORTED");
  const fps =
    video.avg_frame_rate && /^\d+\/\d+$/.test(video.avg_frame_rate)
      ? video.avg_frame_rate
      : "30";
  const [num, den] = fps.split("/").map(Number);
  if (!den || num / den < 1 || num / den > 60) throw Error("FPS_UNSUPPORTED");
  const version = run(ffmpeg, ["-version"]).split("\n")[0],
    filters = run(ffmpeg, ["-hide_banner", "-filters"]),
    hasVmaf = filters.includes("libvmaf");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(source)) hash.update(chunk);
  const starts = [
    0,
    Math.max(0, (duration - seconds) * 0.5),
    Math.max(0, (duration - seconds) * 0.85),
  ].filter((v, i, a) => a.findIndex((x) => Math.abs(x - v) < 0.1) === i);
  const rows = [];
  if (!targetSizes(video.width, video.height).length)
    throw Error("SOURCE_TOO_SMALL");
  for (let i = 0; i < starts.length; i++) {
    const folder = path.join(out, "sample-" + i);
    await mkdir(folder, { recursive: true });
    const ref = path.join(folder, "reference.mkv");
    run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-ss",
      String(starts[i]),
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      source,
      "-t",
      String(seconds),
      "-map",
      "0:v:0",
      "-vf",
      "fps=" + fps + ",setsar=1,format=yuv420p",
      "-an",
      "-c:v",
      "ffv1",
      ref,
    ]);
    for (const size of targetSizes(video.width, video.height)) {
      const name = "h264-" + size.height + "p.mp4",
        output = path.join(folder, name),
        began = performance.now(),
        maxrate =
          size.height <= 360
            ? 800
            : size.height <= 480
              ? 1400
              : size.height <= 720
                ? 2800
                : 5000;
      run(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        ref,
        "-vf",
        "scale=" + size.width + ":" + size.height + ":flags=bicubic",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        String(crf),
        "-maxrate",
        maxrate + "k",
        "-bufsize",
        maxrate * 2 + "k",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        output,
      ]);
      const encodingSeconds = (performance.now() - began) / 1000,
        encoded = probe(output),
        stream = encoded.streams.find((s) => s.codec_type === "video");
      if (
        stream.width !== size.width ||
        stream.height !== size.height ||
        Math.abs(Number(encoded.format.duration) - seconds) > 0.3
      )
        throw Error("OUTPUT_VERIFICATION_FAILED");
      const prefix =
        "[0:v]scale=" +
        video.width +
        ":" +
        video.height +
        ":flags=bicubic,setpts=PTS-STARTPTS[d];[1:v]setpts=PTS-STARTPTS[r];[d][r]";
      // spawnSync exposes stderr even when FFmpeg succeeds.
      const { spawnSync } = await import("node:child_process");
      const measure = (filter) => {
        const r = spawnSync(
          ffmpeg,
          [
            "-hide_banner",
            "-nostdin",
            "-i",
            output,
            "-i",
            ref,
            "-lavfi",
            prefix + filter,
            "-f",
            "null",
            "-",
          ],
          {
            cwd: folder,
            encoding: "utf8",
            timeout: 240000,
            maxBuffer: 12e6,
            windowsHide: true,
          },
        );
        if (r.status !== 0) throw Error("QUALITY_MEASUREMENT_FAILED");
        return r.stderr;
      };
      let vmaf = null;
      if (hasVmaf) {
        measure(
          "libvmaf=model=version=vmaf_v0.6.1:log_fmt=json:log_path=vmaf-" +
            size.height +
            ".json",
        );
        vmaf = JSON.parse(
          await readFile(
            path.join(folder, "vmaf-" + size.height + ".json"),
            "utf8",
          ),
        ).pooled_metrics.vmaf.mean;
      }
      const ssim = Number(/All:([0-9.]+)/.exec(measure("ssim"))?.[1]),
        psnrRaw = /average:([0-9.]+|inf)/.exec(measure("psnr"))?.[1],
        psnr = psnrRaw === "inf" ? "Infinity" : Number(psnrRaw);
      if (
        !Number.isFinite(ssim) ||
        !(psnr === "Infinity" || Number.isFinite(psnr))
      )
        throw Error("QUALITY_PARSE_FAILED");
      rows.push({
        sample: i,
        offsetSeconds: starts[i],
        height: size.height,
        width: size.width,
        bytes: Number(encoded.format.size),
        bitrateKbps:
          (Number(encoded.format.size) * 8) /
          Number(encoded.format.duration) /
          1000,
        durationSeconds: Number(encoded.format.duration),
        encodingSeconds,
        vmaf,
        ssim,
        psnr,
      });
      await writeFile(
        path.join(out, "progress.json"),
        JSON.stringify({
          samples: starts.length,
          completed: rows.length,
          last: { sample: i, height: size.height },
        }),
      );
    }
  }
  const report = {
    at: new Date().toISOString(),
    scope: "LOCAL_H264_EXPERIMENT_NOT_CLOUDINARY_PRESET",
    source: {
      sha256: hash.digest("hex"),
      width: video.width,
      height: video.height,
      durationSeconds: duration,
      codec: video.codec_name,
      transfer: video.color_transfer || "unknown",
      fps,
      bitrateKbps: Number(info.format.bit_rate) / 1000,
    },
    tool: version,
    encoding: {
      codec: "libx264",
      crf,
      preset: "medium",
      audio: false,
      scaler: "bicubic",
    },
    vmafStatus: hasVmaf ? "MEASURED" : "NOT_AVAILABLE",
    vmafModel: hasVmaf ? "vmaf_v0.6.1" : null,
    comparison:
      "Distorted upscaled bicubic to source resolution, timestamp-aligned FFV1 reference, video only",
    rows,
    limitations: [
      "Short temporal samples, not a representative film corpus.",
      "Audio bytes excluded; no CDN/network or player startup measurement.",
      "No production profile/asset changed; review visual quality before choosing a preset.",
    ],
  };
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      event: "encoding.benchmark",
      measurements: rows.length,
      vmafStatus: report.vmafStatus,
      output: path.join(out, "report.json"),
    }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((e) => {
    console.error(
      JSON.stringify({
        code: /^[A-Z0-9_]{3,80}$/.test(e.message)
          ? e.message
          : "ENCODING_BENCHMARK_FAILED",
      }),
    );
    process.exitCode = 1;
  });
}
