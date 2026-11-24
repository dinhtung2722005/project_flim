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
  await mkdir(".local/admin-advanced", { recursive: true });
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

    const film = await fixture("Phim kiểm duyệt"),
      draft = await fixture("Phim nháp", false),
      formula = await fixture('=HYPERLINK("https://example.test","Phim")'),
      broken = await fixture("Phim lỗi video");
    await f!.query(
      "UPDATE movie.video_assets SET processing_status='FAILED' WHERE id=$1",
      [broken.assetId],
    );
    const genre = randomUUID(),
      person = randomUUID();
    await f!.query(
      "INSERT INTO movie.genres(id,slug,name) VALUES($1,$2,'Thể loại thử')",
      [genre, "test-" + genre],
    );
    await f!.query(
      "INSERT INTO movie.title_genres(title_id,genre_id) VALUES($1,$2)",
      [film.titleId, genre],
    );
    await f!.query(
      "INSERT INTO movie.people(id,name,normalized_name) VALUES($1,'Diễn viên thử','dien vien thu')",
      [person],
    );
    await f!.query(
      "INSERT INTO movie.credits(title_id,person_id,role) VALUES($1,$2,'ACTOR')",
      [film.titleId, person],
    );
    await f!.query(
      "UPDATE movie.titles SET poster_asset_ref='test/poster',synopsis='Nội dung thử nghiệm',original_language='vi' WHERE id=$1",
      [film.titleId],
    );
    async function role(code: string) {
      const actor = await seed();
      await f!.query(
        "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code=$2",
        [actor.id, code],
      );
      return actor;
    }
    const adminActor = await role("ADMIN"),
      superActor = await role("SUPER_ADMIN"),
      editor = await role("EDITOR"),
      auditor = await role("AUDITOR");
    const own = "/me/title-reviews/" + film.titleId,
      list = "/titles/" + film.titleId + "/viewer-reviews";
    async function ownGet(user = a) {
      return expect(api("get", own, user.token), 200);
    }
    const save = async (
      user: any,
      tag: string,
      rating: number,
      content: string,
    ) =>
      expect(
        api("put", own, user.token)
          .set("If-Match", tag)
          .send({ rating, content, containsSpoilers: false }),
        200,
      );
    let aa = await save(a, (await ownGet()).headers.etag, 8, "Đánh giá A"),
      bb = await save(b, (await ownGet(b)).headers.etag, 4, "Đánh giá B");
    const id = aa.body.review.id,
      reviewPath = "/admin/viewer-reviews/" + id,
      moderatePath = reviewPath + "/moderation";
    const getReview = async () =>
      expect(api("get", reviewPath, adminActor.token), 200);
    const moderate = async (
      tag: string,
      status: string,
      reason = "Kiểm tra vi phạm",
    ) =>
      api("patch", moderatePath, adminActor.token)
        .set("If-Match", tag)
        .send({ status, reason });
    await expect(api("get", "/admin/viewer-reviews"), 401);
    for (const actor of [a, editor, auditor])
      await expect(api("get", "/admin/viewer-reviews", actor.token), 403);
    for (const actor of [adminActor, superActor])
      await expect(api("get", "/admin/viewer-reviews", actor.token), 200);
    await expect(api("get", reviewPath, a.token), 403);
    await expect(
      api("patch", moderatePath, editor.token).send({
        status: "HIDDEN",
        reason: "Thử nghiệm",
      }),
      403,
    );
    await expect(api("get", "/admin/catalog-health", a.token), 403);
    await expect(api("get", "/admin/catalog-health", auditor.token), 403);
    await expect(api("get", "/admin/catalog-health", editor.token), 200);
    await expect(
      api("get", "/admin/viewer-reviews?status=DELETED", adminActor.token),
      422,
    );
    await expect(
      api("get", "/admin/viewer-reviews?titleId=x", adminActor.token),
      422,
    );
    await expect(
      api("get", "/admin/catalog-health?issue=UNKNOWN", editor.token),
      422,
    );
    await expect(
      api("patch", moderatePath, adminActor.token).send({
        status: "HIDDEN",
        reason: "Vi phạm",
      }),
      428,
    );
    await expect(moderate('"bad"', "HIDDEN"), 412);
    let current = await getReview();
    await expect(
      api("patch", moderatePath, adminActor.token)
        .set("If-Match", current.headers.etag)
        .send({ status: "HIDDEN", reason: " ", rating: 1 }),
      422,
    );
    eq((await expect(api("get", list), 200)).body.summary.average, 6);
    const beforeOwnerTag = aa.headers.etag,
      hidden = await expect(
        moderate(current.headers.etag, "HIDDEN", "Nội dung quảng cáo"),
        200,
      );
    eq(hidden.body.moderationStatus, "HIDDEN");
    ok(hidden.headers.etag !== current.headers.etag);
    let publicRows = (await expect(api("get", list), 200)).body;
    eq(publicRows.summary.count, 1);
    eq(publicRows.summary.average, 4);
    ok(!publicRows.data.some((r: any) => r.id === id));
    ok(!JSON.stringify(publicRows).includes("Nội dung quảng cáo"));
    const otherPath = "/admin/viewer-reviews/" + bb.body.review.id;
    const otherCurrent = await expect(
      api("get", otherPath, adminActor.token),
      200,
    );
    const otherHidden = await expect(
      api("patch", otherPath + "/moderation", adminActor.token)
        .set("If-Match", otherCurrent.headers.etag)
        .send({
          status: "HIDDEN",
          reason: "Thử nghiệm không có đánh giá công khai",
        }),
      200,
    );
    const emptyPublic = (await expect(api("get", list), 200)).body;
    eq(emptyPublic.summary.count, 0);
    eq(emptyPublic.summary.average, null);
    await expect(
      api("patch", otherPath + "/moderation", adminActor.token)
        .set("If-Match", otherHidden.headers.etag)
        .send({ status: "VISIBLE", reason: "Khôi phục sau kiểm tra" }),
      200,
    );
    let owner = await ownGet();
    eq(owner.body.review.moderationStatus, "HIDDEN");
    eq(owner.body.review.moderationReason, "Nội dung quảng cáo");
    await expect(
      api("put", own, a.token)
        .set("If-Match", beforeOwnerTag)
        .send({ rating: 9 }),
      412,
    );
    await expect(
      api("put", own, a.token)
        .set("If-Match", owner.headers.etag)
        .send({ rating: 9, moderationStatus: "VISIBLE" }),
      422,
    );
    const edited = await save(
      a,
      owner.headers.etag,
      9,
      "Đánh giá A <img src=x onerror=alert(1)>",
    );
    eq(edited.body.review.moderationStatus, "HIDDEN");
    eq((await expect(api("get", list), 200)).body.summary.count, 1);
    await expect(moderate(hidden.headers.etag, "VISIBLE", "Đã kiểm tra"), 412);
    current = await getReview();
    const visible = await expect(
      moderate(current.headers.etag, "VISIBLE", "Đã kiểm tra lại"),
      200,
    );
    publicRows = (await expect(api("get", list), 200)).body;
    eq(publicRows.summary.count, 2);
    eq(publicRows.summary.average, 6.5);
    eq(
      (
        await expect(
          moderate(visible.headers.etag, "VISIBLE", "Không thay đổi"),
          200,
        )
      ).headers.etag,
      visible.headers.etag,
    );
    eq(
      (
        await f!.query(
          "SELECT count(*)::int n FROM movie.audit_logs WHERE action='viewer-review.moderated' AND resource_id=$1",
          [id],
        )
      ).rows[0].n,
      2,
    );
    // Audit failure must roll back visibility and version.
    await f!.query(
      "CREATE FUNCTION movie.reject_moderation_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='viewer-review.moderated' THEN RAISE EXCEPTION 'fixture only'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_moderation_audit BEFORE INSERT ON movie.audit_logs FOR EACH ROW EXECUTE FUNCTION movie.reject_moderation_audit()",
    );
    await expect(
      moderate(visible.headers.etag, "HIDDEN"),
      503,
      "AUDIT_WRITE_UNAVAILABLE",
    );
    eq((await getReview()).headers.etag, visible.headers.etag);
    eq((await getReview()).body.moderationStatus, "VISIBLE");
    await f!.query(
      "DROP TRIGGER reject_moderation_audit ON movie.audit_logs; DROP FUNCTION movie.reject_moderation_audit()",
    );
    await f!.query(
      "DELETE FROM movie.user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM movie.roles WHERE code='ADMIN')",
      [adminActor.id],
    );
    await expect(api("get", reviewPath, adminActor.token), 403);
    await f!.query(
      "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code='ADMIN'",
      [adminActor.id],
    );
    const adminList = (
      await expect(
        api("get", "/admin/viewer-reviews?limit=1", adminActor.token),
        200,
      )
    ).body;
    eq(adminList.data.length, 1);
    eq(adminList.page.hasMore, true);
    const next = (
      await expect(
        api(
          "get",
          "/admin/viewer-reviews?limit=1&cursor=" +
            encodeURIComponent(adminList.page.nextCursor),
          adminActor.token,
        ),
        200,
      )
    ).body;
    eq(next.data.length, 1);
    ok(next.data[0].id !== adminList.data[0].id);
    await expect(
      api(
        "get",
        "/admin/viewer-reviews?status=HIDDEN&cursor=" +
          encodeURIComponent(adminList.page.nextCursor),
        adminActor.token,
      ),
      400,
    );
    ok(!JSON.stringify(adminList).includes(a.email));
    ok(!Object.hasOwn(adminList.data[0], "userId"));
    const health = (
      await expect(api("get", "/admin/catalog-health", editor.token), 200)
    ).body;
    eq(health.summary.titles, "4");
    eq(health.summary.withoutPlayableVideo, "2");
    eq(health.data.find((r: any) => r.id === film.titleId).issues, []);
    const bad = health.data.find((r: any) => r.id === broken.titleId);
    eq(bad.videoReady, false);
    ok(bad.issues.includes("PUBLISHED_WITHOUT_PLAYABLE"));
    const missing = health.data.find((r: any) => r.id === draft.titleId);
    ok(missing.issues.includes("NO_POSTER"));
    ok(!missing.issues.includes("PUBLISHED_WITHOUT_PLAYABLE"));
    const critical = (
      await expect(
        api(
          "get",
          "/admin/catalog-health?issue=PUBLISHED_WITHOUT_PLAYABLE",
          editor.token,
        ),
        200,
      )
    ).body;
    eq(critical.summary.titles, "1");
    eq(critical.data[0].id, broken.titleId);
    eq(
      (
        await expect(
          api(
            "get",
            "/admin/catalog-health?q=ki%E1%BB%83m%20duy%E1%BB%87t",
            editor.token,
          ),
          200,
        )
      ).body.data[0].id,
      film.titleId,
    );
    const healthPage = (
      await expect(
        api("get", "/admin/catalog-health?limit=1", editor.token),
        200,
      )
    ).body;
    eq(healthPage.page.hasMore, true);
    await expect(
      api(
        "get",
        "/admin/catalog-health?issue=NO_POSTER&cursor=" +
          encodeURIComponent(healthPage.page.nextCursor),
        editor.token,
      ),
      400,
    );
    await f!.query(
      "INSERT INTO movie.title_daily_stats(title_id,day,definition_version,qualified_views,playback_starts) VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,2,9007199254740993,3)",
      [formula.titleId],
    );
    const exportPath = "/admin/metrics/views/export?days=7";
    await expect(api("get", exportPath), 401);
    await expect(api("get", exportPath, editor.token), 403);
    await expect(
      api("get", "/admin/metrics/views/export?days=5", adminActor.token),
      422,
    );
    for (const actor of [adminActor, auditor]) {
      const csv = await expect(api("get", exportPath, actor.token), 200);
      ok(csv.headers["content-type"].includes("text/csv"));
      ok(csv.headers["content-disposition"].includes("7-days.csv"));
      ok(csv.headers["cache-control"].includes("no-store"));
      eq(csv.text.charCodeAt(0), 0xfeff);
      ok(csv.text.includes("9007199254740993"));
      ok(
        csv.text.includes('"\'=HYPERLINK(""https://example.test"",""Phim"")"'),
      );
      eq(csv.text.match(/"\d{4}-\d{2}-\d{2}"/g)?.length, 7);
    }
    eq(
      (
        await f!.query(
          "SELECT count(*)::int n FROM movie.audit_logs WHERE action='metrics.views.exported'",
        )
      ).rows[0].n,
      2,
    );
    // Real browser moderation, conflict recovery, catalog filters and authenticated download.
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
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(e.name));
    await page.route("https://res.cloudinary.com/**", (r: any) => r.abort());
    const bc = async (p: Promise<any>) => {
      await p;
      checks++;
      browserChecks++;
    };
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(adminActor.email);
    await page
      .getByLabel("Mật khẩu", { exact: true })
      .fill(adminActor.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL((u: URL) => u.pathname !== "/login");
    await page.goto("/admin/viewer-reviews");
    let card = page
      .locator(".moderation-card")
      .filter({ hasText: "Đánh giá A" });
    await bc(browserExpect(card).toBeVisible());
    await bc(
      browserExpect(card.locator(".moderation-content img")).toHaveCount(0),
    );
    await card
      .getByLabel("Lý do xử lý", { exact: true })
      .fill("Quảng cáo lặp lại");
    // Concurrent author edit invalidates the displayed admin version.
    owner = await ownGet();
    await save(a, owner.headers.etag, 9, "Đánh giá A cập nhật");
    await card
      .getByRole("button", { name: "Lưu kiểm duyệt", exact: true })
      .click();
    await bc(
      browserExpect(
        card.getByText("Đánh giá đã thay đổi.", { exact: false }),
      ).toBeVisible(),
    );
    await bc(
      browserExpect(
        card.getByLabel("Lý do xử lý", { exact: true }),
      ).toHaveValue("Quảng cáo lặp lại"),
    );
    await card.getByRole("button", { name: "Đọc bản mới, giữ lý do" }).click();
    await bc(
      browserExpect(
        card.getByText("Đánh giá A cập nhật", { exact: true }),
      ).toBeVisible(),
    );
    await card
      .getByRole("button", { name: "Lưu kiểm duyệt", exact: true })
      .click();
    await bc(
      browserExpect(page.locator(".toast")).toContainText("Đã ẩn đánh giá."),
    );
    await bc(browserExpect(card.locator(".badge").first()).toHaveText("Đã ẩn"));
    eq((await expect(api("get", list), 200)).body.summary.count, 1);
    const authorContext = await browser.newContext({ baseURL: origin }),
      authorPage = await authorContext.newPage();
    await authorPage.goto(
      "/login?next=" + encodeURIComponent("/titles/" + film.titleId),
    );
    await authorPage.getByLabel("Email", { exact: true }).fill(a.email);
    await authorPage.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
    await authorPage
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .click();
    await authorPage.waitForURL(new RegExp("/titles/" + film.titleId));
    await bc(
      browserExpect(
        authorPage.locator(".review-moderation-notice"),
      ).toContainText("Quảng cáo lặp lại"),
    );
    await bc(
      browserExpect(
        authorPage.getByLabel("Nhận xét của bạn (không bắt buộc)"),
      ).toHaveValue("Đánh giá A cập nhật"),
    );
    await authorContext.close();
    await card
      .getByLabel("Lý do xử lý", { exact: true })
      .fill("Đã xem xét và khôi phục");
    await card
      .getByRole("button", { name: "Lưu kiểm duyệt", exact: true })
      .click();
    await bc(
      browserExpect(page.locator(".toast")).toContainText(
        "Đã khôi phục đánh giá.",
      ),
    );
    eq((await expect(api("get", list), 200)).body.summary.count, 2);
    await page.getByLabel("Trạng thái kiểm duyệt").selectOption("HIDDEN");
    await bc(
      browserExpect(
        page.getByText("Chưa có đánh giá phù hợp", { exact: true }),
      ).toBeVisible(),
    );
    await page.goto("/admin/catalog-health");
    await bc(
      browserExpect(
        page.getByRole("heading", { name: "Chất lượng nội dung", exact: true }),
      ).toBeVisible(),
    );
    await page
      .getByLabel("Vấn đề nội dung")
      .selectOption("PUBLISHED_WITHOUT_PLAYABLE");
    await bc(browserExpect(page.locator("tbody tr")).toHaveCount(1));
    await bc(
      browserExpect(page.locator("tbody")).toContainText("Phim lỗi video"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await bc(browserExpect(page.getByLabel("Vấn đề nội dung")).toBeVisible());
    ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: ".local/admin-advanced/catalog-health-mobile.png",
      fullPage: true,
    });
    await page.goto("/admin");
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Xuất CSV", exact: true }).click();
    const download = await downloaded;
    eq(download.suggestedFilename(), "pj-flim-views-7-days.csv");
    const downloadedBytes = await readFile(await download.path());
    eq([...downloadedBytes.subarray(0, 3)], [239, 187, 191]);
    ok(downloadedBytes.toString("utf8").includes("9007199254740993"));
    eq(errors, []);
    await context.close();
    // Stale delete/recreate references cannot moderate a replacement review.
    current = await getReview();
    const modTag = current.headers.etag;
    owner = await ownGet();
    await expect(
      api("delete", own, a.token).set("If-Match", owner.headers.etag),
      204,
    );
    const recreated = await save(
      a,
      (await ownGet()).headers.etag,
      7,
      "Đánh giá mới",
    );
    ok(recreated.body.review.id !== id);
    await expect(moderate(modTag, "HIDDEN"), 404);
    eq(
      (await f!.query("SELECT count(*)::int n FROM movie.permissions")).rows[0]
        .n,
      19,
    );
    eq(
      (await f!.query("SELECT count(*)::int n FROM movie.role_permissions"))
        .rows[0].n,
      46,
    );
    ok(result.document.components!.schemas!.AdminViewerReview);
    const report = {
      passed: true,
      checks,
      browserChecks,
      database: "isolated disposable PostgreSQL",
      schemaTables: 59,
      permissions: 19,
      providerLive: false,
      realUserDataChanged: false,
    };
    await writeFile(
      ".local/admin-advanced/integration-result.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({ event: "admin-advanced.integration.passed", ...report }),
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
      event: "admin-advanced.integration.failed",
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
