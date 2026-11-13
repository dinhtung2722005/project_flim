import { RetryMediaDto } from "../dto/media.dto";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  CloudinaryProvider,
  UploadPolicy,
  VerifiedVideo,
} from "../../../../packages/media/src/cloudinary.provider";
import {
  cloudinaryConfiguration,
  VIDEO_FORMATS,
} from "../../../../packages/media/src/cloudinary.config";
import {
  ApiError,
  Principal,
  audit,
  checkMutation,
  fail,
  hash,
  json,
} from "../common";
import { CreateUploadIntentDto, VerifyUploadDto } from "../dto/media.dto";

import {
  createEncodingSnapshot,
  encodingPreset,
  processingConfigHash,
} from "../../../../packages/media/src/encoding-profiles";

@Injectable()
export class MediaService {
  constructor(
    private readonly db: Database,
    private readonly provider: CloudinaryProvider,
  ) {}
  private key(key: string | undefined) {
    if (!key) fail("IDEMPOTENCY_KEY_REQUIRED");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      fail(
        "VALIDATION_FAILED",
        "Idempotency-Key must contain 8-128 safe ASCII characters.",
      );
    return hash(key);
  }
  private async receipt(
    tx: Tx,
    actor: Principal,
    route: string,
    keyHash: string,
    fingerprint: string,
  ) {
    const scope = "user:" + actor.id;
    await query(
      tx,
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS locked",
      [JSON.stringify([scope, route, keyHash])],
    );
    const saved = await one(
      tx,
      "SELECT * FROM movie.idempotency_records WHERE actor_scope=$1 AND method='POST' AND route_key=$2 AND request_key_hash=$3",
      [scope, route, keyHash],
    );
    if (saved) {
      if (saved.request_fingerprint !== fingerprint)
        fail("IDEMPOTENCY_KEY_REUSED");
      if (new Date(saved.expires_at).getTime() <= Date.now())
        fail("IDEMPOTENCY_RESULT_EXPIRED");
      if (saved.state !== "COMPLETED") fail("IDEMPOTENCY_IN_PROGRESS");
    }
    return saved;
  }
  private async save(
    tx: Tx,
    actor: Principal,
    route: string,
    keyHash: string,
    fingerprint: string,
    id: string,
    status: number,
    body: object,
    operationId?: string,
  ) {
    await query(
      tx,
      "INSERT INTO movie.idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,state,resource_type,resource_id,operation_id,response_status,response_body,expires_at) VALUES ($1,'POST',$2,$3,$4,'COMPLETED','upload_intent',$5::uuid,$6::uuid,$7,$8::jsonb,now()+interval '24 hours') RETURNING id",
      [
        "user:" + actor.id,
        route,
        keyHash,
        fingerprint,
        id,
        operationId ?? null,
        status,
        JSON.stringify(body),
      ],
    );
  }
  private async intent(tx: Tx, actor: Principal, id: string, lock = false) {
    const row = await one(
      tx,
      "SELECT * FROM movie.upload_intents WHERE id=$1::uuid AND owner_user_id=$2::uuid" +
        (lock ? " FOR UPDATE" : ""),
      [id, actor.id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  private async episode(tx: Tx, id: string) {
    const row = await one(
      tx,
      "SELECT e.id,e.publication_status AS status,t.publication_status AS title_status FROM movie.episodes e JOIN movie.seasons s ON s.id=e.season_id JOIN movie.titles t ON t.id=s.title_id WHERE e.id=$1::uuid FOR UPDATE OF e FOR SHARE OF s,t",
      [id],
    );
    if (!row || [row.status, row.title_status].includes("ARCHIVED"))
      fail("RESOURCE_NOT_FOUND");
    return row;
  }
  private live(row: Record<string, any>) {
    if (row.status === "REJECTED")
      fail(
        "MEDIA_UPLOAD_MISMATCH",
        "This upload intent was rejected. Create a new intent.",
      );
    if (
      row.status !== "VERIFIED" &&
      (row.status === "EXPIRED" ||
        new Date(row.expires_at).getTime() <= Date.now())
    )
      fail("MEDIA_UPLOAD_INTENT_EXPIRED");
  }
  private async view(row: Record<string, any>) {
    const p = row.expected_policy as UploadPolicy;
    const pending =
      row.status === "PENDING" &&
      new Date(row.expires_at).getTime() > Date.now();
    return {
      id: row.id,
      episodeId: row.episode_id,
      assetId: p.assetId,
      internalVersion: p.internalVersion,
      status: !pending && row.status === "PENDING" ? "EXPIRED" : row.status,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      verifiedAt: row.verified_at
        ? new Date(row.verified_at).toISOString()
        : null,
      expectedBytes: p.expectedBytes,
      sourceFormat: p.sourceFormat,
      encodingPreset: p.encodingPreset ?? null,
      encoding: p.encoding ?? null,
      ...(pending ? { upload: this.provider.signedUpload(p) } : {}),
    };
  }
  async get(actor: Principal, id: string) {
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "media.upload");
      return this.view(await this.intent(tx, actor, id));
    });
  }
  async create(
    actor: Principal,
    episodeId: string,
    body: CreateUploadIntentDto,
    key: string | undefined,
  ) {
    const keyHash = this.key(key),
      route = "/admin/episodes/" + episodeId + "/upload-intents";
    const fingerprint = hash(
      JSON.stringify({
        episodeId,
        expectedBytes: body.expectedBytes,
        sourceFormat: body.sourceFormat,
        ...(body.encodingPreset ? { encodingPreset: body.encodingPreset } : {}),
      }),
    );
    // No provider request while holding a database transaction open.
    const previous = await this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "media.upload");
      const saved = await this.receipt(tx, actor, route, keyHash, fingerprint);
      if (!saved) return undefined;
      const intent = await this.intent(tx, actor, saved.resource_id);
      this.live(intent);
      return this.view(intent);
    });
    if (previous) return previous;
    const c = cloudinaryConfiguration();
    if (body.expectedBytes > c.maxBytes) fail("MEDIA_FILE_LIMIT_EXCEEDED");
    await this.provider.assertPreset();
    return this.db.$transaction(
      async (tx) => {
        await checkMutation(tx, actor, "media.upload");
        const saved = await this.receipt(
          tx,
          actor,
          route,
          keyHash,
          fingerprint,
        );
        if (saved) {
          const intent = await this.intent(tx, actor, saved.resource_id);
          this.live(intent);
          return this.view(intent);
        }
        // Serialize each user's issuance quota across different idempotency keys.
        await query(
          tx,
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS locked",
          ["media.issue:" + actor.id],
        );
        const count = await one(
          tx,
          "SELECT count(*)::int AS count FROM movie.upload_intents WHERE owner_user_id=$1::uuid AND created_at>now()-interval '1 hour'",
          [actor.id],
        );
        if (count!.count >= 10)
          fail("RATE_LIMITED", "At most ten upload intents per user per hour.");
        await this.episode(tx, episodeId);
        const version = await one(
          tx,
          "SELECT coalesce(max(internal_version),0)+1 AS version FROM movie.video_assets WHERE episode_id=$1::uuid",
          [episodeId],
        );
        const intentId = randomUUID(),
          assetId = randomUUID(),
          timestamp = Math.floor(Date.now() / 1000);
        const publicId = "pj-flim/episodes/" + episodeId + "/" + assetId;
        const policy: UploadPolicy = {
          assetId,
          internalVersion: version!.version,
          cloudName: c.cloudName,
          apiKey: c.apiKey,
          preset: c.preset,
          deliveryType: "authenticated",
          expectedBytes: body.expectedBytes,
          sourceFormat: body.sourceFormat,
          maxBytes: c.maxBytes,
          maxDurationSeconds: c.maxDurationSeconds,
          encodingPreset: encodingPreset(body.encodingPreset),
          streamingProfile: c.profile,
          profileVersion: "hls-" + c.profile + "-v1",
          signatureTimestamp: timestamp,
          parameters: {
            timestamp,
            public_id: publicId,
            type: "authenticated",
            upload_preset: c.preset,
            overwrite: false,
            use_filename: false,
            unique_filename: false,
            allowed_formats: [...VIDEO_FORMATS].join(","),
            context:
              "intent_id=" +
              intentId +
              "|episode_id=" +
              episodeId +
              "|asset_id=" +
              assetId +
              "|owner_user_id=" +
              actor.id,
          },
        };
        // Both references are reserved atomically before any upload credentials leave the API.
        await query(
          tx,
          "INSERT INTO movie.video_assets(id,episode_id,public_id,delivery_type,internal_version) VALUES ($1::uuid,$2::uuid,$3,'authenticated',$4) RETURNING id",
          [assetId, episodeId, publicId, version!.version],
        );
        const intent = await one(
          tx,
          "INSERT INTO movie.upload_intents(id,episode_id,owner_user_id,target_public_id,expected_policy,expires_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,to_timestamp($6::double precision)) RETURNING *",
          [
            intentId,
            episodeId,
            actor.id,
            publicId,
            JSON.stringify(policy),
            timestamp + 3600,
          ],
        );
        await audit(
          tx,
          actor,
          "media.upload_intent.created",
          "upload_intent",
          intentId,
          {
            episodeId,
            assetId,
            internalVersion: version!.version,
            expectedBytes: body.expectedBytes,
            sourceFormat: body.sourceFormat,
          },
        );
        // Store a reference only, never signed upload fields in replay receipts or audit.
        await this.save(tx, actor, route, keyHash, fingerprint, intentId, 201, {
          intentId,
        });
        return this.view(intent!);
      },
      { timeout: 10000 },
    );
  }
  async verify(
    actor: Principal,
    id: string,
    body: VerifyUploadDto,
    key: string | undefined,
  ): Promise<any> {
    const keyHash = this.key(key),
      route = "/admin/upload-intents/" + id + "/verifications";
    const fingerprint = hash(
      JSON.stringify({ intentId: id, episodeId: body.episodeId }),
    );
    const initial = await this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "media.upload");
      const saved = await this.receipt(tx, actor, route, keyHash, fingerprint);
      const intent = await this.intent(tx, actor, id);
      if (intent.episode_id !== body.episodeId) fail("MEDIA_UPLOAD_MISMATCH");
      if (saved) return { saved: saved.response_body, intent };
      this.live(intent);
      if (intent.status === "VERIFIED") return { completed: true, intent };
      await query(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS locked",
        ["media.verify:" + actor.id],
      );
      const budget = await one(
        tx,
        "SELECT count(*)::int AS count FROM movie.security_events WHERE user_id=$1::uuid AND category='media.verification.requested' AND received_at>now()-interval '1 hour'",
        [actor.id],
      );
      if (budget!.count >= 30)
        fail(
          "RATE_LIMITED",
          "At most thirty provider verification lookups per user per hour.",
        );
      await query(
        tx,
        "INSERT INTO movie.security_events(category,outcome,user_id,safe_metadata,request_id) VALUES ('media.verification.requested','SUCCESS',$1::uuid,$2::jsonb,$3) RETURNING id",
        [actor.id, JSON.stringify({ intentId: id }), actor.requestId],
      );
      return { intent };
    });
    if (initial.saved) return this.replay(initial.saved);
    let video: VerifiedVideo | undefined, rejection: string | undefined;
    if (!initial.completed) {
      const raw = await this.provider.lookup(
        initial.intent.target_public_id,
        initial.intent.expected_policy,
      );
      try {
        video = this.provider.inspect(raw, initial.intent);
      } catch (error) {
        if (
          error instanceof ApiError &&
          [
            "MEDIA_UPLOAD_MISMATCH",
            "MEDIA_FORMAT_UNSUPPORTED",
            "MEDIA_FILE_LIMIT_EXCEEDED",
          ].includes(error.code)
        )
          rejection = error.code;
        else throw error;
      }
    }
    const result = await this.db.$transaction(
      async (tx) => {
        await checkMutation(tx, actor, "media.upload");
        const saved = await this.receipt(
          tx,
          actor,
          route,
          keyHash,
          fingerprint,
        );
        if (saved) return saved.response_body;
        await this.episode(tx, body.episodeId);
        const intent = await this.intent(tx, actor, id, true);
        this.live(intent);
        let p = intent.expected_policy as UploadPolicy;
        const asset = await one(
          tx,
          "SELECT * FROM movie.video_assets WHERE id=$1::uuid AND episode_id=$2::uuid FOR UPDATE",
          [p.assetId, body.episodeId],
        );
        if (
          !asset ||
          asset.lifecycle_status !== "ACTIVE" ||
          asset.public_id !== intent.target_public_id
        )
          fail("MEDIA_UPLOAD_MISMATCH");
        if (intent.status === "VERIFIED") {
          const attempt = await one(
            tx,
            "SELECT operation_id FROM movie.media_attempts WHERE id=$1::uuid",
            [asset.current_attempt_id],
          );
          const completed = {
            intentId: id,
            episodeId: body.episodeId,
            assetId: asset.id,
            status: "VERIFIED",
            processingStatus: asset.processing_status,
            operationId: attempt?.operation_id ?? null,
            operationUrl: attempt
              ? "/api/v1/admin/operations/" + attempt.operation_id
              : null,
          };
          await this.save(
            tx,
            actor,
            route,
            keyHash,
            fingerprint,
            id,
            200,
            completed,
            attempt?.operation_id,
          );
          return completed;
        }
        if (rejection) {
          await query(
            tx,
            "UPDATE movie.upload_intents SET status='REJECTED' WHERE id=$1::uuid RETURNING id",
            [id],
          );
          await query(
            tx,
            "UPDATE movie.video_assets SET processing_status='FAILED',version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING id",
            [asset.id],
          );
          await audit(
            tx,
            actor,
            "media.upload_intent.rejected",
            "upload_intent",
            id,
            {
              episodeId: body.episodeId,
              assetId: asset.id,
              errorCode: rejection,
            },
          );
          const denied = { errorCode: rejection };
          await this.save(
            tx,
            actor,
            route,
            keyHash,
            fingerprint,
            id,
            422,
            denied,
          );
          return denied;
        }
        if (!video) fail("MEDIA_PROVIDER_BAD_RESPONSE");
        if (p.encodingPreset) {
          const encoding = createEncodingSnapshot(p.encodingPreset, video);
          p = {
            ...p,
            encoding,
            streamingProfile: encoding.profileName,
            profileVersion: encoding.profileVersion,
          };
        }
        const operationId = randomUUID(),
          attemptId = randomUUID();
        const configHash = processingConfigHash(p);
        await query(
          tx,
          "INSERT INTO movie.operations(id,owner_user_id,principal_scope,type,resource_type,resource_id) VALUES ($1::uuid,$2::uuid,$3,'MEDIA_PROCESSING','video_asset',$4::uuid) RETURNING id",
          [operationId, actor.id, "user:" + actor.id, asset.id],
        );
        await query(
          tx,
          "INSERT INTO movie.media_attempts(id,asset_id,operation_id,profile_version,config_hash,attempt_no,callback_context_hash) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,1,$6) RETURNING id",
          [
            attemptId,
            asset.id,
            operationId,
            p.profileVersion,
            configHash,
            hash(randomUUID()),
          ],
        );
        await query(
          tx,
          "INSERT INTO movie.media_outputs(attempt_id,format,profile_version,config_hash,status) VALUES ($1::uuid,'HLS',$2,$3,'PENDING') RETURNING id",
          [attemptId, p.profileVersion, configHash],
        );
        await query(
          tx,
          "UPDATE movie.video_assets SET provider_asset_id=$2,provider_version=$3,bytes=$4::bigint,duration_seconds=$5::numeric,width=$6,height=$7,source_format=$8,processing_status='UPLOADED',current_attempt_id=$9::uuid,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING id",
          [
            asset.id,
            video.assetId,
            video.version,
            video.bytes,
            video.duration,
            video.width,
            video.height,
            video.format,
            attemptId,
          ],
        );
        await query(
          tx,
          "UPDATE movie.upload_intents SET status='VERIFIED',verified_asset_id=$2::uuid,verified_at=now(),expected_policy=$3::jsonb WHERE id=$1::uuid RETURNING id",
          [id, asset.id, JSON.stringify(p)],
        );
        await audit(
          tx,
          actor,
          "media.upload_intent.verified",
          "upload_intent",
          id,
          {
            episodeId: body.episodeId,
            assetId: asset.id,
            operationId,
            attemptId,
            bytes: video.bytes,
            durationSeconds: video.duration,
            encodingPreset: p.encodingPreset ?? null,
            encodingDefinitionHash: p.encoding?.definitionHash ?? null,
          },
        );
        await query(
          tx,
          "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,operation_id,initiating_actor_id,correlation_id,payload) VALUES ('media.processing.requested','video_asset',$1::uuid,$2::bigint,$3::uuid,$4::uuid,$5,$6::jsonb) RETURNING id",
          [
            asset.id,
            (BigInt(asset.version) + 1n).toString(),
            operationId,
            actor.id,
            actor.requestId,
            JSON.stringify({
              intentId: id,
              assetId: asset.id,
              episodeId: body.episodeId,
              operationId,
              attemptId,
              configHash,
            }),
          ],
        );
        const completed = {
          intentId: id,
          episodeId: body.episodeId,
          assetId: asset.id,
          status: "VERIFIED",
          processingStatus: "UPLOADED",
          operationId,
          operationUrl: "/api/v1/admin/operations/" + operationId,
        };
        await this.save(
          tx,
          actor,
          route,
          keyHash,
          fingerprint,
          id,
          200,
          completed,
          operationId,
        );
        return completed;
      },
      { timeout: 10000 },
    );
    return this.replay(result);
  }

  async retry(
    actor: Principal,
    id: string,
    body: RetryMediaDto,
    key: string | undefined,
  ) {
    const keyHash = this.key(key),
      route = "/admin/media-assets/" + id + "/processing-attempts";
    const fingerprint = hash(
      JSON.stringify({ assetId: id, reason: body.reason }),
    );
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "media.retry");
      const receipt = await this.receipt(
        tx,
        actor,
        route,
        keyHash,
        fingerprint,
      );
      if (receipt) return receipt.response_body;
      const asset = await one(
        tx,
        "SELECT * FROM movie.video_assets WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!asset) fail("RESOURCE_NOT_FOUND");
      if (
        asset.lifecycle_status !== "ACTIVE" ||
        asset.processing_status === "READY"
      )
        fail("MEDIA_ASSET_IN_USE");
      const active = await one(
        tx,
        "SELECT id FROM movie.media_attempts WHERE asset_id=$1::uuid AND status NOT IN ('SUCCEEDED','FAILED','CANCELLED') LIMIT 1",
        [id],
      );
      if (active) fail("MEDIA_PROCESSING_ALREADY_ACTIVE");
      const intent = await one(
        tx,
        "SELECT * FROM movie.upload_intents WHERE verified_asset_id=$1::uuid AND status='VERIFIED'",
        [id],
      );
      if (!intent || !asset.provider_version || !asset.provider_asset_id)
        fail("MEDIA_NOT_READY");
      const p = intent.expected_policy as UploadPolicy;
      const attemptId = randomUUID(),
        operationId = randomUUID();
      const n = await one(
        tx,
        "SELECT coalesce(max(attempt_no),0)+1 AS n FROM movie.media_attempts WHERE asset_id=$1::uuid",
        [id],
      );
      const configHash = processingConfigHash(p);
      await query(
        tx,
        "INSERT INTO movie.operations(id,owner_user_id,principal_scope,type,resource_type,resource_id) VALUES ($1::uuid,$2::uuid,$3,'MEDIA_PROCESSING','video_asset',$4::uuid) RETURNING id",
        [operationId, actor.id, "user:" + actor.id, id],
      );
      await query(
        tx,
        "INSERT INTO movie.media_attempts(id,asset_id,operation_id,profile_version,config_hash,attempt_no,callback_context_hash) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7) RETURNING id",
        [
          attemptId,
          id,
          operationId,
          p.profileVersion,
          configHash,
          n!.n,
          hash(randomUUID()),
        ],
      );
      await query(
        tx,
        "INSERT INTO movie.media_outputs(attempt_id,format,profile_version,config_hash,status) VALUES ($1::uuid,'HLS',$2,$3,'PENDING') RETURNING id",
        [attemptId, p.profileVersion, configHash],
      );
      await query(
        tx,
        "UPDATE movie.video_assets SET current_attempt_id=$2::uuid,processing_status='UPLOADED',backup_status=CASE WHEN backup_status='VERIFIED' THEN 'VERIFIED' ELSE 'PENDING' END,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING id",
        [id, attemptId],
      );
      await audit(
        tx,
        actor,
        "media.processing.retried",
        "video_asset",
        id,
        { operationId, attemptId, attemptNo: n!.n },
        body.reason,
      );
      await query(
        tx,
        "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,operation_id,initiating_actor_id,correlation_id,payload) VALUES ('media.processing.requested','video_asset',$1::uuid,$2::bigint,$3::uuid,$4::uuid,$5,$6::jsonb) RETURNING id",
        [
          id,
          (BigInt(asset.version) + 1n).toString(),
          operationId,
          actor.id,
          actor.requestId,
          JSON.stringify({
            assetId: id,
            episodeId: asset.episode_id,
            intentId: intent.id,
            operationId,
            attemptId,
            configHash,
          }),
        ],
      );
      const result = {
        operationId,
        attemptId,
        assetId: id,
        status: "QUEUED",
        operationUrl: "/api/v1/admin/operations/" + operationId,
      };
      await query(
        tx,
        "INSERT INTO movie.idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,state,resource_type,resource_id,operation_id,response_status,response_body,expires_at) VALUES ($1,'POST',$2,$3,$4,'COMPLETED','video_asset',$5::uuid,$6::uuid,202,$7::jsonb,now()+interval '24 hours') RETURNING id",
        [
          "user:" + actor.id,
          route,
          keyHash,
          fingerprint,
          id,
          operationId,
          JSON.stringify(result),
        ],
      );
      return result;
    });
  }

  private replay(result: any) {
    if (result.errorCode) fail(result.errorCode);
    return json(result);
  }
}
