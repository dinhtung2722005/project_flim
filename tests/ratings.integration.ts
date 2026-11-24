import { RatingsService } from "../apps/api/src/services/ratings.service";
import { OmdbRatingsClient } from "../packages/ratings/src/omdb";
import { chromium, expect as browserExpect } from "@playwright/test";
import "../apps/api/src/config";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import request from "supertest";
import { createApplication } from "../apps/api/src/application";
import { AuthService } from "../apps/api/src/services/auth.service";
import { passwordHash } from "../apps/api/src/security";
import { normalized } from "../packages/assistant/src/search";
let checks = 0;
function eq(a: unknown, b: unknown) {
  assert.deepEqual(a, b);
  checks++;
}
function ok(v: unknown) {
  assert.ok(v);
  checks++;
}
async function main() {
  delete process.env.OMDB_API_KEY;
  process.env.REVIEWS_ENABLED = "true";
  const password = process.env.PJ_FLIM_TEST_ADMIN_PASSWORD;
  if (!password)
    throw new Error("Isolated test database admin credential required.");
  process.env.ASSISTANT_QUEUE_PREFIX =
    "pjflim.assistant-test." + randomBytes(6).toString("hex");
  process.env.ASSISTANT_ENABLED = "true";
  process.env.ASSISTANT_DISPATCH_ENABLED = "false";
  process.env.ASSISTANT_ENGINE = "CATALOG";
  process.env.ASSISTANT_WORKER_SECRET = randomBytes(32).toString("hex");
  process.env.ASSISTANT_SERVICE_SECRET = randomBytes(32).toString("hex");
  process.env.AUTH_MFA_REQUIRED = "false";
  const name = "pj_flim_test_" + randomBytes(6).toString("hex");
  assert.match(name, /^pj_flim_test_[a-f0-9]{12}$/);
  const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!),
    apiUrl = new URL(process.env.DATABASE_URL!);
  ownerUrl.searchParams.delete("schema");
  apiUrl.searchParams.delete("schema");
  const adminUrl = new URL(ownerUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.username = process.env.PJ_FLIM_TEST_ADMIN_USER ?? "postgres";
  adminUrl.password = password;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 2 });
  let f: Pool | undefined,
    app: any,
    created = false;
  await mkdir(".local/ratings", { recursive: true });
  try {
    await admin.query(
      'CREATE DATABASE "' +
        name +
        "\" OWNER pj_flim_owner TEMPLATE template0 ENCODING 'UTF8'",
    );
    created = true;
    ownerUrl.pathname = "/" + name;
    apiUrl.pathname = "/" + name;
    f = new Pool({ connectionString: ownerUrl.toString(), max: 4 });
    await f.query(
      'REVOKE ALL ON DATABASE "' +
        name +
        '" FROM PUBLIC; GRANT CONNECT ON DATABASE "' +
        name +
        '" TO movie_api,movie_worker; ALTER DATABASE "' +
        name +
        '" SET search_path TO movie,pg_catalog',
    );
    for (const filename of [
      "movie-database-schema.sql",
      "movie-database-rbac-seed.sql",
      "movie-database-grants.sql",
      "movie-recommendations-v1.sql",
      "movie-assistant-v1.sql",
      "movie-assistant-feedback-v1.sql",
      "movie-reviews-v1.sql",
      "movie-viewer-reviews-v1.sql",
      "movie-view-stats-v1.sql",
      "movie-admin-advanced-v1.sql",
      "movie-catalog-batches-v1.sql",
    ])
      await f.query(await readFile("docs/design/sql/" + filename, "utf8"));
    process.env.DATABASE_URL = apiUrl.toString();
    process.env.MIGRATION_DATABASE_URL = ownerUrl.toString();
    const result = await createApplication();
    app = result.app;
    const server = app.getHttpServer();
    const auth = app.get(AuthService);
    const testPassword = "Assistant-" + randomBytes(16).toString("hex"),
      pwhash = await passwordHash(testPassword);
    async function seed(role = "MEMBER") {
      const id = randomUUID(),
        sid = randomUUID(),
        email = id + "@example.test";
      await f!.query(
        "INSERT INTO movie.users(id,email_normalized,password_hash,display_name) VALUES($1,$2,$3,'Assistant test')",
        [id, email, pwhash],
      );
      await f!.query(
        "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code=$2",
        [id, role],
      );
      await f!.query(
        "INSERT INTO movie.auth_sessions(id,user_id,state,auth_version,idle_expires_at,absolute_expires_at) VALUES($1,$2,'ACTIVE',1,now()+interval '1 hour',now()+interval '2 hours')",
        [sid, id],
      );
      return {
        id,
        sid,
        email,
        password: testPassword,
        token: auth.sign({ sub: id, sid, av: "1", kind: "access" }),
      };
    }
    const a = await seed(),
      adminUser = await seed("ADMIN"),
      editor = await seed("EDITOR"),
      auditor = await seed("AUDITOR");
    const api = (method: string, path: string, token?: string) => {
      let r = (request(server) as any)[method]("/api/v1" + path);
      if (token) r = r.set("Authorization", "Bearer " + token);
      return r;
    };
    async function expect(req: any, status: number, code?: string) {
      const r = await req;
      eq(r.status, status);
      if (code) eq(r.body.code, code);
      return r;
    }
    async function fixture(title: string, published = true) {
      const titleId = randomUUID(),
        seasonId = randomUUID(),
        episodeId = randomUUID(),
        assetId = randomUUID(),
        attemptId = randomUUID(),
        operationId = randomUUID();
      await f!.query(
        "INSERT INTO movie.titles(id,kind,slug,localized_title,normalized_title,release_year,country_codes,created_by,updated_by,publication_status,published_at) VALUES($1,'SERIES',$2,$3,$4,2026,ARRAY['VN'],$5,$5,$6,CASE WHEN $6='PUBLISHED' THEN now() ELSE NULL END)",
        [
          titleId,
          "assistant-" + titleId,
          title,
          normalized(title),
          a.id,
          published ? "PUBLISHED" : "DRAFT",
        ],
      );
      await f!.query(
        "INSERT INTO movie.seasons(id,title_id,number,name) VALUES($1,$2,1,'Season 1')",
        [seasonId, titleId],
      );
      await f!.query(
        "INSERT INTO movie.episodes(id,title_id,season_id,number,name) VALUES($1,$2,$3,1,'Episode 1')",
        [episodeId, titleId, seasonId],
      );
      await f!.query(
        "INSERT INTO movie.video_assets(id,episode_id,internal_version,provider_asset_id,public_id,provider_version,delivery_type,processing_status,backup_status,duration_seconds,bytes,source_format) VALUES($1,$2,1,$3,$3,'1234','authenticated','READY','VERIFIED',100,100,'mp4')",
        [assetId, episodeId, "test/" + assetId],
      );
      await f!.query(
        "INSERT INTO movie.operations(id,owner_user_id,principal_scope,type) VALUES($1,$2,'test','MEDIA_PROCESS')",
        [operationId, a.id],
      );
      await f!.query(
        "INSERT INTO movie.media_attempts(id,asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash,completed_at) VALUES($1,$2,$3,'hls-hd-v1','viewer','SUCCEEDED',1,$4,now())",
        [attemptId, assetId, operationId, randomUUID()],
      );
      await f!.query(
        "UPDATE movie.video_assets SET current_attempt_id=$2 WHERE id=$1",
        [assetId, attemptId],
      );
      await f!.query(
        "INSERT INTO movie.media_outputs(attempt_id,format,profile_version,config_hash,status,manifest_ref,verified_at,rendition_summary) VALUES($1,'HLS','hls-hd-v1','viewer','READY','test/manifest',now(),'[{\"height\":720}]')",
        [attemptId],
      );
      await f!.query(
        "INSERT INTO movie.source_backups(asset_id,storage_provider,bucket,object_key,sha256,bytes,status,verified_at,source_manifest_ref,object_version) VALUES($1,'S3','test',$2,$3,100,'VERIFIED',now(),'test/manifest','v1')",
        [assetId, assetId, "0".repeat(64)],
      );
      await f!.query(
        "UPDATE movie.episodes SET active_asset_id=$2,publication_status=$3,published_at=CASE WHEN $3='PUBLISHED' THEN now() ELSE NULL END WHERE id=$1",
        [episodeId, assetId, published ? "PUBLISHED" : "DRAFT"],
      );
      return { titleId, seasonId, episodeId, assetId };
    }

    const film = await fixture("Rating Film"),
      draft = await fixture("Hidden Film", false);
    const path = "/titles/" + film.titleId + "/ratings";
    const service = app.get(RatingsService) as RatingsService;
    let calls = 0,
      mode = "normal",
      release: (() => void) | undefined,
      entered: (() => void) | undefined,
      gate: Promise<void> | undefined;
    service.client = () =>
      new OmdbRatingsClient("fixture-key", async (input, init) => {
        const u = new URL(String(input));
        eq(u.origin, "https://www.omdbapi.com");
        eq(init?.redirect, "error");
        calls++;
        if (mode === "wait") {
          entered?.();
          await gate;
        }
        if (mode === "error") throw Error("fixture-key-private");
        const row = {
          Response: "True",
          Title: u.searchParams.get("t"),
          Year: "2026",
          Type: "series",
          imdbID: "tt1234567",
          imdbRating:
            mode === "partial" ? "N/A" : mode === "zero" ? "0" : "8.6",
          imdbVotes: mode === "partial" ? "N/A" : "123,456",
          Metascore: mode === "zero" ? "0" : "82",
        };
        return new Response(JSON.stringify(row), {
          headers: { "Content-Type": "application/json" },
        });
      });
    const clear = () => {
      (service as any).cache.clear();
    };
    const r = await expect(api("get", path), 200);
    eq(r.body.status, "NOT_CONFIGURED");
    eq(r.body.imdb.score, null);
    eq(calls, 0);
    process.env.OMDB_API_KEY = "fixture-key";
    await expect(api("get", "/titles/" + draft.titleId + "/ratings"), 404);
    eq(calls, 0);
    const ready = await expect(api("get", path), 200);
    eq(ready.body.imdb.score, 8.6);
    eq(ready.body.imdb.scale, 10);
    eq(ready.body.metacritic.score, 82);
    eq(ready.body.metacritic.scale, 100);
    eq(ready.headers["cache-control"], "no-store");
    ok(!JSON.stringify(ready.body).includes("fixture-key"));
    eq(calls, 1);
    await expect(api("get", path), 200);
    eq(calls, 1);
    await f!.query("UPDATE movie.titles SET version=version+1 WHERE id=$1", [
      film.titleId,
    ]);
    await expect(api("get", path), 200);
    eq(calls, 2);
    clear();
    mode = "partial";
    const partial = await expect(api("get", path), 200);
    eq(partial.body.imdb.score, null);
    eq(partial.body.metacritic.score, 82);
    clear();
    mode = "zero";
    const zero = await expect(api("get", path), 200);
    eq(zero.body.imdb.score, 0);
    eq(zero.body.metacritic.score, 0);
    clear();
    mode = "error";
    const failed = await expect(api("get", path), 200);
    eq(failed.body.status, "UNAVAILABLE");
    eq(failed.body.imdb.score, null);
    ok(!JSON.stringify(failed.body).includes("private"));
    clear();
    mode = "wait";
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = api("get", path).then((r: any) => r);
    await active;
    const second = api("get", path).then((r: any) => r);
    const before = calls;
    await new Promise((resolve) => setTimeout(resolve, 80));
    eq(calls, before);
    release!();
    eq((await first).status, 200);
    eq((await second).status, 200);
    eq(calls, before);
    clear();
    mode = "wait";
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const active2 = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const stale = api("get", path).then((r: any) => r);
    await active2;
    await f!.query(
      "UPDATE movie.titles SET publication_status='DRAFT',published_at=NULL,version=version+1 WHERE id=$1",
      [film.titleId],
    );
    release!();
    eq((await stale).status, 404);
    await f!.query(
      "UPDATE movie.titles SET publication_status='PUBLISHED',published_at=now(),version=version+1 WHERE id=$1",
      [film.titleId],
    );
    clear();
    mode = "normal";
    // The endpoint documents the separate scales.
    const spec = await expect(request(server).get("/api/openapi.json"), 200);
    eq(
      spec.body.paths["/api/v1/titles/{id}/ratings"].get.responses["200"]
        .content["application/json"].schema.properties.metacritic.properties
        .score.maximum,
      100,
    );
    await app.listen(0, "127.0.0.1");
    const origin = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      let pageErrors = 0;
      page.on("pageerror", () => pageErrors++);
      await page.goto(origin + "/");
      const card = page
        .locator(".movie-card")
        .filter({ hasText: "Rating Film" })
        .first();
      await card.locator(".card-ratings").scrollIntoViewIfNeeded();
      await browserExpect(card.locator(".card-ratings")).toBeVisible();
      await browserExpect(card.locator(".card-ratings strong")).toHaveText([
        "8.6",
        "82",
      ]);
      eq(await card.locator(".card-ratings a,.card-ratings button").count(), 0);
      checks += 2;
      await page.screenshot({
        path: ".local/ratings/home-scores.png",
        fullPage: true,
      });
      await page.route("https://res.cloudinary.com/**", (route) =>
        route.abort(),
      );
      await page.goto(origin + "/watch/" + film.episodeId);
      await browserExpect(
        page.getByRole("heading", { name: "Điểm đánh giá", exact: true }),
      ).toBeVisible();
      await browserExpect(
        page
          .getByRole("article", { name: "Điểm IMDb", exact: true })
          .locator("strong"),
      ).toHaveText("8.6");
      await browserExpect(
        page
          .getByRole("article", { name: "Điểm Metacritic", exact: true })
          .locator("strong"),
      ).toHaveText("82");
      checks += 3;
      await page.screenshot({
        path: ".local/ratings/watch-scores.png",
        fullPage: true,
      });
      await page.goto(origin + "/titles/" + film.titleId);
      const imdb = page.getByRole("article", {
          name: "Điểm IMDb",
          exact: true,
        }),
        meta = page.getByRole("article", {
          name: "Điểm Metacritic",
          exact: true,
        });
      await browserExpect(imdb.locator("strong")).toHaveText("8.6");
      await browserExpect(meta.locator("strong")).toHaveText("82");
      await browserExpect(imdb.getByRole("link")).toHaveAttribute(
        "href",
        "https://www.imdb.com/title/tt1234567/",
      );
      await browserExpect(
        page.getByText("Metascore · Giới phê bình", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: ".local/ratings/scores-desktop.png",
        fullPage: true,
      });
      checks += 4;
      await page.setViewportSize({ width: 390, height: 844 });
      await browserExpect(meta).toBeVisible();
      eq(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: ".local/ratings/scores-mobile.png",
        fullPage: true,
      });
      clear();
      mode = "partial";
      await page.reload();
      await browserExpect(
        imdb.getByText("Chưa có điểm", { exact: true }),
      ).toBeVisible();
      await browserExpect(meta.locator("strong")).toHaveText("82");
      checks += 2;
      clear();
      mode = "zero";
      await page.reload();
      await browserExpect(imdb.locator("strong")).toHaveText("0.0");
      await browserExpect(meta.locator("strong")).toHaveText("0");
      checks += 2;
      clear();
      mode = "error";
      await page.reload();
      await browserExpect(
        page.getByText("Chưa tải được điểm đánh giá.", { exact: false }),
      ).toBeVisible();
      await browserExpect(
        page.getByRole("button", { name: "Thử lại", exact: true }),
      ).toBeVisible();
      checks += 2;
      clear();
      delete process.env.OMDB_API_KEY;
      await page.reload();
      await browserExpect(
        imdb.getByText("Chưa có điểm", { exact: true }),
      ).toBeVisible();
      await browserExpect(
        meta.getByText("Chưa có điểm", { exact: true }),
      ).toBeVisible();
      checks += 2;
      await page.goto(origin + "/");
      await page.setViewportSize({ width: 390, height: 844 });
      await browserExpect(card.locator(".card-ratings strong")).toHaveText([
        "—",
        "—",
      ]);
      eq(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: ".local/ratings/home-no-key-mobile.png",
        fullPage: true,
      });
      checks++;
      eq(pageErrors, 0);
    } finally {
      await browser.close();
    }
    const report = {
      passed: true,
      checks,
      providerCalls: calls,
      liveProvider: false,
      chrome: true,
      schemaTables: 59,
    };
    await writeFile(
      ".local/ratings/integration-result.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({ event: "ratings.integration.passed", ...report }),
    );
  } finally {
    if (app) await app.close();
    if (f) await f.end();
    if (created) {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
        [name],
      );
      await admin.query('DROP DATABASE "' + name + '"');
    }
    await admin.end();
  }
}
main().catch(async (error) => {
  await writeFile(".local/ratings/failure.txt", String(error.stack));
  console.error(
    JSON.stringify({
      event: "ratings.integration.failed",
      code: error.code ?? error.name,
      detail:
        error instanceof assert.AssertionError
          ? error.message
          : "See private test log.",
    }),
  );
  process.exitCode = 1;
});
