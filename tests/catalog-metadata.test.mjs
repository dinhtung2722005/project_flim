import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName,
  plainText,
  episodeCount,
  safeImageUrl,
  normalizeItem,
  titleMatches,
  validImageBytes,
} from "../scripts/lib/catalog-metadata.mjs";
const fixture = {
  providerId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  slug: "phim-thu",
  name: "Phim thử",
  originalName: "Sample",
  type: "series",
  year: 2024,
  episodeTotal: "24 tập",
  episodeCurrent: "Tập 3",
  posterUrl: "https://phimimg.com/uploads/movies/vod/fixture.jpg",
  category: [{ slug: "hanh-dong", name: "Hành động" }],
  country: [{ slug: "au-my" }, { slug: "han-quoc" }],
  link_m3u8: "https://private.invalid/video.m3u8",
  episodes: [{ link_embed: "https://private.invalid" }],
};
test("Vietnamese names compare across accents and composed Unicode", () => {
  assert.equal(normalizeName("HOÁN ĐỔI"), normalizeName("Hoán đổi"));
});
test("plain text excludes HTML, scripts, nested entities and controls", () => {
  const s = plainText(
    "<script>secret()</script><p>A &amp; B &#273; &lt;b&gt;x&lt;/b&gt;</p>\0",
  );
  assert.equal(s, "A & B đ x");
  assert.ok(!s.includes("secret"));
  assert.equal(plainText("abcd", 2), "ab");
});
test("declared count accepts explicit total only", () => {
  assert.equal(episodeCount(1, "MOVIE"), 1);
  assert.equal(episodeCount("52 Tập", "SERIES"), 52);
});
test("unknown/current/range episode counts never guessed", () => {
  for (const x of ["??", "Tập 3", "18/18", "1-2", 0, 101, 2.5])
    assert.throws(() => episodeCount(x, "SERIES"));
  assert.throws(() => episodeCount(2, "MOVIE"));
});
test("image origin allowlist rejects SSRF and signed URLs", () => {
  for (const x of [
    "http://phimimg.com/uploads/movies/x.jpg",
    "https://localhost/uploads/movies/x.jpg",
    "https://phimimg.com.evil.test/uploads/movies/x.jpg",
    "https://user:password@phimimg.com/uploads/movies/x.jpg",
    "https://phimimg.com:444/uploads/movies/x.jpg",
    "https://phimimg.com/uploads/movies/x.jpg?token=x",
    "https://phimimg.com/uploads/movies/x.svg",
    "data:image/png;base64,eA==",
  ])
    assert.throws(() => safeImageUrl(x));
});
test("both documented CDN path families are supported", () => {
  assert.equal(
    safeImageUrl("https://phimimg.com/upload/vod/fixture.webp"),
    "https://phimimg.com/upload/vod/fixture.webp",
  );
});
test("normalization uses a metadata whitelist, strips all video fields", () => {
  const item = normalizeItem(fixture, "Một bản tóm tắt ngắn.");
  assert.equal(item.expectedEpisodes, 24);
  assert.deepEqual(item.countryCodes, ["KR"]);
  assert.ok(!JSON.stringify(item).includes("private.invalid"));
  assert.equal(item.sourceApiUrl, "https://phimapi.com/phim/phim-thu");
});
test("no empty summary, unsupported type or malformed ID", () => {
  assert.throws(() => normalizeItem(fixture, ""));
  assert.throws(() => normalizeItem({ ...fixture, type: "unknown" }, "x"));
  assert.throws(() => normalizeItem({ ...fixture, slug: "../unsafe" }, "x"));
});
test("duplicates compare both names, year and kind", () => {
  const item = normalizeItem(fixture, "x");
  assert.ok(
    titleMatches(
      { localizedTitle: "PHIM THU", releaseYear: 2024, kind: "SERIES" },
      item,
    ),
  );
  assert.ok(
    !titleMatches(
      { localizedTitle: "Phim thử", releaseYear: 2023, kind: "SERIES" },
      item,
    ),
  );
  assert.ok(
    !titleMatches(
      { localizedTitle: "Phim thử", releaseYear: 2024, kind: "MOVIE" },
      item,
    ),
  );
});
test("only raster image magic accepted", () => {
  const webp = Buffer.from("RIFF0000WEBPVP8 ");
  assert.ok(validImageBytes(webp));
  assert.ok(!validImageBytes(Buffer.from("<svg>malicious</svg>")));
  assert.ok(!validImageBytes(Buffer.from("not an image")));
});
