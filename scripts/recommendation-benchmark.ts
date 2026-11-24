import "../apps/api/src/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { rank, Item } from "../packages/recommendations/src/content";
import {
  evaluateRecommendations,
  metadataAudit,
  EvaluationCase,
} from "../packages/recommendations/src/evaluation";
async function main() {
  const args = process.argv.slice(2),
    value = (key: string) => {
      const i = args.indexOf(key);
      return i < 0 ? undefined : args[i + 1];
    };
  const output = value("--out") || ".local/benchmarks/recommendations";
  await mkdir(output, { recursive: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let rows: any[] = [];
  try {
    await pool.query("BEGIN READ ONLY");
    rows = (
      await pool.query(
        "SELECT t.id,t.localized_title,t.synopsis,t.release_year,t.original_language,t.country_codes,t.publication_status,t.created_at,COALESCE(t.published_at,t.created_at) AS published_at,ARRAY(SELECT g.slug FROM movie.title_genres tg JOIN movie.genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id) AS genres,ARRAY(SELECT p.name FROM movie.credits c JOIN movie.people p ON p.id=c.person_id WHERE c.title_id=t.id) AS credits FROM movie.titles t ORDER BY t.id LIMIT 1001",
      )
    ).rows;
    await pool.query("ROLLBACK");
  } finally {
    await pool.end();
  }
  if (rows.length > 1000) throw Error("EVALUATION_CATALOG_TOO_LARGE");
  const items: Item[] = rows.map((r) => ({
    id: r.id,
    text: r.localized_title + " " + r.synopsis,
    genres: r.genres,
    credits: r.credits,
    language: r.original_language,
    countries: r.country_codes,
    year: r.release_year,
    publishedAt: new Date(r.published_at),
  }));
  const labels = value("--labels");
  let cases: EvaluationCase[] = [],
    labelStatus = "UNLABELED";
  if (labels) {
    const raw = JSON.parse(await readFile(labels, "utf8"));
    if (
      !["PROPOSED", "REVIEWED"].includes(raw.status) ||
      !Array.isArray(raw.cases)
    )
      throw Error("EVALUATION_LABELS_INVALID");
    cases = raw.cases;
    labelStatus = raw.status;
  }
  const now = new Date().toISOString(),
    result = cases.length
      ? evaluateRecommendations(items, cases)
      : {
          metadata: {
            ...metadataAudit(items),
            missingSynopsis: rows.filter((r) => !r.synopsis?.trim()).length,
          },
        };
  result.metadata = {
    ...metadataAudit(items),
    missingSynopsis: rows.filter((r) => !r.synopsis?.trim()).length,
  };
  const report = {
    at: now,
    model: "content-v1",
    scope: "ADMIN_METADATA_OFFLINE_INCLUDES_DRAFTS",
    labelStatus,
    acceptedQuality: false,
    result,
    publicationCounts: Object.fromEntries(
      ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"].map((s) => [
        s,
        rows.filter((r) => r.publication_status === s).length,
      ]),
    ),
    notes: [
      "Metadata audit may include drafts; not a public recommendation feed.",
      "No account history, secrets or playback URLs exported.",
      "Supply independently reviewed labels before claiming quality.",
      "Draft recency uses import/creation time; not real publication chronology.",
      "Unjudged items count as nonrelevant. Proposed metadata labels are incomplete and not independent user judgments.",
    ],
  };
  await writeFile(
    output + "/catalog-metadata.json",
    JSON.stringify(
      {
        at: now,
        scope: report.scope,
        items: items.map((i, n) => ({
          ...i,
          name: rows[n].localized_title,
          publicationStatus: rows[n].publication_status,
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(output + "/report.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      event: "recommendations.benchmark",
      titles: items.length,
      labelStatus,
      output: output + "/report.json",
    }),
  );
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      code: "RECOMMENDATION_BENCHMARK_FAILED",
      cause: /^[A-Z0-9_]{3,60}$/.test(e.code || "") ? e.code : "CHECK_INPUT",
    }),
  );
  process.exitCode = 1;
});
