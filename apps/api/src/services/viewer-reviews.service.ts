import { Injectable } from "@nestjs/common";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  Principal,
  etag,
  fail,
  json,
  paginated,
  readCursor,
  requireMatch,
} from "../common";
import { checkViewer, budget, publicTitle } from "../viewer-common";
import { PageDto } from "../dto/common.dto";
import { ViewerReviewDto } from "../dto/viewer-reviews.dto";

@Injectable()
export class ViewerReviewsService {
  constructor(private readonly db: Database) {}
  private async visible(tx: Tx, titleId: string, lock = false) {
    if (
      !(await one(
        tx,
        "SELECT t.id FROM movie.titles t WHERE t.id=$1::uuid AND " +
          publicTitle() +
          (lock ? " FOR SHARE OF t" : ""),
        [titleId],
      ))
    )
      fail("RESOURCE_NOT_FOUND");
  }
  private tag(actor: Principal, titleId: string, row: any) {
    // Include the review UUID to fence stale edits after a delete/recreate.
    return etag(
      "viewer-review",
      actor.id + ":" + titleId,
      row ? row.id + ":" + row.version : "0",
    );
  }
  private async own(tx: Tx, actor: Principal, titleId: string) {
    return one(
      tx,
      "SELECT id,title_id,rating,content,contains_spoilers,moderation_status,moderation_reason,moderated_at,version,created_at,updated_at FROM movie.viewer_reviews WHERE user_id=$1::uuid AND title_id=$2::uuid",
      [actor.id, titleId],
    );
  }
  async list(titleId: string, dto: PageDto) {
    const filter = { titleId },
      cursor = readCursor(dto.cursor, "public.viewer-reviews", filter);
    return this.db.$transaction(
      async (tx) => {
        await this.visible(tx, titleId);
        const summary = await one(
          tx,
          "SELECT count(*)::int AS count,round(avg(r.rating),1)::float8 AS average FROM movie.viewer_reviews r JOIN movie.users u ON u.id=r.user_id WHERE r.title_id=$1::uuid AND u.status='ACTIVE' AND r.moderation_status='VISIBLE'",
          [titleId],
        );
        const rows = await query(
          tx,
          "SELECT r.id,r.rating,r.content,r.contains_spoilers,r.created_at,r.updated_at,u.display_name AS author,r.created_at::text AS __cursor_time FROM movie.viewer_reviews r JOIN movie.users u ON u.id=r.user_id WHERE r.title_id=$1::uuid AND u.status='ACTIVE' AND r.moderation_status='VISIBLE' AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT $4",
          [titleId, cursor?.[0] ?? null, cursor?.[1] ?? null, dto.limit + 1],
        );
        return {
          ...paginated(rows, dto.limit, "public.viewer-reviews", filter),
          summary: { ...summary, scale: 10, source: "PJ_FLIM_VIEWERS" },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async get(actor: Principal, titleId: string) {
    return this.db.$transaction(async (tx) => {
      await checkViewer(tx, actor);
      await this.visible(tx, titleId);
      const row = await this.own(tx, actor, titleId);
      return {
        body: { review: row ? json(row) : null },
        etag: this.tag(actor, titleId, row),
      };
    });
  }
  async save(
    actor: Principal,
    titleId: string,
    dto: ViewerReviewDto,
    match: string | undefined,
  ) {
    await budget(
      this.db,
      "viewer-review-write",
      actor.id,
      10,
      60,
      actor.requestId,
    );
    return this.db.$transaction(async (tx) => {
      await checkViewer(tx, actor);
      await query(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
        ["viewer-review:" + actor.id + ":" + titleId],
      );
      await this.visible(tx, titleId, true);
      const old = await this.own(tx, actor, titleId);
      this.match(actor, titleId, old, match);
      const row = await one(
        tx,
        old
          ? "UPDATE movie.viewer_reviews SET rating=$3,content=$4,contains_spoilers=$5,version=version+1,updated_at=clock_timestamp() WHERE user_id=$1::uuid AND title_id=$2::uuid RETURNING id,title_id,rating,content,contains_spoilers,moderation_status,moderation_reason,moderated_at,version,created_at,updated_at"
          : "INSERT INTO movie.viewer_reviews(user_id,title_id,rating,content,contains_spoilers) VALUES($1::uuid,$2::uuid,$3,$4,$5) RETURNING id,title_id,rating,content,contains_spoilers,moderation_status,moderation_reason,moderated_at,version,created_at,updated_at",
        [actor.id, titleId, dto.rating, dto.content, dto.containsSpoilers],
      );
      return {
        body: { review: json(row) },
        etag: this.tag(actor, titleId, row),
      };
    });
  }
  private match(actor: Principal, titleId: string, row: any, header?: string) {
    // Use the shared precondition/error-code contract.
    requireMatch(
      header,
      "viewer-review",
      actor.id + ":" + titleId,
      row ? row.id + ":" + row.version : "0",
    );
  }
  async remove(actor: Principal, titleId: string, match?: string) {
    return this.db.$transaction(async (tx) => {
      await checkViewer(tx, actor);
      await query(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text",
        ["viewer-review:" + actor.id + ":" + titleId],
      );
      const row = await this.own(tx, actor, titleId);
      this.match(actor, titleId, row, match);
      await query(
        tx,
        "DELETE FROM movie.viewer_reviews WHERE user_id=$1::uuid AND title_id=$2::uuid RETURNING id",
        [actor.id, titleId],
      );
      return this.tag(actor, titleId, null);
    });
  }
}
