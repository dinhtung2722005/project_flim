import { ViewStore } from "../apps/analytics-worker/src/store";
import { AnalyticsBroker } from "../packages/analytics/src/broker";
import amqp from "amqplib";
import { config as loadEnv } from "dotenv";
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
loadEnv({ path: ".env.worker.local", quiet: true });
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
    browser: any,
    store: ViewStore | undefined,
    broker: AnalyticsBroker | undefined,
    prefix: string | undefined;
  await mkdir(".local/view-stats", { recursive: true });
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

    const film = await fixture("Phim thống kê"),
      other = await fixture("Phim khác"),
      draft = await fixture("Nháp", false);
    await f!.query(
      "UPDATE movie.view_stats_policy SET measurement_started_at=clock_timestamp()-interval '2 days'",
    );
    const workerUrl = new URL(process.env.WORKER_DATABASE_URL!);
    workerUrl.searchParams.delete("schema");
    workerUrl.pathname = "/" + name;
    store = new ViewStore(
      workerUrl.toString(),
      randomBytes(32).toString("hex"),
    );
    await store.ready();
    await store.ready();
    const wrong = new ViewStore(
      workerUrl.toString(),
      randomBytes(32).toString("hex"),
    );
    await assert.rejects(wrong.ready(), /ANALYTICS_HASH_KEY_MISMATCH/);
    checks++;
    await wrong.close();
    const auditor = await seed();
    await f!.query(
      "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code='AUDITOR'",
      [auditor.id],
    );
    const adminActor = await seed();
    await f!.query(
      "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code='ADMIN'",
      [adminActor.id],
    );
    const read = async () =>
      (await expect(api("get", "/titles/" + film.titleId + "/views"), 200))
        .body;
    eq((await read()).views, "0");
    eq((await read()).definitionVersion, 2);
    eq((await read()).workerInitialized, true);
    await expect(api("get", "/titles/" + draft.titleId + "/views"), 404);
    await expect(api("get", "/titles/not-uuid/views"), 400);
    await expect(api("get", "/admin/metrics/views"), 401);
    await expect(api("get", "/admin/metrics/views", a.token), 403);
    await expect(api("get", "/admin/metrics/views?days=8", auditor.token), 422);
    await expect(
      api("get", "/admin/metrics/views?views=50", auditor.token),
      422,
    );
    for (const n of [7, 30, 90]) {
      const r = (
        await expect(
          api("get", "/admin/metrics/views?days=" + n, auditor.token),
          200,
        )
      ).body;
      eq(r.daily.length, n);
      eq(r.total.views, "0");
      eq(r.top, []);
    }
    const create = async (user?: any, guest?: string, target = film) => {
      const q = api(
        "post",
        "/episodes/" + target.episodeId + "/playback-sessions",
        user?.token,
      ).set("Idempotency-Key", randomUUID());
      if (!user)
        q.set("X-Guest-Id", guest ?? randomBytes(32).toString("base64url"));
      const s = (await expect(q.send({}), 201)).body;
      await f!.query(
        "UPDATE movie.playback_sessions SET created_at=clock_timestamp()-interval '130 seconds' WHERE id=$1",
        [s.id],
      );
      return s;
    };
    const rows = (values: [string, number, number][], offset = 0) =>
      values.map(([type, time, pos], i) => ({
        id: randomUUID(),
        type,
        sequence: offset + i,
        elapsedMs: time * 1000,
        positionSeconds: pos,
      }));
    const normal = () =>
      rows([
        ["play", 0, 0],
        ["heartbeat", 15, 15],
        ["heartbeat", 30, 30],
        ["heartbeat", 45, 45],
        ["heartbeat", 60, 60],
      ]);
    const post = async (s: any, events: any[], batchId = randomUUID()) =>
      (
        await expect(
          api("post", "/playback-sessions/" + s.id + "/events")
            .set("X-Playback-Telemetry", s.telemetryToken)
            .send({ batchId, events }),
          202,
        )
      ).body;
    const close = async (s: any, user?: any) => {
      const r = api("delete", "/playback-sessions/" + s.id, user?.token);
      if (!user) r.set("X-Playback-Management", s.managementToken);
      await expect(r, 204);
    };
    const s = await create(a);
    await expect(
      api("post", "/playback-sessions/" + s.id + "/events")
        .set("X-Playback-Telemetry", "0".repeat(64))
        .send({ batchId: randomUUID(), events: normal() }),
      403,
    );
    const batchId = randomUUID(),
      events = normal();
    eq((await post(s, events, batchId)).duplicate, false);
    eq((await post(s, events, batchId)).duplicate, true);
    eq((await read()).views, "0"); // Durable outbox, no synchronous increments.
    const event = await store.claim();
    ok(event);
    eq(event.type, "playback.events.accepted");
    await store.confirmed(event, false); // Broker outage leaves the accepted batch intact.
    eq((await read()).views, "0");
    await f!.query(
      "UPDATE movie.outbox_events SET next_attempt_at=clock_timestamp() WHERE id=$1",
      [event.id],
    );
    const claimed = await store.claim();
    ok(claimed);
    ok(Number(claimed.lease_token) > Number(event.lease_token));
    await store.confirmed(event, true);
    eq(
      (
        await f!.query(
          "SELECT published_at FROM movie.outbox_events WHERE id=$1",
          [event.id],
        )
      ).rows[0].published_at,
      null,
    );
    const url = process.env.ANALYTICS_RABBITMQ_URL || process.env.RABBITMQ_URL!;
    prefix = "pjflim.analytics-test." + randomBytes(6).toString("hex");
    broker = new AnalyticsBroker(url, prefix);
    await broker.open();
    let consumed = 0;
    let consumerError: unknown;
    await broker.consume(async (wake) => {
      try {
        await store!.receive(wake);
        consumed++;
      } catch (e) {
        consumerError = e;
        throw e;
      }
    });
    const wait = async (condition: () => Promise<boolean>) => {
      const until = Date.now() + 12000;
      while (!(await condition())) {
        if (consumerError) throw consumerError;
        if (Date.now() > until)
          throw Error("Timed out awaiting analytics result.");
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const publish = async (e: any) => {
      const n = consumed;
      await broker!.publish({ v: 1, eventId: e.id, batchId: e.aggregate_id });
      await store!.confirmed(e, true);
      await wait(async () => consumed > n);
    };
    await publish(claimed);
    eq((await read()).views, "1");
    await publish(claimed);
    eq((await read()).views, "1"); // RabbitMQ redelivery idempotent.
    const drain = async () => {
      for (let i = 0; i < 30; i++) {
        const e = await store!.claim();
        if (!e) return;
        await publish(e);
      }
      throw Error("Unexpected pending fixture work.");
    };
    await close(s, a);
    const repeat = await create(a);
    await post(repeat, normal());
    await drain();
    eq((await read()).views, "1");
    await close(repeat, a);
    const another = await create(b);
    await post(another, normal());
    await drain();
    eq((await read()).views, "2");
    await close(another, b);
    const guest = randomBytes(32).toString("base64url"),
      g = await create(undefined, guest);
    await post(g, normal());
    await drain();
    eq((await read()).views, "3");
    await close(g);
    const g2 = await create(undefined, guest);
    await post(g2, normal());
    await drain();
    eq((await read()).views, "3");
    await close(g2);
    const paused = await create();
    await post(
      paused,
      rows([
        ["play", 0, 0],
        ["pause", 15, 15],
        ["heartbeat", 30, 30],
        ["heartbeat", 60, 60],
      ]),
    );
    await drain();
    eq((await read()).views, "3");
    await close(paused);
    const seek = await create();
    await post(
      seek,
      rows([
        ["play", 0, 0],
        ["seek", 15, 80],
        ["heartbeat", 30, 95],
      ]),
    );
    await drain();
    eq((await read()).views, "3");
    await close(seek);
    const late = await create();
    const lateRows = normal();
    await post(
      late,
      lateRows.filter((e) => e.sequence !== 2),
    );
    await drain();
    eq((await read()).views, "3");
    await post(late, [lateRows[2]]);
    await drain();
    eq((await read()).views, "4");
    await close(late);
    const old = await create();
    await f!.query(
      "UPDATE movie.playback_sessions SET created_at=clock_timestamp()-interval '3 days' WHERE id=$1",
      [old.id],
    );
    await post(old, normal());
    await drain();
    eq((await read()).views, "4");
    await close(old);
    const preview = await create(a);
    await f!.query(
      "DELETE FROM movie.resume_heads WHERE active_session_id=$1",
      [preview.id],
    );
    await f!.query(
      "UPDATE movie.playback_sessions SET mode='PREVIEW',resume_generation=NULL WHERE id=$1",
      [preview.id],
    );
    await post(preview, normal());
    await drain();
    eq((await read()).views, "4");
    await close(preview, a);
    const yesterday = await create(a);
    await f!.query(
      "UPDATE movie.playback_sessions SET created_at=((clock_timestamp() AT TIME ZONE 'UTC')::date-1+time '12:00') AT TIME ZONE 'UTC' WHERE id=$1",
      [yesterday.id],
    );
    await post(yesterday, normal());
    await drain();
    eq((await read()).views, "5");
    await close(yesterday, a);
    // Crash after publish / lost acknowledgement: reconciliation republishes accepted work.
    const recovered = await create();
    await post(recovered, normal());
    const lost = await store.claim();
    ok(lost);
    await store.confirmed(lost, true);
    await f!.query(
      "UPDATE movie.outbox_events SET published_at=clock_timestamp()-interval '3 minutes' WHERE id=$1",
      [lost.id],
    );
    await store.reconcile();
    const reclaimed = await store.claim();
    eq(reclaimed.id, lost.id);
    await publish(reclaimed);
    eq((await read()).views, "6");
    await close(recovered);
    const metrics = (
      await expect(
        api("get", "/admin/metrics/views?days=7", auditor.token),
        200,
      )
    ).body;
    eq(metrics.total.views, "6");
    eq(metrics.daily.length, 7);
    eq(metrics.top[0].id, film.titleId);
    eq(metrics.top[0].views, "6");
    eq(metrics.processing.pendingBatches, "0");
    eq(
      (await expect(api("get", "/admin/metrics/summary", auditor.token), 200))
        .body.viewsLastSevenDays,
      "6",
    );
    const publicList = (await expect(api("get", "/titles"), 200)).body;
    eq(publicList.data.find((r: any) => r.id === film.titleId).viewCount, "6");
    eq(
      (await expect(api("get", "/titles/" + film.titleId), 200)).body.viewCount,
      "6",
    );
    const privateRows = (
      await f!.query("SELECT viewer_key FROM movie.view_daily_viewers")
    ).rows;
    eq(privateRows.length, 6);
    ok(privateRows.every((r) => /^[a-f0-9]{64}$/.test(r.viewer_key)));
    ok(!JSON.stringify(privateRows).includes(a.id));
    ok(!JSON.stringify(privateRows).includes(guest));
    const workerPool = store.pool;
    for (const table of ["view_daily_viewers", "view_session_facts"]) {
      const g = (
        await f!.query(
          "SELECT has_table_privilege('movie_api',$1,'SELECT') AS read,has_table_privilege('movie_api',$1,'INSERT') AS write,has_table_privilege('movie_auditor',$1,'SELECT') AS audit",
          ["movie." + table],
        )
      ).rows[0];
      eq(g, { read: false, write: false, audit: false });
    }
    const apiPool = new Pool({ connectionString: apiUrl.toString() });
    await assert.rejects(
      apiPool.query("UPDATE movie.title_daily_stats SET qualified_views=100"),
      (e: any) => e.code === "42501",
    );
    checks++;
    await assert.rejects(
      apiPool.query("SELECT * FROM movie.view_daily_viewers"),
      (e: any) => e.code === "42501",
    );
    checks++;
    await apiPool.end();
    const extra = randomUUID();
    await f!.query(
      "INSERT INTO movie.view_daily_viewers(title_id,day,viewer_key) VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date-91,$2)",
      [film.titleId, "f".repeat(64)],
    );
    await store.prune();
    eq(
      (
        await f!.query(
          "SELECT count(*)::int n FROM movie.view_daily_viewers WHERE viewer_key=$1",
          ["f".repeat(64)],
        )
      ).rows[0].n,
      0,
    );
    eq((await read()).views, "6");
    // Precision and the seven-date boundary, using fixture-only aggregates.
    await f!.query(
      "INSERT INTO movie.title_daily_stats(title_id,day,definition_version,qualified_views) VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date-7,2,99),($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,1,999)",
      [other.titleId],
    );
    eq(
      (await expect(api("get", "/admin/metrics/summary", auditor.token), 200))
        .body.viewsLastSevenDays,
      "6",
    );
    await f!.query(
      "INSERT INTO movie.title_daily_stats(title_id,day,definition_version,qualified_views) VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,2,9007199254740993)",
      [other.titleId],
    );
    eq(
      (await expect(api("get", "/titles/" + other.titleId + "/views"), 200))
        .body.views,
      "9007199254741092",
    );
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
      errors: string[] = [];
    await page.route("https://res.cloudinary.com/**", (route: any) =>
      route.abort(),
    );
    page.on("pageerror", (e: any) => errors.push(e.name));
    const bc = async (p: Promise<any>) => {
      await p;
      checks++;
      browserChecks++;
    };
    await page.goto("/titles/" + film.titleId);
    await bc(
      browserExpect(page.getByTestId("title-view-count")).toContainText(
        "6 lượt xem hợp lệ",
      ),
    );
    await page.reload();
    await bc(
      browserExpect(page.getByTestId("title-view-count")).toContainText(
        "6 lượt xem hợp lệ",
      ),
    );
    eq((await read()).views, "6");
    await page.goto("/");
    await bc(
      browserExpect(
        page
          .locator(
            '.movie-card[href="/titles/' + film.titleId + '"] .card-views',
          )
          .first(),
      ).toContainText("6 lượt xem"),
    );
    await page.goto("/titles/" + other.titleId);
    await bc(
      browserExpect(page.getByTestId("title-view-count")).toContainText(
        "9.007.199.254.741.092",
      ),
    );
    await page.goto("/watch/" + film.episodeId);
    await bc(
      browserExpect(page.getByTestId("title-view-count")).toContainText(
        "6 lượt xem hợp lệ",
      ),
    );
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(auditor.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(auditor.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL((url: URL) => url.pathname !== "/login");
    await page.goto("/admin");
    const section = page.getByRole("region", { name: "Thống kê lượt xem" });
    await bc(
      browserExpect(
        section.getByRole("heading", { name: "Thống kê lượt xem" }),
      ).toBeVisible(),
    );
    await bc(
      browserExpect(section.locator(".view-chart > div")).toHaveCount(7),
    );
    await section.getByLabel("Khoảng thời gian thống kê").selectOption("30");
    await bc(
      browserExpect(section.locator(".view-chart > div")).toHaveCount(30),
    );
    await section.getByLabel("Khoảng thời gian thống kê").selectOption("90");
    await bc(
      browserExpect(section.locator(".view-chart > div")).toHaveCount(90),
    );
    await section
      .getByText("Xem số liệu theo ngày UTC", { exact: true })
      .click();
    await bc(
      browserExpect(section.locator("details tbody tr")).toHaveCount(90),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await bc(
      browserExpect(
        section.getByRole("heading", { name: "Thống kê lượt xem" }),
      ).toBeVisible(),
    );
    ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    eq(errors, []);
    await context.close();
    eq(
      (
        await f!.query(
          "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE'",
        )
      ).rows[0].n,
      59,
    );
    ok(result.document.components!.schemas!.TitleViewStats);
    ok(result.document.components!.schemas!.AdminViewMetrics);
    const report = {
      passed: true,
      checks,
      browserChecks,
      schemaTables: 59,
      database: "isolated disposable PostgreSQL",
      rabbitmq:
        "isolated quorum queue, real confirms/consumer/redelivery/reconciliation",
      providerLive: false,
      realUserDataChanged: false,
    };
    await writeFile(
      ".local/view-stats/integration-result.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({ event: "view-stats.integration.passed", ...report }),
    );
  } finally {
    await broker?.close();
    await store?.close();
    if (prefix) {
      const c = await amqp.connect(
        process.env.ANALYTICS_RABBITMQ_URL || process.env.RABBITMQ_URL!,
      );
      try {
        const ch = await c.createChannel();
        await ch.deleteQueue(prefix + ".jobs");
        await ch.deleteQueue(prefix + ".dlq");
        await ch.deleteExchange(prefix + ".events");
        await ch.deleteExchange(prefix + ".dead");
      } finally {
        await c.close();
      }
    }
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
      event: "view-stats.integration.failed",
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
