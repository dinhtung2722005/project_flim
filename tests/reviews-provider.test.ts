import assert from "node:assert/strict";
import { TmdbReviewClient, Mapping } from "../packages/reviews/src/tmdb";
import { ApiError } from "../packages/backend-core/src/errors";
let checks = 0;
const mapping: Mapping = {
  externalId: 155,
  kind: "movie",
  sourceUrl: "https://www.themoviedb.org/movie/155",
};
const title = {
  kind: "MOVIE",
  localized_title: "Phim thử",
  original_title: "Review Film",
  release_year: 2026,
};
const review = {
  id: "a".repeat(24),
  author: "Critic",
  author_details: { rating: 8.5 },
  content: "Nội dung review hợp lệ.",
  url: "https://www.themoviedb.org/review/" + "a".repeat(24),
};
const response = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const page = (rows: unknown[]) => ({
  id: 155,
  page: 1,
  total_pages: rows.length ? 1 : 0,
  total_results: rows.length,
  results: rows,
});
function client(body: unknown) {
  return new TmdbReviewClient("fixture", async () => response(body));
}
async function rejects(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (e) => e instanceof ApiError && e.code === code);
  checks++;
}
async function main() {
  await rejects(
    () => new TmdbReviewClient("").reviews(mapping),
    "REVIEW_PROVIDER_NOT_CONFIGURED",
  );
  for (const [status, code] of [
    [401, "REVIEW_PROVIDER_AUTH_FAILED"],
    [403, "REVIEW_PROVIDER_AUTH_FAILED"],
    [429, "REVIEW_PROVIDER_RATE_LIMITED"],
    [500, "REVIEW_PROVIDER_UNAVAILABLE"],
  ] as const)
    await rejects(
      () =>
        new TmdbReviewClient("fixture", async () =>
          response({}, status),
        ).reviews(mapping),
      code,
    );
  for (const bad of [
    null,
    [],
    {},
    { ...page([review]), id: 999 },
    { ...page([review]), page: 2 },
    { ...page([review]), results: [null] },
    page([review, review]),
    page([{ ...review, url: "https://evil.test/review" }]),
    page([{ ...review, id: "invalid" }]),
    page([{ ...review, author: "" }]),
    page([{ ...review, author_details: { rating: 11 } }]),
    page([{ ...review, author_details: { rating: "8" } }]),
  ])
    await rejects(
      () => client(bad).reviews(mapping),
      "REVIEW_PROVIDER_INVALID_RESPONSE",
    );
  await rejects(
    () =>
      new TmdbReviewClient(
        "fixture",
        async () =>
          new Response("{", {
            headers: { "Content-Type": "application/json" },
          }),
      ).reviews(mapping),
    "REVIEW_PROVIDER_INVALID_RESPONSE",
  );
  await rejects(
    () =>
      new TmdbReviewClient("fixture", async () =>
        response(page([review]), 200, { "Content-Type": "text/html" }),
      ).reviews(mapping),
    "REVIEW_PROVIDER_INVALID_RESPONSE",
  );
  await rejects(
    () =>
      new TmdbReviewClient("fixture", async () =>
        response(page([review]), 200, { "Content-Length": "1024001" }),
      ).reviews(mapping),
    "REVIEW_PROVIDER_INVALID_RESPONSE",
  );
  await rejects(
    () =>
      new TmdbReviewClient(
        "fixture",
        async () =>
          new Response(" ".repeat(1024001), {
            headers: { "Content-Type": "application/json" },
          }),
      ).reviews(mapping),
    "REVIEW_PROVIDER_INVALID_RESPONSE",
  );
  await rejects(
    () =>
      new TmdbReviewClient("fixture", async () => {
        throw Error("private-token");
      }).reviews(mapping),
    "REVIEW_PROVIDER_UNAVAILABLE",
  );
  for (const body of [
    { id: 155, title: "Wrong Film", release_date: "2026-01-01" },
    { id: 155, title: "Review Film", release_date: "2000-01-01" },
    { id: 999, title: "Review Film", release_date: "2026-01-01" },
  ])
    await rejects(
      () => client(body).verify(title, 155),
      "REVIEW_MAPPING_MISMATCH",
    );
  await rejects(
    () =>
      client({
        id: 155,
        title: "Review Film",
        release_date: "2026-01-01",
      }).verify({ ...title, release_year: null }, 155),
    "REVIEW_MAPPING_MISMATCH",
  );
  const urls: string[] = [];
  const fallback = new TmdbReviewClient("fixture", async (input, init) => {
    const u = new URL(String(input));
    urls.push(u.href);
    assert.equal(u.origin, "https://api.themoviedb.org");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as any).Authorization, "Bearer fixture");
    return response(
      page(
        u.searchParams.get("language") === "vi-VN"
          ? []
          : [
              {
                ...review,
                content:
                  "<script>bad()</script><b>Đọc</b> " + "a".repeat(13000),
              },
            ],
      ),
    );
  });
  const loaded = await fallback.reviews(mapping);
  assert.equal(urls.length, 2);
  assert.equal(loaded.language, "en-US");
  assert.equal(loaded.items[0].content.length, 12000);
  assert.ok(!loaded.items[0].content.includes("<"));
  assert.ok(!loaded.items[0].content.includes("bad()"));
  checks += 5;
  const vi = await client(page([review])).reviews(mapping);
  assert.equal(vi.language, "vi-VN");
  checks++;
  const rows = Array.from({ length: 25 }, (_, i) => ({
    ...review,
    id: i.toString(16).padStart(24, "0"),
    url:
      "https://www.themoviedb.org/review/" + i.toString(16).padStart(24, "0"),
  }));
  const limited = await client({ ...page(rows), total_pages: 2 }).reviews(
    mapping,
  );
  assert.equal(limited.items.length, 20);
  assert.equal(limited.truncated, true);
  checks += 2;
  const empty = await client(page([])).reviews(mapping);
  assert.equal(empty.items.length, 0);
  checks++;
  const match = await client({
    id: 155,
    title: "Review Film",
    release_date: "2026-01-01",
  }).verify(title, 155);
  assert.deepEqual(match, mapping);
  checks++;
  await rejects(
    () => client({ results: null }).candidates(title),
    "REVIEW_PROVIDER_INVALID_RESPONSE",
  );
  const found = await new TmdbReviewClient("fixture", async (input) => {
    const u = new URL(String(input));
    assert.equal(u.pathname, "/3/search/movie");
    assert.equal(u.searchParams.get("query"), "Review Film");
    assert.equal(u.searchParams.get("year"), "2026");
    return response({
      results: [
        null,
        { id: 155, title: "Review Film", release_date: "2026-01-01" },
      ],
    });
  }).candidates(title);
  assert.equal(found.length, 1);
  assert.equal(found[0].verified, false);
  checks += 2;
  console.log(
    JSON.stringify({
      event: "reviews.provider.passed",
      checks,
      liveProvider: false,
    }),
  );
}
main().catch((e) => {
  console.error({
    event: "reviews.provider.failed",
    code: e.code ?? e.name,
    detail: e.message,
  });
  process.exitCode = 1;
});
