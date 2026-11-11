import { Controller, Post, Req, HttpCode } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createHash } from "node:crypto";
import type { Request } from "express";
import {
  Database,
  one,
  query,
} from "../../../../packages/database/src/database";
import { cloudinaryConfiguration } from "../../../../packages/media/src/cloudinary.config";
import { Public, fail, hash, secureEqual, uuid } from "../common";
@ApiExcludeController()
@Controller("webhooks")
export class CloudinaryWebhookController {
  constructor(private readonly db: Database) {}
  @Public()
  @Post("cloudinary")
  @HttpCode(200)
  async receive(@Req() req: Request) {
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) fail("WEBHOOK_PAYLOAD_INVALID");
    const timestamp = req.get("x-cld-timestamp") ?? "",
      signature = req.get("x-cld-signature") ?? "";
    if (
      !/^[0-9]{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    )
      fail("WEBHOOK_TIMESTAMP_INVALID");
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(signature))
      fail("WEBHOOK_SIGNATURE_INVALID");
    const secret = cloudinaryConfiguration().apiSecret;
    const expected = createHash(signature.length === 40 ? "sha1" : "sha256")
      .update(raw)
      .update(timestamp)
      .update(secret)
      .digest("hex");
    if (!secureEqual(signature.toLowerCase(), expected))
      fail("WEBHOOK_SIGNATURE_INVALID");
    let payload: any;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      fail("REQUEST_MALFORMED_JSON");
    }
    const attemptId =
      typeof req.query.attemptId === "string"
        ? uuid(req.query.attemptId)
        : fail("WEBHOOK_PAYLOAD_INVALID");
    const context =
      typeof req.query.context === "string" ? req.query.context : "";
    if (
      !/^[a-f0-9]{64}$/.test(context) ||
      !payload ||
      payload.notification_type !== "eager" ||
      typeof payload.public_id !== "string"
    )
      fail("WEBHOOK_PAYLOAD_INVALID");
    return this.db.$transaction(async (tx) => {
      const attempt = await one(
        tx,
        "SELECT a.*,v.public_id,v.provider_asset_id,v.provider_version,v.delivery_type,v.current_attempt_id,v.lifecycle_status,o.owner_user_id FROM movie.media_attempts a JOIN movie.video_assets v ON v.id=a.asset_id JOIN movie.operations o ON o.id=a.operation_id WHERE a.id=$1::uuid",
        [attemptId],
      );
      if (
        !attempt ||
        !secureEqual(attempt.callback_context_hash, hash(context))
      )
        fail("WEBHOOK_SIGNATURE_INVALID");
      if (
        payload.public_id !== attempt.public_id ||
        (payload.asset_id && payload.asset_id !== attempt.provider_asset_id) ||
        (payload.version &&
          String(payload.version) !== attempt.provider_version) ||
        (payload.resource_type && payload.resource_type !== "video") ||
        (payload.type && payload.type !== attempt.delivery_type) ||
        (attempt.provider_batch_ref &&
          payload.batch_id !== attempt.provider_batch_ref)
      )
        fail("WEBHOOK_PAYLOAD_INVALID");
      const safe = {
        notificationType: "eager",
        attemptId,
        publicId: payload.public_id,
        providerAssetId: attempt.provider_asset_id,
        providerVersion: attempt.provider_version,
        status:
          typeof payload.status === "string"
            ? payload.status.slice(0, 30)
            : "received",
        batchId:
          typeof payload.batch_id === "string"
            ? payload.batch_id.slice(0, 200)
            : null,
      };
      const late =
        attempt.current_attempt_id !== attemptId ||
        attempt.lifecycle_status !== "ACTIVE" ||
        ["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status);
      const inserted = await one(
        tx,
        "INSERT INTO movie.inbox_events(source,dedup_key,payload_fingerprint,verified_payload,status,attempt_id,error_code) VALUES ('CLOUDINARY',$1,$2,$3::jsonb,$4,$5::uuid,$6) ON CONFLICT(source,dedup_key) DO NOTHING RETURNING id",
        [
          hash(attemptId + "|" + hash(raw.toString("utf8"))),
          hash(raw.toString("utf8")),
          JSON.stringify(safe),
          late ? "REJECTED" : "RECEIVED",
          attemptId,
          late ? "MEDIA_ASSET_IN_USE" : null,
        ],
      );
      if (inserted && !late) {
        await query(
          tx,
          "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,operation_id,initiating_actor_id,payload) VALUES ('media.webhook.received','media_attempt',$1::uuid,1,$2::uuid,$3::uuid,$4::jsonb) RETURNING id",
          [
            attemptId,
            attempt.operation_id,
            attempt.owner_user_id,
            JSON.stringify({ inboxId: inserted.id, attemptId }),
          ],
        );
      }
      return { accepted: true, duplicate: !inserted, ignored: late };
    });
  }
}
