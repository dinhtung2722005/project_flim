import { Injectable } from "@nestjs/common";
import {
  Database,
  one,
  query,
} from "../../../../packages/database/src/database";
import { Principal, fail, hash, json, paginated, readCursor } from "../common";
import { PageDto } from "../dto/common.dto";
import { ProgressDto } from "../dto/library.dto";
import { ReportDto } from "../dto/reports.dto";
import { PlaybackService } from "./playback.service";
import { PublicCatalogService } from "./public-catalog.service";
import {
  ViewerRequest,
  budget,
  checkViewer,
  publicTitle,
  publicEpisode,
  titleFields,
} from "../viewer-common";
@Injectable()
export class LibraryService {
  constructor(
    private readonly db: Database,
    private readonly catalog: PublicCatalogService,
    private readonly playback: PlaybackService,
  ) {}
  async watchlist(actor: Principal, dto: PageDto) {
    const filter = { userId: actor.id },
      cursor = readCursor(dto.cursor, "me.watchlist", filter);
    return paginated(
      await query(
        this.db,
        "SELECT " +
          titleFields() +
          ",w.created_at AS saved_at,w.created_at::text AS __cursor_time FROM movie.watchlist w JOIN movie.titles t ON t.id=w.title_id WHERE w.user_id=$1::uuid AND " +
          publicTitle() +
          " AND ($2::timestamptz IS NULL OR (w.created_at,t.id)<($2::timestamptz,$3::uuid)) ORDER BY w.created_at DESC,t.id DESC LIMIT $4",
        [actor.id, cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
      ),
      dto.limit,
      "me.watchlist",
      filter,
      "saved_at",
    );
  }
  async add(actor: Principal, id: string) {
    return this.db.$transaction(async (tx) => {
      await checkViewer(tx, actor);
      await this.catalog.title(id, tx);
      const inserted = await one(
        tx,
        "INSERT INTO movie.watchlist(user_id,title_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING title_id",
        [actor.id, id],
      );
      return !!inserted;
    });
  }
  async remove(actor: Principal, id: string) {
    await this.db.$transaction(async (tx) => {
      await checkViewer(tx, actor);
      await query(
        tx,
        "DELETE FROM movie.watchlist WHERE user_id=$1::uuid AND title_id=$2::uuid RETURNING title_id",
        [actor.id, id],
      );
    });
  }
  private progressFields() {
    return "p.episode_id,p.session_id,p.asset_id,p.asset_version,p.resume_generation,p.last_sequence,p.position_seconds,p.watched_seconds,p.completed_at,p.updated_at";
  }
  async progress(actor: Principal, id: string) {
    await this.catalog.episode(id);
    const row = await one(
      this.db,
      "SELECT " +
        this.progressFields() +
        ",e.active_asset_id FROM movie.watch_progress p JOIN movie.episodes e ON e.id=p.episode_id WHERE p.user_id=$1::uuid AND p.episode_id=$2::uuid",
      [actor.id, id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    const eligible = row.active_asset_id === row.asset_id;
    const { active_asset_id, ...result } = row;
    return json({
      ...result,
      resume_eligible: eligible,
      position_seconds: eligible ? result.position_seconds : 0,
    });
  }
  async history(actor: Principal, dto: PageDto, continuing = false) {
    const resource = continuing ? "me.continue-watching" : "me.history",
      filter = { userId: actor.id },
      cursor = readCursor(dto.cursor, resource, filter);
    return paginated(
      await query(
        this.db,
        "SELECT p.episode_id AS id," +
          this.progressFields() +
          ",p.updated_at::text AS __cursor_time,e.number,e.name,e.title_id,t.slug,t.localized_title,t.poster_asset_ref,(p.asset_id=e.active_asset_id) AS resume_eligible FROM movie.watch_progress p JOIN movie.episodes e ON e.id=p.episode_id JOIN movie.titles t ON t.id=e.title_id JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE p.user_id=$1::uuid AND " +
          publicEpisode() +
          (continuing
            ? " AND p.completed_at IS NULL AND p.position_seconds>0 AND p.asset_id=e.active_asset_id"
            : "") +
          " AND ($2::timestamptz IS NULL OR (p.updated_at,p.episode_id)<($2::timestamptz,$3::uuid)) ORDER BY p.updated_at DESC,p.episode_id DESC LIMIT $4",
        [actor.id, cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
      ),
      dto.limit,
      resource,
      filter,
      "updated_at",
    );
  }
  async saveProgress(actor: Principal, id: string, dto: ProgressDto) {
    return this.db.$transaction(async (tx) => {
      await checkViewer(tx, actor);
      const head = await one(
        tx,
        "SELECT * FROM movie.resume_heads WHERE user_id=$1::uuid AND episode_id=$2::uuid FOR UPDATE",
        [actor.id, id],
      );
      if (!head || head.active_session_id !== dto.sessionId)
        fail("PROGRESS_SESSION_STALE");
      const session = await this.playback.own(
        tx,
        dto.sessionId,
        { actor, scope: "user:" + actor.id },
        undefined,
        true,
      );
      if (
        session.episode_id !== id ||
        session.resume_generation !== head.generation
      )
        fail("PROGRESS_SESSION_STALE");
      await this.catalog.episode(id, tx);
      const asset = await one(
        tx,
        "SELECT duration_seconds FROM movie.video_assets WHERE id=$1::uuid",
        [session.asset_id],
      );
      const duration = Number(asset!.duration_seconds);
      if (dto.positionSeconds > duration + 0.001)
        fail("PROGRESS_INTERVAL_INVALID", "Position exceeds video duration.");
      const old = await one(
        tx,
        "SELECT * FROM movie.watch_progress WHERE user_id=$1::uuid AND episode_id=$2::uuid FOR UPDATE",
        [actor.id, id],
      );
      const route = "/me/watch-progress/" + id,
        scope = "user:" + actor.id,
        key = hash(dto.sessionId + ":" + dto.sequence),
        fingerprint = hash(JSON.stringify(dto));
      const receipt = await one(
        tx,
        "SELECT request_fingerprint,response_body FROM movie.idempotency_records WHERE actor_scope=$1 AND method='PUT' AND route_key=$2 AND request_key_hash=$3",
        [scope, route, key],
      );
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint)
          fail("PROGRESS_SEQUENCE_CONFLICT");
        return { created: false, body: receipt.response_body };
      }
      if (
        old?.session_id === dto.sessionId &&
        BigInt(dto.sequence) <= old.last_sequence
      )
        fail("PROGRESS_SEQUENCE_CONFLICT");
      let intervals: number[][] =
        old && old.asset_id === session.asset_id ? old.watched_intervals : [];
      if (dto.intervalStartSeconds !== undefined) {
        const from = dto.intervalStartSeconds,
          to = dto.positionSeconds;
        if (from > to || from > duration) fail("PROGRESS_INTERVAL_INVALID");
        const since =
          old?.session_id === dto.sessionId
            ? new Date(old.updated_at)
            : new Date(session.created_at);
        const allowance =
          Math.max(0, (Date.now() - since.getTime()) / 1000) * 2 + 2;
        if (to - from > allowance)
          fail(
            "PROGRESS_INTERVAL_INVALID",
            "Watched interval exceeds elapsed playback time.",
          );
        intervals = [...intervals, [from, to]].sort((a, b) => a[0] - b[0]);
        const merged: number[][] = [];
        for (const [a, b] of intervals) {
          const last = merged.at(-1);
          if (last && a <= last[1] + 0.001) last[1] = Math.max(last[1], b);
          else merged.push([a, b]);
        }
        intervals = merged;
        if (intervals.length > 2000)
          fail(
            "PROGRESS_INTERVAL_INVALID",
            "Too many fragmented watched intervals.",
          );
      }
      const watched =
        Math.round(intervals.reduce((sum, [a, b]) => sum + b - a, 0) * 1000) /
        1000;
      const baseline = await one(
        tx,
        "SELECT response_body FROM movie.idempotency_records WHERE actor_scope=$1 AND method='PUT' AND route_key='progress.baseline' AND request_key_hash=$2",
        [scope, hash(session.id)],
      );
      const totalAllowance =
        Number(baseline?.response_body?.watchedSeconds ?? 0) +
        Math.max(
          0,
          (Date.now() - new Date(session.created_at).getTime()) / 1000,
        ) *
          2 +
        2;
      if (watched > totalAllowance)
        fail(
          "PROGRESS_INTERVAL_INVALID",
          "Total watched coverage exceeds session time budget.",
        );
      const ended =
        dto.ended &&
        (await one(
          tx,
          "SELECT 1 FROM movie.watch_events WHERE session_id=$1::uuid AND type='ended' AND position_seconds>=$2 LIMIT 1",
          [session.id, duration - 2],
        ));
      const complete =
        !!ended &&
        watched >= duration * 0.9 &&
        dto.positionSeconds >= duration - 2;
      const preserveComplete =
        old && old.asset_id === session.asset_id ? old.completed_at : null;
      const row = await one(
        tx,
        "INSERT INTO movie.watch_progress(user_id,episode_id,session_id,asset_id,asset_version,resume_generation,last_sequence,position_seconds,watched_intervals,watched_seconds,completed_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::bigint,$7::bigint,$8,$9::jsonb,$10,CASE WHEN $11::boolean THEN now() ELSE $12::timestamptz END) ON CONFLICT(user_id,episode_id) DO UPDATE SET session_id=EXCLUDED.session_id,asset_id=EXCLUDED.asset_id,asset_version=EXCLUDED.asset_version,resume_generation=EXCLUDED.resume_generation,last_sequence=EXCLUDED.last_sequence,position_seconds=EXCLUDED.position_seconds,watched_intervals=EXCLUDED.watched_intervals,watched_seconds=EXCLUDED.watched_seconds,completed_at=EXCLUDED.completed_at,updated_at=now() RETURNING *",
        [
          actor.id,
          id,
          session.id,
          session.asset_id,
          session.asset_version,
          head.generation,
          dto.sequence,
          dto.positionSeconds,
          JSON.stringify(intervals),
          watched,
          complete,
          preserveComplete,
        ],
      );
      const { user_id, watched_intervals, ...safe } = row!;
      const body = json(safe);
      await query(
        tx,
        "INSERT INTO movie.idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,state,resource_type,resource_id,response_status,response_body,expires_at) VALUES ($1,'PUT',$2,$3,$4,'COMPLETED','watch_progress',$5::uuid,$6,$7::jsonb,now()+interval '1 day') RETURNING id",
        [
          scope,
          route,
          key,
          fingerprint,
          id,
          old ? 200 : 201,
          JSON.stringify(body),
        ],
      );
      return { created: !old, body };
    });
  }
  async report(dto: ReportDto, req: ViewerRequest) {
    const viewer = await this.playback.viewer(req);
    await budget(
      this.db,
      "viewer.report",
      viewer.actor?.id ?? req.ip ?? "unknown",
      10,
      3600,
      req.requestId,
    );
    return this.db.$transaction(async (tx) => {
      if (viewer.actor) await checkViewer(tx, viewer.actor);
      if (!viewer.actor && !dto.playbackSessionId)
        fail("AUTHENTICATION_REQUIRED");
      if (dto.playbackSessionId) {
        const session = await this.playback.own(
          tx,
          dto.playbackSessionId,
          viewer,
          req.get("X-Playback-Management"),
        );
        const episode = await this.catalog.episode(session.episode_id, tx);
        if (
          episode.title_id !== dto.titleId ||
          (dto.episodeId && dto.episodeId !== session.episode_id)
        )
          fail("RESOURCE_NOT_FOUND");
      }
      await this.catalog.title(dto.titleId, tx);
      if (dto.episodeId) {
        const episode = await this.catalog.episode(dto.episodeId, tx);
        if (episode.title_id !== dto.titleId) fail("RESOURCE_NOT_FOUND");
      }
      const row = await one(
        tx,
        "INSERT INTO movie.content_reports(reporter_user_id,playback_session_id,title_id,episode_id,category,message) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6) RETURNING id,title_id,episode_id,category,message,status,created_at",
        [
          viewer.actor?.id ?? null,
          dto.playbackSessionId ?? null,
          dto.titleId,
          dto.episodeId ?? null,
          dto.category,
          dto.message,
        ],
      );
      return json(row);
    });
  }
  async reportDetail(id: string, req: ViewerRequest) {
    const viewer = await this.playback.viewer(req);
    return this.db.$transaction(async (tx) => {
      const row = await one(
        tx,
        "SELECT id,reporter_user_id,playback_session_id,title_id,episode_id,category,message,status,created_at,updated_at FROM movie.content_reports WHERE id=$1::uuid",
        [id],
      );
      if (!row) fail("RESOURCE_NOT_FOUND");
      if (row.reporter_user_id) {
        if (viewer.actor?.id !== row.reporter_user_id)
          fail("RESOURCE_NOT_FOUND");
        await checkViewer(tx, viewer.actor!);
      } else {
        const session = await this.playback.own(
          tx,
          row.playback_session_id,
          viewer,
          req.get("X-Playback-Management"),
          false,
          true,
        );
        if (session.user_id) fail("RESOURCE_NOT_FOUND");
      }
      const { reporter_user_id, playback_session_id, ...safe } = row;
      return json(safe);
    });
  }
}
