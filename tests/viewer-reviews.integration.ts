import "../apps/api/src/config";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import request from "supertest";
import { chromium, expect as browserExpect } from "@playwright/test";
import { createApplication } from "../apps/api/src/application";
import { AuthService } from "../apps/api/src/services/auth.service";
import { passwordHash } from "../apps/api/src/security";
import { normalized } from "../packages/assistant/src/search";
let checks = 0,
  browserChecks = 0;
function eq(a: unknown, b: unknown) {
  assert.deepEqual(a, b);
  checks++;
}
function ok(v: unknown) {
  assert.ok(v);
  checks++;
}
async function main() {
  const password = process.env.PJ_FLIM_TEST_ADMIN_PASSWORD;
  if (!password) throw Error("Isolated database credential required.");
  process.env.AUTH_MFA_REQUIRED = "false";
  process.env.ASSISTANT_DISPATCH_ENABLED = "false";
  process.env.OMDB_API_KEY = "";
  process.env.TMDB_API_READ_TOKEN = "";
  const name = "pj_flim_test_" + randomBytes(6).toString("hex");
  assert.match(name, /^pj_flim_test_[a-f0-9]{12}$/);
  const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!),
    apiUrl = new URL(process.env.DATABASE_URL!);
  ownerUrl.searchParams.delete("schema");
  apiUrl.searchParams.delete("schema");
  const adminUrl = new URL(ownerUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.username = "postgres";
  adminUrl.password = password;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 2 });
  let app: any,
    f: Pool | undefined,
    created = false,
    browser: any;
  await mkdir(".local/viewer-reviews", { recursive: true });
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
    const server = app.getHttpServer(),
      auth = app.get(AuthService);
    const testPassword = "ViewerReview-" + randomBytes(16).toString("hex"),
      pwhash = await passwordHash(testPassword);
    async function seed() {
      const id = randomUUID(),
        sid = randomUUID(),
        email = id + "@example.test";
      await f!.query(
        "INSERT INTO movie.users(id,email_normalized,password_hash,display_name) VALUES($1,$2,$3,'Người xem thử')",
        [id, email, pwhash],
      );
      await f!.query(
        "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code='MEMBER'",
        [id],
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
      b = await seed();
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

    const film = await fixture("Phim cộng đồng"),
      other = await fixture("Phim khác"),
      draft = await fixture("Nháp", false);
    const own = "/me/title-reviews/" + film.titleId,
      list = "/titles/" + film.titleId + "/viewer-reviews";
    const get = async (user = a) =>
      await expect(api("get", own, user.token), 200);
    const put = (
      user: typeof a,
      tag: string | undefined,
      data: object,
      path = own,
    ) => {
      let req = api("put", path, user.token);
      if (tag) req = req.set("If-Match", tag);
      return req.send(data);
    };
    const del = (user: typeof a, tag: string | undefined, path = own) => {
      let req = api("delete", path, user.token);
      if (tag) req = req.set("If-Match", tag);
      return req;
    };
    await expect(api("get", own), 401, "AUTHENTICATION_REQUIRED");
    await expect(api("put", own).send({ rating: 8 }), 401);
    await expect(api("delete", own), 401);
    const empty = await expect(api("get", list), 200);
    eq(empty.body.summary, {
      count: 0,
      average: null,
      scale: 10,
      source: "PJ_FLIM_VIEWERS",
    });
    eq(empty.body.data, []);
    eq(empty.headers["cache-control"], "no-store");
    await expect(
      api("get", "/titles/" + draft.titleId + "/viewer-reviews"),
      404,
      "RESOURCE_NOT_FOUND",
    );
    await expect(
      api("get", "/me/title-reviews/" + draft.titleId, a.token),
      404,
    );
    const initial = await get();
    eq(initial.body.review, null);
    ok(initial.headers.etag);
    const tag0 = initial.headers.etag;
    for (const data of [
      { rating: 0 },
      { rating: 11 },
      { rating: 1.5 },
      { rating: "8" },
      { rating: null },
      { rating: 8, content: null },
      { rating: 8, content: "x".repeat(2001) },
      { rating: 8, content: "bad\u0000text" },
      { rating: 8, containsSpoilers: "true" },
      { rating: 8, containsSpoilers: null },
      { rating: 8, userId: b.id },
      { rating: 8, role: "ADMIN" },
    ])
      await expect(put(a, tag0, data), 422, "VALIDATION_FAILED");
    await expect(
      put(a, undefined, { rating: 8 }),
      428,
      "PRECONDITION_REQUIRED",
    );
    const injection = "<img src=x onerror=alert(1)> Cảm nhận của tôi.";
    const saved = await expect(
      put(a, tag0, {
        rating: 9,
        content: "  " + injection + "  ",
        containsSpoilers: true,
      }),
      200,
    );
    eq(saved.body.review.content, injection);
    eq(saved.body.review.rating, 9);
    eq(saved.body.review.containsSpoilers, true);
    eq(saved.body.review.version, "1");
    ok(saved.headers.etag !== tag0);
    const publicA = await expect(api("get", list), 200);
    eq(publicA.body.summary.average, 9);
    eq(publicA.body.summary.count, 1);
    eq(publicA.body.data[0].author, "Người xem thử");
    ok(!JSON.stringify(publicA.body).includes(a.id));
    ok(!JSON.stringify(publicA.body).includes(a.email));
    ok(!JSON.stringify(publicA.body).includes(a.sid));
    await expect(
      put(b, saved.headers.etag, { rating: 1, content: "Attack" }),
      412,
      "RESOURCE_VERSION_MISMATCH",
    );
    eq((await get()).body.review.rating, 9);
    await expect(del(b, saved.headers.etag), 412, "RESOURCE_VERSION_MISMATCH");
    eq((await get(b)).body.review, null);
    const b0 = (await get(b)).headers.etag;
    const savedB = await expect(put(b, b0, { rating: 5 }), 200);
    eq(savedB.body.review.content, "");
    eq(savedB.body.review.containsSpoilers, false);
    eq((await expect(api("get", list), 200)).body.summary.average, 7);
    const updated = await expect(
      put(a, saved.headers.etag, { rating: 8, content: "Sửa nhận xét" }),
      200,
    );
    eq(updated.body.review.id, saved.body.review.id);
    eq(updated.body.review.version, "2");
    eq(updated.body.review.createdAt, saved.body.review.createdAt);
    eq((await expect(api("get", list), 200)).body.summary.average, 6.5);
    await expect(
      put(a, saved.headers.etag, { rating: 1 }),
      412,
      "RESOURCE_VERSION_MISMATCH",
    );
    // Concurrent updates use the same ETag; exactly one may commit.
    const parallel = await Promise.all([
      put(a, updated.headers.etag, { rating: 7, content: "tab1" }),
      put(a, updated.headers.etag, { rating: 8, content: "tab2" }),
    ]);
    eq(parallel.map((r) => r.status).sort(), [200, 412]);
    eq((await get()).body.review.version, "3");
    await expect(del(a, undefined), 428, "PRECONDITION_REQUIRED");
    let current = await get();
    const removed = await expect(del(a, current.headers.etag), 204);
    ok(removed.headers.etag);
    eq((await get()).body.review, null);
    await expect(del(a, removed.headers.etag), 204); // already absent, same precondition
    const recreated = await expect(
      put(a, removed.headers.etag, { rating: 6, content: "Đánh giá mới" }),
      200,
    );
    ok(recreated.body.review.id !== saved.body.review.id);
    await expect(
      put(a, saved.headers.etag, { rating: 1 }),
      412,
      "RESOURCE_VERSION_MISMATCH",
    );
    // Cursor pages keep microsecond precision and cannot be used on another film.
    const c = await seed();
    await f!.query(
      "INSERT INTO movie.viewer_reviews(title_id,user_id,rating,content) VALUES($1,$2,10,'Review thứ ba')",
      [film.titleId, c.id],
    );
    const ids = (
      await f!.query(
        "SELECT id FROM movie.viewer_reviews WHERE title_id=$1 ORDER BY id",
        [film.titleId],
      )
    ).rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i++)
      await f!.query(
        "UPDATE movie.viewer_reviews SET created_at=$2::timestamptz WHERE id=$1",
        [ids[i], "2026-11-25T00:00:00.00000" + (i + 1) + "Z"],
      );
    let cursor: string | undefined;
    const seen: string[] = [];
    do {
      const page = await expect(
        api(
          "get",
          list +
            "?limit=1" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        ),
        200,
      );
      seen.push(...page.body.data.map((r: any) => r.id));
      cursor = page.body.page.nextCursor ?? undefined;
      if (cursor)
        await expect(
          api(
            "get",
            "/titles/" +
              other.titleId +
              "/viewer-reviews?limit=1&cursor=" +
              encodeURIComponent(cursor),
          ),
          400,
          "REQUEST_INVALID_CURSOR",
        );
    } while (cursor);
    eq(seen, [...ids].reverse());
    eq(new Set(seen).size, ids.length);
    await expect(api("get", list + "?limit=101"), 422);
    await expect(
      api("get", list + "?cursor=bad"),
      400,
      "REQUEST_INVALID_CURSOR",
    );
    // A deactivated author is not counted or displayed; do not reveal email.
    await f!.query("UPDATE movie.users SET status='SUSPENDED' WHERE id=$1", [
      c.id,
    ]);
    const active = await expect(api("get", list), 200);
    eq(active.body.summary.count, 2);
    const hiddenReview = (
      await f!.query(
        "SELECT id FROM movie.viewer_reviews WHERE user_id=$1 AND title_id=$2",
        [c.id, film.titleId],
      )
    ).rows[0].id;
    ok(!active.body.data.some((r: any) => r.id === hiddenReview));
    const revoked = await seed(),
      revokedTag = (await expect(api("get", own, revoked.token), 200)).headers
        .etag;
    await f!.query(
      "UPDATE movie.auth_sessions SET state='REVOKED',revoked_at=clock_timestamp() WHERE id=$1",
      [revoked.sid],
    );
    await expect(
      put(revoked, revokedTag, { rating: 1 }),
      401,
      "AUTH_SESSION_REVOKED",
    );
    await f!.query(
      "DELETE FROM movie.security_events WHERE category='viewer-review-write'",
    );
    // Actual browser journey, using the API and disposable PostgreSQL database.
    await app.listen(0, "127.0.0.1");
    const origin = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({
      executablePath:
        process.env.PJ_FLIM_CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage(),
      errors: string[] = [],
      dialogs: string[] = [];
    page.on("pageerror", (e: any) => errors.push(e.name));
    page.on("dialog", async (d: any) => {
      dialogs.push(d.type());
      await d.dismiss();
    });
    const bc = async (p: Promise<any>) => {
      await p;
      checks++;
      browserChecks++;
    };
    await page.goto("/titles/" + film.titleId);
    const section = page.getByRole("region", {
      name: "Đánh giá người xem pj-Flim",
    });
    await bc(
      browserExpect(
        section.getByRole("heading", {
          name: "Đánh giá của người xem",
          exact: true,
        }),
      ).toBeVisible(),
    );
    await bc(
      browserExpect(
        section.getByRole("link", { name: "Đăng nhập", exact: true }),
      ).toBeVisible(),
    );
    await section.getByRole("link", { name: "Đăng nhập", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(a.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await bc(
      browserExpect(page).toHaveURL(new RegExp("/titles/" + film.titleId)),
    );
    await bc(
      browserExpect(
        section.getByLabel("Nhận xét của bạn (không bắt buộc)"),
      ).toHaveValue("Đánh giá mới"),
    );
    await section
      .getByLabel("Điểm của bạn", { exact: true })
      .selectOption("10");
    await section
      .getByLabel("Nhận xét của bạn (không bắt buộc)")
      .fill(injection);
    await section.getByLabel("Nhận xét có tiết lộ nội dung phim").check();
    await section
      .getByRole("button", { name: "Lưu đánh giá", exact: true })
      .click();
    await bc(
      browserExpect(
        section.getByText("Đã lưu đánh giá của bạn.", { exact: true }),
      ).toBeVisible(),
    );
    await bc(
      browserExpect(section.locator(".viewer-score")).toContainText("7,5"),
    );
    await bc(
      browserExpect(
        section.locator(
          ".viewer-review-card img,.viewer-review-card svg,.viewer-review-card script",
        ),
      ).toHaveCount(0),
    );
    await bc(browserExpect(section.locator("details[open]")).toHaveCount(0));
    await section
      .getByText("Đọc nhận xét có tiết lộ nội dung", { exact: true })
      .click();
    await bc(
      browserExpect(
        section
          .locator(".viewer-review-card .viewer-review-content")
          .filter({ hasText: injection }),
      ).toBeVisible(),
    );
    // Editing through a second session causes a 412 and preserves the UI draft.
    await section
      .getByLabel("Nhận xét của bạn (không bắt buộc)")
      .fill("Bản nháp ở trình duyệt");
    current = await get();
    await expect(
      put(a, current.headers.etag, {
        rating: 9,
        content: "Nội dung từ tab khác",
      }),
      200,
    );
    await section
      .getByRole("button", { name: "Lưu đánh giá", exact: true })
      .click();
    await bc(
      browserExpect(
        section.getByText(
          "Đánh giá đã thay đổi ở phiên khác. Bản nháp của bạn vẫn được giữ.",
          { exact: true },
        ),
      ).toBeVisible(),
    );
    await bc(
      browserExpect(
        section.getByLabel("Nhận xét của bạn (không bắt buộc)"),
      ).toHaveValue("Bản nháp ở trình duyệt"),
    );
    await section
      .getByRole("button", {
        name: "Tải lại đánh giá (thay bản nháp)",
        exact: true,
      })
      .click();
    await bc(
      browserExpect(
        section.getByLabel("Nhận xét của bạn (không bắt buộc)"),
      ).toHaveValue("Nội dung từ tab khác"),
    );
    await section
      .getByRole("button", { name: "Xóa đánh giá của tôi", exact: true })
      .click();
    await bc(
      browserExpect(
        section.getByText("Đã xóa đánh giá của bạn.", { exact: true }),
      ).toBeVisible(),
    );
    await bc(
      browserExpect(section.locator(".viewer-score")).toContainText(
        "1 đánh giá",
      ),
    );
    await bc(
      browserExpect(
        section.getByLabel("Điểm của bạn", { exact: true }),
      ).toHaveValue(""),
    );
    eq(
      await section
        .getByLabel("Điểm của bạn", { exact: true })
        .evaluate((element: any) => element.validity.valueMissing),
      true,
    );
    browserChecks++;
    await page.setViewportSize({ width: 320, height: 840 });
    eq(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    browserChecks++;
    const floating = await page
      .getByRole("link", { name: "Mở trợ lý phim", exact: true })
      .boundingBox();
    ok(floating && floating.width <= 50);
    browserChecks++;
    await section.screenshot({
      path: ".local/viewer-reviews/community-mobile.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await section.screenshot({
      path: ".local/viewer-reviews/community-desktop.png",
    });
    await page.locator(".account-menu summary").click();
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await bc(
      browserExpect(
        section.getByRole("link", { name: "Đăng nhập", exact: true }),
      ).toBeVisible(),
    );
    await bc(browserExpect(section.getByRole("textbox")).toHaveCount(0));
    eq(errors, []);
    eq(dialogs, []);
    await context.close();
    // Rate-limit abuse, independent of other actor flows.
    const spam = await seed(),
      spamPath = "/me/title-reviews/" + other.titleId;
    let spamTag = (await expect(api("get", spamPath, spam.token), 200)).headers
      .etag;
    for (let i = 0; i < 10; i++)
      spamTag = (await expect(put(spam, spamTag, { rating: 8 }, spamPath), 200))
        .headers.etag;
    await expect(
      put(spam, spamTag, { rating: 8 }, spamPath),
      429,
      "RATE_LIMITED",
    );
    current = await get(b);
    await f!.query(
      "UPDATE movie.titles SET publication_status='UNPUBLISHED' WHERE id=$1",
      [film.titleId],
    );
    await expect(api("get", list), 404, "RESOURCE_NOT_FOUND");
    await expect(api("get", own, b.token), 404, "RESOURCE_NOT_FOUND");
    await expect(
      put(b, current.headers.etag, { rating: 8 }),
      404,
      "RESOURCE_NOT_FOUND",
    );
    await expect(del(b, current.headers.etag), 204); // delete remains available for owner privacy
    for (const permission of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const grants = (
        await f!.query(
          "SELECT has_table_privilege('movie_api','movie.viewer_reviews',$1) api,has_table_privilege('movie_worker','movie.viewer_reviews',$1) worker,has_table_privilege('movie_auditor','movie.viewer_reviews',$1) auditor",
          [permission],
        )
      ).rows[0];
      eq(grants, { api: true, worker: false, auditor: false });
    }
    eq(
      (
        await f!.query(
          "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE'",
        )
      ).rows[0].n,
      59,
    );
    const paths = result.document.paths;
    ok(paths["/api/v1/titles/{id}/viewer-reviews"]?.get);
    ok(paths["/api/v1/me/title-reviews/{id}"]?.put);
    ok(result.document.components!.schemas!.ViewerReviewPublic);
    const report = {
      passed: true,
      checks,
      browserChecks,
      database: "isolated disposable PostgreSQL",
      schemaTables: 59,
      providerLive: false,
      browser: "Chrome",
      realUserDataChanged: false,
    };
    await writeFile(
      ".local/viewer-reviews/integration-result.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({ event: "viewer-reviews.integration.passed", ...report }),
    );
  } finally {
    if (browser) await browser.close();
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
main().catch((e) => {
  console.error(
    JSON.stringify({
      event: "viewer-reviews.integration.failed",
      code: e.code ?? e.name,
      detail:
        e instanceof assert.AssertionError
          ? e.message
          : !e.code
            ? String(e.message).split(/\r?\n/).slice(0, 9).join("\n")
            : "See private test configuration; no raw connection errors emitted.",
    }),
  );
  process.exitCode = 1;
});
