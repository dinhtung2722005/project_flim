import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import { CloudinaryProvider } from "../../../../packages/media/src/cloudinary.provider";
import { cloudinaryConfiguration } from "../../../../packages/media/src/cloudinary.config";
import { Principal, fail, hash, json, secureEqual } from "../common";
import { configuration } from "../config";
import { encrypt, decrypt } from "../security";
import { AuthService } from "./auth.service";
import {
  ViewerRequest,
  optionalActor,
  privateHash,
  budget,
  checkViewer,
  assetReady,
} from "../viewer-common";
import { EventsDto } from "../dto/playback.dto";
type Viewer = { actor?: Principal; guestHash?: string; scope: string };
@Injectable()
export class PlaybackService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly provider: CloudinaryProvider,
  ) {}
  token(id: string, kind: "management" | "telemetry") {
    return createHmac("sha256", configuration().cursor)
      .update("playback:" + kind + ":" + id)
      .digest("hex");
  }
  async viewer(req: ViewerRequest, creating = false): Promise<Viewer> {
    const actor = await optionalActor(req, this.auth);
    if (actor) return { actor, scope: "user:" + actor.id };
    if (creating && process.env.ALLOW_GUEST_PLAYBACK === "false")
      fail("AUTHENTICATION_REQUIRED");
    const guest = req.get("X-Guest-Id");
    if (creating && (!guest || !/^[A-Za-z0-9_-]{43,128}$/.test(guest)))
      fail(
        "VALIDATION_FAILED",
        "Guest playback requires X-Guest-Id with 43-128 random URL-safe characters.",
      );
    const guestHash = guest ? privateHash("guest:" + guest) : undefined;
    return {
      guestHash,
      scope: guestHash ? "guest:" + guestHash : "guest:unknown",
    };
  }
  async own(
    tx: Tx,
    id: string,
    viewer: Viewer,
    proof?: string,
    lock = false,
    allowClosed = false,
  ) {
    if (viewer.actor) await checkViewer(tx, viewer.actor);
    const row = await one(
      tx,
      "SELECT * FROM movie.playback_sessions WHERE id=$1::uuid" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    if (row.user_id) {
      if (!viewer.actor || viewer.actor.id !== row.user_id)
        fail("RESOURCE_NOT_FOUND");
    } else if (!proof || !secureEqual(hash(proof), row.management_token_hash))
      fail("RESOURCE_NOT_FOUND");
    if (!allowClosed) this.live(row);
    return row;
  }
  live(row: Record<string, any>) {
    if (row.revoked_at || row.closed_at) fail("PLAYBACK_SESSION_REVOKED");
    if (new Date(row.expires_at).getTime() <= Date.now())
      fail("PLAYBACK_SESSION_EXPIRED");
  }
  private key(value?: string) {
    if (!value) fail("IDEMPOTENCY_KEY_REQUIRED");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value))
      fail("VALIDATION_FAILED", "Invalid Idempotency-Key.");
    return hash(value);
  }
  private async receipt(
    tx: Tx,
    scope: string,
    route: string,
    key: string,
    fingerprint: string,
  ) {
    await query(
      tx,
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
      [JSON.stringify([scope, route, key])],
    );
    const row = await one(
      tx,
      "SELECT * FROM movie.idempotency_records WHERE actor_scope=$1 AND method='POST' AND route_key=$2 AND request_key_hash=$3",
      [scope, route, key],
    );
    if (!row) return;
    if (row.request_fingerprint !== fingerprint) fail("IDEMPOTENCY_KEY_REUSED");
    if (new Date(row.expires_at).getTime() <= Date.now())
      fail("IDEMPOTENCY_RESULT_EXPIRED");
    if (row.state !== "COMPLETED") fail("IDEMPOTENCY_IN_PROGRESS");
    return JSON.parse(
      decrypt(Buffer.from(row.response_body.encrypted, "base64")),
    );
  }
  private async save(
    tx: Tx,
    scope: string,
    route: string,
    key: string,
    fingerprint: string,
    body: Record<string, any>,
    status: number,
  ) {
    await query(
      tx,
      "INSERT INTO movie.idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,state,resource_type,resource_id,response_status,response_body,expires_at) VALUES ($1,'POST',$2,$3,$4,'COMPLETED','playback_session',$5::uuid,$6,$7::jsonb,now()+interval '24 hours') RETURNING id",
      [
        scope,
        route,
        key,
        fingerprint,
        body.id,
        status,
        JSON.stringify({
          encrypted: encrypt(JSON.stringify(body)).toString("base64"),
        }),
      ],
    );
  }
  private async playable(tx: Tx, episodeId: string, pinnedAssetId?: string) {
    const parent = await one(
      tx,
      "SELECT title_id FROM movie.episodes WHERE id=$1::uuid",
      [episodeId],
    );
    if (!parent) fail("RESOURCE_NOT_FOUND");
    const title = await one(
      tx,
      "SELECT publication_status FROM movie.titles WHERE id=$1::uuid FOR SHARE",
      [parent.title_id],
    );
    const episode = await one(
      tx,
      "SELECT id,active_asset_id,publication_status FROM movie.episodes WHERE id=$1::uuid FOR SHARE",
      [episodeId],
    );
    if (
      title?.publication_status !== "PUBLISHED" ||
      episode?.publication_status !== "PUBLISHED"
    )
      fail("RESOURCE_NOT_FOUND");
    const asset = await one(
      tx,
      "SELECT a.*,ma.profile_version,ui.expected_policy FROM movie.video_assets a JOIN movie.media_attempts ma ON ma.id=a.current_attempt_id LEFT JOIN movie.upload_intents ui ON ui.verified_asset_id=a.id WHERE a.id=$1::uuid AND a.episode_id=$2::uuid AND " +
        assetReady() +
        " FOR SHARE OF a",
      [pinnedAssetId ?? episode.active_asset_id, episodeId],
    );
    if (!asset) fail("RESOURCE_NOT_FOUND");
    if (asset.delivery_type !== "authenticated")
      fail(
        "PLAYBACK_ACCESS_DENIED",
        "Playback requires authenticated Cloudinary delivery.",
      );
    return asset;
  }
  private assertDelivery() {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.PLAYBACK_ALLOW_NON_EXPIRING_URLS !== "true"
    )
      fail(
        "SERVICE_UNAVAILABLE",
        "Configure CDN access protection or explicitly allow non-expiring signed delivery before production playback.",
      );
  }
  private response(row: Record<string, any>, asset: Record<string, any>) {
    this.assertDelivery();
    const c = cloudinaryConfiguration(),
      p = asset.expected_policy;
    if (p && (p.cloudName !== c.cloudName || p.apiKey !== c.apiKey))
      fail("MEDIA_PROVIDER_UNAVAILABLE");
    const profile = p?.streamingProfile ?? c.profile;
    return json({
      id: row.id,
      episodeId: row.episode_id,
      assetId: row.asset_id,
      assetVersion: row.asset_version,
      mode: row.mode,
      expiresAt: row.expires_at,
      maxExpiresAt: row.max_expires_at,
      deliveryGeneration: row.delivery_generation,
      resumeGeneration: row.resume_generation,
      durationSeconds: asset.duration_seconds,
      managementToken: row.user_id
        ? undefined
        : this.token(row.id, "management"),
      telemetryToken: this.token(row.id, "telemetry"),
      delivery: {
        url: this.provider.playbackUrl(asset, profile),
        format: "HLS",
        authorization: "SIGNED_URL",
        expiresAt: null,
        revocation: "SESSION_ONLY",
      },
      capabilities: { adaptiveBitrate: true, seek: true },
    });
  }
  async create(episodeId: string, req: ViewerRequest, keyValue?: string) {
    const viewer = await this.viewer(req, true),
      key = this.key(keyValue);
    await budget(
      this.db,
      "viewer.playback.create",
      req.ip ?? "unknown",
      60,
      600,
      req.requestId,
    );
    return this.db.$transaction(async (tx) => {
      if (viewer.actor) await checkViewer(tx, viewer.actor);
      const route = "/episodes/" + episodeId + "/playback-sessions",
        fingerprint = hash(JSON.stringify({ episodeId }));
      const cached = await this.receipt(
        tx,
        viewer.scope,
        route,
        key,
        fingerprint,
      );
      if (cached) {
        const row = await this.own(
          tx,
          cached.id,
          viewer,
          cached.managementToken,
        );
        const asset = await this.playable(tx, episodeId, row.asset_id);
        this.response(row, asset);
        return cached;
      }
      await query(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
        ["playback.limit:" + viewer.scope],
      );
      const active = await one(
        tx,
        "SELECT count(*)::int AS n FROM movie.playback_sessions WHERE ((user_id=$1::uuid) OR (guest_id_hash=$2)) AND closed_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
        [viewer.actor?.id ?? null, viewer.guestHash ?? null],
      );
      if (active!.n >= (viewer.actor ? 3 : 2))
        fail("PLAYBACK_CONCURRENCY_LIMIT");
      const asset = await this.playable(tx, episodeId),
        id = randomUUID();
      let generation: bigint | null = null;
      if (viewer.actor) {
        await query(
          tx,
          "INSERT INTO movie.resume_heads(user_id,episode_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING generation",
          [viewer.actor.id, episodeId],
        );
        const head = await one(
          tx,
          "SELECT generation FROM movie.resume_heads WHERE user_id=$1::uuid AND episode_id=$2::uuid FOR UPDATE",
          [viewer.actor.id, episodeId],
        );
        generation = BigInt(head!.generation) + 1n;
      }
      const row = await one(
        tx,
        "INSERT INTO movie.playback_sessions(id,user_id,guest_id_hash,episode_id,asset_id,asset_version,management_token_hash,telemetry_token_hash,resume_generation,expires_at,max_expires_at) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9::bigint,now()+interval '30 minutes',now()+interval '6 hours') RETURNING *",
        [
          id,
          viewer.actor?.id ?? null,
          viewer.actor ? null : viewer.guestHash,
          episodeId,
          asset.id,
          asset.internal_version,
          hash(this.token(id, "management")),
          hash(this.token(id, "telemetry")),
          generation,
        ],
      );
      if (viewer.actor)
        await query(
          tx,
          "UPDATE movie.resume_heads SET generation=$3::bigint,active_session_id=$4::uuid,updated_at=now() WHERE user_id=$1::uuid AND episode_id=$2::uuid RETURNING generation",
          [viewer.actor.id, episodeId, generation, id],
        );
      if (viewer.actor) {
        const previous = await one(
          tx,
          "SELECT asset_id,watched_seconds FROM movie.watch_progress WHERE user_id=$1::uuid AND episode_id=$2::uuid",
          [viewer.actor.id, episodeId],
        );
        await query(
          tx,
          "INSERT INTO movie.idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,state,resource_type,resource_id,response_status,response_body,expires_at) VALUES ($1,'PUT','progress.baseline',$2,$2,'COMPLETED','playback_session',$3::uuid,200,$4::jsonb,now()+interval '1 day') RETURNING id",
          [
            viewer.scope,
            hash(id),
            id,
            JSON.stringify({
              watchedSeconds:
                previous?.asset_id === asset.id
                  ? Number(previous!.watched_seconds)
                  : 0,
            }),
          ],
        );
      }
      const response = this.response(row!, asset);
      await this.save(tx, viewer.scope, route, key, fingerprint, response, 201);
      return response;
    });
  }
  async get(id: string, req: ViewerRequest) {
    const viewer = await this.viewer(req);
    return this.db.$transaction(async (tx) => {
      const row = await this.own(
        tx,
        id,
        viewer,
        req.get("X-Playback-Management"),
      );
      return this.response(
        row,
        await this.playable(tx, row.episode_id, row.asset_id),
      );
    });
  }
  async close(id: string, req: ViewerRequest) {
    const viewer = await this.viewer(req);
    await this.db.$transaction(async (tx) => {
      const row = await this.own(
        tx,
        id,
        viewer,
        req.get("X-Playback-Management"),
        true,
        true,
      );
      if (!row.closed_at)
        await query(
          tx,
          "UPDATE movie.playback_sessions SET closed_at=now() WHERE id=$1::uuid RETURNING id",
          [id],
        );
    });
  }
  async renew(id: string, req: ViewerRequest, keyValue?: string) {
    const viewer = await this.viewer(req),
      key = this.key(keyValue);
    await budget(
      this.db,
      "viewer.playback.renew",
      req.ip ?? "unknown",
      120,
      600,
      req.requestId,
    );
    return this.db.$transaction(async (tx) => {
      const row = await this.own(
        tx,
        id,
        viewer,
        req.get("X-Playback-Management"),
        true,
      );
      const scope = row.user_id
        ? "user:" + row.user_id
        : "guest:" + row.guest_id_hash;
      const route = "/playback-sessions/" + id + "/renewals",
        fingerprint = hash(JSON.stringify({ sessionId: id }));
      const cached = await this.receipt(tx, scope, route, key, fingerprint);
      const asset = await this.playable(tx, row.episode_id, row.asset_id);
      if (cached) {
        this.response(row, asset);
        return cached;
      }
      const next = await one(
        tx,
        "UPDATE movie.playback_sessions SET expires_at=LEAST(max_expires_at,now()+interval '30 minutes'),delivery_generation=delivery_generation+1 WHERE id=$1::uuid RETURNING *",
        [id],
      );
      const response = this.response(next!, asset);
      await this.save(tx, scope, route, key, fingerprint, response, 200);
      return response;
    });
  }
  async events(id: string, dto: EventsDto, req: ViewerRequest) {
    const token = req.get("X-Playback-Telemetry");
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      fail("AUTHENTICATION_REQUIRED");
    await budget(
      this.db,
      "viewer.playback.events",
      privateHash(token),
      240,
      60,
      req.requestId,
    );
    return this.db.$transaction(async (tx) => {
      const row = await one(
        tx,
        "SELECT s.*,a.duration_seconds FROM movie.playback_sessions s JOIN movie.video_assets a ON a.id=s.asset_id WHERE s.id=$1::uuid FOR UPDATE OF s",
        [id],
      );
      if (!row || !secureEqual(hash(token), row.telemetry_token_hash))
        fail("TELEMETRY_SESSION_MISMATCH");
      this.live(row);
      if (
        row.user_id &&
        !(await one(
          tx,
          "SELECT 1 FROM movie.users WHERE id=$1::uuid AND status='ACTIVE'",
          [row.user_id],
        ))
      )
        fail("PLAYBACK_SESSION_REVOKED");
      const bytes = Buffer.byteLength(JSON.stringify(dto)),
        fingerprint = hash(JSON.stringify(dto));
      if (bytes > 65536) fail("TELEMETRY_BATCH_INVALID");
      const duplicate = await one(
        tx,
        "SELECT id,payload_fingerprint FROM movie.playback_event_batches WHERE session_id=$1::uuid AND client_batch_id=$2::uuid",
        [id, dto.batchId],
      );
      if (duplicate) {
        if (duplicate.payload_fingerprint !== fingerprint)
          fail("TELEMETRY_BATCH_INVALID", "Batch ID has different content.");
        return {
          id: duplicate.id,
          batchId: dto.batchId,
          accepted: true,
          duplicate: true,
        };
      }
      const seen = new Set<string>();
      for (const event of dto.events) {
        if (
          seen.has(event.id) ||
          (event.positionSeconds ?? 0) > Number(row.duration_seconds) + 1 ||
          event.elapsedMs >
            Date.now() - new Date(row.created_at).getTime() + 10000
        )
          fail("TELEMETRY_BATCH_INVALID");
        seen.add(event.id);
        const saved = await one(
          tx,
          "SELECT payload_fingerprint FROM movie.watch_events WHERE session_id=$1::uuid AND client_event_id=$2::uuid",
          [id, event.id],
        );
        if (saved && saved.payload_fingerprint !== hash(JSON.stringify(event)))
          fail("TELEMETRY_BATCH_INVALID", "Event ID has different content.");
      }
      const batch = await one(
        tx,
        "INSERT INTO movie.playback_event_batches(session_id,client_batch_id,payload_fingerprint,event_count,payload_bytes) VALUES ($1::uuid,$2::uuid,$3,$4,$5) RETURNING id",
        [id, dto.batchId, fingerprint, dto.events.length, bytes],
      );
      for (const event of dto.events)
        await query(
          tx,
          "INSERT INTO movie.watch_events(session_id,client_event_id,sequence,type,elapsed_ms,position_seconds,payload,payload_fingerprint) VALUES ($1::uuid,$2::uuid,$3::bigint,$4,$5::bigint,$6,$7::jsonb,$8) ON CONFLICT(session_id,client_event_id) DO NOTHING RETURNING id",
          [
            id,
            event.id,
            event.sequence,
            event.type,
            event.elapsedMs,
            event.positionSeconds ?? null,
            JSON.stringify({
              errorCode: event.errorCode,
              height: event.height,
            }),
            hash(JSON.stringify(event)),
          ],
        );
      await query(
        tx,
        "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,initiating_actor_id,correlation_id,payload) VALUES ('playback.events.accepted','playback_event_batch',$1::uuid,1,$2::uuid,$3,$4::jsonb) RETURNING id",
        [
          batch!.id,
          row.user_id,
          req.requestId,
          JSON.stringify({ batchId: batch!.id, sessionId: id }),
        ],
      );
      return {
        id: batch!.id,
        batchId: dto.batchId,
        accepted: true,
        duplicate: false,
      };
    });
  }
}
