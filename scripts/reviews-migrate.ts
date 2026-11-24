import "../apps/api/src/config";
import { Pool } from "pg";
import { mkdir, readFile, writeFile } from "node:fs/promises";
async function main() {
  if (process.env.PJ_FLIM_APPLY_REVIEWS !== "true")
    throw Error("Explicit migration flag required.");
  const url = new URL(process.env.MIGRATION_DATABASE_URL!);
  url.searchParams.delete("schema");
  if (
    !url.pathname ||
    ["/postgres", "/template0", "/template1"].includes(url.pathname)
  )
    throw Error("System database refused.");
  const pool = new Pool({ connectionString: url.toString(), max: 1 }),
    db = await pool.connect();
  try {
    await db.query(
      "SELECT pg_advisory_lock(hashtextextended('pj-flim.reviews-v1',0))",
    );
    const tables = (
      await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE' ORDER BY table_name",
      )
    ).rows.map((r) => r.table_name);
    const expected = ["review_sources", "external_reviews"],
      found = expected.filter((t) => tables.includes(t));
    if (found.length !== 0 && found.length !== 2)
      throw Error("Partial review schema.");
    if (!found.length) {
      await mkdir(".local/reviews", { recursive: true });
      await writeFile(
        ".local/reviews/pre-migration-schema.json",
        JSON.stringify({ at: new Date().toISOString(), tables }, null, 2),
      );
      await db.query(
        await readFile("docs/design/sql/movie-reviews-v1.sql", "utf8"),
      );
    }
    const fields: Record<string, string[]> = {
      review_sources: [
        "generation",
        "title_version",
        "title_id",
        "provider",
        "external_kind",
        "external_id",
        "source_url",
        "version",
        "verified_by",
        "verified_at",
        "refreshed_at",
        "expires_at",
        "last_attempt_at",
        "lease_id",
        "lease_until",
        "last_error",
      ],
      external_reviews: [
        "id",
        "title_id",
        "external_id",
        "author",
        "content",
        "rating",
        "language",
        "source_url",
        "source_created_at",
        "source_updated_at",
        "fetched_at",
      ],
    };
    for (const table of expected) {
      const columns = (
        await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='movie' AND table_name=$1 ORDER BY column_name",
          [table],
        )
      ).rows.map((r) => r.column_name);
      if (JSON.stringify(columns) !== JSON.stringify(fields[table].sort()))
        throw Error("Review schema differs.");
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const row = (
          await db.query(
            "SELECT has_table_privilege('movie_api',$1,$2) api,has_table_privilege('movie_worker',$1,$2) worker,has_table_privilege('movie_auditor',$1,$2) auditor",
            ["movie." + table, privilege],
          )
        ).rows[0];
        if (!row.api || row.worker || row.auditor)
          throw Error("Review grants differ.");
      }
    }
    console.log(
      JSON.stringify({
        event: "reviews.migration.ready",
        applied: !found.length,
        tables: tables.length + (found.length ? 0 : 2),
      }),
    );
  } finally {
    await db
      .query(
        "SELECT pg_advisory_unlock(hashtextextended('pj-flim.reviews-v1',0))",
      )
      .catch(() => {});
    db.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "reviews.migration.failed",
      detail:
        "Check reviewed schema/grants and local connection; no credentials emitted.",
    }),
  );
  process.exitCode = 1;
});
