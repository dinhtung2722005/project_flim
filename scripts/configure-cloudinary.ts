import "../apps/api/src/config";
import { v2 as cloudinary } from "cloudinary";
import { mkdir, writeFile } from "node:fs/promises";
import { CloudinaryProvider } from "../packages/media/src/cloudinary.provider";
import {
  cloudinaryConfiguration,
  VIDEO_FORMATS,
} from "../packages/media/src/cloudinary.config";
import { ApiError } from "../apps/api/src/common";
async function main() {
  const provider = new CloudinaryProvider(),
    c = cloudinaryConfiguration(),
    options = provider.options();
  await cloudinary.api.ping(options);
  let created = false;
  try {
    await cloudinary.api.upload_preset(c.preset, options);
  } catch (error) {
    if (((error as any)?.http_code ?? (error as any)?.error?.http_code) !== 404)
      throw error;
    // Dedicated signed preset only. Existing presets are inspected, never overwritten.
    await cloudinary.api.create_upload_preset({
      ...options,
      name: c.preset,
      unsigned: false,
      overwrite: false,
      allowed_formats: [...VIDEO_FORMATS],
      use_filename: false,
      unique_filename: false,
    });
    created = true;
  }
  await provider.assertPreset();
  const profile = await cloudinary.api.get_streaming_profile(
    c.profile,
    options,
  );
  const summary = {
    checkedAt: new Date().toISOString(),
    connected: true,
    cloudName: c.cloudName,
    preset: c.preset,
    presetCreated: created,
    signedOnly: true,
    maxVideoBytes: c.maxBytes,
    maxDurationSeconds: c.maxDurationSeconds,
    streamingProfile: profile.data?.name ?? c.profile,
    deliveryType: "authenticated",
    note: "Provider/account limits may be lower than this application's configured maximum. Real long-video HLS must pass the separate smoke test.",
  };
  await mkdir(".local/media", { recursive: true });
  await writeFile(
    ".local/media/provider-check.json",
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary));
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "cloudinary.configuration.failed",
      code:
        error instanceof ApiError ? error.code : "MEDIA_PROVIDER_UNAVAILABLE",
      providerStatus:
        typeof error?.http_code === "number" ? error.http_code : undefined,
    }),
  );
  process.exitCode = 1;
});
