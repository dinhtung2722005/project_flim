import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Pool } from "pg";
import type request from "supertest";

export async function runPaginationChecks(c: {
  fixtures: Pool;
  titleId: string;
  rootId: string;
  get: (path: string) => PromiseLike<request.Response>;
}) {
  const database = (await c.fixtures.query("SELECT current_database() AS name"))
    .rows[0].name;
  assert.match(database, /^pj_flim_test_[a-f0-9]{12}$/);
  const tables = [
    "people",
    "homepage_banners",
    "content_reports",
    "users",
  ] as const;
  const paths = [
    "/admin/people",
    "/admin/banners",
    "/admin/reports",
    "/admin/users",
  ];
  const owned = new Map<string, string[]>();
  let checks = 0;
  const cases: { path: string; rows: number; pages: number }[] = [];
  const equal = (actual: unknown, expected: unknown) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const time = "2020-01-01T00:00:00.123456Z";
  try {
    const prefix = "pagination-" + randomUUID();
    const inserts = [
      c.fixtures.query(
        "INSERT INTO movie.people(name,normalized_name,created_at) SELECT $1||n,$1||n,$2::timestamptz FROM generate_series(1,7) n RETURNING id",
        [prefix, time],
      ),
      c.fixtures.query(
        "INSERT INTO movie.homepage_banners(title_id,image_asset_ref,updated_by,created_at) SELECT $1,'tests/pagination',$2,$3::timestamptz FROM generate_series(1,7) RETURNING id",
        [c.titleId, c.rootId, time],
      ),
      c.fixtures.query(
        "INSERT INTO movie.content_reports(reporter_user_id,title_id,category,message,created_at) SELECT $1,$2,'OTHER','Pagination fixture',$3::timestamptz FROM generate_series(1,7) RETURNING id",
        [c.rootId, c.titleId, time],
      ),
      c.fixtures.query(
        "INSERT INTO movie.users(email_normalized,password_hash,display_name,created_at) SELECT $1||n||'@example.test','fixture-no-login',$1||n,$2::timestamptz FROM generate_series(1,7) n RETURNING id",
        [prefix, time],
      ),
    ];
    // Collect every successful insert before propagating any error, so cleanup owns all IDs.
    const results = await Promise.allSettled(inserts);
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled")
        owned.set(
          tables[i],
          result.value.rows.map((row) => row.id),
        );
    }
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    for (let i = 0; i < tables.length; i++) {
      const expected = (
        await c.fixtures.query(
          "SELECT id FROM movie." +
            tables[i] +
            " ORDER BY created_at DESC,id DESC",
        )
      ).rows.map((row) => row.id);
      const seen: string[] = [];
      let cursor: string | null = null,
        pages = 0,
        sawMicroseconds = false;
      do {
        const response = await c.get(
          "/api/v1" +
            paths[i] +
            "?limit=3" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
        equal(response.status, 200);
        for (const row of response.body.data) {
          equal(
            Object.keys(row).some((key) => /cursor/i.test(key)),
            false,
          );
          seen.push(row.id);
        }
        cursor = response.body.page.nextCursor;
        if (cursor) {
          const payload = JSON.parse(
            Buffer.from(cursor.split(".")[0], "base64url").toString("utf8"),
          );
          if (String(payload.last[0]).includes(".123456"))
            sawMicroseconds = true;
        }
        pages++;
        assert.ok(pages <= 100, "bounded pagination");
      } while (cursor);
      equal(seen, expected);
      equal(new Set(seen).size, seen.length);
      equal(sawMicroseconds, true);
      cases.push({ path: paths[i], rows: seen.length, pages });
    }
    await mkdir(".local/api", { recursive: true });
    await writeFile(
      ".local/api/pagination-result.json",
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          passed: true,
          checks,
          cases,
          database: "isolated temporary PostgreSQL",
          scope:
            "same microsecond timestamp: no skipped/duplicated records and no internal cursor fields in data",
        },
        null,
        2,
      ) + "\n",
    );
    return checks;
  } finally {
    for (const table of tables) {
      const ids = owned.get(table);
      if (ids?.length)
        await c.fixtures.query(
          "DELETE FROM movie." + table + " WHERE id=ANY($1::uuid[])",
          [ids],
        );
    }
  }
}
