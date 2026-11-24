import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import {
  normalizeItem,
  normalizeName,
  titleMatches,
  safeImageUrl,
  validImageBytes,
} from "./lib/catalog-metadata.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const n = args.indexOf(name);
  return n < 0 ? fallback : args[n + 1];
};
const batchName = option("--batch", "default");
const AREA = path.join(
  ROOT,
  ".local/catalog-import/kkphim",
  batchName === "default" ? "" : batchName,
);
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function read(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function save(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
}
function localFile(value) {
  const target = path.resolve(ROOT, value);
  if (!target.startsWith(path.join(ROOT, ".local/catalog-import") + path.sep))
    throw Error("LOCAL_IMPORT_PATH_REQUIRED");
  return target;
}
async function bounded(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw Error("RESPONSE_TOO_LARGE");
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw Error("RESPONSE_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function providerJson(route) {
  if (
    !/^\/(?:v1\/api\/danh-sach\/(?:phim-le|phim-bo)\?page=1&limit=\d+|phim\/[a-z0-9-]+)$/.test(
      route,
    )
  )
    throw Error("SOURCE_ROUTE_NOT_ALLOWED");
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://phimapi.com" + route, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/json",
        "User-Agent": "pj-Flim-metadata-import/1.0",
      },
    });
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 2) throw Error("SOURCE_TEMPORARILY_UNAVAILABLE");
      await delay(2000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw Error("SOURCE_HTTP_" + response.status);
    return JSON.parse((await bounded(response, 3000000)).toString("utf8"));
  }
}
function validatePlan(plan) {
  if (
    plan.version !== 1 ||
    plan.provider !== "KKPHIM" ||
    !Array.isArray(plan.items) ||
    plan.items.length < 1 ||
    plan.items.length > 100
  )
    throw Error("IMPORT_PLAN_INVALID");
  const age = Date.now() - Date.parse(plan.fetchedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 86400000)
    throw Error("IMPORT_PLAN_EXPIRED");
  const items = plan.items.map((i) => {
    const candidate = normalizeItem(
      {
        providerId: i.providerId,
        slug: i.slug,
        name: i.name,
        originalName: i.originalName,
        type:
          i.kind === "MOVIE"
            ? "single"
            : i.kind === "SERIES"
              ? "series"
              : "unknown",
        year: i.year,
        episodeTotal: i.expectedEpisodes,
        episodeCurrent: i.sourceEpisodeCurrent,
        posterUrl: i.posterUrl,
        category: i.genres,
        country: [],
      },
      i.synopsis,
    );
    if (
      !Array.isArray(i.countryCodes) ||
      i.countryCodes.length > 30 ||
      i.countryCodes.some((c) => !/^([A-Z]{2})$/.test(c))
    )
      throw Error("COUNTRY_CODES_INVALID");
    candidate.countryCodes = [...new Set(i.countryCodes)];
    return candidate;
  });
  if (
    new Set(items.map((i) => i.slug)).size !== items.length ||
    new Set(items.map((i) => i.providerId)).size !== items.length
  )
    throw Error("DUPLICATE_SOURCE_TITLE");
  return { ...plan, items };
}
async function fetchPreview() {
  const count = Number(option("--limit", 20));
  if (!Number.isInteger(count) || count < 2 || count > 100)
    throw Error("LIMIT_2_TO_100_REQUIRED");
  const rows = [];
  for (const type of ["phim-le", "phim-bo"]) {
    const batch = await providerJson(
      "/v1/api/danh-sach/" +
        type +
        "?page=1&limit=" +
        Math.min(64, Math.ceil(count / 2)),
    );
    for (const entry of (batch.data?.items || []).slice(
      0,
      type === "phim-le" ? Math.ceil(count / 2) : Math.floor(count / 2),
    )) {
      const result = await providerJson("/phim/" + entry.slug),
        m = result.movie;
      if (!m) throw Error("SOURCE_DETAIL_INVALID");
      rows.push({
        providerId: m._id,
        slug: m.slug,
        name: m.name,
        originalName: m.origin_name,
        type: m.type,
        year: m.year,
        posterUrl: m.poster_url,
        episodeTotal: m.episode_total,
        episodeCurrent: m.episode_current,
        category: m.category,
        country: m.country,
      });
      await delay(350);
    }
  }
  const file = path.join(AREA, "source-preview.json");
  await save(file, {
    at: new Date().toISOString(),
    provider: "KKPHIM",
    items: rows,
  });
  console.log(
    JSON.stringify({
      event: "metadata.fetched",
      titles: rows.length,
      file: path.relative(ROOT, file),
      videoFieldsStored: false,
    }),
  );
}
async function prepare() {
  const source = await read(
    localFile(option("--source", path.join(AREA, "source-preview.json"))),
  );
  const synopses = await read(
    localFile(option("--synopses", path.join(AREA, "synopses.vi.json"))),
  );
  const plan = validatePlan({
    version: 1,
    provider: "KKPHIM",
    fetchedAt: source.at,
    preparedAt: new Date().toISOString(),
    items: source.items.map((i) => normalizeItem(i, synopses[i.slug])),
  });
  const file = localFile(option("--plan", path.join(AREA, "plan.json")));
  await save(file, plan);
  console.log(
    JSON.stringify({
      event: "metadata.prepared",
      titles: plan.items.length,
      movies: plan.items.filter((i) => i.kind === "MOVIE").length,
      series: plan.items.filter((i) => i.kind === "SERIES").length,
      expectedEpisodes: plan.items.reduce((n, i) => n + i.expectedEpisodes, 0),
      file: path.relative(ROOT, file),
      databaseChanged: false,
    }),
  );
}
async function apply() {
  if (process.env.NODE_ENV === "production") throw Error("LOCAL_IMPORT_ONLY");
  for (const f of [".env.database.local", ".env.api.local"])
    dotenv.config({ path: path.join(ROOT, f), quiet: true });
  const port = Number(process.env.API_PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("API_PORT_INVALID");
  const base = "http://127.0.0.1:" + port + "/api/v1";
  const plan = validatePlan(
    await read(localFile(option("--plan", path.join(AREA, "plan.json")))),
  );
  const planHash = digest(plan.items),
    stateFile = path.join(AREA, "state.json");
  let state;
  try {
    state = await read(stateFile);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (state && state.planHash !== planHash)
    throw Error("IMPORT_PLAN_CHANGED_USE_SEPARATE_BATCH");
  state ??= {
    version: 1,
    runId: randomUUID(),
    planHash,
    startedAt: new Date().toISOString(),
    items: {},
  };
  const lockFile = path.join(AREA, "import.lock");
  let lock;
  try {
    lock = await fs.open(lockFile, "wx");
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, runId: state.runId }),
    );
  } catch (e) {
    if (e.code === "EEXIST") throw Error("IMPORT_ALREADY_RUNNING");
    throw e;
  }
  let token,
    created = 0,
    resumed = 0,
    skipped = 0,
    newEpisodes = 0,
    newGenres = 0;
  const report = {
    at: new Date().toISOString(),
    engine: "METADATA_ONLY",
    provider: "KKPHIM",
    items: [],
  };
  const api = async (route, method = "GET", body) => {
    if (!/^\/(?:admin\/|auth\/sessions|titles\/)/.test(route))
      throw Error("LOCAL_API_ROUTE_NOT_ALLOWED");
    const response = await fetch(base + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok)
      throw Error(data?.code || "LOCAL_API_HTTP_" + response.status);
    return { data, requestId: response.headers.get("x-request-id") };
  };
  const list = async (route) => {
    const result = [];
    let cursor;
    for (let page = 0; page < 200; page++) {
      const r = (
        await api(
          route +
            "?limit=100" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        )
      ).data;
      if (!Array.isArray(r.data)) throw Error("LOCAL_COLLECTION_INVALID");
      result.push(...r.data);
      if (!r.page?.hasMore) return result;
      if (!r.page.nextCursor || r.page.nextCursor === cursor)
        throw Error("LOCAL_CURSOR_INVALID");
      cursor = r.page.nextCursor;
    }
    throw Error("LOCAL_PAGE_BUDGET_EXCEEDED");
  };
  try {
    for (const key of [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ])
      if (!process.env[key]) throw Error("CLOUDINARY_NOT_CONFIGURED");
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
      hide_sensitive: true,
      signature_algorithm: "sha256",
    });
    const account = await read(
      path.resolve(
        ROOT,
        process.env.PJ_FLIM_ADMIN_CREDENTIALS_FILE ||
          ".local/api/bootstrap-admin.json",
      ),
    );
    const login = await api("/auth/sessions", "POST", {
      email: account.email,
      password: account.password,
    });
    token = login.data.accessToken;
    if (!token) throw Error("ACTIVE_ADMIN_SESSION_REQUIRED");
    const existing = await list("/admin/titles"),
      genres = await list("/admin/genres");
    if (!state.baseline)
      state.baseline = existing.map((t) => ({
        id: t.id,
        version: t.version,
        publicationStatus: t.publicationStatus,
      }));
    await save(stateFile, state);
    for (const item of plan.items) {
      let record = state.items[item.providerId];
      let title = record?.titleId
        ? existing.find((t) => t.id === record.titleId)
        : undefined;
      if (!title) {
        const collision = existing.find(
          (t) => t.slug === item.slug || titleMatches(t, item),
        );
        if (collision) {
          skipped++;
          report.items.push({
            slug: item.slug,
            titleId: collision.id,
            status: "SKIPPED_EXISTING",
          });
          continue;
        }
      } else {
        if (title.publicationStatus !== "DRAFT" || !titleMatches(title, item))
          throw Error("RESUME_TITLE_CHANGED");
        resumed++;
      }
      record ??= {
        slug: item.slug,
        sourceApiUrl: item.sourceApiUrl,
        sourcePageUrl: item.sourcePageUrl,
        expectedEpisodes: item.expectedEpisodes,
        sourceEpisodeCurrent: item.sourceEpisodeCurrent,
      };
      state.items[item.providerId] = record;
      const genreIds = [];
      for (const genre of item.genres) {
        let found = genres.find(
          (g) =>
            g.slug === genre.slug ||
            normalizeName(g.name) === normalizeName(genre.name),
        );
        if (!found) {
          found = (await api("/admin/genres", "POST", genre)).data;
          genres.push(found);
          newGenres++;
        }
        genreIds.push(found.id);
      }
      if (!record.poster) {
        const publicId =
          "pj-flim/catalog/kkphim/" + item.providerId + "/poster";
        let resource;
        try {
          resource = await cloudinary.api.resource(publicId, {
            resource_type: "image",
            type: "upload",
            timeout: 15000,
          });
        } catch (e) {
          if ((e.http_code ?? e.error?.http_code) !== 404)
            throw Error("POSTER_LOOKUP_FAILED");
        }
        if (!resource) {
          const response = await fetch(safeImageUrl(item.posterUrl), {
            redirect: "error",
            signal: AbortSignal.timeout(20000),
            headers: {
              "User-Agent": "pj-Flim-metadata-import/1.0",
              Accept: "image/jpeg,image/png,image/webp",
            },
          });
          if (
            !response.ok ||
            !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(
              response.headers.get("content-type") || "",
            )
          )
            throw Error("POSTER_RESPONSE_INVALID");
          const bytes = await bounded(response, 5000000);
          if (!validImageBytes(bytes)) throw Error("POSTER_BYTES_INVALID");
          resource = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                public_id: publicId,
                resource_type: "image",
                type: "upload",
                overwrite: false,
                unique_filename: false,
                timeout: 30000,
              },
              (error, result) =>
                error ? reject(Error("POSTER_UPLOAD_FAILED")) : resolve(result),
            );
            stream.on("error", () => reject(Error("POSTER_UPLOAD_FAILED")));
            stream.end(bytes);
          });
        }
        if (
          resource.public_id !== publicId ||
          resource.resource_type !== "image" ||
          !resource.bytes ||
          !resource.width ||
          !resource.height
        )
          throw Error("POSTER_RESOURCE_INVALID");
        record.poster = {
          publicId,
          bytes: resource.bytes,
          width: resource.width,
          height: resource.height,
          format: resource.format,
        };
        await save(stateFile, state);
      }
      if (!title) {
        const createdTitle = await api("/admin/titles", "POST", {
          kind: item.kind,
          slug: item.slug,
          localizedTitle: item.name,
          ...(item.originalName ? { originalTitle: item.originalName } : {}),
          synopsis: item.synopsis,
          releaseYear: item.year,
          posterAssetRef: record.poster.publicId,
          countryCodes: item.countryCodes,
          genreIds,
        });
        title = createdTitle.data;
        existing.push(title);
        record.titleId = title.id;
        record.createRequestId = createdTitle.requestId;
        created++;
        await save(stateFile, state);
      }
      let seasons = await list("/admin/titles/" + title.id + "/seasons");
      if (item.kind === "SERIES" && seasons.length === 0) {
        const match = (item.name + " " + item.originalName).match(
          /\((?:phần|season)\s+(\d+)\)/i,
        );
        const number = match ? Number(match[1]) : 1;
        seasons = [
          (
            await api("/admin/titles/" + title.id + "/seasons", "POST", {
              number,
              name: match ? "Phần " + number : "Danh sách tập",
            })
          ).data,
        ];
      }
      if (seasons.length !== 1) throw Error("EXPECTED_ONE_SOURCE_SEASON");
      const episodes = await list(
        "/admin/seasons/" + seasons[0].id + "/episodes",
      );
      if (
        episodes.some(
          (e) => e.activeAssetId || e.publicationStatus !== "DRAFT",
        ) ||
        episodes.length > item.expectedEpisodes
      )
        throw Error("RESUME_EPISODES_CHANGED");
      for (let number = 1; number <= item.expectedEpisodes; number++) {
        if (episodes.some((e) => e.number === number)) continue;
        if (item.kind === "MOVIE")
          throw Error("MOVIE_TECHNICAL_EPISODE_MISSING");
        episodes.push(
          (
            await api("/admin/seasons/" + seasons[0].id + "/episodes", "POST", {
              number,
              name: "Tập " + number,
            })
          ).data,
        );
        newEpisodes++;
      }
      const fresh = (await api("/admin/titles/" + title.id)).data;
      const cover =
        "https://res.cloudinary.com/" +
        encodeURIComponent(process.env.CLOUDINARY_CLOUD_NAME) +
        "/image/upload/f_auto,q_auto,w_160/" +
        record.poster.publicId;
      const image = await fetch(cover, {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!image.ok || !image.headers.get("content-type")?.startsWith("image/"))
        throw Error("POSTER_DELIVERY_FAILED");
      await image.body?.cancel();
      if (
        fresh.publicationStatus !== "DRAFT" ||
        fresh.posterAssetRef !== record.poster.publicId ||
        fresh.synopsis !== item.synopsis ||
        episodes.length !== item.expectedEpisodes
      )
        throw Error("IMPORTED_METADATA_VERIFY_FAILED");
      const hidden = await fetch(base + "/titles/" + title.id, {
        signal: AbortSignal.timeout(10000),
      });
      if (hidden.status !== 404) throw Error("METADATA_ONLY_TITLE_NOT_HIDDEN");
      await hidden.body?.cancel();
      record.status = "VERIFIED";
      record.episodeCount = episodes.length;
      record.verifiedAt = new Date().toISOString();
      await save(stateFile, state);
      report.items.push({
        slug: item.slug,
        name: item.name,
        titleId: title.id,
        kind: item.kind,
        expectedEpisodes: item.expectedEpisodes,
        episodes: episodes.length,
        publicationStatus: "DRAFT",
        coverHttp: 200,
      });
      console.log(
        JSON.stringify({
          event: "metadata.title.ready",
          slug: item.slug,
          episodes: episodes.length,
          videoAssetsAdded: 0,
        }),
      );
    }
    const after = await list("/admin/titles");
    if (
      state.baseline.some(
        (b) =>
          !after.some(
            (t) =>
              t.id === b.id &&
              t.version === b.version &&
              t.publicationStatus === b.publicationStatus,
          ),
      )
    )
      throw Error("EXISTING_TITLE_CHANGED");
    report.passed = true;
    report.created = created;
    report.resumed = resumed;
    report.skipped = skipped;
    report.newSeriesEpisodes = newEpisodes;
    report.newGenres = newGenres;
    report.expectedEpisodes = plan.items.reduce(
      (n, i) => n + i.expectedEpisodes,
      0,
    );
    report.videoAssetsAdded = 0;
    report.existingTitlesUnchanged = true;
  } catch (error) {
    report.passed = false;
    report.error = /^[A-Z][A-Z0-9_]+$/.test(error.message || "")
      ? error.message
      : "IMPORT_FAILED";
    throw Error(report.error);
  } finally {
    if (token)
      try {
        await api("/auth/sessions/current", "DELETE");
        report.logout = 204;
      } catch {
        report.logout = "FAILED";
      }
    await save(path.join(AREA, "last-run.json"), report);
    await lock.close();
    await fs.unlink(lockFile);
  }
  console.log(
    JSON.stringify({
      event: "metadata.import.complete",
      ...Object.fromEntries(
        Object.entries(report).filter(([k]) => k !== "items"),
      ),
    }),
  );
}
try {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(batchName))
    throw Error("BATCH_NAME_INVALID");
  await fs.mkdir(AREA, { recursive: true });
  const modes = ["--fetch", "--prepare", "--apply"].filter(flag);
  if (modes.length !== 1) throw Error("CHOOSE_FETCH_PREPARE_OR_APPLY");
  if (flag("--fetch")) await fetchPreview();
  else if (flag("--prepare")) await prepare();
  else await apply();
} catch (error) {
  console.error(
    JSON.stringify({
      event: "metadata.import.failed",
      code: /^[A-Z][A-Z0-9_]+$/.test(error.message || "")
        ? error.message
        : "IMPORT_FAILED",
    }),
  );
  process.exitCode = 1;
}
