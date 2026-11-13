// Public API only; exports no auth, account, playback URL, image ref or secret.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
export const stableJson = (value) =>
  JSON.stringify(
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map((v) => JSON.parse(stableJson(v)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, JSON.parse(stableJson(value[k]))]),
          )
      : value,
  );
const hash = (value) =>
  createHash("sha256").update(stableJson(value)).digest("hex");
const bounded = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
export function snapshotTitle(row) {
  if (
    !/^[0-9a-f-]{36}$/i.test(row.id) ||
    !["MOVIE", "SERIES"].includes(row.kind)
  )
    throw Error("PUBLIC_TITLE_SCHEMA_INVALID");
  const synopsis = bounded(row.synopsis, 3000);
  return {
    id: row.id,
    kind: row.kind,
    name: bounded(row.localizedTitle, 300),
    original_name: row.originalTitle ? bounded(row.originalTitle, 300) : null,
    synopsis,
    genres: (row.genres || []).slice(0, 30).map((g) => bounded(g.name, 100)),
    credits: (row.credits || [])
      .slice(0, 30)
      .map((c) => bounded(c.role + ": " + c.name, 200)),
    year: Number.isInteger(row.releaseYear) ? row.releaseYear : null,
    countries: (row.countryCodes || []).slice(0, 20),
    language: row.originalLanguage || null,
    metadata_truncated:
      (row.synopsis?.length || 0) > 3000 ||
      (row.genres?.length || 0) > 30 ||
      (row.credits?.length || 0) > 30,
  };
}
async function get(base, path) {
  const response = await fetch(base + path, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw Error("PUBLIC_CATALOG_UNAVAILABLE");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw Error("PUBLIC_CATALOG_TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function exportCatalog({
  base = "http://127.0.0.1:3000",
  output = ".local/agent/catalog.snapshot.json",
  max = 1000,
  fetchJson = get,
} = {}) {
  const origin = new URL(base);
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw Error("ONLY_LOCAL_PUBLIC_API_SUPPORTED");
  if (!Number.isInteger(max) || max < 1 || max > 1000)
    throw Error("INVALID_SNAPSHOT_LIMIT");
  const target = resolve(output),
    workspace = resolve(".local/agent");
  const sub = relative(workspace, target);
  if (sub.startsWith("..") || isAbsolute(sub))
    throw Error("OUTPUT_MUST_BE_IN_LOCAL_AGENT");
  const titles = [],
    seen = new Set();
  let cursor = null,
    truncated = false;
  for (let page = 0; page < 20; page++) {
    const data = await fetchJson(
      origin.origin,
      "/api/v1/titles?limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (!Array.isArray(data.data) || !data.page)
      throw Error("PUBLIC_CATALOG_SCHEMA_INVALID");
    for (const row of data.data) {
      if (seen.has(row.id)) continue;
      if (titles.length === max) {
        truncated = true;
        break;
      }
      seen.add(row.id);
      try {
        titles.push(
          snapshotTitle(
            await fetchJson(
              origin.origin,
              "/api/v1/titles/" + encodeURIComponent(row.id),
            ),
          ),
        );
      } catch (error) {
        throw Error("PUBLIC_TITLE_EXPORT_FAILED");
      }
    }
    if (truncated || !data.page.hasMore) break;
    cursor = data.page.nextCursor;
    if (!cursor || typeof cursor !== "string")
      throw Error("PUBLIC_CURSOR_INVALID");
    if (titles.length === max || page === 19) {
      truncated = true;
      break;
    }
  }
  const now = new Date();
  const snapshot = {
    schema_version: 1,
    source: "pj-flim-public-catalog",
    generated_at: now.toISOString(),
    expires_at: new Date(+now + 24 * 3600000).toISOString(),
    demo: false,
    truncated,
    rights: { cloud_processing: true, embedding: true },
    titles,
    titles_sha256: hash(titles),
  };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return {
    file: relative(process.cwd(), target),
    titles: titles.length,
    truncated,
    titlesSha256: snapshot.titles_sha256,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  exportCatalog()
    .then((result) =>
      console.log(
        JSON.stringify({ event: "agent.catalog.exported", ...result }),
      ),
    )
    .catch(() => {
      console.error(
        JSON.stringify({
          event: "agent.catalog.export.failed",
          detail:
            "Check the local public API; no credentials or response data were printed.",
        }),
      );
      process.exitCode = 1;
    });
}
