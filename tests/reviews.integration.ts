import { ReviewsService } from "../apps/api/src/services/reviews.service";
import { TmdbReviewClient } from "../packages/reviews/src/tmdb";
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
  process.env.TMDB_API_READ_TOKEN = "fixture-review-token";
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
  await mkdir(".local/reviews", { recursive: true });
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

    const title = await fixture("Review Film"),
      draft = await fixture("Draft Review", false);
    const titleId = title.titleId;
    const sourcePath = "/admin/titles/" + titleId + "/review-source";
    const syncPath = "/admin/titles/" + titleId + "/review-sync";
    const listPath = "/titles/" + titleId + "/reviews";
    const service = app.get(ReviewsService) as ReviewsService;
    let mode = "normal",
      calls = 0,
      gate: (() => void) | undefined,
      entered: (() => void) | undefined,
      waiting: Promise<void> | undefined;
    const reviewId = "a".repeat(24);
    const make = (data: any, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const transport: typeof fetch = async (input: any, options: any) => {
      const url = new URL(String(input));
      ok(url.origin === "https://api.themoviedb.org");
      ok(options.redirect === "error");
      ok(options.headers.Authorization === "Bearer fixture-review-token");
      calls++;
      if (mode === "401") return make({ private: "must not leak" }, 401);
      if (mode === "429") return make({}, 429);
      if (mode === "timeout") throw Error("private-fixture-key");
      if (url.pathname.includes("/search/"))
        return make({
          results: [
            {
              id: 155,
              name: "Review Film",
              original_name: "Review Film",
              first_air_date: "2026-01-01",
            },
          ],
        });
      if (!url.pathname.endsWith("/reviews"))
        return make({
          id: 155,
          name: mode === "mismatch" ? "Wrong Film" : "Review Film",
          first_air_date: "2026-01-01",
        });
      if (mode === "wait") {
        entered?.();
        await waiting;
      }
      const language = url.searchParams.get("language");
      const rows =
        mode === "empty" || language === "vi-VN"
          ? []
          : [
              {
                id: reviewId,
                author: "Fixture critic",
                author_details: { rating: 8.5 },
                content:
                  "<script>window.__unsafe=1</script><b>Review fixture</b> — " +
                  "Nội dung thử. ".repeat(8),
                url:
                  mode === "evil"
                    ? "https://evil.test/review"
                    : "https://www.themoviedb.org/review/" + reviewId,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-02T00:00:00Z",
              },
            ];
      const result =
        mode === "pagination" && rows.length
          ? Array.from({ length: 3 }, (_, i) => ({
              ...rows[0],
              id: i.toString(16).padStart(24, "0"),
              url:
                "https://www.themoviedb.org/review/" +
                i.toString(16).padStart(24, "0"),
            }))
          : rows;
      return make({
        id: 155,
        page: 1,
        total_pages: result.length ? 1 : 0,
        total_results: result.length,
        results: result,
      });
    };
    service.client = () =>
      new TmdbReviewClient("fixture-review-token", transport);
    const fresh = () => api("get", sourcePath, adminUser.token);
    const clearBudget = () =>
      f!.query(
        "DELETE FROM movie.security_events WHERE category='review-admin'",
      );
    const allowSync = async () => {
      await clearBudget();
      await f!.query(
        "UPDATE movie.review_sources SET last_attempt_at=NULL WHERE title_id=$1",
        [titleId],
      );
    };
    const save = async (id = 155) => {
      const current = await expect(fresh(), 200);
      return expect(
        api("put", sourcePath, adminUser.token)
          .set("If-Match", current.headers.etag)
          .send({ externalId: id }),
        200,
      );
    };
    await expect(api("get", sourcePath), 401);
    await expect(api("get", sourcePath, a.token), 403);
    await expect(api("post", syncPath, a.token).send({}), 403);
    await expect(
      api("put", sourcePath, auditor.token).send({ externalId: 155 }),
      403,
    );
    await expect(api("get", sourcePath, auditor.token), 403);
    await expect(api("get", sourcePath, editor.token), 200);
    await expect(api("get", "/titles/" + draft.titleId + "/reviews"), 404);
    const initial = await expect(fresh(), 200);
    eq(initial.body.status, "UNMAPPED");
    eq(String(initial.body.version), "0");
    await expect(
      api("put", sourcePath, adminUser.token).send({ externalId: 155 }),
      428,
      "PRECONDITION_REQUIRED",
    );
    for (const body of [
      { externalId: null },
      { externalId: "155" },
      { externalId: 0 },
      { externalId: 155, verified: true },
    ]) {
      await expect(
        api("put", sourcePath, adminUser.token)
          .set("If-Match", initial.headers.etag)
          .send(body),
        422,
        "VALIDATION_FAILED",
      );
    }
    await clearBudget();
    mode = "mismatch";
    await expect(
      api("put", sourcePath, adminUser.token)
        .set("If-Match", initial.headers.etag)
        .send({ externalId: 155 }),
      422,
      "REVIEW_MAPPING_MISMATCH",
    );
    mode = "normal";
    await save();
    await expect(
      api("put", sourcePath, adminUser.token)
        .set("If-Match", initial.headers.etag)
        .send({ externalId: 155 }),
      412,
    );
    await clearBudget();
    const candidate = await expect(
      api(
        "get",
        "/admin/titles/" + titleId + "/review-candidates",
        editor.token,
      ),
      200,
    );
    eq(candidate.body.data[0].verified, false);
    const synced = await expect(
      api("post", syncPath, adminUser.token).send({}),
      200,
    );
    eq(synced.body.sync.count, 1);
    eq(synced.body.sync.language, "en-US");
    eq(synced.body.data[0].rating, 8.5);
    ok(!synced.body.data[0].content.includes("<"));
    ok(!synced.body.data[0].content.includes("window.__unsafe"));
    eq((await expect(api("get", listPath), 200)).body.data.length, 1);
    await expect(api("post", syncPath, adminUser.token).send({}), 429);
    process.env.REVIEWS_ENABLED = "false";
    const disabled = await expect(api("get", listPath), 200);
    eq(disabled.body.meta.status, "DISABLED");
    eq(disabled.body.data.length, 0);
    process.env.REVIEWS_ENABLED = "true";
    delete process.env.TMDB_API_READ_TOKEN;
    eq(
      (await expect(api("get", listPath), 200)).body.meta.status,
      "NOT_CONFIGURED",
    );
    process.env.TMDB_API_READ_TOKEN = "fixture-review-token";
    await f!.query("UPDATE movie.titles SET version=version+1 WHERE id=$1", [
      titleId,
    ]);
    const stale = await expect(api("get", listPath), 200);
    eq(stale.body.meta.status, "STALE");
    eq(stale.body.data.length, 0);
    await allowSync();
    await expect(api("post", syncPath, adminUser.token).send({}), 200);
    for (const [testMode, status, code] of [
      ["401", 503, "REVIEW_PROVIDER_AUTH_FAILED"],
      ["429", 429, "REVIEW_PROVIDER_RATE_LIMITED"],
      ["timeout", 503, "REVIEW_PROVIDER_UNAVAILABLE"],
      ["evil", 502, "REVIEW_PROVIDER_INVALID_RESPONSE"],
    ] as const) {
      mode = testMode;
      await allowSync();
      const r = await expect(
        api("post", syncPath, adminUser.token).send({}),
        status,
        code,
      );
      ok(!JSON.stringify(r.body).includes("private"));
      eq((await expect(api("get", listPath), 200)).body.data.length, 1);
    }
    mode = "empty";
    await allowSync();
    const empty = await expect(
      api("post", syncPath, adminUser.token).send({}),
      200,
    );
    eq(empty.body.sync.count, 0);
    eq(empty.body.meta.status, "READY");
    eq(empty.body.data.length, 0);
    mode = "normal";
    await allowSync();
    await expect(api("post", syncPath, adminUser.token).send({}), 200);
    mode = "pagination";
    await allowSync();
    await expect(api("post", syncPath, adminUser.token).send({}), 200);
    const firstPage = await expect(api("get", listPath + "?limit=1"), 200);
    eq(firstPage.body.data.length, 1);
    eq(firstPage.body.page.hasMore, true);
    const cursor = encodeURIComponent(firstPage.body.page.nextCursor);
    const secondPage = await expect(
      api("get", listPath + "?limit=1&cursor=" + cursor),
      200,
    );
    ok(firstPage.body.data[0].id !== secondPage.body.data[0].id);
    await expect(
      api(
        "get",
        "/admin/titles/" + titleId + "/reviews?limit=1&cursor=" + cursor,
        adminUser.token,
      ),
      400,
      "REQUEST_INVALID_CURSOR",
    );
    await f!.query(
      "UPDATE movie.review_sources SET refreshed_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE title_id=$1",
      [titleId],
    );
    eq((await expect(api("get", listPath), 200)).body.meta.status, "STALE");
    mode = "normal";
    await allowSync();
    await expect(api("post", syncPath, adminUser.token).send({}), 200);
    await expect(
      api("get", listPath + "?limit=1&cursor=" + cursor),
      400,
      "REQUEST_INVALID_CURSOR",
    );
    // Mapping replacement fences an in-flight network request.
    await allowSync();
    mode = "wait";
    waiting = new Promise<void>((resolve) => {
      gate = resolve;
    });
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const inflight = api("post", syncPath, adminUser.token)
      .send({})
      .then((r: any) => r);
    await active;
    const current = await expect(fresh(), 200);
    await expect(
      api("delete", sourcePath, adminUser.token).set(
        "If-Match",
        current.headers.etag,
      ),
      204,
    );
    gate!();
    const fenced = await inflight;
    eq(fenced.status, 409);
    eq(fenced.body.code, "REVIEW_CONTEXT_CHANGED");
    eq(
      (
        await f!.query(
          "SELECT count(*)::int n FROM movie.external_reviews WHERE title_id=$1",
          [titleId],
        )
      ).rows[0].n,
      0,
    );
    mode = "normal";
    await clearBudget();
    await save();
    await allowSync();
    await expect(api("post", syncPath, adminUser.token).send({}), 200);
    const abaOld = await expect(fresh(), 200);
    await expect(
      api("delete", sourcePath, adminUser.token).set(
        "If-Match",
        abaOld.headers.etag,
      ),
      204,
    );
    await clearBudget();
    await save();
    await expect(
      api("delete", sourcePath, adminUser.token).set(
        "If-Match",
        abaOld.headers.etag,
      ),
      412,
    );
    await allowSync();
    await expect(api("post", syncPath, adminUser.token).send({}), 200);
    // Failure to append audit must roll back a mapping/purge.
    const prior = await expect(fresh(), 200);
    await f!.query("REVOKE INSERT ON movie.audit_logs FROM movie_api");
    try {
      await expect(
        api("delete", sourcePath, adminUser.token).set(
          "If-Match",
          prior.headers.etag,
        ),
        503,
      );
    } finally {
      await f!.query("GRANT INSERT ON movie.audit_logs TO movie_api");
    }
    eq((await expect(api("get", listPath), 200)).body.data.length, 1);
    for (const table of ["review_sources", "external_reviews"]) {
      const row = (
        await f!.query(
          "SELECT has_table_privilege('movie_api',$1,'INSERT') a,has_table_privilege('movie_worker',$1,'SELECT') w,has_table_privilege('movie_auditor',$1,'SELECT') r",
          ["movie." + table],
        )
      ).rows[0];
      eq(row, { a: true, w: false, r: false });
    }
    const spec = await expect(request(server).get("/api/openapi.json"), 200);
    ok(spec.body.paths["/api/v1/titles/{id}/reviews"]);
    eq(
      spec.body.paths["/api/v1/titles/{id}/reviews"].get.responses["200"]
        .content["application/json"].schema.$ref,
      "#/components/schemas/ReviewPage",
    );
    // Real frontend -> API -> database with an in-process HTTP provider fixture.
    await app.listen(0, "127.0.0.1");
    const origin = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    try {
      const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
        }),
        page = await context.newPage();
      let pageErrors = 0;
      page.on("pageerror", () => pageErrors++);
      await page.goto(origin + "/titles/" + titleId);
      await browserExpect(
        page.getByRole("heading", { name: "Review từ khán giả TMDB", exact: true }),
      ).toBeVisible();
      await browserExpect(
        page.getByText("Fixture critic · 8.5/10"),
      ).toBeVisible();
      await page.getByText("Đọc bài review", { exact: true }).click();
      await browserExpect(page.locator(".review-content")).toContainText(
        "Review fixture",
      );
      eq(
        await page.evaluate(() => typeof (window as any).__unsafe),
        "undefined",
      );
      await browserExpect(
        page.getByRole("link", { name: "Mở bài gốc trên TMDB ↗" }),
      ).toHaveAttribute(
        "href",
        "https://www.themoviedb.org/review/" + reviewId,
      );
      await page.screenshot({
        path: ".local/reviews/test-public.png",
        fullPage: true,
      });
      await context.addInitScript(
        (value: any) =>
          sessionStorage.setItem("pj-flim.auth", JSON.stringify(value)),
        { accessToken: adminUser.token, refreshToken: "fixture-unused" },
      );
      await page.goto(origin + "/admin/titles/" + titleId);
      await browserExpect(
        page.getByRole("heading", { name: "Review từ TMDB", exact: true }),
      ).toBeVisible();
      await browserExpect(
        page.getByRole("spinbutton", { name: "TMDB ID", exact: true }),
      ).toHaveValue("155");
      await browserExpect(
        page.getByRole("button", { name: "Tải review", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Tìm phim trên TMDB", exact: true })
        .click();
      await browserExpect(
        page.getByRole("button", { name: /Review Film.*ID 155/ }),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".local/reviews/test-admin-mobile.png",
        fullPage: true,
      });
      eq(pageErrors, 0);
      checks += 8;
    } finally {
      await browser.close();
    }
    const report = {
      passed: true,
      checks,
      providerCalls: calls,
      providerLive: false,
      modelInference: false,
      chrome: true,
      schemaTables: 59,
    };
    await writeFile(
      ".local/reviews/integration-result.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({ event: "reviews.integration.passed", ...report }),
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
  await writeFile(".local/reviews/failure.txt", String(error.stack));
  console.error(
    JSON.stringify({
      event: "reviews.integration.failed",
      code: error.code ?? error.name,
      detail:
        error instanceof assert.AssertionError
          ? error.message
          : "See private test log.",
    }),
  );
  process.exitCode = 1;
});
