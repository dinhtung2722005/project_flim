import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError, hash } from "../../../packages/backend-core/src/errors";
import {
  CloudinaryProvider,
  UploadPolicy,
} from "../../../packages/media/src/cloudinary.provider";
import {
  BackupStorage,
  BackupResult,
} from "../../../packages/media/src/backup-storage";
import {
  MediaPending,
  verifyHls,
} from "../../../packages/media/src/hls-verifier";
import { workerConfiguration } from "./config";
import { WorkerStore, row, rows, systemAudit } from "./store";
import {
  assertEncodingSnapshot,
  processingConfigHash,
} from "../../../packages/media/src/encoding-profiles";

type Lease = {
  id: string;
  token: string;
  owner: string;
  handler: string;
  checkpoint: Record<string, any>;
  operationId: string;
  signal: AbortSignal;
};
class LeaseLost extends Error {}
type Context = {
  asset: Record<string, any>;
  attempt: Record<string, any>;
  intent: Record<string, any>;
  policy: UploadPolicy;
  actorId: string;
};
export class MediaWorker {
  readonly owner = randomUUID();
  readonly cfg = workerConfiguration();
  constructor(
    readonly store: WorkerStore,
    readonly provider = new CloudinaryProvider(),
    readonly backup = new BackupStorage(),
  ) {}
  async receiveEvent(id: string) {
    return this.store.tx(async (tx) => {
      const event = await row(
        tx,
        "SELECT * FROM movie.outbox_events WHERE id=$1",
        [id],
      );
      if (!event) return "dead" as const;
      let attemptId: string | undefined;
      if (event.type === "media.processing.requested") {
        const attempt = await row(
          tx,
          "SELECT id,operation_id FROM movie.media_attempts WHERE id=$1::uuid AND asset_id=$2::uuid AND operation_id=$3::uuid",
          [event.payload.attemptId, event.aggregate_id, event.operation_id],
        );
        if (!attempt) return "dead" as const;
        attemptId = attempt.id;
        for (const handler of ["media.hls", "media.backup"])
          await rows(
            tx,
            "INSERT INTO movie.job_runs(handler,logical_key,operation_id) VALUES ($1,$2,$3::uuid) ON CONFLICT(handler,logical_key) DO NOTHING RETURNING id",
            [handler, attemptId, attempt.operation_id],
          );
      } else if (event.type === "media.webhook.received") {
        const inbox = await row(
          tx,
          "SELECT * FROM movie.inbox_events WHERE id=$1::uuid AND attempt_id=$2::uuid FOR UPDATE",
          [event.payload.inboxId, event.aggregate_id],
        );
        if (!inbox) return "dead" as const;
        attemptId = inbox.attempt_id;
        await rows(
          tx,
          "UPDATE movie.job_runs SET next_attempt_at=now() WHERE handler='media.hls' AND logical_key=$1 AND state='WAITING' AND lease_owner IS NULL",
          [attemptId],
        );
        await rows(
          tx,
          "UPDATE movie.inbox_events SET status='PROCESSED',processed_at=now() WHERE id=$1 AND status='RECEIVED'",
          [inbox.id],
        );
      } else return "dead" as const;
      return "ack" as const;
    });
  }
  async context(attemptId: string): Promise<Context> {
    const attempt = await row(
      this.store.pool,
      "SELECT a.*,o.owner_user_id FROM movie.media_attempts a JOIN movie.operations o ON o.id=a.operation_id WHERE a.id=$1::uuid",
      [attemptId],
    );
    if (!attempt) throw new LeaseLost();
    const asset = await row(
      this.store.pool,
      "SELECT * FROM movie.video_assets WHERE id=$1::uuid",
      [attempt.asset_id],
    );
    const intent = await row(
      this.store.pool,
      "SELECT * FROM movie.upload_intents WHERE verified_asset_id=$1::uuid AND status='VERIFIED'",
      [attempt.asset_id],
    );
    if (
      !asset ||
      !intent ||
      asset.current_attempt_id !== attempt.id ||
      asset.lifecycle_status !== "ACTIVE" ||
      ["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status)
    )
      throw new LeaseLost();
    const permission = attempt.attempt_no > 1 ? "media.retry" : "media.upload";
    const actor = await row(
      this.store.pool,
      "SELECT u.id FROM movie.users u JOIN movie.user_roles ur ON ur.user_id=u.id JOIN movie.role_permissions rp ON rp.role_id=ur.role_id JOIN movie.permissions p ON p.id=rp.permission_id WHERE u.id=$1::uuid AND u.status='ACTIVE' AND p.code=$2 LIMIT 1",
      [attempt.owner_user_id, permission],
    );
    if (!actor) throw new ApiError("AUTH_FORBIDDEN");
    const policy = intent.expected_policy as UploadPolicy;
    if (policy.encodingPreset) {
      if (
        !policy.encoding ||
        policy.encodingPreset !== policy.encoding.presetId
      )
        throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
      assertEncodingSnapshot(policy.encoding, {
        width: asset.width,
        height: asset.height,
      });
      if (
        policy.streamingProfile !== policy.encoding.profileName ||
        policy.profileVersion !== policy.encoding.profileVersion ||
        attempt.profile_version !== policy.profileVersion ||
        attempt.config_hash !== processingConfigHash(policy)
      )
        throw new ApiError("MEDIA_PROVIDER_BAD_RESPONSE");
    }
    return {
      asset,
      attempt,
      intent,
      policy: intent.expected_policy as UploadPolicy,
      actorId: attempt.owner_user_id,
    };
  }
  private async guard(tx: PoolClient, lease: Lease, ctx: Context) {
    const job = await row(
      tx,
      "SELECT id FROM movie.job_runs WHERE id=$1 AND state='RUNNING' AND lease_owner=$2 AND lease_token=$3 AND lease_until>now() FOR UPDATE",
      [lease.id, lease.owner, lease.token],
    );
    if (!job) throw new LeaseLost();
    const asset = await row(
      tx,
      "SELECT * FROM movie.video_assets WHERE id=$1::uuid FOR UPDATE",
      [ctx.asset.id],
    );
    const attempt = await row(
      tx,
      "SELECT * FROM movie.media_attempts WHERE id=$1::uuid FOR UPDATE",
      [ctx.attempt.id],
    );
    if (
      !asset ||
      asset.current_attempt_id !== ctx.attempt.id ||
      asset.lifecycle_status !== "ACTIVE" ||
      !attempt ||
      ["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status)
    )
      throw new LeaseLost();
    const permitted = await row(
      tx,
      "SELECT u.id FROM movie.users u JOIN movie.user_roles ur ON ur.user_id=u.id JOIN movie.role_permissions rp ON rp.role_id=ur.role_id JOIN movie.permissions p ON p.id=rp.permission_id WHERE u.id=$1::uuid AND u.status='ACTIVE' AND p.code=$2 LIMIT 1",
      [
        ctx.actorId,
        ctx.attempt.attempt_no > 1 ? "media.retry" : "media.upload",
      ],
    );
    if (!permitted) throw new ApiError("AUTH_FORBIDDEN");
    return { asset, attempt };
  }
  private async checkpoint(
    lease: Lease,
    ctx: Context,
    checkpoint: Record<string, any>,
  ) {
    await this.store.tx(async (tx) => {
      await this.guard(tx, lease, ctx);
      await rows(
        tx,
        "UPDATE movie.job_runs SET checkpoint=$2::jsonb,updated_at=now() WHERE id=$1",
        [lease.id, JSON.stringify(checkpoint)],
      );
    });
    lease.checkpoint = checkpoint;
  }
  private async verifySource(ctx: Context) {
    const raw = await this.provider.lookup(ctx.asset.public_id, ctx.policy),
      video = this.provider.inspect(raw, ctx.intent);
    if (
      video.assetId !== ctx.asset.provider_asset_id ||
      video.version !== ctx.asset.provider_version ||
      BigInt(video.bytes) !== BigInt(ctx.asset.bytes)
    )
      throw new ApiError("MEDIA_UPLOAD_MISMATCH");
  }
  async run(id: string): Promise<"ack" | "dead"> {
    const claimed = await row(
      this.store.pool,
      "UPDATE movie.job_runs SET state='RUNNING',lease_owner=$2,lease_until=now()+($3::int*interval '1 second'),lease_token=lease_token+1,attempt_count=attempt_count+1,updated_at=now() WHERE id=$1 AND handler IN ('media.hls','media.backup') AND state IN ('PENDING','WAITING','RUNNING') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now() OR lease_owner LIKE 'dispatch:%') RETURNING *",
      [id, this.owner, this.cfg.leaseSeconds],
    );
    if (!claimed) return "ack";
    const abort = new AbortController();
    const lease: Lease = {
      id,
      token: claimed.lease_token,
      owner: this.owner,
      handler: claimed.handler,
      checkpoint: claimed.checkpoint,
      operationId: claimed.operation_id,
      signal: abort.signal,
    };
    let renewing = false;
    const heartbeat = setInterval(
      async () => {
        if (renewing) return;
        renewing = true;
        try {
          const r = await rows(
            this.store.pool,
            "UPDATE movie.job_runs SET lease_until=now()+($4::int*interval '1 second') WHERE id=$1 AND state='RUNNING' AND lease_owner=$2 AND lease_token=$3 AND lease_until>now() RETURNING id",
            [id, this.owner, lease.token, this.cfg.leaseSeconds],
          );
          if (!r.length) abort.abort();
        } catch {
          abort.abort();
        } finally {
          renewing = false;
        }
      },
      Math.floor((this.cfg.leaseSeconds * 1000) / 3),
    );
    let ctx: Context | undefined;
    try {
      ctx = await this.context(claimed.logical_key);
      await this.store.tx(async (tx) => {
        await this.guard(tx, lease, ctx!);
        const started = await row(
          tx,
          "UPDATE movie.operations SET status='RUNNING',progress=5,updated_at=now() WHERE id=$1::uuid AND status='QUEUED' RETURNING id",
          [ctx!.attempt.operation_id],
        );
        if (started)
          await systemAudit(
            tx,
            "media.processing.started",
            ctx!.asset.id,
            ctx!.attempt.operation_id,
            ctx!.actorId,
          );
        await rows(
          tx,
          "UPDATE movie.video_assets SET processing_status='PROCESSING',updated_at=now() WHERE id=$1::uuid AND processing_status='UPLOADED'",
          [ctx!.asset.id],
        );
      });
      if (claimed.handler === "media.hls") await this.hls(lease, ctx);
      else await this.copy(lease, ctx);
      return "ack";
    } catch (error) {
      if (abort.signal.aborted) return "ack";
      if (error instanceof LeaseLost) {
        await rows(
          this.store.pool,
          "UPDATE movie.job_runs SET state='FAILED',completed_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code='MEDIA_ASSET_IN_USE',updated_at=now() WHERE id=$1 AND state='RUNNING' AND lease_owner=$2 AND lease_token=$3 AND lease_until>now()",
          [lease.id, lease.owner, lease.token],
        );
        return "ack";
      }
      return await this.failure(lease, claimed.logical_key, error, ctx);
    } finally {
      clearInterval(heartbeat);
    }
  }
  private async hls(lease: Lease, ctx: Context) {
    if (
      Date.now() - new Date(ctx.attempt.created_at).getTime() >
      this.cfg.maxWaitSeconds * 1000
    )
      throw new ApiError("MEDIA_PROCESSING_FAILED");
    if (!lease.checkpoint.submittedAt) {
      await this.verifySource(ctx);
      if (!this.cfg.webhook) throw new ApiError("MEDIA_PROVIDER_UNAVAILABLE");
      const nonce = createHmac("sha256", this.cfg.callbackSecret)
        .update(
          [
            ctx.attempt.id,
            ctx.asset.id,
            ctx.asset.provider_version,
            ctx.attempt.config_hash,
          ].join("|"),
        )
        .digest("hex");
      const url = new URL(this.cfg.webhook);
      url.searchParams.set("attemptId", ctx.attempt.id);
      url.searchParams.set("context", nonce);
      const checkpoint = {
        ...lease.checkpoint,
        submittedAt: new Date().toISOString(),
        submissionState: "PREPARED",
      };
      await this.store.tx(async (tx) => {
        await this.guard(tx, lease, ctx);
        await rows(
          tx,
          "UPDATE movie.media_attempts SET callback_context_hash=$2,status='WAITING_PROVIDER',updated_at=now() WHERE id=$1::uuid",
          [ctx.attempt.id, hash(nonce)],
        );
        await rows(
          tx,
          "UPDATE movie.job_runs SET checkpoint=$2::jsonb,updated_at=now() WHERE id=$1",
          [lease.id, JSON.stringify(checkpoint)],
        );
      });
      lease.checkpoint = checkpoint;
      const response = await this.provider.requestHls(
        ctx.asset,
        ctx.policy,
        url.toString(),
      );
      if (response?.eager?.some((e: any) => e.status === "failed" || e.error))
        throw new ApiError("MEDIA_PROCESSING_FAILED");
      await this.store.tx(async (tx) => {
        await this.guard(tx, lease, ctx);
        if (response?.batch_id)
          await rows(
            tx,
            "UPDATE movie.media_attempts SET provider_batch_ref=$2 WHERE id=$1::uuid",
            [ctx.attempt.id, response.batch_id],
          );
        const cp = {
          ...checkpoint,
          submissionState: "ACCEPTED",
          batchId: response?.batch_id ?? null,
        };
        await rows(
          tx,
          "UPDATE movie.job_runs SET checkpoint=$2::jsonb WHERE id=$1",
          [lease.id, JSON.stringify(cp)],
        );
        lease.checkpoint = cp;
      });
    }
    const manifestUrl = this.provider.deliveryUrl(ctx.asset, ctx.policy, true);
    const summary = await verifyHls(
      manifestUrl,
      ctx.policy.cloudName,
      {
        width: ctx.asset.width,
        height: ctx.asset.height,
        duration: Number(ctx.asset.duration_seconds),
      },
      lease.signal,
      ctx.policy.encoding,
    );
    if (ctx.policy.encoding)
      await this.provider.assertStreamingProfile(ctx.policy.encoding);
    await this.verifySource(ctx);
    await this.store.tx(async (tx) => {
      await this.guard(tx, lease, ctx);
      const ref = JSON.stringify({
        provider: "CLOUDINARY",
        cloudName: ctx.policy.cloudName,
        publicId: ctx.asset.public_id,
        version: ctx.asset.provider_version,
        deliveryType: ctx.asset.delivery_type,
        streamingProfile: ctx.policy.streamingProfile,
        ...(ctx.policy.encoding
          ? {
              encodingPreset: ctx.policy.encoding.presetId,
              encodingDefinitionHash: ctx.policy.encoding.definitionHash,
            }
          : {}),
        format: "m3u8",
      });
      await rows(
        tx,
        "UPDATE movie.media_outputs SET status='READY',manifest_ref=$2,rendition_summary=$3::jsonb,verified_at=now() WHERE attempt_id=$1::uuid AND format='HLS' AND config_hash=$4 AND profile_version=$5",
        [
          ctx.attempt.id,
          ref,
          JSON.stringify(summary),
          ctx.attempt.config_hash,
          ctx.attempt.profile_version,
        ],
      );
      await rows(
        tx,
        "UPDATE movie.media_attempts SET status='VERIFYING_OUTPUT',updated_at=now() WHERE id=$1::uuid",
        [ctx.attempt.id],
      );
      await systemAudit(
        tx,
        "media.hls.verified",
        ctx.asset.id,
        ctx.attempt.operation_id,
        ctx.actorId,
        {
          renditions: summary.length,
          profileVersion: ctx.attempt.profile_version,
        },
      );
      await this.succeeded(tx, lease);
      await this.finish(tx, ctx);
    });
  }
  private async copy(lease: Lease, ctx: Context) {
    await this.verifySource(ctx);
    let saved = await row(
      this.store.pool,
      "SELECT * FROM movie.source_backups WHERE asset_id=$1::uuid AND storage_provider=$2",
      [ctx.asset.id, this.backup.driver === "s3" ? "S3" : "FILESYSTEM"],
    );
    let result: BackupResult | undefined;
    if (saved?.status === "VERIFIED") {
      result = await this.backup.verifyExisting(
        {
          provider: saved.storage_provider,
          bucket: saved.bucket,
          key: saved.object_key,
          version: saved.object_version,
          manifestRef: saved.source_manifest_ref,
          sha256: saved.sha256,
          bytes: Number(saved.bytes),
        },
        lease.signal,
      );
    } else {
      await this.store.tx(async (tx) => {
        await this.guard(tx, lease, ctx);
        await rows(
          tx,
          "UPDATE movie.video_assets SET backup_status='RUNNING',updated_at=now() WHERE id=$1::uuid",
          [ctx.asset.id],
        );
      });
      result = await this.backup.copySource(
        {
          url: this.provider.deliveryUrl(ctx.asset, ctx.policy),
          cloudName: ctx.policy.cloudName,
          assetId: ctx.asset.id,
          providerAssetId: ctx.asset.provider_asset_id,
          providerVersion: ctx.asset.provider_version,
          format: ctx.asset.source_format,
          bytes: Number(ctx.asset.bytes),
        },
        lease.signal,
      );
    }
    await this.verifySource(ctx);
    await this.store.tx(async (tx) => {
      await this.guard(tx, lease, ctx);
      await rows(
        tx,
        "INSERT INTO movie.source_backups(asset_id,storage_provider,bucket,object_key,object_version,source_manifest_ref,sha256,bytes,status,verified_at) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::bigint,'VERIFIED',now()) ON CONFLICT(asset_id,storage_provider) DO UPDATE SET bucket=excluded.bucket,object_key=excluded.object_key,object_version=excluded.object_version,source_manifest_ref=excluded.source_manifest_ref,sha256=excluded.sha256,bytes=excluded.bytes,status='VERIFIED',verified_at=now(),updated_at=now() RETURNING id",
        [
          ctx.asset.id,
          result!.provider,
          result!.bucket,
          result!.key,
          result!.version,
          result!.manifestRef,
          result!.sha256,
          result!.bytes,
        ],
      );
      await rows(
        tx,
        "UPDATE movie.video_assets SET backup_status='VERIFIED',updated_at=now() WHERE id=$1::uuid",
        [ctx.asset.id],
      );
      await systemAudit(
        tx,
        "media.backup.verified",
        ctx.asset.id,
        ctx.attempt.operation_id,
        ctx.actorId,
        {
          sha256: result!.sha256,
          bytes: result!.bytes,
          storageProvider: result!.provider,
        },
      );
      await this.succeeded(tx, lease);
      await this.finish(tx, ctx);
    });
  }
  private async succeeded(tx: PoolClient, lease: Lease) {
    await rows(
      tx,
      "UPDATE movie.job_runs SET state='SUCCEEDED',completed_at=now(),updated_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE id=$1",
      [lease.id],
    );
  }
  private async finish(tx: PoolClient, ctx: Context) {
    const complete = await row(
      tx,
      "SELECT 1 FROM movie.media_outputs o JOIN movie.source_backups b ON b.asset_id=$2::uuid WHERE o.attempt_id=$1::uuid AND o.format='HLS' AND o.config_hash=$3 AND o.profile_version=$4 AND o.status='READY' AND o.verified_at IS NOT NULL AND o.manifest_ref IS NOT NULL AND b.status='VERIFIED' AND b.sha256 IS NOT NULL AND b.bytes=$5::bigint AND b.verified_at IS NOT NULL LIMIT 1",
      [
        ctx.attempt.id,
        ctx.asset.id,
        ctx.attempt.config_hash,
        ctx.attempt.profile_version,
        ctx.asset.bytes,
      ],
    );
    if (!complete) {
      await rows(
        tx,
        "UPDATE movie.operations SET progress=GREATEST(progress,50),updated_at=now() WHERE id=$1::uuid AND status='RUNNING'",
        [ctx.attempt.operation_id],
      );
      return;
    }
    await rows(
      tx,
      "UPDATE movie.media_attempts SET status='SUCCEEDED',completed_at=now(),updated_at=now(),error_code=NULL WHERE id=$1::uuid",
      [ctx.attempt.id],
    );
    await rows(
      tx,
      "UPDATE movie.video_assets SET processing_status='READY',backup_status='VERIFIED',version=version+1,updated_at=now() WHERE id=$1::uuid",
      [ctx.asset.id],
    );
    await rows(
      tx,
      "UPDATE movie.operations SET status='SUCCEEDED',progress=100,completed_at=now(),updated_at=now(),error_code=NULL,error_message=NULL,error_retryable=NULL,result_ref=$2::jsonb WHERE id=$1::uuid",
      [
        ctx.attempt.operation_id,
        JSON.stringify({
          assetId: ctx.asset.id,
          attemptId: ctx.attempt.id,
          assetUrl: "/api/v1/admin/media-assets/" + ctx.asset.id,
        }),
      ],
    );
    await systemAudit(
      tx,
      "media.processing.succeeded",
      ctx.asset.id,
      ctx.attempt.operation_id,
      ctx.actorId,
    );
  }
  private async failure(
    lease: Lease,
    attemptId: string,
    error: unknown,
    ctx?: Context,
  ): Promise<"ack" | "dead"> {
    const pending = error instanceof MediaPending;
    const code =
      error instanceof ApiError
        ? error.code
        : pending
          ? "MEDIA_NOT_READY"
          : "SERVICE_UNAVAILABLE";
    const failures =
      Number(lease.checkpoint.failureCount ?? 0) + (pending ? 0 : 1);
    const terminal =
      !pending &&
      (failures >= this.cfg.maxFailures ||
        [
          "AUTH_FORBIDDEN",
          "MEDIA_UPLOAD_MISMATCH",
          "MEDIA_FORMAT_UNSUPPORTED",
          "MEDIA_PROCESSING_FAILED",
        ].includes(code));
    return this.store.tx(async (tx) => {
      const job = await row(
        tx,
        "SELECT * FROM movie.job_runs WHERE id=$1 AND state='RUNNING' AND lease_owner=$2 AND lease_token=$3 AND lease_until>now() FOR UPDATE",
        [lease.id, lease.owner, lease.token],
      );
      if (!job) return "ack";
      const checkpoint = { ...lease.checkpoint, failureCount: failures };
      if (!terminal) {
        const seconds = pending
          ? this.cfg.reconcileSeconds
          : Math.min(300, 2 ** Math.min(failures, 8));
        await rows(
          tx,
          "UPDATE movie.job_runs SET state='WAITING',lease_owner=NULL,lease_until=NULL,last_error_code=$2,checkpoint=$3::jsonb,next_attempt_at=now()+($4::int*interval '1 second'),updated_at=now() WHERE id=$1",
          [lease.id, code, JSON.stringify(checkpoint), seconds],
        );
        return "ack";
      }
      const attempt = await row(
        tx,
        "SELECT a.*,o.owner_user_id FROM movie.media_attempts a JOIN movie.operations o ON o.id=a.operation_id WHERE a.id=$1::uuid",
        [attemptId],
      );
      if (attempt) {
        const asset = await row(
          tx,
          "SELECT * FROM movie.video_assets WHERE id=$1::uuid FOR UPDATE",
          [attempt.asset_id],
        );
        await rows(
          tx,
          "SELECT id FROM movie.media_attempts WHERE id=$1::uuid FOR UPDATE",
          [attemptId],
        );
        if (
          asset?.current_attempt_id === attemptId &&
          !["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status)
        ) {
          await rows(
            tx,
            "UPDATE movie.media_attempts SET status='FAILED',error_code=$2,completed_at=now(),updated_at=now() WHERE id=$1::uuid",
            [attemptId, code],
          );
          await rows(
            tx,
            "UPDATE movie.video_assets SET processing_status='FAILED',backup_status=CASE WHEN $2 THEN 'FAILED' ELSE backup_status END,version=version+1,updated_at=now() WHERE id=$1::uuid",
            [asset.id, lease.handler === "media.backup"],
          );
          await rows(
            tx,
            "UPDATE movie.operations SET status='FAILED',error_code=$2,error_message='Media processing did not complete.',error_retryable=$3,completed_at=now(),updated_at=now() WHERE id=$1::uuid",
            [
              attempt.operation_id,
              code,
              ![
                "AUTH_FORBIDDEN",
                "MEDIA_UPLOAD_MISMATCH",
                "MEDIA_FORMAT_UNSUPPORTED",
              ].includes(code),
            ],
          );
          await systemAudit(
            tx,
            "media.processing.failed",
            asset.id,
            attempt.operation_id,
            attempt.owner_user_id,
            { errorCode: code, handler: lease.handler },
          );
        }
      }
      // Only lock this job. Siblings observe the terminal attempt in their fenced guard.
      await rows(
        tx,
        "UPDATE movie.job_runs SET state='FAILED',completed_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code=$2,checkpoint=$3::jsonb,updated_at=now() WHERE id=$1",
        [lease.id, code, JSON.stringify(checkpoint)],
      );
      return "dead";
    });
  }
}
