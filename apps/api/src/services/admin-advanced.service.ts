import { Injectable } from "@nestjs/common";
import {
  Database,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  Principal,
  audit,
  checkMutation,
  etag,
  fail,
  json,
  normalize,
  paginated,
  readCursor,
  requireMatch,
} from "../common";
import {
  AdminReviewQueryDto,
  ModerateReviewDto,
  CatalogHealthQueryDto,
} from "../dto/admin-advanced.dto";
import { assetReady } from "../viewer-common";
@Injectable()
export class AdminAdvancedService {
  constructor(private readonly db: Database) {}
  private fields =
    "r.id,r.title_id,t.localized_title AS title,r.rating,r.content,r.contains_spoilers,r.moderation_status,r.moderation_reason,r.moderated_at,r.version,r.created_at,r.updated_at,u.display_name AS author,u.status AS author_status";
  async reviews(actor: Principal, dto: AdminReviewQueryDto) {
    const filter = { status: dto.status ?? "", titleId: dto.titleId ?? "" },
      cursor = readCursor(dto.cursor, "admin.viewer-reviews", filter);
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "reviews.moderate");
      const rows = await query(
        tx,
        "SELECT " +
          this.fields +
          ",r.created_at::text AS __cursor_time FROM movie.viewer_reviews r JOIN movie.titles t ON t.id=r.title_id JOIN movie.users u ON u.id=r.user_id WHERE ($1='' OR r.moderation_status=$1) AND ($2::uuid IS NULL OR r.title_id=$2::uuid) AND ($3::timestamptz IS NULL OR (r.created_at,r.id)<($3::timestamptz,$4::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT $5",
        [
          filter.status,
          dto.titleId ?? null,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          dto.limit + 1,
        ],
      );
      return paginated(rows, dto.limit, "admin.viewer-reviews", filter);
    });
  }
  async review(actor: Principal, id: string) {
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "reviews.moderate");
      const r = await one(
        tx,
        "SELECT " +
          this.fields +
          " FROM movie.viewer_reviews r JOIN movie.titles t ON t.id=r.title_id JOIN movie.users u ON u.id=r.user_id WHERE r.id=$1::uuid",
        [id],
      );
      if (!r) fail("RESOURCE_NOT_FOUND");
      return { body: json(r), etag: etag("review-moderation", id, r!.version) };
    });
  }
  async moderate(
    actor: Principal,
    id: string,
    dto: ModerateReviewDto,
    match?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "reviews.moderate");
      const ref = await one(
        tx,
        "SELECT user_id,title_id FROM movie.viewer_reviews WHERE id=$1::uuid",
        [id],
      );
      if (!ref) fail("RESOURCE_NOT_FOUND");
      await query(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
        ["viewer-review:" + ref!.user_id + ":" + ref!.title_id],
      );
      const old = await one(
        tx,
        "SELECT moderation_status,version FROM movie.viewer_reviews WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!old) fail("RESOURCE_NOT_FOUND");
      requireMatch(match, "review-moderation", id, old!.version);
      if (old!.moderation_status !== dto.status) {
        await query(
          tx,
          "UPDATE movie.viewer_reviews SET moderation_status=$2,moderation_reason=$3,moderated_at=clock_timestamp(),moderated_by=$4::uuid,version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
          [id, dto.status, dto.reason, actor.id],
        );
        await audit(
          tx,
          actor,
          "viewer-review.moderated",
          "viewer_review",
          id,
          { beforeStatus: old!.moderation_status, afterStatus: dto.status },
          dto.reason,
        );
      }
      const r = await one(
        tx,
        "SELECT " +
          this.fields +
          " FROM movie.viewer_reviews r JOIN movie.titles t ON t.id=r.title_id JOIN movie.users u ON u.id=r.user_id WHERE r.id=$1::uuid",
        [id],
      );
      return { body: json(r), etag: etag("review-moderation", id, r!.version) };
    });
  }
  async health(actor: Principal, dto: CatalogHealthQueryDto) {
    const filter = { q: normalize(dto.q ?? ""), issue: dto.issue ?? "" },
      cursor = readCursor(dto.cursor, "admin.catalog-health", filter);
    const hasPlayable =
      "EXISTS(SELECT 1 FROM movie.episodes e JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE e.title_id=t.id AND e.publication_status='PUBLISHED' AND " +
      assetReady() +
      ")";
    const base =
      "WITH base AS (SELECT t.id,t.localized_title,t.publication_status,t.created_at,t.created_at::text AS __cursor_time," +
      hasPlayable +
      " AS video_ready,array_remove(ARRAY[CASE WHEN nullif(btrim(t.poster_asset_ref),'') IS NULL THEN 'NO_POSTER' END,CASE WHEN nullif(btrim(t.synopsis),'') IS NULL THEN 'NO_SYNOPSIS' END,CASE WHEN NOT EXISTS(SELECT 1 FROM movie.title_genres tg WHERE tg.title_id=t.id) THEN 'NO_GENRES' END,CASE WHEN t.release_year IS NULL THEN 'NO_YEAR' END,CASE WHEN nullif(btrim(t.original_language),'') IS NULL THEN 'NO_LANGUAGE' END,CASE WHEN NOT EXISTS(SELECT 1 FROM movie.credits c WHERE c.title_id=t.id) THEN 'NO_CREDITS' END,CASE WHEN NOT (" +
      hasPlayable +
      ") THEN 'NO_PLAYABLE_EPISODE' END,CASE WHEN t.publication_status='PUBLISHED' AND NOT (" +
      hasPlayable +
      ") THEN 'PUBLISHED_WITHOUT_PLAYABLE' END]::text[],NULL) AS issues FROM movie.titles t WHERE ($1='' OR t.normalized_title LIKE '%'||$1||'%')),filtered AS(SELECT * FROM base WHERE ($2='' OR $2=ANY(issues))) ";
    return this.db.$transaction(
      async (tx) => {
        await checkMutation(tx, actor, "catalog.read_drafts");
        const summary = await one(
          tx,
          base +
            "SELECT count(*)::text AS titles,count(*) FILTER(WHERE cardinality(issues)>0)::text AS needs_attention,count(*) FILTER(WHERE NOT video_ready)::text AS without_playable_video FROM filtered",
          [filter.q, filter.issue],
        );
        const rows = await query(
          tx,
          base +
            "SELECT * FROM filtered WHERE ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",
          [
            filter.q,
            filter.issue,
            cursor?.[0] ?? null,
            cursor?.[1] ?? null,
            dto.limit + 1,
          ],
        );
        return {
          ...paginated(rows, dto.limit, "admin.catalog-health", filter),
          summary: json(summary),
          checkedAt: new Date().toISOString(),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
