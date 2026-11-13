import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  exportCatalog,
  snapshotTitle,
  stableJson,
} from "../scripts/export-agent-catalog.mjs";
const id = randomUUID();
const row = {
  id,
  kind: "MOVIE",
  localizedTitle: "Phim thử tiếng Việt",
  synopsis: "Một câu chuyện.",
  releaseYear: 2025,
  countryCodes: ["VN"],
  originalLanguage: "vi",
  genres: [{ name: "Gia đình" }],
  credits: [{ role: "DIRECTOR", name: "Đạo diễn thử" }],
  posterAssetRef: "private-poster",
  playbackUrl: "signed-url-not-real",
  createdBy: "owner-not-exported",
};
test("only allowlisted public fields are exported", () => {
  const data = snapshotTitle(row);
  for (const k of ["playbackUrl", "posterAssetRef", "createdBy"])
    assert.equal(data[k], undefined);
  assert.deepEqual(data.genres, ["Gia đình"]);
  assert.equal(data.name, row.localizedTitle);
});
test("text and list limits are preserved with a truncation flag", () => {
  const data = snapshotTitle({
    ...row,
    synopsis: "x".repeat(4000),
    genres: Array.from({ length: 40 }, () => ({ name: "Test" })),
  });
  assert.equal(data.synopsis.length, 3000);
  assert.equal(data.genres.length, 30);
  assert.equal(data.metadata_truncated, true);
});
test("stable JSON matches the Python canonical UTF8 convention", () => {
  assert.equal(
    stableJson({ z: null, b: "Điện ảnh", a: [{ y: 2, x: true }] }),
    '{"a":[{"x":true,"y":2}],"b":"Điện ảnh","z":null}',
  );
});
test("export pages without credentials or private fields", async () => {
  const output = ".local/agent/export-test-" + randomUUID() + ".json",
    requests = [];
  try {
    const result = await exportCatalog({
      output,
      fetchJson: async (base, path) => {
        requests.push({ base, path });
        if (path.startsWith("/api/v1/titles?"))
          return { data: [{ id }], page: { hasMore: false, nextCursor: null } };
        return row;
      },
    });
    assert.equal(result.titles, 1);
    const data = JSON.parse(await readFile(output, "utf8"));
    assert.equal(data.demo, false);
    assert.equal(data.rights.cloud_processing, true);
    assert.match(data.titles_sha256, /^[0-9a-f]{64}$/);
    assert.equal(data.titles[0].playbackUrl, undefined);
    assert.equal(requests.length, 2);
  } finally {
    await unlink(output).catch(() => {});
  }
});
test("maximum candidate count marks a partial catalog", async () => {
  const output = ".local/agent/export-test-" + randomUUID() + ".json";
  try {
    const result = await exportCatalog({
      max: 1,
      output,
      fetchJson: async (base, path) =>
        path.startsWith("/api/v1/titles?")
          ? {
              data: [{ id }, { id: randomUUID() }],
              page: { hasMore: true, nextCursor: "test" },
            }
          : row,
    });
    assert.equal(result.titles, 1);
    assert.equal(result.truncated, true);
  } finally {
    await unlink(output).catch(() => {});
  }
});
test("rejects remote URLs, credentials, arbitrary output paths and invalid limits", async () => {
  for (const params of [
    { base: "https://example.com" },
    { base: "http://user:pass@127.0.0.1:3000" },
    { base: "http://127.0.0.1:3000/private" },
    { output: "README.md" },
    { max: 1001 },
  ])
    await assert.rejects(() => exportCatalog(params));
});
test("API failure does not write a partial snapshot", async () => {
  const output = ".local/agent/export-test-" + randomUUID() + ".json";
  await assert.rejects(() =>
    exportCatalog({
      output,
      fetchJson: async () => {
        throw Error("fixture");
      },
    }),
  );
  await assert.rejects(() => readFile(output));
});
