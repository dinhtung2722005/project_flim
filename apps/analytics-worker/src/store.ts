import { Pool, PoolClient } from "pg";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  qualifyView,
  MAX_VIEW_EVENTS,
  VIEW_DEFINITION_VERSION,
} from "../../../packages/analytics/src/views";
import type { AnalyticsWake } from "../../../packages/analytics/src/broker";
const one = async (db: Pool | PoolClient, sql: string, args: any[] = []) =>
  (await db.query(sql, args)).rows[0];
export class ViewStore {
  readonly pool: Pool;
  readonly owner = randomUUID();
  constructor(
    database: string,
    readonly secret: string,
  ) {
    const uri = new URL(database);
    uri.searchParams.delete("schema");
    this.pool = new Pool({
      connectionString: uri.toString(),
      max: 4,
      options: "-c timezone=UTC",
      connectionTimeoutMillis: 5000,
    });
  }
  async ready() {
    const key = createHash("sha256").update(this.secret).digest("hex");
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const p = await one(
        c,
        "SELECT * FROM movie.view_stats_policy WHERE definition_version=2 FOR UPDATE",
      );
      if (!p || (p.hash_key_id && p.hash_key_id !== key))
        throw Error("ANALYTICS_HASH_KEY_MISMATCH");
      if (!p.hash_key_id)
        await c.query(
          "UPDATE movie.view_stats_policy SET hash_key_id=$1 WHERE definition_version=2",
          [key],
        );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private lastReconcile = 0;
  async reconcile() {
    // Bound reconciliation independently of the publication loop.
    await this.pool.query(
      "WITH candidates AS (SELECT e.id FROM movie.outbox_events e WHERE e.type='playback.events.accepted' AND e.published_at<clock_timestamp()-interval '2 minutes' AND EXISTS(SELECT 1 FROM movie.playback_event_batches b WHERE b.id=e.aggregate_id AND b.status='ACCEPTED') ORDER BY e.published_at,e.id LIMIT 100 FOR UPDATE SKIP LOCKED) UPDATE movie.outbox_events e SET published_at=NULL,next_attempt_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL FROM candidates c WHERE e.id=c.id",
    );
    this.lastReconcile = Date.now();
  }
  async claim() {
    if (Date.now() - this.lastReconcile >= 60000) await this.reconcile();
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const e = await one(
        c,
        "SELECT * FROM movie.outbox_events WHERE type='playback.events.accepted' AND published_at IS NULL AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!e) {
        await c.query("COMMIT");
        return null;
      }
      const claimed = await one(
        c,
        "UPDATE movie.outbox_events SET lease_owner=$2,lease_until=clock_timestamp()+interval '30 seconds',lease_token=lease_token+1,attempt_count=attempt_count+1 WHERE id=$1 RETURNING *",
        [e.id, this.owner],
      );
      await c.query("COMMIT");
      return claimed;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async confirmed(e: any, success: boolean) {
    await this.pool.query(
      success
        ? "UPDATE movie.outbox_events SET published_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND lease_token=$3::bigint AND lease_until>clock_timestamp()"
        : "UPDATE movie.outbox_events SET lease_owner=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 seconds' WHERE id=$1 AND lease_owner=$2 AND lease_token=$3::bigint",
      [e.id, this.owner, e.lease_token.toString()],
    );
  }
  async receive(wake: AnalyticsWake) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const e = await one(
        c,
        "SELECT * FROM movie.outbox_events WHERE id=$1 AND type='playback.events.accepted' AND aggregate_id=$2",
        [wake.eventId, wake.batchId],
      );
      if (!e) {
        await c.query("COMMIT");
        return;
      }
      const batch = await one(
        c,
        "SELECT * FROM movie.playback_event_batches WHERE id=$1",
        [wake.batchId],
      );
      if (
        !batch ||
        batch.id !== e.payload.batchId ||
        batch.session_id !== e.payload.sessionId
      )
        throw Error("ANALYTICS_CONTEXT_MISMATCH");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "view-session:" + batch.session_id,
      ]);
      const session = await one(
        c,
        "SELECT s.*,ep.title_id,a.duration_seconds FROM movie.playback_sessions s JOIN movie.episodes ep ON ep.id=s.episode_id JOIN movie.video_assets a ON a.id=s.asset_id WHERE s.id=$1",
        [batch.session_id],
      );
      const current = await one(
        c,
        "SELECT status FROM movie.playback_event_batches WHERE id=$1 FOR UPDATE",
        [batch.id],
      );
      if (current.status === "PROCESSED") {
        await c.query("COMMIT");
        return;
      }
      const policy = await one(
        c,
        "SELECT measurement_started_at FROM movie.view_stats_policy WHERE definition_version=2",
      );
      if (
        session &&
        session.mode === "PUBLIC" &&
        +new Date(session.created_at) >=
          +new Date(policy.measurement_started_at) &&
        +new Date(session.created_at) >= Date.now() - 30 * 86400000
      ) {
        await c.query(
          "INSERT INTO movie.view_session_facts(session_id) VALUES($1) ON CONFLICT DO NOTHING",
          [session.id],
        );
        const fact = await one(
          c,
          "SELECT * FROM movie.view_session_facts WHERE session_id=$1 FOR UPDATE",
          [session.id],
        );
        if (!fact.qualified) {
          const events = (
            await c.query(
              "SELECT sequence,type,elapsed_ms,position_seconds,received_at FROM movie.watch_events WHERE session_id=$1 ORDER BY sequence,id LIMIT $2",
              [session.id, MAX_VIEW_EVENTS + 1],
            )
          ).rows;
          const result = qualifyView(
            events.slice(0, MAX_VIEW_EVENTS),
            Number(session.duration_seconds),
            session.created_at,
          );
          const startDay = new Date(session.created_at)
            .toISOString()
            .slice(0, 10);
          if (result.started && !fact.started)
            await this.add(c, session.title_id, startDay, "playback_starts");
          if (result.qualified) {
            const day = result.qualifiedAt!.slice(0, 10),
              key = createHmac("sha256", this.secret)
                .update(
                  day +
                    ":" +
                    (session.user_id
                      ? "user:" + session.user_id
                      : "guest:" + session.guest_id_hash),
                )
                .digest("hex");
            const first = await c.query(
              "INSERT INTO movie.view_daily_viewers(title_id,day,viewer_key,definition_version) VALUES($1,$2::date,$3,2) ON CONFLICT DO NOTHING RETURNING title_id",
              [session.title_id, day, key],
            );
            if (first.rowCount)
              await this.add(c, session.title_id, day, "qualified_views");
          }
          await c.query(
            "UPDATE movie.view_session_facts SET started=started OR $2,qualified=qualified OR $3,observed_events=$4,updated_at=clock_timestamp() WHERE session_id=$1",
            [session.id, result.started, result.qualified, events.length],
          );
        }
      }
      await c.query(
        "UPDATE movie.playback_event_batches SET status='PROCESSED',processed_at=clock_timestamp() WHERE id=$1",
        [batch.id],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private async add(
    c: PoolClient,
    titleId: string,
    day: string,
    column: "playback_starts" | "qualified_views",
  ) {
    await c.query(
      "INSERT INTO movie.title_daily_stats(title_id,day,definition_version," +
        column +
        ") VALUES($1,$2::date,$3,1) ON CONFLICT(title_id,day,definition_version) DO UPDATE SET " +
        column +
        "=movie.title_daily_stats." +
        column +
        "+1,updated_at=clock_timestamp()",
      [titleId, day, VIEW_DEFINITION_VERSION],
    );
  }
  async prune() {
    await this.pool.query(
      "DELETE FROM movie.view_daily_viewers WHERE ctid IN (SELECT ctid FROM movie.view_daily_viewers WHERE day<(clock_timestamp() AT TIME ZONE 'UTC')::date-90 LIMIT 1000)",
    );
  }
  async close() {
    await this.pool.end();
  }
}
