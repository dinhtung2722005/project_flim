import assert from "node:assert/strict";
import { OmdbRatingsClient } from "../packages/ratings/src/omdb";
const title = {
  kind: "MOVIE",
  localized_title: "Phim thử",
  original_title: "Rating Film",
  release_year: 2026,
};
const valid = {
  Response: "True",
  Title: "Rating Film",
  Year: "2026",
  Type: "movie",
  imdbID: "tt1234567",
  imdbRating: "8.6",
  imdbVotes: "123,456",
  Metascore: "82",
};
let checks = 0;
function equal(a: unknown, b: unknown) {
  assert.deepEqual(a, b);
  checks++;
}
const response = (body: unknown, status = 200, type = "application/json") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": type },
  });
const lookup = (body: unknown, t = title) =>
  new OmdbRatingsClient("fixture-key", async () => response(body)).lookup(t);
async function main() {
  equal(
    (await new OmdbRatingsClient("").lookup(title)).status,
    "NOT_CONFIGURED",
  );
  const good = await lookup(valid);
  equal(good.imdb.score, 8.6);
  equal(good.metacritic.score, 82);
  equal(good.imdb.votes, 123456);
  equal(good.imdb.url, "https://www.imdb.com/title/tt1234567/");
  equal(
    (
      await lookup({
        ...valid,
        imdbRating: "N/A",
        Metascore: "N/A",
        imdbVotes: "N/A",
      })
    ).imdb.score,
    null,
  );
  equal(
    (await lookup({ ...valid, imdbRating: "0", Metascore: "0" })).metacritic
      .score,
    0,
  );
  for (const bad of [
    { Title: "Wrong film" },
    { Year: "2000" },
    { Type: "series" },
    { imdbID: "javascript:alert(1)" },
  ])
    equal((await lookup({ ...valid, ...bad })).status, "NOT_FOUND");
  for (const bad of [
    { imdbRating: "11" },
    { Metascore: "101" },
    { Metascore: "80.5" },
    { imdbRating: 8.6 },
    { imdbVotes: "1,23" },
    { imdbVotes: "99999999999999999" },
    { Response: "True", Title: null },
  ])
    equal((await lookup({ ...valid, ...bad })).status, "UNAVAILABLE");
  for (const code of [401, 403, 429, 500])
    equal(
      (
        await new OmdbRatingsClient("fixture-key", async () =>
          response({}, code),
        ).lookup(title)
      ).status,
      "UNAVAILABLE",
    );
  equal(
    (await lookup({ Response: "False", Error: "Movie not found!" })).status,
    "NOT_FOUND",
  );
  equal(
    (await lookup({ Response: "False", Error: "Invalid API key!" })).status,
    "UNAVAILABLE",
  );
  equal(
    (
      await new OmdbRatingsClient("fixture-key", async () => {
        throw Error("private key");
      }).lookup(title)
    ).status,
    "UNAVAILABLE",
  );
  equal(
    (
      await new OmdbRatingsClient(
        "fixture-key",
        async () =>
          new Response("{", {
            headers: { "Content-Type": "application/json" },
          }),
      ).lookup(title)
    ).status,
    "UNAVAILABLE",
  );
  equal(
    (
      await new OmdbRatingsClient("fixture-key", async () =>
        response(valid, 200, "text/html"),
      ).lookup(title)
    ).status,
    "UNAVAILABLE",
  );
  equal(
    (
      await new OmdbRatingsClient(
        "fixture-key",
        async () =>
          new Response(" ".repeat(256001), {
            headers: { "Content-Type": "application/json" },
          }),
      ).lookup(title)
    ).status,
    "UNAVAILABLE",
  );
  equal(
    (await lookup(valid, { ...title, release_year: undefined as any })).status,
    "NOT_FOUND",
  );
  equal(
    (
      await lookup(
        { ...valid, Title: "电影二" },
        { ...title, original_title: "电影一", localized_title: "电影一" },
      )
    ).status,
    "NOT_FOUND",
  );
  const same = await new OmdbRatingsClient(
    "fixture-key",
    async (input, init) => {
      const url = new URL(String(input));
      equal(url.origin, "https://www.omdbapi.com");
      equal(url.searchParams.get("t"), "Rating Film");
      equal(url.searchParams.get("y"), "2026");
      equal(url.searchParams.get("type"), "movie");
      equal(init?.redirect, "error");
      return response(valid);
    },
  ).lookup(title);
  equal(same.status, "READY");
  console.log(
    JSON.stringify({
      event: "ratings.provider.passed",
      checks,
      liveProvider: false,
    }),
  );
}
main().catch((e) => {
  console.error({
    event: "ratings.provider.failed",
    code: e.code ?? e.name,
    detail: e.message,
  });
  process.exitCode = 1;
});
