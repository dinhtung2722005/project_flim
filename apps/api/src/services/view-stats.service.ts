import { Injectable } from "@nestjs/common";
import {
  Database,
  one,
  query,
} from "../../../../packages/database/src/database";
import { Principal, audit, checkMutation, fail, json } from "../common";
import { publicTitle } from "../viewer-common";
import { ViewMetricsDto } from "../dto/view-stats.dto";
@Injectable()
export class ViewStatsService {
  constructor(private readonly db: Database) {}
  private async policy(tx: any = this.db) {
    const p = await one(
      tx,
      "SELECT measurement_started_at,hash_key_id IS NOT NULL AS worker_initialized FROM movie.view_stats_policy WHERE definition_version=2",
    );
    return {
      definitionVersion: 2,
      measurementStartedAt: p?.measurement_started_at ?? null,
      aggregation: "ASYNCHRONOUS",
      workerInitialized: p?.worker_initialized ?? false,
      thresholdSeconds: 120,
      shortVideoFraction: 0.5,
      dedup: "VIEWER_TITLE_UTC_DAY",
      timezone: "UTC",
    };
  }
  async title(id: string) {
    if (
      !(await one(
        this.db,
        "SELECT t.id FROM movie.titles t WHERE t.id=$1::uuid AND " +
          publicTitle(),
        [id],
      ))
    )
      fail("RESOURCE_NOT_FOUND");
    const row = await one(
      this.db,
      "SELECT coalesce(sum(qualified_views),0)::text AS views,max(updated_at) AS updated_at FROM movie.title_daily_stats WHERE title_id=$1::uuid AND definition_version=2",
      [id],
    );
    return json({ ...row, ...(await this.policy()) });
  }
  async admin(actor: Principal, dto: ViewMetricsDto, exported = false) {
    return this.db.$transaction(
      async (tx) => {
        await checkMutation(tx, actor, "metrics.read");
        const range =
          "day BETWEEN (transaction_timestamp() AT TIME ZONE 'UTC')::date-($1::int-1) AND (transaction_timestamp() AT TIME ZONE 'UTC')::date";
        const total = await one(
          tx,
          "SELECT coalesce(sum(qualified_views),0)::text AS views,coalesce(sum(playback_starts),0)::text AS playback_starts FROM movie.title_daily_stats WHERE definition_version=2 AND " +
            range,
          [dto.days],
        );
        const daily = await query(
          tx,
          "WITH days AS (SELECT generate_series((transaction_timestamp() AT TIME ZONE 'UTC')::date-($1::int-1),(transaction_timestamp() AT TIME ZONE 'UTC')::date,interval '1 day')::date AS day), stats AS (SELECT day,sum(qualified_views)::text AS views,sum(playback_starts)::text AS starts FROM movie.title_daily_stats WHERE definition_version=2 AND " +
            range +
            " GROUP BY day) SELECT to_char(d.day,'YYYY-MM-DD') AS day,coalesce(s.views,'0') AS views,coalesce(s.starts,'0') AS playback_starts FROM days d LEFT JOIN stats s USING(day) ORDER BY d.day",
          [dto.days],
        );
        const top = await query(
          tx,
          "SELECT t.id,t.localized_title AS name,sum(s.qualified_views)::text AS views,sum(s.playback_starts)::text AS playback_starts FROM movie.title_daily_stats s JOIN movie.titles t ON t.id=s.title_id WHERE s.definition_version=2 AND s." +
            range +
            " AND " +
            publicTitle() +
            " GROUP BY t.id ORDER BY sum(s.qualified_views) DESC,t.id LIMIT 10",
          [dto.days],
        );
        const processing = await one(
          tx,
          "SELECT count(*) FILTER(WHERE b.status='ACCEPTED')::text AS pending_batches,max(b.processed_at) AS last_processed_at FROM movie.playback_event_batches b JOIN movie.playback_sessions s ON s.id=b.session_id WHERE s.mode='PUBLIC' AND s.created_at>=(SELECT measurement_started_at FROM movie.view_stats_policy WHERE definition_version=2)",
        );
        if (exported)
          await audit(tx, actor, "metrics.views.exported", "metrics", "views", {
            days: dto.days,
            definitionVersion: 2,
          });
        return json({
          ...(await this.policy(tx)),
          days: dto.days,
          total,
          daily,
          top,
          processing,
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
