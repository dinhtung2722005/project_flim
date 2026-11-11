import { Injectable } from "@nestjs/common";
import { v2 as cloudinary } from "cloudinary";
import { ApiError, fail } from "../../backend-core/src/errors";
import { cloudinaryConfiguration, VIDEO_FORMATS } from "./cloudinary.config";

cloudinary.config({ hide_sensitive: true });
export type UploadPolicy = {
  assetId: string;
  internalVersion: number;
  cloudName: string;
  apiKey: string;
  preset: string;
  deliveryType: "authenticated";
  expectedBytes: number;
  sourceFormat: string;
  maxBytes: number;
  maxDurationSeconds: number;
  streamingProfile: string;
  profileVersion: string;
  signatureTimestamp: number;
  parameters: Record<string, string | number | boolean>;
};
export type VerifiedVideo = {
  assetId: string;
  publicId: string;
  version: string;
  bytes: number;
  format: string;
  duration: number;
  width: number;
  height: number;
};
export function providerError(error: any): never {
  if (error instanceof ApiError) throw error;
  const cause = error?.error ?? error;
  const status = error?.http_code ?? cause?.http_code;
  const networkCode = cause?.code ?? cause?.message?.code;
  if (status === 404)
    fail("MEDIA_NOT_READY", "The upload is not available at Cloudinary yet.");
  if (
    status === 408 ||
    status === 499 ||
    status === 504 ||
    ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(networkCode) ||
    error?.name === "TimeoutError"
  )
    fail("MEDIA_PROVIDER_TIMEOUT");
  if (
    status === 401 ||
    status === 403 ||
    status === 420 ||
    status === 429 ||
    status >= 500 ||
    ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET"].includes(
      networkCode,
    )
  )
    fail("MEDIA_PROVIDER_UNAVAILABLE");
  fail("MEDIA_PROVIDER_BAD_RESPONSE");
}
@Injectable()
export class CloudinaryProvider {
  private presetCheck?: { key: string; expires: number };
  options() {
    const c = cloudinaryConfiguration();
    return {
      cloud_name: c.cloudName,
      api_key: c.apiKey,
      api_secret: c.apiSecret,
      secure: true,
      signature_algorithm: "sha256",
      timeout: 10000,
    };
  }
  async assertPreset() {
    const c = cloudinaryConfiguration();
    const key = JSON.stringify([c.cloudName, c.apiKey, c.preset, c.maxBytes]);
    if (this.presetCheck?.key === key && this.presetCheck.expires > Date.now())
      return;
    let preset: any;
    try {
      preset = await cloudinary.api.upload_preset(c.preset, this.options());
    } catch (error) {
      if (
        ((error as any)?.http_code ?? (error as any)?.error?.http_code) === 404
      )
        fail(
          "MEDIA_PROVIDER_UNAVAILABLE",
          "Create the signed video upload preset first.",
        );
      providerError(error);
    }
    const settings = preset.settings ?? {};
    const formats = Array.isArray(settings.allowed_formats)
      ? settings.allowed_formats
      : String(settings.allowed_formats ?? "").split(",");
    // Cloudinary presets do not support per-preset byte limits. Verify size after upload.
    // Incoming transformations would invalidate
    // the source byte comparison; eager output belongs to the processing worker.
    if (
      preset.unsigned !== false ||
      formats.length === 0 ||
      formats.some(
        (f: string) => !(VIDEO_FORMATS as readonly string[]).includes(f),
      ) ||
      (settings.transformation &&
        JSON.stringify(settings.transformation) !== "[]") ||
      (settings.eager && JSON.stringify(settings.eager) !== "[]") ||
      settings.folder ||
      settings.public_id_prefix ||
      settings.asset_folder ||
      settings.use_asset_folder_as_public_id_prefix === true ||
      settings.disallow_public_id === true
    )
      fail(
        "MEDIA_PROVIDER_UNAVAILABLE",
        "The signed upload preset does not match the video policy.",
      );
    this.presetCheck = { key, expires: Date.now() + 60000 };
  }
  signedUpload(policy: UploadPolicy) {
    const c = cloudinaryConfiguration();
    if (c.cloudName !== policy.cloudName || c.apiKey !== policy.apiKey)
      fail(
        "MEDIA_PROVIDER_UNAVAILABLE",
        "This upload intent belongs to another Cloudinary configuration.",
      );
    const sign: (params: object, secret: string, algorithm?: string) => string =
      cloudinary.utils.api_sign_request;
    const signature = sign(policy.parameters, c.apiSecret, "sha256");
    return {
      method: "POST",
      url: "https://api.cloudinary.com/v1_1/" + c.cloudName + "/video/upload",
      resourceType: "video",
      deliveryType: policy.deliveryType,
      chunkSize: 20 * 1024 * 1024,
      expectedBytes: policy.expectedBytes,
      maxBytes: policy.maxBytes,
      signatureExpiresAt: new Date(
        (policy.signatureTimestamp + 3600) * 1000,
      ).toISOString(),
      fields: { ...policy.parameters, api_key: c.apiKey, signature },
    };
  }
  async lookup(publicId: string, policy: UploadPolicy): Promise<any> {
    // Public ID, account and delivery type come exclusively from the database.
    this.signedUpload(policy);
    try {
      return await cloudinary.api.resource(publicId, {
        ...this.options(),
        resource_type: "video",
        type: policy.deliveryType,
        context: true,
        media_metadata: true,
      });
    } catch (error) {
      providerError(error);
    }
  }
  deliveryUrl(asset: Record<string, any>, policy: UploadPolicy, hls = false) {
    const c = cloudinaryConfiguration();
    this.signedUpload(policy);
    return cloudinary.url(asset.public_id, {
      cloud_name: c.cloudName,
      api_secret: c.apiSecret,
      secure: true,
      sign_url: true,
      resource_type: "video",
      type: policy.deliveryType,
      version: asset.provider_version,
      format: hls ? "m3u8" : asset.source_format,
      ...(hls ? { streaming_profile: policy.streamingProfile } : {}),
    });
  }
  playbackUrl(asset: Record<string, any>, profile: string) {
    const c = cloudinaryConfiguration();
    return cloudinary.url(asset.public_id, {
      cloud_name: c.cloudName,
      api_secret: c.apiSecret,
      secure: true,
      sign_url: true,
      resource_type: "video",
      type: "authenticated",
      version: asset.provider_version,
      format: "m3u8",
      streaming_profile: profile,
    });
  }
  async requestHls(
    asset: Record<string, any>,
    policy: UploadPolicy,
    callbackUrl: string,
  ) {
    this.signedUpload(policy);
    try {
      return await cloudinary.uploader.explicit(asset.public_id, {
        ...this.options(),
        resource_type: "video",
        type: policy.deliveryType,
        eager: [{ streaming_profile: policy.streamingProfile, format: "m3u8" }],
        eager_async: true,
        eager_notification_url: callbackUrl,
      });
    } catch (error) {
      providerError(error);
    }
  }
  inspect(raw: any, intent: Record<string, any>): VerifiedVideo {
    const p = intent.expected_policy as UploadPolicy;
    if (!raw || typeof raw !== "object") fail("MEDIA_PROVIDER_BAD_RESPONSE");
    const context = raw.context?.custom;
    if (
      raw.public_id !== intent.target_public_id ||
      raw.resource_type !== "video" ||
      raw.type !== p.deliveryType ||
      context?.intent_id !== intent.id ||
      context?.episode_id !== intent.episode_id ||
      context?.asset_id !== p.assetId ||
      context?.owner_user_id !== intent.owner_user_id
    )
      fail("MEDIA_UPLOAD_MISMATCH");
    if (
      !(VIDEO_FORMATS as readonly string[]).includes(raw.format) ||
      raw.format !== p.sourceFormat
    )
      fail("MEDIA_FORMAT_UNSUPPORTED");
    if (
      !Number.isSafeInteger(raw.bytes) ||
      raw.bytes < 1 ||
      !Number.isFinite(raw.duration) ||
      raw.duration <= 0 ||
      !Number.isInteger(raw.width) ||
      raw.width <= 0 ||
      !Number.isInteger(raw.height) ||
      raw.height <= 0 ||
      typeof raw.asset_id !== "string" ||
      !/^[a-z0-9_-]{1,128}$/i.test(raw.asset_id) ||
      !/^[1-9][0-9]{0,19}$/.test(String(raw.version)) ||
      !Number.isFinite(Date.parse(raw.created_at))
    )
      fail("MEDIA_PROVIDER_BAD_RESPONSE");
    if (raw.bytes > p.maxBytes || raw.duration > p.maxDurationSeconds)
      fail("MEDIA_FILE_LIMIT_EXCEEDED");
    if (
      raw.bytes !== p.expectedBytes ||
      Date.parse(raw.created_at) <
        new Date(intent.created_at).getTime() - 5000 ||
      Date.parse(raw.created_at) > new Date(intent.expires_at).getTime()
    )
      fail("MEDIA_UPLOAD_MISMATCH");
    return {
      assetId: raw.asset_id,
      publicId: raw.public_id,
      version: String(raw.version),
      bytes: raw.bytes,
      duration: raw.duration,
      width: raw.width,
      height: raw.height,
      format: raw.format,
    };
  }
}
