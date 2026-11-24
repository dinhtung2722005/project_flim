import "../apps/api/src/config";
import { Pool } from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
async function main() {
  if (process.env.PJ_FLIM_APPLY_ASSISTANT !== "true")
    throw new Error("Explicit additive migration flag required.");
  const uri = new URL(process.env.MIGRATION_DATABASE_URL!);
  uri.searchParams.delete("schema");
  if (["/postgres", "/template0", "/template1"].includes(uri.pathname))
    throw new Error("System database refused.");
  const pool = new Pool({ connectionString: uri.toString(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query(
      "SELECT pg_advisory_lock(hashtextextended('pj-flim.assistant-v1',0))",
    );
    const names = ["assistant_runs", "assistant_run_steps"];
    const found = (
      await c.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='movie' AND table_name=ANY($1::text[])",
        [names],
      )
    ).rows;
    if (found.length !== 0 && found.length !== 2)
      throw new Error("Partial assistant migration.");
    if (!found.length) {
      await mkdir(".local/assistant", { recursive: true });
      const before = await c.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='movie' ORDER BY table_name",
      );
      await writeFile(
        ".local/assistant/pre-migration-schema.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            tables: before.rows.map((r) => r.table_name),
          },
          null,
          2,
        ),
      );
      await c.query(
        await readFile("docs/design/sql/movie-assistant-v1.sql", "utf8"),
      );
    }
    // Idempotent additive constraint update for both existing and fresh installs.
    await c.query(
      await readFile("docs/design/sql/movie-assistant-feedback-v1.sql", "utf8"),
    );
    for (const name of names) {
      for (const permission of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const r = (
          await c.query(
            "SELECT has_table_privilege('movie_api',$1,$2) AS api,has_table_privilege('movie_worker',$1,$2) AS worker,has_table_privilege('movie_auditor',$1,$2) AS auditor",
            ["movie." + name, permission],
          )
        ).rows[0];
        if (!r.api || r.worker || r.auditor)
          throw new Error("Assistant grants differ.");
      }
    }
    console.log(
      JSON.stringify({
        event: "assistant.migration.ready",
        applied: found.length === 0,
        feedbackToolEnabled: true,
      }),
    );
  } finally {
    await c
      .query(
        "SELECT pg_advisory_unlock(hashtextextended('pj-flim.assistant-v1',0))",
      )
      .catch(() => {});
    c.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "assistant.migration.failed",
      detail:
        "Review additive schema/grants; no raw database credentials emitted.",
    }),
  );
  process.exitCode = 1;
});
