import "../apps/api/src/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
async function main() {
  if (process.env.PJ_FLIM_APPLY_VIEWER_REVIEWS !== "true")
    throw Error("Explicit additive migration flag required.");
  const uri = new URL(process.env.MIGRATION_DATABASE_URL!);
  uri.searchParams.delete("schema");
  if (["/postgres", "/template0", "/template1"].includes(uri.pathname))
    throw Error("System database refused.");
  const pool = new Pool({ connectionString: uri.toString(), max: 1 }),
    c = await pool.connect();
  try {
    await c.query(
      "SELECT pg_advisory_lock(hashtextextended('pj-flim.viewer-reviews-v1',0))",
    );
    const found = (
      await c.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='movie' AND table_name='viewer_reviews'",
      )
    ).rowCount;
    if (!found)
      await c.query(
        await readFile("docs/design/sql/movie-viewer-reviews-v1.sql", "utf8"),
      );
    const columns = (
      await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='movie' AND table_name='viewer_reviews' ORDER BY column_name",
      )
    ).rows.map((r) => r.column_name).filter(name=>!["moderation_status","moderation_reason","moderated_at","moderated_by"].includes(name));
    if (
      JSON.stringify(columns) !==
      JSON.stringify([
        "contains_spoilers",
        "content",
        "created_at",
        "id",
        "rating",
        "title_id",
        "updated_at",
        "user_id",
        "version",
      ])
    )
      throw Error("Schema differs.");
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const p = (
        await c.query(
          "SELECT has_table_privilege('movie_api','movie.viewer_reviews',$1) api,has_table_privilege('movie_worker','movie.viewer_reviews',$1) worker,has_table_privilege('movie_auditor','movie.viewer_reviews',$1) auditor",
          [privilege],
        )
      ).rows[0];
      if (!p.api || p.worker || p.auditor) throw Error("Grants differ.");
    }
    console.log(
      JSON.stringify({
        event: "viewer-reviews.migration.ready",
        applied: !found,
      }),
    );
  } finally {
    await c
      .query(
        "SELECT pg_advisory_unlock(hashtextextended('pj-flim.viewer-reviews-v1',0))",
      )
      .catch(() => {});
    c.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "viewer-reviews.migration.failed",
      detail:
        "Check private schema/migration configuration; no credentials emitted.",
    }),
  );
  process.exitCode = 1;
});
