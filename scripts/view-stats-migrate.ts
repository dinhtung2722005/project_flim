import "../apps/api/src/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
async function main() {
  if (process.env.PJ_FLIM_APPLY_VIEWS !== "true")
    throw Error("Explicit additive migration flag required.");
  const uri = new URL(process.env.MIGRATION_DATABASE_URL!);
  uri.searchParams.delete("schema");
  if (["/postgres", "/template0", "/template1"].includes(uri.pathname))
    throw Error("System database refused.");
  const pool = new Pool({ connectionString: uri.toString(), max: 1 }),
    c = await pool.connect();
  try {
    await c.query(
      "SELECT pg_advisory_lock(hashtextextended('pj-flim.view-stats-v1',0))",
    );
    const found = (
      await c.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='movie' AND table_name='view_stats_policy'",
      )
    ).rowCount;
    if (!found)
      await c.query(
        await readFile("docs/design/sql/movie-view-stats-v1.sql", "utf8"),
      );
    const columns = (
      await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='movie' AND table_name='view_stats_policy' ORDER BY column_name",
      )
    ).rows.map((r) => r.column_name);
    if (
      JSON.stringify(columns) !==
      JSON.stringify([
        "definition_version",
        "hash_key_id",
        "measurement_started_at",
      ])
    )
      throw Error("Schema differs.");
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const p = (
        await c.query(
          "SELECT has_table_privilege('movie_api','movie.view_stats_policy',$1) api,has_table_privilege('movie_worker','movie.view_stats_policy',$1) worker,has_table_privilege('movie_auditor','movie.view_stats_policy',$1) auditor",
          [privilege],
        )
      ).rows[0];
      if (
        p.api !== (privilege === "SELECT") ||
        p.worker !== (privilege !== "DELETE") ||
        p.auditor
      )
        throw Error("Grants differ.");
    }
    const expected: Record<string, string[]> = {
      view_daily_viewers: [
        "day",
        "definition_version",
        "title_id",
        "viewer_key",
      ],
      view_session_facts: [
        "definition_version",
        "observed_events",
        "qualified",
        "session_id",
        "started",
        "updated_at",
      ],
    };
    for (const [table, columns] of Object.entries(expected)) {
      const actual = (
        await c.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='movie' AND table_name=$1 ORDER BY column_name",
          [table],
        )
      ).rows.map((r) => r.column_name);
      if (JSON.stringify(actual) !== JSON.stringify(columns))
        throw Error("Incomplete analytics schema.");
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const grants = (
          await c.query(
            "SELECT has_table_privilege('movie_api',$1,$2) api,has_table_privilege('movie_worker',$1,$2) worker,has_table_privilege('movie_auditor',$1,$2) auditor",
            ["movie." + table, privilege],
          )
        ).rows[0];
        if (
          grants.api ||
          grants.auditor ||
          grants.worker !==
            (table === "view_daily_viewers"
              ? privilege !== "UPDATE"
              : privilege !== "DELETE")
        )
          throw Error("Private analytics grants differ.");
      }
    }
    if (
      !(
        await c.query(
          "SELECT to_regclass('movie.watch_events_session_sequence_idx') present",
        )
      ).rows[0].present
    )
      throw Error("Missing sequence index.");
    if (
      (
        await c.query(
          "SELECT has_table_privilege('movie_api','movie.title_daily_stats','UPDATE') allowed",
        )
      ).rows[0].allowed
    )
      throw Error("API must not write counters.");
    console.log(
      JSON.stringify({
        event: "view-stats.migration.ready",
        applied: !found,
      }),
    );
  } finally {
    await c
      .query(
        "SELECT pg_advisory_unlock(hashtextextended('pj-flim.view-stats-v1',0))",
      )
      .catch(() => {});
    c.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "view-stats.migration.failed",
      detail:
        "Check private schema/migration configuration; no credentials emitted.",
    }),
  );
  process.exitCode = 1;
});
