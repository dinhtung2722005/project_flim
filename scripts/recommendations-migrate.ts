import "../apps/api/src/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
async function main() {
  if (process.env.PJ_FLIM_APPLY_RECOMMENDATIONS !== "true")
    throw new Error(
      "Set PJ_FLIM_APPLY_RECOMMENDATIONS=true to apply the reviewed additive SQL migration.",
    );
  const url = new URL(process.env.MIGRATION_DATABASE_URL!);
  url.searchParams.delete("schema");
  if (
    !url.pathname ||
    ["/postgres", "/template0", "/template1"].includes(url.pathname)
  )
    throw new Error("Refusing a system database.");
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const db = await pool.connect();
  try {
    await db.query(
      "SELECT pg_advisory_lock(hashtextextended('pj-flim.recommendations-v1',0))",
    );
    const state = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE' ORDER BY table_name",
    );
    const expected = [
      "recommendation_preferences",
      "recommendation_feedback",
      "recommendation_snapshots",
    ];
    const found = state.rows.filter((r) => expected.includes(r.table_name));
    if (found.length !== 0 && found.length !== 3)
      throw new Error(
        "Partial recommendation schema; review before proceeding.",
      );
    if (!found.length) {
      await mkdir(".local/recommendations", { recursive: true });
      await writeFile(
        ".local/recommendations/pre-migration-schema.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            tables: state.rows.map((r) => r.table_name),
          },
          null,
          2,
        ) + "\n",
      );
      await db.query(
        await readFile("docs/design/sql/movie-recommendations-v1.sql", "utf8"),
      );
    }

    const columns = await db.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='movie' AND table_name=ANY($1::text[]) ORDER BY table_name,column_name",
      [expected],
    );
    const shape: Record<string, string[]> = {
      recommendation_preferences: [
        "user_id",
        "enabled",
        "hide_completed",
        "version",
        "updated_at",
      ],
      recommendation_feedback: ["user_id", "title_id", "kind", "created_at"],
      recommendation_snapshots: [
        "id",
        "user_id",
        "preference_version",
        "model_version",
        "surface",
        "personalized",
        "candidate_truncated",
        "items",
        "created_at",
        "expires_at",
      ],
    };
    for (const table of expected) {
      const actual = columns.rows
        .filter((r) => r.table_name === table)
        .map((r) => r.column_name)
        .sort();
      if (JSON.stringify(actual) !== JSON.stringify(shape[table].sort()))
        throw new Error("Recommendation schema columns differ.");
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const p = await db.query(
          "SELECT has_table_privilege('movie_api',$1,$2) AS api, has_table_privilege('movie_worker',$1,$2) AS worker,has_table_privilege('movie_auditor',$1,$2) AS auditor",
          ["movie." + table, privilege],
        );
        if (!p.rows[0].api || p.rows[0].worker || p.rows[0].auditor)
          throw new Error("Recommendation grants need review.");
      }
    }
    const permissions = await db.query(
      "SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE'",
    );
    console.log(
      JSON.stringify({
        event: "recommendations.migration.ready",
        applied: !found.length,
        tables: permissions.rows[0].tables,
      }),
    );
  } finally {
    await db
      .query(
        "SELECT pg_advisory_unlock(hashtextextended('pj-flim.recommendations-v1',0))",
      )
      .catch(() => {});
    db.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "recommendations.migration.failed",
      detail:
        "No credentials or raw database error emitted. Review schema/grants and local database connection.",
    }),
  );
  process.exitCode = 1;
});
