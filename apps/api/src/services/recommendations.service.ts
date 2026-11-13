import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import {
  Item,
  Signal,
  MODEL_VERSION,
  decayedWeight,
  rank,
} from "../../../../packages/recommendations/src/content";
import { Principal, fail, json, requireMatch, secureEqual } from "../common";
import { configuration } from "../config";
import {
  budget,
  checkViewer,
  publicTitle,
  publicEpisode,
  titleFields,
} from "../viewer-common";
import {
  RecommendationQueryDto,
  RecommendationPreferencesDto,
} from "../dto/recommendations.dto";
type SavedItem = {
  id: string;
  reason: "SIMILAR_CONTENT" | "RECENTLY_PUBLISHED";
};
type FeedCursor = {
  v: 1;
  owner: string;
  id: string;
  offset: number;
  model: string;
  surface: string;
  epoch: string;
  expires: number;
};
const complete = (alias = "t") =>
  `NOT EXISTS(SELECT 1 FROM movie.episodes ce JOIN movie.video_assets ca ON ca.id=ce.active_asset_id WHERE ce.title_id=${alias}.id AND ${publicEpisode("ce", "ca", alias)} AND NOT EXISTS(SELECT 1 FROM movie.watch_progress cp WHERE cp.user_id=$1::uuid AND cp.episode_id=ce.id AND cp.asset_id=ca.id AND cp.asset_version=ca.internal_version AND cp.completed_at IS NOT NULL))`;
