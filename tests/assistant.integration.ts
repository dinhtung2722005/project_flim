import { runAssistantFeedbackChecks } from "./assistant-feedback.integration";
import { runAssistantE2E } from "./assistant-e2e";
import "../apps/api/src/config";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import request from "supertest";
import { createApplication } from "../apps/api/src/application";
import { AuthService } from "../apps/api/src/services/auth.service";
import { AssistantService } from "../apps/api/src/services/assistant.service";
import { passwordHash } from "../apps/api/src/security";
import { normalized, rankCatalog } from "../packages/assistant/src/search";
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
  adminUrl.username = "postgres";
  adminUrl.password = password;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 2 });
  let f: Pool | undefined,
    app: any,
    created = false;
  await mkdir(".local/assistant/tests", { recursive: true });
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
      b = await seed();
    const api = (method: string, path: string, token?: string) => {
      let r = (request(server) as any)[method](path);
      if (token) r = r.set("Authorization", "Bearer " + token);
      return r;
    };
    async function expect(req: any, status: number, code?: string) {
      const r = await req;
      if (r.status !== status)
        console.error(
          JSON.stringify({
            expected: status,
            actual: r.status,
            code: r.body.code,
            errors: r.body.errors,
            detail: r.body.detail,
          }),
        );
      eq(r.status, status);
      if (code) eq(r.body.code, code);
      return r;
    }
    const post = (
      u: typeof a,
      message = "Có phim nào đang xem được?",
      extra: Record<string, unknown> = {},
    ) =>
      api("post", "/api/v1/assistant/runs", u.token)
        .set("Idempotency-Key", randomUUID())
        .send({ message, ...extra });
    const internal = (id: string, path: string, cap: string, body: any = {}) =>
      api("post", "/api/v1/internal/assistant/runs/" + id + "/" + path)
        .set("Authorization", "Bearer " + cap)
        .send(body);
    const claim = async (id: string) =>
      (
        await expect(
          api("post", "/api/v1/internal/assistant/runs/" + id + "/claims")
            .set("X-Assistant-Worker-Key", process.env.ASSISTANT_WORKER_SECRET!)
            .send({}),
          200,
        )
      ).body;
    const tool = async (
      id: string,
      cap: string,
      name: string,
      args: object,
      callId = randomUUID(),
    ) =>
      (
        await expect(
          internal(id, "tools", cap, { callId, tool: name, args }),
          200,
        )
      ).body;
    const create = async (
      u: typeof a,
      message?: string,
      extra?: Record<string, unknown>,
    ) => (await expect(post(u, message, extra), 202)).body;
    const cancel = async (u: typeof a, id: string) =>
      expect(api("delete", "/api/v1/assistant/runs/" + id, u.token), 204);
    const selection = (evidence: any[], kind = "FOUND") => ({
      kind,
      titleIds: evidence
        .filter((e) => e.kind === "TITLE")
        .map((e) => e.entityId),
      helpIds: evidence.filter((e) => e.kind === "HELP").map((e) => e.entityId),
      episodeIds: evidence
        .filter((e) => e.kind === "EPISODE")
        .map((e) => e.entityId),
      evidenceIds: evidence.map((e) => e.id),
    });
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
    const visible = await fixture("Điện ảnh Alpha"),
      hidden = await fixture("Bí mật chưa xuất bản", false);
    // DTO and authentication contracts.
    await expect(api("get", "/api/v1/assistant/capabilities"), 401);
    eq(
      (await expect(api("get", "/api/v1/assistant/capabilities", a.token), 200))
        .body.enabled,
      true,
    );
    for (const bad of [
      { message: "" },
      { message: "x", userId: b.id },
      { message: "x", filters: null },
      { message: "x", filters: { year: "2026" } },
      { message: "x", filters: { url: "http://bad.test" } },
      { message: "x", limit: 6 },
      { message: "x", avoidSpoilers: null },
      { message: "x", contextTitleId: "invalid" },
    ]) {
      await expect(
        api("post", "/api/v1/assistant/runs", a.token)
          .set("Idempotency-Key", randomUUID())
          .send(bad),
        422,
        "VALIDATION_FAILED",
      );
    }
    await expect(
      api("post", "/api/v1/assistant/runs", a.token).send({ message: "x" }),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    await expect(
      api(
        "post",
        "/api/v1/internal/assistant/runs/" + randomUUID() + "/claims",
      ).send({}),
      403,
      "AUTH_FORBIDDEN",
    );
    const key = randomUUID();
    const run = (
      await expect(
        api("post", "/api/v1/assistant/runs", a.token)
          .set("Idempotency-Key", key)
          .send({ message: "Alpha" }),
        202,
      )
    ).body;
    const replay = (
      await expect(
        api("post", "/api/v1/assistant/runs", a.token)
          .set("Idempotency-Key", key)
          .send({ message: "Alpha" }),
        202,
      )
    ).body;
    eq(run.id, replay.id);
    await expect(
      api("post", "/api/v1/assistant/runs", a.token)
        .set("Idempotency-Key", key)
        .send({ message: "Changed" }),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    const outbox = await f.query(
      "SELECT payload FROM movie.outbox_events WHERE aggregate_id=$1",
      [run.id],
    );
    eq(outbox.rowCount, 1);
    eq(outbox.rows[0].payload, { runId: run.id });
    await expect(
      api("get", "/api/v1/assistant/runs/" + run.id, b.token),
      404,
      "RESOURCE_NOT_FOUND",
    );
    await expect(
      api("delete", "/api/v1/assistant/runs/" + run.id, b.token),
      404,
      "RESOURCE_NOT_FOUND",
    );
    const superAdmin = await seed("SUPER_ADMIN");
    await expect(
      api("get", "/api/v1/assistant/runs/" + run.id, superAdmin.token),
      404,
      "RESOURCE_NOT_FOUND",
    );
    try {
      await f.query(
        "UPDATE movie.assistant_runs SET auth_session_id=$2 WHERE id=$1",
        [run.id, b.sid],
      );
      assert.fail("Cross-owner session accepted");
    } catch (e: any) {
      eq(e.code, "23503");
    }
    await expect(
      post(b, "follow up", { parentRunId: run.id }),
      404,
      "RESOURCE_NOT_FOUND",
    );
    // Live tools must not expose unpublished content, asset refs or URLs.
    const c = await claim(run.id);
    ok(c.active);
    eq((await claim(run.id)).active, false);
    await expect(
      internal(run.id, "tools", "invalid", {
        callId: randomUUID(),
        tool: "search_help",
        args: { query: "x" },
      }),
      403,
    );
    const callId = randomUUID(),
      data = await tool(
        run.id,
        c.capability,
        "search_catalog",
        { query: "dien anh" },
        callId,
      );
    eq(data.evidence.length, 1);
    eq(data.evidence[0].entityId, visible.titleId);
    ok(!JSON.stringify(data).includes(hidden.titleId));
    ok(!JSON.stringify(data).includes("provider"));
    ok(!JSON.stringify(data).includes("manifest"));
    ok(!JSON.stringify(data).includes("synopsis"));
    const repeat = await tool(
      run.id,
      c.capability,
      "search_catalog",
      { query: "dien anh" },
      callId,
    );
    eq(repeat, data);
    await expect(
      internal(run.id, "tools", c.capability, {
        callId,
        tool: "search_catalog",
        args: { query: "different" },
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    await expect(
      internal(run.id, "tools", c.capability, {
        callId: randomUUID(),
        tool: "get_title_details",
        args: { titleId: hidden.titleId },
      }),
      404,
      "RESOURCE_NOT_FOUND",
    );
    await expect(
      internal(run.id, "tools", c.capability, {
        callId: randomUUID(),
        tool: "raw_sql",
        args: {},
      }),
      422,
    );
    await expect(
      internal(run.id, "tools", c.capability, {
        callId: randomUUID(),
        tool: "search_help",
        args: { query: "x", url: "http://bad.test" },
      }),
      422,
      "VALIDATION_FAILED",
    );
    await expect(
      internal(run.id, "results", c.capability, {
        engine: "CATALOG",
        selection: { ...selection(data.evidence), titleIds: [hidden.titleId] },
      }),
      422,
      "AGENT_ANSWER_INVALID",
    );
    await expect(
      internal(run.id, "results", c.capability, {
        engine: "OLLAMA",
        selection: selection(data.evidence),
      }),
      422,
      "AGENT_ANSWER_INVALID",
    );
    await expect(
      internal(run.id, "results", c.capability, {
        engine: "CATALOG",
        selection: selection(data.evidence),
      }),
      200,
    );
    const answer = (
      await expect(api("get", "/api/v1/assistant/runs/" + run.id, a.token), 200)
    ).body;
    eq(answer.status, "SUCCEEDED");
    eq(answer.result.cards[0].id, visible.titleId);
    eq(answer.result.sources[0].url, "/titles/" + visible.titleId);
    // Stored selections never render a title after unpublication.
    await f.query(
      "UPDATE movie.titles SET publication_status='UNPUBLISHED' WHERE id=$1",
      [visible.titleId],
    );
    const changed = (
      await expect(api("get", "/api/v1/assistant/runs/" + run.id, a.token), 200)
    ).body;
    eq(changed.result.cards.length, 0);
    ok(!JSON.stringify(changed.result).includes("Alpha"));
    eq(changed.result.warnings, ["AGENT_CONTEXT_CHANGED"]);
    await f.query(
      "UPDATE movie.titles SET publication_status='PUBLISHED' WHERE id=$1",
      [visible.titleId],
    );
    const follow = await create(a, "Các tập của phim này?", {
      parentRunId: run.id,
    });
    eq(follow.contextTitleId, visible.titleId);
    const cf = await claim(follow.id);
    const ep = await tool(follow.id, cf.capability, "get_published_episodes", {
      titleId: visible.titleId,
    });
    eq(
      ep.evidence.filter((e: any) => e.kind === "EPISODE")[0].entityId,
      visible.episodeId,
    );
    await expect(
      internal(follow.id, "results", cf.capability, {
        engine: "CATALOG",
        selection: selection(ep.evidence),
      }),
      200,
    );
    // Bounded tool calls and cancellation fencing.
    const many = await create(b);
    const cm = await claim(many.id);
    for (let i = 0; i < 6; i++)
      await tool(many.id, cm.capability, "search_help", {
        query: "chất lượng video",
      });
    await expect(
      internal(many.id, "tools", cm.capability, {
        callId: randomUUID(),
        tool: "search_help",
        args: { query: "video" },
      }),
      429,
      "AGENT_TOOL_BUDGET_EXCEEDED",
    );
    await cancel(b, many.id);
    await cancel(b, many.id);
    await expect(
      internal(many.id, "results", cm.capability, {
        engine: "CATALOG",
        selection: {
          kind: "EMPTY",
          titleIds: [],
          helpIds: [],
          episodeIds: [],
          evidenceIds: [],
        },
      }),
      409,
      "AGENT_CONTEXT_CHANGED",
    );
    eq(
      (
        await expect(
          api("get", "/api/v1/assistant/runs/" + many.id, b.token),
          200,
        )
      ).body.status,
      "CANCELLED",
    );
    // Logout/revocation is checked inside tool access, not just at creation.
    const u = await seed(),
      rev = await create(u);
    const cr = await claim(rev.id);
    await f.query(
      "UPDATE movie.auth_sessions SET state='REVOKED',revoked_at=clock_timestamp() WHERE id=$1",
      [u.sid],
    );
    await expect(
      internal(rev.id, "tools", cr.capability, {
        callId: randomUUID(),
        tool: "search_help",
        args: { query: "video" },
      }),
      401,
      "AUTH_SESSION_REVOKED",
    );
    await expect(
      internal(rev.id, "failures", cr.capability, {
        code: "AUTH_SESSION_REVOKED",
      }),
      200,
    );
    // Lease reclamation increments generation; old workers cannot write.
    const lease = await create(b);
    const oldClaim = await claim(lease.id);
    await f.query(
      "UPDATE movie.assistant_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [lease.id],
    );
    await app.get(AssistantService).maintain();
    const nextClaim = await claim(lease.id);
    ok(nextClaim.active);
    ok(nextClaim.capability !== oldClaim.capability);
    await expect(
      internal(lease.id, "heartbeats", oldClaim.capability),
      409,
      "AGENT_CONTEXT_CHANGED",
    );
    await expect(internal(lease.id, "heartbeats", nextClaim.capability), 200);
    await cancel(b, lease.id);
    const helpRun = await create(b, "Đổi chất lượng video?");
    const hc = await claim(helpRun.id),
      hd = await tool(helpRun.id, hc.capability, "search_help", {
        query: "Đổi chất lượng video?",
      });
    ok(hd.evidence.length > 0);
    await expect(
      internal(helpRun.id, "results", hc.capability, {
        engine: "CATALOG",
        selection: selection(hd.evidence, "HELP"),
      }),
      200,
    );
    const helpAnswer = (
      await expect(
        api("get", "/api/v1/assistant/runs/" + helpRun.id, b.token),
        200,
      )
    ).body;
    ok(helpAnswer.result.answer.includes("chất lượng"));
    eq(helpAnswer.result.cards.length, 0);
    // Owner-bound cursors and 7-day retention.
    const page = (
      await expect(api("get", "/api/v1/assistant/runs?limit=1", a.token), 200)
    ).body;
    ok(page.page.nextCursor);
    await expect(
      api(
        "get",
        "/api/v1/assistant/runs?limit=1&cursor=" +
          encodeURIComponent(page.page.nextCursor),
        b.token,
      ),
      400,
      "REQUEST_INVALID_CURSOR",
    );
    const exp = await create(await seed());
    const expOwner = (
      await f.query("SELECT user_id FROM movie.assistant_runs WHERE id=$1", [
        exp.id,
      ])
    ).rows[0].user_id;
    await f.query(
      "UPDATE movie.assistant_runs SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1",
      [exp.id],
    );
    await app.get(AssistantService).maintain();
    eq(
      (
        await f.query("SELECT id FROM movie.assistant_runs WHERE id=$1", [
          exp.id,
        ])
      ).rowCount,
      0,
    );
    for (const table of ["assistant_runs", "assistant_run_steps"]) {
      const p = (
        await f.query(
          "SELECT has_table_privilege('movie_api',$1,'SELECT') AS api,has_table_privilege('movie_worker',$1,'SELECT') AS worker,has_table_privilege('movie_auditor',$1,'SELECT') AS auditor",
          ["movie." + table],
        )
      ).rows[0];
      eq(p, { api: true, worker: false, auditor: false });
    }
    eq(
      (
        await f.query(
          "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE'",
        )
      ).rows[0].n,
      59,
    );
    const paths = Object.keys(result.document.paths);
    ok(!paths.some((p) => p.includes("/internal/assistant/")));
    for (const path of [
      "/assistant/runs",
      "/assistant/runs/{id}",
      "/assistant/capabilities",
    ])
      ok(paths.includes("/api/v1" + path));
    eq(
      (
        result.document.paths["/api/v1/assistant/runs"]!.post!.responses[
          "202"
        ] as any
      ).content["application/json"].schema.$ref,
      "#/components/schemas/AssistantRun",
    );
    eq(normalized("ĐIỆN ẢNH"), "dien anh");
    eq(
      rankCatalog(
        [
          { id: "a", localized_title: "Điện ảnh Alpha" },
          { id: "b", localized_title: "Beta" },
        ],
        "dien anh",
        5,
      ).map((x) => x.id),
      ["a"],
    );
    process.env.ASSISTANT_ENABLED = "false";
    await expect(post(a), 503, "AGENT_DISABLED");
    process.env.ASSISTANT_ENABLED = "true";
    const feedbackChecks = await runAssistantFeedbackChecks({
      app,
      f,
      fixture,
      seed,
      create,
      claim,
      tool,
      expect,
      api,
      internal,
      selection,
      cancel,
      document: result.document,
    });
    checks += feedbackChecks;
    const e2e =
      process.env.PJ_FLIM_TEST_ASSISTANT_E2E === "true"
        ? await runAssistantE2E({
            app,
            fixtures: f,
            seed,
            titleId: visible.titleId,
          })
        : null;
    if (e2e) checks += e2e.checks;
    const report = {
      checks,
      feedbackChecks,
      e2e,
      database: "isolated disposable fixture",
      schemaTables: 59,
      queueTested: !!e2e,
      modelLive: false,
    };
    await writeFile(
      ".local/assistant/tests/backend-result.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({ event: "assistant.integration.passed", ...report }),
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
main().catch((e) => {
  console.error(
    JSON.stringify({
      event: "assistant.integration.failed",
      code: e.code ?? e.name,
      detail:
        e instanceof assert.AssertionError
          ? e.message
          : "See private test setup/schema; no raw connection error emitted.",
    }),
  );
  process.exitCode = 1;
});
