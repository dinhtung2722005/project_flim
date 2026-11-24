import "../apps/api/src/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
async function main() {
  if (process.env.PJ_FLIM_APPLY_ADMIN_ADVANCED !== "true")
    throw Error("Explicit migration flag required.");
  const uri = new URL(process.env.MIGRATION_DATABASE_URL!);
  uri.searchParams.delete("schema");
  if (["/postgres", "/template0", "/template1"].includes(uri.pathname))
    throw Error("System database refused.");
  const pool = new Pool({ connectionString: uri.toString(), max: 1 }),
    c = await pool.connect();
  try {
    await c.query(
      "SELECT pg_advisory_lock(hashtextextended('pj-flim.admin-advanced-v1',0))",
    );
    const found = (
      await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='movie' AND table_name='viewer_reviews' AND column_name='moderation_status'",
      )
    ).rowCount;
    if (!found)
      await c.query(
        await readFile("docs/design/sql/movie-admin-advanced-v1.sql", "utf8"),
      );
    const cols = (
      await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='movie' AND table_name='viewer_reviews' AND column_name IN('moderation_status','moderation_reason','moderated_at','moderated_by')",
      )
    ).rows;
    if (cols.length !== 4) throw Error("Incomplete moderation schema.");
    const roles = (
      await c.query(
        "SELECT r.code FROM movie.roles r JOIN movie.role_permissions rp ON rp.role_id=r.id JOIN movie.permissions p ON p.id=rp.permission_id WHERE p.code='reviews.moderate' ORDER BY r.code",
      )
    ).rows.map((r) => r.code);
    if (JSON.stringify(roles) !== JSON.stringify(["ADMIN", "SUPER_ADMIN"]))
      throw Error("Moderation role grants differ.");
    const grant = (
      await c.query(
        "SELECT has_table_privilege('movie_api','movie.viewer_reviews','UPDATE') api,has_table_privilege('movie_worker','movie.viewer_reviews','SELECT') worker,has_table_privilege('movie_auditor','movie.viewer_reviews','SELECT') auditor,to_regclass('movie.viewer_reviews_moderation_created_idx') idx,to_regclass('movie.viewer_reviews_admin_created_idx') all_idx",
      )
    ).rows[0];
    if (
      !grant.api ||
      grant.worker ||
      grant.auditor ||
      !grant.idx ||
      !grant.all_idx
    )
      throw Error("Moderation privileges/indexes differ.");
    console.log(
      JSON.stringify({
        event: "admin-advanced.migration.ready",
        applied: !found,
      }),
    );
  } finally {
    await c
      .query(
        "SELECT pg_advisory_unlock(hashtextextended('pj-flim.admin-advanced-v1',0))",
      )
      .catch(() => {});
    c.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "admin-advanced.migration.failed",
      detail:
        "Check private migration/schema configuration; no credentials emitted.",
    }),
  );
  process.exitCode = 1;
});
