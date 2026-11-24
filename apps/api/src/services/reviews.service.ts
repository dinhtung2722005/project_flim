import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  ApiError,
  Principal,
  audit,
  checkMutation,
  fail,
  json,
  requireMatch,
  readCursor,
  paginated,
} from "../common";
import { budget, publicTitle } from "../viewer-common";
import { PageDto } from "../dto/common.dto";
import {
  TmdbReviewClient,
  reviewConfiguration,
  ReviewTitle,
} from "../../../../packages/reviews/src/tmdb";
export function reviewEtagVersion(row: any) {
  if (!row) return "0";
  return String(row.version) + "-" + row.generation;
}
@Injectable()
export class ReviewsService {
  constructor(private readonly db: Database) {}
  client() {
    return new TmdbReviewClient(reviewConfiguration().token);
  }
  private async title(id: string, tx: Tx = this.db, lock = false) {
    const row = await one(
      tx,
      "SELECT id,kind,localized_title,original_title,release_year,version FROM movie.titles WHERE id=$1::uuid" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row! as ReviewTitle & { id: string; version: bigint };
  }
  private async permission(actor: Principal) {
    await this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "catalog.write");
    });
    await budget(this.db, "review-admin", actor.id, 10, 60, actor.requestId);
  }
  async source(id: string) {
    const title = await this.title(id);
    const row = await one(
      this.db,
      "SELECT *,refreshed_at::text AS cache_version FROM movie.review_sources WHERE title_id=$1::uuid",
      [id],
    );
    const cfg = reviewConfiguration();
    return json({
      titleId: id,
      provider: "TMDB",
      configured: cfg.configured,
      enabled: cfg.enabled,
      externalId: row ? Number(row.external_id) : null,
      externalKind: row?.external_kind ?? null,
      sourceUrl: row?.source_url ?? null,
      verifiedAt: row?.verified_at ?? null,
      version: row?.version ?? 0n,
      cacheVersion: row?.cache_version ?? null,
      etagVersion: reviewEtagVersion(row),
      refreshedAt: row?.refreshed_at ?? null,
      expiresAt: row?.expires_at ?? null,
      lastError: row?.last_error ?? null,
      refreshing: !!row?.lease_until && new Date(row.lease_until) > new Date(),
      status: !cfg.enabled
        ? "DISABLED"
        : !cfg.configured
          ? "NOT_CONFIGURED"
          : !row
            ? "UNMAPPED"
            : row.title_version !== title.version
              ? "STALE"
              : !row.expires_at
                ? "NOT_FETCHED"
                : new Date(row.expires_at) <= new Date()
                  ? "STALE"
                  : "READY",
    });
  }
  async candidates(actor: Principal, id: string) {
    await this.permission(actor);
    if (!reviewConfiguration().enabled) fail("REVIEW_PROVIDER_NOT_CONFIGURED");
    return { data: await this.client().candidates(await this.title(id)) };
  }
  async map(
    actor: Principal,
    id: string,
    externalId: number,
    match: string | undefined,
  ) {
    await this.permission(actor);
    const before = await this.source(id);
    requireMatch(match, "review-source", id, before.etagVersion);
    if (!before.enabled) fail("REVIEW_PROVIDER_NOT_CONFIGURED");
    const title = await this.title(id),
      mapping = await this.client().verify(title, externalId);
    await this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "catalog.write");
      const currentTitle = await this.title(id, tx, true);
      if (currentTitle.version !== title.version)
        fail("RESOURCE_VERSION_MISMATCH");
      const old = await one(
        tx,
        "SELECT version,generation FROM movie.review_sources WHERE title_id=$1::uuid FOR UPDATE",
        [id],
      );
      requireMatch(match, "review-source", id, reviewEtagVersion(old));
      if (old) {
        await query(
          tx,
          "DELETE FROM movie.external_reviews WHERE title_id=$1::uuid RETURNING id",
          [id],
        );
        await query(
          tx,
          "UPDATE movie.review_sources SET external_kind=$2,external_id=$3,source_url=$4,verified_by=$5::uuid,verified_at=now(),title_version=$6::bigint,version=version+1,refreshed_at=NULL,expires_at=NULL,last_attempt_at=NULL,lease_id=NULL,lease_until=NULL,last_error=NULL WHERE title_id=$1::uuid RETURNING title_id",
          [
            id,
            mapping.kind,
            externalId,
            mapping.sourceUrl,
            actor.id,
            title.version,
          ],
        );
      } else
        await query(
          tx,
          "INSERT INTO movie.review_sources(title_id,external_kind,external_id,source_url,verified_by,title_version) VALUES($1::uuid,$2,$3,$4,$5::uuid,$6::bigint) RETURNING title_id",
          [
            id,
            mapping.kind,
            externalId,
            mapping.sourceUrl,
            actor.id,
            title.version,
          ],
        );
      await audit(tx, actor, "reviews.mapping.saved", "title", id, {
        provider: "TMDB",
        externalId,
        externalKind: mapping.kind,
      });
    });
    return this.source(id);
  }
  async remove(actor: Principal, id: string, match: string | undefined) {
    await this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "catalog.write");
      await this.title(id, tx, true);
      const row = await one(
        tx,
        "SELECT version,generation FROM movie.review_sources WHERE title_id=$1::uuid FOR UPDATE",
        [id],
      );
      requireMatch(match, "review-source", id, reviewEtagVersion(row));
      await query(
        tx,
        "DELETE FROM movie.review_sources WHERE title_id=$1::uuid RETURNING title_id",
        [id],
      );
      await audit(tx, actor, "reviews.mapping.removed", "title", id, {
        provider: "TMDB",
      });
    });
  }
  async sync(actor: Principal, id: string) {
    await this.permission(actor);
    const cfg = reviewConfiguration();
    if (!cfg.enabled || !cfg.configured) fail("REVIEW_PROVIDER_NOT_CONFIGURED");
    const lease = randomUUID();
    const reserved = await this.db.$transaction(async (tx) => {
      await checkMutation(tx, actor, "catalog.write");
      const title = await this.title(id, tx, true);
      const row = await one(
        tx,
        "SELECT *,clock_timestamp() AS db_now FROM movie.review_sources WHERE title_id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!row) fail("REVIEW_SOURCE_NOT_MAPPED");
      const now = +new Date(row.db_now);
      if (row.lease_until && +new Date(row.lease_until) > now)
        fail("REVIEW_SYNC_IN_PROGRESS");
      if (row.last_attempt_at && now - +new Date(row.last_attempt_at) < 60000)
        fail("RATE_LIMITED");
      await query(
        tx,
        "UPDATE movie.review_sources SET lease_id=$2::uuid,lease_until=clock_timestamp()+interval '45 seconds',last_attempt_at=clock_timestamp(),last_error=NULL WHERE title_id=$1::uuid RETURNING title_id",
        [id, lease],
      );
      await audit(tx, actor, "reviews.sync.started", "title", id, {
        provider: "TMDB",
        externalId: Number(row.external_id),
      });
      return { row, title };
    });
    try {
      const mapping = await this.client().verify(
        reserved.title,
        Number(reserved.row.external_id),
        AbortSignal.timeout(8000),
      );
      const payload = await this.client().reviews(mapping);
      await this.db.$transaction(async (tx) => {
        await checkMutation(tx, actor, "catalog.write");
        const title = await this.title(id, tx, true);
        const row = await one(
          tx,
          "SELECT *,clock_timestamp() AS db_now FROM movie.review_sources WHERE title_id=$1::uuid FOR UPDATE",
          [id],
        );
        if (
          !row ||
          row.lease_id !== lease ||
          +new Date(row.lease_until) <= +new Date(row.db_now) ||
          row.version !== reserved.row.version ||
          title.version !== reserved.title.version
        )
          fail("REVIEW_CONTEXT_CHANGED");
        await query(
          tx,
          "DELETE FROM movie.external_reviews WHERE title_id=$1::uuid RETURNING id",
          [id],
        );
        for (const item of payload.items)
          await query(
            tx,
            "INSERT INTO movie.external_reviews(title_id,external_id,author,content,rating,language,source_url,source_created_at,source_updated_at) VALUES($1::uuid,$2,$3,$4,$5::numeric,$6,$7,$8::timestamptz,$9::timestamptz) RETURNING id",
            [
              id,
              item.externalId,
              item.author,
              item.content,
              item.rating,
              item.language,
              item.sourceUrl,
              item.sourceCreatedAt,
              item.sourceUpdatedAt,
            ],
          );
        await query(
          tx,
          "UPDATE movie.review_sources SET refreshed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours',title_version=$2::bigint,lease_id=NULL,lease_until=NULL,last_error=NULL WHERE title_id=$1::uuid RETURNING title_id",
          [id, reserved.title.version],
        );
        await audit(tx, actor, "reviews.sync.completed", "title", id, {
          provider: "TMDB",
          count: payload.items.length,
          language: payload.language,
          truncated: payload.truncated,
        });
      });
      return {
        ...(await this.list(id, new PageDto(), true)),
        sync: {
          count: payload.items.length,
          language: payload.language,
          truncated: payload.truncated,
        },
      };
    } catch (error) {
      const code =
        error instanceof ApiError && error.code.startsWith("REVIEW_")
          ? error.code
          : "REVIEW_PROVIDER_UNAVAILABLE";
      // Release only this lease. A replaced/deleted mapping or a newer worker stays untouched.
      await this.db
        .$transaction(async (tx) => {
          const changed = await query(
            tx,
            "UPDATE movie.review_sources SET lease_id=NULL,lease_until=NULL,last_error=$3 WHERE title_id=$1::uuid AND lease_id=$2::uuid RETURNING title_id",
            [id, lease, code],
          );
          if (changed.length)
            await audit(tx, actor, "reviews.sync.failed", "title", id, {
              provider: "TMDB",
              code,
            });
        })
        .catch(() => {});
      throw error;
    }
  }
  async list(id: string, dto: PageDto, admin = false, evidence = false) {
    if (admin) await this.title(id);
    else if (
      !(await one(
        this.db,
        "SELECT t.id FROM movie.titles t WHERE t.id=$1::uuid AND " +
          publicTitle(),
        [id],
      ))
    )
      fail("RESOURCE_NOT_FOUND");
    const source = await this.source(id),
      filter = {
        id,
        version: source.etagVersion,
        verifiedAt: source.verifiedAt,
        refreshedAt: source.cacheVersion,
        admin,
      },
      cursor = readCursor(
        dto.cursor,
        admin ? "admin.reviews" : "public.reviews",
        filter,
      );
    const meta = {
      provider: "TMDB",
      status: source.status,
      refreshedAt: source.refreshedAt,
      expiresAt: source.expiresAt,
      attribution:
        "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      sourceUrl: source.sourceUrl,
      scope: "TMDB_USER_REVIEWS",
      ratingScale: 10,
      ...(evidence
        ? { revision: source.etagVersion, cacheVersion: source.cacheVersion }
        : {}),
    };
    if (source.status !== "READY")
      return {
        data: [],
        page: { limit: dto.limit, hasMore: false, nextCursor: null },
        meta,
      };
    const rows = await query(
      this.db,
      "SELECT r.id,r.author,r.content,r.rating,r.language,r.source_url,r.source_created_at,r.source_updated_at,r.fetched_at,r.fetched_at::text AS __cursor_time FROM movie.external_reviews r JOIN movie.review_sources s ON s.title_id=r.title_id JOIN movie.titles t ON t.id=r.title_id WHERE r.title_id=$1::uuid AND s.expires_at>clock_timestamp() AND s.version=$2::bigint AND s.title_version=t.version AND (s.version::text||'-'||s.generation::text)=$6 AND s.refreshed_at::text=$7 AND ($3::timestamptz IS NULL OR (r.fetched_at,r.id)<($3::timestamptz,$4::uuid))" +
        (admin ? "" : " AND " + publicTitle()) +
        " ORDER BY r.fetched_at DESC,r.id DESC LIMIT $5",
      [
        id,
        source.version,
        cursor?.[0] ?? null,
        cursor?.[1] ?? null,
        dto.limit + 1,
        source.etagVersion,
        source.cacheVersion,
      ],
    );
    return {
      ...paginated(
        rows,
        dto.limit,
        admin ? "admin.reviews" : "public.reviews",
        filter,
        "fetched_at",
      ),
      meta,
    };
  }
}
