import "../apps/api/src/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
async function main() {
  if (process.env.PJ_FLIM_APPLY_CATALOG_BATCHES !== "true")
    throw Error("Explicit additive migration flag required.");
  const uri = new URL(process.env.MIGRATION_DATABASE_URL!);
  uri.searchParams.delete("schema");
  if (["/postgres", "/template0", "/template1"].includes(uri.pathname))
    throw Error("System database refused.");
  const pool = new Pool({ connectionString: uri.toString(), max: 1 }),
    c = await pool.connect();
  try {
    await c.query(
      "SELECT pg_advisory_lock(hashtextextended('pj-flim.catalog-batches-v1',0))",
    );
    const found = (
      await c.query("SELECT to_regclass('movie.catalog_batches') present")
    ).rows[0].present;
    if (!found)
      await c.query(
        await readFile("docs/design/sql/movie-catalog-batches-v1.sql", "utf8"),
      );
    const cols = (
      await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='movie' AND table_name='catalog_batches' ORDER BY column_name",
      )
    ).rows.map((r) => r.column_name);
    if (
      JSON.stringify(cols) !==
      JSON.stringify([
        "action",
        "created_at",
        "expires_at",
        "finished_at",
        "genre_ids",
        "id",
        "items",
        "owner_session_id",
        "owner_user_id",
        "reason",
        "started_at",
        "state",
        "updated_at",
        "version",
      ])
    )
      throw Error("Batch schema differs.");
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const g = (
        await c.query(
          "SELECT has_table_privilege('movie_api','movie.catalog_batches',$1) api,has_table_privilege('movie_worker','movie.catalog_batches',$1) worker,has_table_privilege('movie_auditor','movie.catalog_batches',$1) auditor",
          [p],
        )
      ).rows[0];
      if (!g.api || g.worker || g.auditor)
        throw Error("Private batch grants differ.");
    }
    if (
      !(
        await c.query(
          "SELECT to_regclass('movie.catalog_batches_owner_created_idx') present",
        )
      ).rows[0].present
    )
      throw Error("Missing owner index.");
    console.log(
      JSON.stringify({
        event: "catalog-batches.migration.ready",
        applied: !found,
      }),
    );
  } finally {
    await c
      .query(
        "SELECT pg_advisory_unlock(hashtextextended('pj-flim.catalog-batches-v1',0))",
      )
      .catch(() => {});
    c.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "catalog-batches.migration.failed",
      detail:
        "Check private migration/schema configuration; credentials omitted.",
    }),
  );
  process.exitCode = 1;
});