@Injectable()
export class RecommendationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(RecommendationsService.name);
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.pruneExpired().catch(() =>
        this.logger.warn("recommendation.retention_failed"),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async pruneExpired() {
    return query(
      this.db,
      "WITH expired AS(SELECT id FROM movie.recommendation_snapshots WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED) DELETE FROM movie.recommendation_snapshots s USING expired e WHERE s.id=e.id RETURNING s.id",
    );
  }
  constructor(private readonly db: Database) {}
  private async preference(tx: Tx, actor: Principal) {
    await checkViewer(tx, actor);
    await query(
      tx,
      "INSERT INTO movie.recommendation_preferences(user_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING RETURNING user_id",
      [actor.id],
    );
    return (await one(
      tx,
      "SELECT * FROM movie.recommendation_preferences WHERE user_id=$1::uuid FOR UPDATE",
      [actor.id],
    ))!;
  }
  private view(row: Record<string, any>) {
    return json({
      enabled: row.enabled,
      hide_completed: row.hide_completed,
      version: row.version,
      updated_at: row.updated_at,
    });
  }
  async preferences(actor: Principal) {
    return this.db.$transaction(async (tx) =>
      this.view(await this.preference(tx, actor)),
    );
  }
  async update(
    actor: Principal,
    dto: RecommendationPreferencesDto,
    header: string | undefined,
  ) {
    return this.db.$transaction(async (tx) => {
      const old = await this.preference(tx, actor);
      requireMatch(header, "recommendation-preferences", actor.id, old.version);
      const row = await one(
        tx,
        "UPDATE movie.recommendation_preferences SET enabled=$2,hide_completed=$3,version=version+1,updated_at=now() WHERE user_id=$1::uuid RETURNING *",
        [actor.id, dto.enabled, dto.hideCompleted],
      );
      await query(
        tx,
        "DELETE FROM movie.recommendation_snapshots WHERE user_id=$1::uuid RETURNING id",
        [actor.id],
      );
      if (!dto.enabled)
        await query(
          tx,
          "DELETE FROM movie.recommendation_feedback WHERE user_id=$1::uuid RETURNING title_id",
          [actor.id],
        );
      return this.view(row!);
    });
  }
  async feedback(actor: Principal, id: string, remove = false) {
    await budget(
      this.db,
      "recommendation.feedback",
      actor.id,
      60,
      60,
      actor.requestId,
    );
    await this.db.$transaction(async (tx) => {
      const pref = await this.preference(tx, actor);
      if (remove) {
        await query(
          tx,
          "DELETE FROM movie.recommendation_feedback WHERE user_id=$1::uuid AND title_id=$2::uuid RETURNING title_id",
          [actor.id, id],
        );
        return;
      }
      if (!pref.enabled)
        fail(
          "RESOURCE_CONFLICT",
          "Enable personalization before giving recommendation feedback.",
        );
      if (
        !(await one(
          tx,
          "SELECT t.id FROM movie.titles t WHERE t.id=$1::uuid AND " +
            publicTitle(),
          [id],
        ))
      )
        fail("RESOURCE_NOT_FOUND");
      const count = await one(
        tx,
        "SELECT count(*)::int AS n FROM movie.recommendation_feedback WHERE user_id=$1::uuid",
        [actor.id],
      );
      if (
        count!.n >= 1000 &&
        !(await one(
          tx,
          "SELECT 1 FROM movie.recommendation_feedback WHERE user_id=$1::uuid AND title_id=$2::uuid",
          [actor.id, id],
        ))
      )
        fail("RATE_LIMITED");
      await query(
        tx,
        "INSERT INTO movie.recommendation_feedback(user_id,title_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING title_id",
        [actor.id, id],
      );
    });
  }
  private encode(cursor: FeedCursor) {
    const text = Buffer.from(JSON.stringify(cursor)).toString("base64url");
    return (
      text +
      "." +
      createHmac("sha256", configuration().cursor)
        .update(text)
        .digest("base64url")
    );
  }
  private decode(value: string, actor: Principal, surface: string): FeedCursor {
    try {
      const [text, signature, ...extra] = value.split(".");
      if (
        extra.length ||
        !signature ||
        !secureEqual(
          signature,
          createHmac("sha256", configuration().cursor)
            .update(text)
            .digest("base64url"),
        )
      )
        throw Error();
      const c = JSON.parse(
        Buffer.from(text, "base64url").toString(),
      ) as FeedCursor;
      if (
        c.v !== 1 ||
        c.owner !== actor.id ||
        c.surface !== surface ||
        c.model !== MODEL_VERSION ||
        !/^\d+$/.test(c.epoch) ||
        !/^[-0-9a-f]{36}$/.test(c.id) ||
        !Number.isInteger(c.offset) ||
        c.offset < 1 ||
        c.offset > 100 ||
        !Number.isSafeInteger(c.expires)
      )
        throw Error();
      return c;
    } catch {
      fail("REQUEST_INVALID_CURSOR");
    }
  }
  async feed(actor: Principal, dto: RecommendationQueryDto) {
    const cursor = dto.cursor
      ? this.decode(dto.cursor, actor, dto.surface)
      : null;
    if (!cursor)
      await budget(
        this.db,
        "recommendation.feed",
        actor.id,
        30,
        60,
        actor.requestId,
      );
    return this.db.$transaction(
      async (tx) => {
        const pref = await this.preference(tx, actor);
        let snapshot: Record<string, any> | undefined;
        if (cursor) {
          if (cursor.epoch !== pref.version.toString())
            fail("RECOMMENDATION_FEED_EXPIRED");
          snapshot = await one(
            tx,
            "SELECT * FROM movie.recommendation_snapshots WHERE id=$1::uuid AND user_id=$2::uuid AND preference_version=$3::bigint AND model_version=$4 AND surface=$5 AND expires_at>clock_timestamp()",
            [cursor.id, actor.id, pref.version, MODEL_VERSION, dto.surface],
          );
          if (
            !snapshot ||
            new Date(snapshot.expires_at).getTime() !== cursor.expires
          )
            fail("RECOMMENDATION_FEED_EXPIRED");
        } else {
          const candidates = await query(
            tx,
            "SELECT t.id FROM movie.titles t WHERE " +
              publicTitle() +
              " ORDER BY t.published_at DESC NULLS LAST,t.id LIMIT 1001",
          );
          const candidateIds = candidates
            .slice(0, 1000)
            .map((t) => t.id as string);
          const signals: Signal[] = [];
          if (pref.enabled) {
            const seeds = await query(
              tx,
              `SELECT w.title_id AS id,2 AS weight,w.created_at AS at FROM movie.watchlist w JOIN movie.titles t ON t.id=w.title_id WHERE w.user_id=$1::uuid AND ${publicTitle()} ORDER BY w.created_at DESC,w.title_id LIMIT 100`,
              [actor.id],
            );
            const progress = await query(
              tx,
              `SELECT e.title_id AS id,3 AS weight,max(p.updated_at) AS at FROM movie.watch_progress p JOIN movie.episodes e ON e.id=p.episode_id JOIN movie.titles t ON t.id=e.title_id JOIN movie.video_assets a ON a.id=e.active_asset_id WHERE p.user_id=$1::uuid AND p.asset_id=a.id AND p.asset_version=a.internal_version AND ${publicEpisode()} AND a.duration_seconds>0 AND p.watched_seconds>=least(a.duration_seconds,greatest(10,least(120,.2*a.duration_seconds))) GROUP BY e.title_id ORDER BY max(p.updated_at) DESC,e.title_id LIMIT 100`,
              [actor.id],
            );
            const weights = new Map<string, number>();
            for (const s of [...seeds, ...progress])
              weights.set(
                s.id,
                Math.min(
                  5,
                  (weights.get(s.id) || 0) +
                    decayedWeight(s.weight, new Date(s.at)),
                ),
              );
            for (const [id, weight] of weights) signals.push({ id, weight });
          }
          const ids = [
            ...new Set([...candidateIds, ...signals.map((s) => s.id)]),
          ];
          const rows = ids.length
            ? await query(
                tx,
                `SELECT t.id,t.localized_title,t.original_title,left(t.synopsis,5000) AS synopsis,t.release_year,t.country_codes,t.original_language,coalesce(t.published_at,t.created_at) AS published_at,ARRAY(SELECT g.genre_id::text FROM movie.title_genres g WHERE g.title_id=t.id ORDER BY g.genre_id LIMIT 30) AS genres,ARRAY(SELECT c.role||':'||c.person_id::text FROM movie.credits c WHERE c.title_id=t.id ORDER BY c.sort_order,c.id LIMIT 30) AS credits FROM movie.titles t WHERE t.id=ANY($1::uuid[]) AND ${publicTitle()}`,
                [ids],
              )
            : [];
          const items: Item[] = rows.map((r) => ({
            id: r.id,
            text: [r.localized_title, r.original_title, r.synopsis]
              .filter(Boolean)
              .join(" "),
            genres: r.genres,
            credits: r.credits,
            language: r.original_language,
            countries: r.country_codes,
            year: r.release_year,
            publishedAt: new Date(r.published_at),
          }));
          const excluded = new Set<string>(),
            dismissed = new Set<string>(),
            completed = new Set<string>();
          if (pref.enabled) {
            for (const r of await query(
              tx,
              "SELECT title_id FROM movie.recommendation_feedback WHERE user_id=$1::uuid AND title_id=ANY($2::uuid[])",
              [actor.id, ids],
            )) {
              excluded.add(r.title_id);
              dismissed.add(r.title_id);
            }
            for (const r of await query(
              tx,
              "SELECT t.id FROM movie.titles t WHERE t.id=ANY($2::uuid[]) AND " +
                publicTitle() +
                " AND " +
                complete(),
              [actor.id, ids],
            )) {
              completed.add(r.id);
              if (pref.hide_completed) excluded.add(r.id);
            }
          }
          const result = rank(
            items,
            candidateIds.filter((id) => !excluded.has(id)),
            signals.filter((s) => !dismissed.has(s.id)),
            Date.now(),
            100,
            signals
              .filter((s) => pref.hide_completed || !completed.has(s.id))
              .map((s) => s.id),
          );
          // A maximum of five feeds per account; only IDs/reason codes, never private source metadata.
          await query(
            tx,
            "DELETE FROM movie.recommendation_snapshots WHERE user_id=$1::uuid AND (expires_at<=now() OR id IN(SELECT id FROM movie.recommendation_snapshots WHERE user_id=$1::uuid ORDER BY created_at DESC,id OFFSET 4)) RETURNING id",
            [actor.id],
          );
          snapshot = await one(
            tx,
            "INSERT INTO movie.recommendation_snapshots(user_id,preference_version,model_version,surface,personalized,candidate_truncated,items) VALUES ($1::uuid,$2::bigint,$3,$4,$5,$6,$7::jsonb) RETURNING *",
            [
              actor.id,
              pref.version,
              MODEL_VERSION,
              dto.surface,
              result.personalized,
              candidates.length > 1000,
              JSON.stringify(result.items),
            ],
          );
        }
        const stored = snapshot!.items as SavedItem[],
          offset = cursor?.offset || 0;
        if (offset > stored.length) fail("REQUEST_INVALID_CURSOR");
        // Slice the immutable order first. Revoked/dismissed/completed items produce a short page.
        const slice = stored.slice(offset, offset + dto.limit),
          ids = slice.map((i) => i.id);
        const extra = pref.enabled
          ? " AND NOT EXISTS(SELECT 1 FROM movie.recommendation_feedback rf WHERE rf.user_id=$1::uuid AND rf.title_id=t.id)" +
            (pref.hide_completed ? " AND NOT (" + complete() + ")" : "")
          : "";
        const rows = ids.length
          ? await query(
              tx,
              "SELECT " +
                titleFields() +
                " FROM movie.titles t WHERE t.id=ANY($2::uuid[]) AND " +
                publicTitle() +
                extra +
                " AND $1::uuid IS NOT NULL",
              [actor.id, ids],
            )
          : [];
        const byId = new Map(rows.map((r) => [r.id, r]));
        const data = slice
          .filter((i) => byId.has(i.id))
          .map((i) => ({
            ...json(byId.get(i.id)),
            recommendation: {
              reason: i.reason,
              text:
                i.reason === "SIMILAR_CONTENT"
                  ? "Gần với nội dung phim bạn lưu hoặc đã xem"
                  : "Khám phá phim được xuất bản gần đây",
            },
          }));
        const end = offset + slice.length,
          hasMore = end < stored.length;
        return {
          data,
          page: {
            limit: dto.limit,
            hasMore,
            nextCursor: hasMore
              ? this.encode({
                  v: 1,
                  owner: actor.id,
                  id: snapshot!.id,
                  offset: end,
                  model: MODEL_VERSION,
                  surface: dto.surface,
                  epoch: pref.version.toString(),
                  expires: new Date(snapshot!.expires_at).getTime(),
                })
              : null,
          },
          meta: {
            modelVersion: MODEL_VERSION,
            personalized: snapshot!.personalized,
            enabled: pref.enabled,
            candidateTruncated: snapshot!.candidate_truncated,
            expiresAt: new Date(snapshot!.expires_at).toISOString(),
          },
        };
      },
      { timeout: 15000 },
    );
  }
}
