import "../../config/src/environment";
import { fail } from "../../backend-core/src/errors";

export const VIDEO_FORMATS = [
  "mp4",
  "mov",
  "mkv",
  "webm",
  "m4v",
  "avi",
] as const;
export function cloudinaryConfiguration() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret)
    fail("MEDIA_PROVIDER_UNAVAILABLE", "Cloudinary is not configured.");
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET ?? "pj_flim_video_signed";
  const maxBytes = Number(process.env.CLOUDINARY_MAX_VIDEO_BYTES ?? 104857600);
  const maxDurationSeconds = Number(
    process.env.CLOUDINARY_MAX_VIDEO_SECONDS ?? 21600,
  );
  const profile = process.env.CLOUDINARY_STREAMING_PROFILE ?? "hd";
  if (
    !/^[a-z0-9_-]{1,100}$/i.test(cloudName) ||
    !/^[0-9]{1,100}$/.test(apiKey) ||
    !/^[a-z0-9_-]{1,100}$/i.test(preset) ||
    !/^[a-z0-9_-]{1,80}$/i.test(profile) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 21474836480 ||
    !Number.isSafeInteger(maxDurationSeconds) ||
    maxDurationSeconds < 1 ||
    maxDurationSeconds > 86400
  )
    fail("MEDIA_PROVIDER_UNAVAILABLE", "Cloudinary configuration is invalid.");
  return {
    cloudName,
    apiKey,
    apiSecret,
    preset,
    maxBytes,
    maxDurationSeconds,
    profile,
  };
}
export type CloudinaryConfiguration = ReturnType<
  typeof cloudinaryConfiguration
>;
