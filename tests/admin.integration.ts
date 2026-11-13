import { runEncodingChecks } from "./encoding.integration";
import { runPaginationChecks } from "./pagination.integration";
import { runAuthSecurityChecks } from "./auth-security.integration";
import { runFrontendChecks } from "./frontend.integration";
import { runGlobalExceptionChecks } from "./global-exception.integration";
import { runMfaPolicyChecks } from "./mfa-policy.integration";
import { runSwaggerChecks } from "./swagger.integration";
import { runViewerIntegration } from "./viewer.integration";
import { runWorkerIntegration } from "./worker.integration";
import { runMediaIntegration } from "./media.integration";
import { runBrowserUploadChecks } from "./browser-upload.integration";
import "../apps/api/src/config";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { createApplication } from "../apps/api/src/application";
import { encrypt, newTotp, passwordHash, totp } from "../apps/api/src/security";
import { hash } from "../apps/api/src/common";
type Fixture = {
  id: string;
  email: string;
  password: string;
  secret: string;
  recovery: string[];
};
let checks = 0;
function status(response: request.Response, expected: number) {
  assert.equal(
    response.status,
    expected,
    JSON.stringify({ expected, actual: response.status, body: response.body }),
  );
  checks++;
  return response;
}
function problem(response: request.Response, expected: number, code: string) {
  status(response, expected);
  assert.equal(response.body.code, code);
  assert.match(response.headers["content-type"], /application\/problem\+json/);
  checks += 2;
  return response;
}
async function main() {
  const password = process.env.PJ_FLIM_TEST_ADMIN_PASSWORD;
  if (!password)
    throw new Error(
      "Set PJ_FLIM_TEST_ADMIN_PASSWORD for an isolated temporary test database. Never run integration fixtures in pj_flim.",
    );
  // Test the default MFA policy independently of the developer local override.
  process.env.AUTH_MFA_REQUIRED = "true";
  checks += await runBrowserUploadChecks();
  const encodingChecks = await runEncodingChecks();
  checks += encodingChecks;
  const started = Date.now(),
    databaseName = "pj_flim_test_" + randomBytes(6).toString("hex");
  if (!/^pj_flim_test_[a-f0-9]{12}$/.test(databaseName))
    throw new Error("Unsafe test database name.");
  const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!),
    apiUrl = new URL(process.env.DATABASE_URL!);
  ownerUrl.searchParams.delete("schema");
  apiUrl.searchParams.delete("schema");
  const adminUrl = new URL(ownerUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.username = process.env.PJ_FLIM_TEST_ADMIN_USER ?? "postgres";
  adminUrl.password = password;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 2 });
  let created = false,
    owner: Pool | undefined,
    app: Awaited<ReturnType<typeof createApplication>>["app"] | undefined;
  try {
    await admin.query(
      'CREATE DATABASE "' +
        databaseName +
        "\" OWNER pj_flim_owner TEMPLATE template0 ENCODING 'UTF8'",
    );
    created = true;
    ownerUrl.pathname = "/" + databaseName;
    apiUrl.pathname = "/" + databaseName;
    owner = new Pool({ connectionString: ownerUrl.toString(), max: 4 });
    const fixtures = owner;
    await fixtures.query(
      'REVOKE ALL ON DATABASE "' +
        databaseName +
        '" FROM PUBLIC; GRANT CONNECT ON DATABASE "' +
        databaseName +
        '" TO movie_api,movie_worker; ALTER DATABASE "' +
        databaseName +
        '" SET search_path TO movie,pg_catalog;',
    );
    for (const file of [
      "movie-database-schema.sql",
      "movie-database-rbac-seed.sql",
      "movie-database-grants.sql",
      "movie-recommendations-v1.sql",
    ])
      await fixtures.query(await readFile("docs/design/sql/" + file, "utf8"));
    process.env.DATABASE_URL = apiUrl.toString();
    process.env.MIGRATION_DATABASE_URL = ownerUrl.toString();
    if (process.env.PJ_FLIM_TEST_WORKER === "true") {
      const workerUrl = new URL(process.env.WORKER_DATABASE_URL!);
      workerUrl.pathname = "/" + databaseName;
      process.env.WORKER_DATABASE_URL = workerUrl.toString();
    }
    async function seed(
      role: string,
      withMfa = role !== "MEMBER",
    ): Promise<Fixture> {
      const id = randomUUID(),
        email =
          role.toLowerCase() +
          "-" +
          randomBytes(5).toString("hex") +
          "@example.test",
        secret = newTotp(),
        password = randomBytes(18).toString("hex"),
        recovery = [
          randomBytes(16).toString("hex"),
          randomBytes(16).toString("hex"),
        ];
      await fixtures.query(
        "INSERT INTO movie.users(id,email_normalized,password_hash,display_name,email_verified_at) VALUES ($1,$2,$3,$4,now())",
        [id, email, await passwordHash(password), role],
      );
      await fixtures.query(
        "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code=$2",
        [id, role],
      );
      if (withMfa) {
        const factor = await fixtures.query(
          "INSERT INTO movie.mfa_factors(user_id,encrypted_secret,encryption_key_id,verified_at) VALUES ($1,$2,'local-v1',now()) RETURNING id",
          [id, encrypt(secret)],
        );
        for (const code of recovery)
          await fixtures.query(
            "INSERT INTO movie.mfa_recovery_codes(factor_id,code_hash) VALUES ($1,$2)",
            [factor.rows[0].id, hash(code)],
          );
      }
      return { id, email, password, secret, recovery };
    }
    const root = await seed("SUPER_ADMIN"),
      editor = await seed("EDITOR"),
      auditor = await seed("AUDITOR"),
      operator = await seed("ADMIN"),
      member = await seed("MEMBER"),
      unenrolled = await seed("EDITOR", false);
    await fixtures.query(
      "INSERT INTO movie.system_settings(key,value,updated_by) VALUES ('site',$1,$2)",
      [JSON.stringify({ name: "pj-Flim" }), root.id],
    );
    process.env.MAIL_TRANSPORT = "local";
    process.env.MAIL_LOCAL_ROOT = ".local/mail/tests/" + databaseName;
    const createdApp = await createApplication();
    app = createdApp.app;
    const server = app.getHttpServer();
    const api = (
      method: "get" | "post" | "put" | "patch" | "delete",
      path: string,
      token?: string,
    ) => {
      const test = request(server)[method](path);
      return token ? test.auth(token, { type: "bearer" }) : test;
    };
    if (process.env.PJ_FLIM_TEST_WEB_ONLY === "true") {
      const frontendChecks = await runFrontendChecks({
        server,
        fixtures,
        seed,
      });
      await mkdir(".local/web", { recursive: true });
      await writeFile(
        ".local/web/integration-result.json",
        JSON.stringify(
          {
            frontendChecks,
            passed: true,
            database: "isolated temporary PostgreSQL",
            durationMs: Date.now() - started,
          },
          null,
          2,
        ),
      );
      console.log(JSON.stringify({ event: "frontend.passed", frontendChecks }));
      return;
    }
    const exceptionChecks = await runGlobalExceptionChecks({
      api,
      fixtures,
      app,
    });
    checks += exceptionChecks;
    status(await api("get", "/api/v1/health"), 200);
    problem(
      await api("get", "/api/v1/admin/titles"),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    status(await api("get", "/api/openapi.json"), 200);
    status(await api("get", "/api/docs").set("Accept", "text/html"), 200);
    status(await api("get", "/api/docs-json"), 404);
    problem(
      await api("post", "/api/v1/auth/sessions").send({
        email: unenrolled.email,
        password: unenrolled.password,
      }),
      403,
      "AUTH_MFA_ENROLLMENT_REQUIRED",
    );
    const pending = status(
      await api("post", "/api/v1/auth/sessions").send({
        email: root.email,
        password: root.password,
      }),
      201,
    ).body;
    status(
      await api(
        "get",
        "/api/v1/auth/mfa-challenges/" + pending.challengeId,
        pending.challengeToken,
      ),
      200,
    );
    assert.equal(pending.state, "PENDING_MFA");
    assert.equal(pending.accessToken, undefined);
    checks += 2;
    problem(
      await api("get", "/api/v1/admin/titles", pending.challengeToken),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    problem(
      await api(
        "post",
        "/api/v1/auth/mfa-challenges/" + pending.challengeId + "/verifications",
      )
        .set("Idempotency-Key", randomUUID())
        .send({ challengeToken: pending.challengeToken, code: "f".repeat(32) }),
      422,
      "AUTH_MFA_INVALID",
    );
    assert.equal(
      (
        await fixtures.query(
          "SELECT attempt_count FROM movie.mfa_challenges WHERE id=$1",
          [pending.challengeId],
        )
      ).rows[0].attempt_count,
      1,
    );
    checks++;
    const key = randomUUID(),
      mfaBody = {
        challengeToken: pending.challengeToken,
        code: totp(root.secret).generate(),
      };
    const verified = await Promise.all([
      api(
        "post",
        "/api/v1/auth/mfa-challenges/" + pending.challengeId + "/verifications",
      )
        .set("Idempotency-Key", key)
        .send(mfaBody),
      api(
        "post",
        "/api/v1/auth/mfa-challenges/" + pending.challengeId + "/verifications",
      )
        .set("Idempotency-Key", key)
        .send(mfaBody),
    ]);
    verified.forEach((r) => status(r, 200));
    assert.equal(verified[0].body.refreshToken, verified[1].body.refreshToken);
    checks++;
    let rootToken = verified[0].body.accessToken;
    const rootRefresh = verified[0].body.refreshToken;
    problem(
      await api(
        "post",
        "/api/v1/auth/mfa-challenges/" + pending.challengeId + "/verifications",
      )
        .set("Idempotency-Key", key)
        .send({ ...mfaBody, code: root.recovery[0] }),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    async function login(user: Fixture) {
      const response = status(
        await api("post", "/api/v1/auth/sessions").send({
          email: user.email,
          password: user.password,
        }),
        201,
      );
      if (response.body.state === "ACTIVE") return response.body;
      return status(
        await api(
          "post",
          "/api/v1/auth/mfa-challenges/" +
            response.body.challengeId +
            "/verifications",
        )
          .set("Idempotency-Key", randomUUID())
          .send({
            challengeToken: response.body.challengeToken,
            code: totp(user.secret).generate(),
          }),
        200,
      ).body;
    }
    const editorToken = (await login(editor)).accessToken,
      auditorToken = (await login(auditor)).accessToken,
      adminToken = (await login(operator)).accessToken,
      memberToken = (await login(member)).accessToken;
    problem(
      await api("get", "/api/v1/admin/titles", memberToken),
      403,
      "AUTH_FORBIDDEN",
    );
    problem(
      await api("get", "/api/v1/admin/titles", auditorToken),
      403,
      "AUTH_FORBIDDEN",
    );
    status(await api("get", "/api/v1/admin/titles", editorToken), 200);
    status(
      await api("get", "/api/v1/auth/sessions/" + pending.sessionId, rootToken),
      200,
    );
    const me = status(await api("get", "/api/v1/me", rootToken), 200);
    assert.equal(me.body.passwordHash, undefined);
    assert.equal(me.body.encryptedSecret, undefined);
    checks += 2;
    const roles = status(
      await api("get", "/api/v1/admin/roles", rootToken),
      200,
    );
    assert.equal(roles.body.length, 5);
    checks++;
    const permissions = status(
      await api("get", "/api/v1/admin/permissions", rootToken),
      200,
    );
    assert.equal(permissions.body.length, 18);
    checks++;
    problem(
      await api("get", "/api/v1/admin/titles/not-a-uuid", rootToken),
      400,
      "REQUEST_INVALID_IDENTIFIER",
    );
    problem(
      await api("post", "/api/v1/admin/titles", rootToken).send({
        kind: "SERIES",
        slug: "bad",
        localizedTitle: "Test",
        role: "SUPER_ADMIN",
      }),
      422,
      "VALIDATION_FAILED",
    );
    problem(
      await api("post", "/api/v1/admin/titles", rootToken)
        .set("Content-Type", "application/json")
        .send('{"kind":'),
      400,
      "REQUEST_MALFORMED_JSON",
    );
    problem(
      await api("post", "/api/v1/admin/titles", rootToken)
        .set("Content-Type", "text/plain")
        .send("not-json"),
      415,
      "REQUEST_UNSUPPORTED_MEDIA_TYPE",
    );
    const queryError = problem(
      await api("get", "/api/v1/admin/titles?limit=101", rootToken),
      422,
      "VALIDATION_FAILED",
    );
    assert.equal(queryError.body.errors[0].location, "query");
    checks++;
    const genre = status(
      await api("post", "/api/v1/admin/genres", rootToken).send({
        slug: "action",
        name: "Action",
      }),
      201,
    );
    const person = status(
      await api("post", "/api/v1/admin/people", rootToken).send({
        name: "Test Actor",
      }),
      201,
    );
    const titleBody = {
      kind: "SERIES",
      slug: "integration-series",
      localizedTitle: "Series Test",
      genreIds: [genre.body.id],
      aliases: [{ alias: "Series alias" }],
      credits: [{ personId: person.body.id, role: "ACTOR" }],
    };
    const title = status(
        await api("post", "/api/v1/admin/titles", rootToken).send(titleBody),
        201,
      ),
      titleId = title.body.id;
    assert.equal(title.headers.location, "/api/v1/admin/titles/" + titleId);
    assert.equal(title.body.genres.length, 1);
    checks += 2;
    problem(
      await api("post", "/api/v1/admin/titles", rootToken).send(titleBody),
      409,
      "CATALOG_SLUG_CONFLICT",
    );
    problem(
      await api("patch", "/api/v1/admin/titles/" + titleId, rootToken).send({
        synopsis: "Missing ETag",
      }),
      428,
      "PRECONDITION_REQUIRED",
    );
    problem(
      await api("patch", "/api/v1/admin/titles/" + titleId, rootToken)
        .set("If-Match", '"wrong"')
        .send({ synopsis: "Stale ETag" }),
      412,
      "RESOURCE_VERSION_MISMATCH",
    );
    const updated = status(
      await api("patch", "/api/v1/admin/titles/" + titleId, rootToken)
        .set("If-Match", title.headers.etag)
        .send({ synopsis: "Updated" }),
      200,
    );
    const race = await Promise.all([
      api("patch", "/api/v1/admin/titles/" + titleId, rootToken)
        .set("If-Match", updated.headers.etag)
        .send({ synopsis: "First" }),
      api("patch", "/api/v1/admin/titles/" + titleId, rootToken)
        .set("If-Match", updated.headers.etag)
        .send({ synopsis: "Second" }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 412]);
    checks++;
    const movie = status(
      await api("post", "/api/v1/admin/titles", rootToken).send({
        kind: "MOVIE",
        slug: "integration-movie",
        localizedTitle: "Movie Test",
      }),
      201,
    );
    const technical = status(
      await api(
        "get",
        "/api/v1/admin/titles/" + movie.body.id + "/seasons",
        rootToken,
      ),
      200,
    );
    assert.equal(technical.body.data[0].number, 0);
    checks++;
    const technicalEpisodes = status(
      await api(
        "get",
        "/api/v1/admin/seasons/" + technical.body.data[0].id + "/episodes",
        rootToken,
      ),
      200,
    );
    assert.equal(technicalEpisodes.body.data.length, 1);
    checks++;
    const page1 = status(
      await api("get", "/api/v1/admin/titles?limit=1", rootToken),
      200,
    );
    assert.equal(page1.body.page.hasMore, true);
    checks++;
    status(
      await api(
        "get",
        "/api/v1/admin/titles?limit=1&cursor=" +
          encodeURIComponent(page1.body.page.nextCursor),
        rootToken,
      ),
      200,
    );
    problem(
      await api(
        "get",
        "/api/v1/admin/titles?limit=1&status=DRAFT&cursor=" +
          encodeURIComponent(page1.body.page.nextCursor),
        rootToken,
      ),
      400,
      "REQUEST_INVALID_CURSOR",
    );
    const season = status(
      await api(
        "post",
        "/api/v1/admin/titles/" + titleId + "/seasons",
        rootToken,
      ).send({ number: 1, name: "Season 1" }),
      201,
    );
    problem(
      await api(
        "post",
        "/api/v1/admin/titles/" + titleId + "/seasons",
        rootToken,
      ).send({ number: 1 }),
      409,
      "CATALOG_SEASON_NUMBER_CONFLICT",
    );
    const episode = status(
        await api(
          "post",
          "/api/v1/admin/seasons/" + season.body.id + "/episodes",
          rootToken,
        ).send({ number: 1, name: "Episode 1" }),
        201,
      ),
      episodeId = episode.body.id;
    checks += await runMediaIntegration({
      api,
      fixtures,
      app,
      episodeId,
      rootToken,
      editorToken,
      adminToken,
      auditorToken,
      memberToken,
    });
    if (process.env.PJ_FLIM_TEST_WORKER === "true")
      checks += await runWorkerIntegration({
        api,
        fixtures,
        rootToken,
        editorToken,
        adminToken,
      });
    const viewerChecks = await runViewerIntegration({
      api,
      fixtures,
      app,
      rootId: root.id,
      rootToken,
      memberToken,
    });
    checks += viewerChecks;
    const paginationChecks = await runPaginationChecks({
      fixtures,
      rootId: root.id,
      titleId,
      get: (path) => api("get", path, rootToken),
    });
    checks += paginationChecks;
    problem(
      await api(
        "post",
        "/api/v1/admin/seasons/" + season.body.id + "/episodes",
        rootToken,
      ).send({ number: 1, name: "Duplicate" }),
      409,
      "CATALOG_EPISODE_NUMBER_CONFLICT",
    );
    problem(
      await api(
        "put",
        "/api/v1/admin/episodes/" + episodeId + "/publication",
        editorToken,
      )
        .set("If-Match", episode.headers.etag)
        .send({ status: "PUBLISHED" }),
      403,
      "AUTH_FORBIDDEN",
    );
    problem(
      await api(
        "put",
        "/api/v1/admin/episodes/" + episodeId + "/publication",
        rootToken,
      )
        .set("If-Match", episode.headers.etag)
        .send({ status: "PUBLISHED" }),
      409,
      "MEDIA_NOT_READY",
    );
    const latestTitle = status(
      await api("get", "/api/v1/admin/titles/" + titleId, rootToken),
      200,
    );
    problem(
      await api(
        "put",
        "/api/v1/admin/titles/" + titleId + "/publication",
        rootToken,
      )
        .set("If-Match", latestTitle.headers.etag)
        .send({ status: "PUBLISHED" }),
      409,
      "CATALOG_NO_PLAYABLE_EPISODE",
    );
    const asset = randomUUID(),
      attempt = randomUUID(),
      operation = randomUUID();
    await fixtures.query(
      "INSERT INTO movie.video_assets(id,episode_id,internal_version,provider_asset_id,public_id,provider_version,delivery_type,processing_status,backup_status,duration_seconds,bytes) VALUES ($1,$2,1,'fixture','fixture','1','authenticated','READY','VERIFIED',600,100)",
      [asset, episodeId],
    );
    await fixtures.query(
      "INSERT INTO movie.operations(id,owner_user_id,principal_scope,type) VALUES ($1,$2,'fixture','MEDIA_PROCESS')",
      [operation, root.id],
    );
    await fixtures.query(
      "INSERT INTO movie.media_attempts(id,asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash,completed_at) VALUES ($1,$2,$3,'v1','fixture','SUCCEEDED',1,'fixture',now())",
      [attempt, asset, operation],
    );
    await fixtures.query(
      "UPDATE movie.video_assets SET current_attempt_id=$2 WHERE id=$1",
      [asset, attempt],
    );
    await fixtures.query(
      "INSERT INTO movie.media_outputs(attempt_id,format,profile_version,config_hash,status,manifest_ref,verified_at) VALUES ($1,'HLS','v1','fixture','READY','fixture/manifest',now())",
      [attempt],
    );
    problem(
      await api("patch", "/api/v1/admin/episodes/" + episodeId, rootToken)
        .set("If-Match", episode.headers.etag)
        .send({ activeAssetId: asset }),
      409,
      "MEDIA_BACKUP_NOT_VERIFIED",
    );
    await fixtures.query(
      "INSERT INTO movie.source_backups(asset_id,storage_provider,bucket,object_key,sha256,bytes,status,verified_at,source_manifest_ref) VALUES ($1,'S3','fixture','fixture',$2,100,'VERIFIED',now(),'fixture/manifest')",
      [asset, "0".repeat(64)],
    );
    const activated = status(
      await api("patch", "/api/v1/admin/episodes/" + episodeId, rootToken)
        .set("If-Match", episode.headers.etag)
        .send({ activeAssetId: asset }),
      200,
    );
    const publishedEpisode = status(
      await api(
        "put",
        "/api/v1/admin/episodes/" + episodeId + "/publication",
        rootToken,
      )
        .set("If-Match", activated.headers.etag)
        .send({ status: "PUBLISHED" }),
      200,
    );
    const publishedTitle = status(
      await api(
        "put",
        "/api/v1/admin/titles/" + titleId + "/publication",
        rootToken,
      )
        .set("If-Match", latestTitle.headers.etag)
        .send({ status: "PUBLISHED" }),
      200,
    );
    assert.equal(publishedEpisode.body.status, "PUBLISHED");
    assert.equal(publishedTitle.body.status, "PUBLISHED");
    checks += 2;
    const banner = status(
      await api("post", "/api/v1/admin/banners", rootToken).send({
        titleId,
        imageAssetRef: "posters/banner",
        enabled: false,
      }),
      201,
    );
    status(
      await api("patch", "/api/v1/admin/banners/" + banner.body.id, rootToken)
        .set("If-Match", banner.headers.etag)
        .send({ enabled: true }),
      200,
    );
    assert.equal(
      (
        await fixtures.query(
          "SELECT aggregate_version::text AS version FROM movie.outbox_events WHERE aggregate_type='banner' AND aggregate_id=$1 ORDER BY created_at DESC LIMIT 1",
          [banner.body.id],
        )
      ).rows[0].version,
      "2",
    );
    checks++;
    const settings = status(
      await api("get", "/api/v1/admin/settings/site", rootToken),
      200,
    );
    problem(
      await api("put", "/api/v1/admin/settings/site", rootToken)
        .set("If-Match", settings.headers.etag)
        .send({ name: "New site" }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
    const challenge = status(
      await api("post", "/api/v1/auth/step-up-challenges", rootToken),
      201,
    ).body;
    status(
      await api(
        "post",
        "/api/v1/auth/step-up-challenges/" +
          challenge.challengeId +
          "/verifications",
      )
        .set("Idempotency-Key", randomUUID())
        .send({
          challengeToken: challenge.challengeToken,
          code: root.recovery[0],
        }),
      200,
    );
    status(
      await api("put", "/api/v1/admin/settings/site", rootToken)
        .set("If-Match", settings.headers.etag)
        .send({ name: "Updated pj-Flim" }),
      200,
    );
    const rootUser = status(
      await api("get", "/api/v1/admin/users/" + root.id, rootToken),
      200,
    );
    problem(
      await api("put", "/api/v1/admin/users/" + root.id + "/roles", rootToken)
        .set("If-Match", rootUser.headers.etag)
        .send({ roles: ["AUDITOR"], reason: "Last administrator test" }),
      409,
      "RBAC_LAST_SUPER_ADMIN",
    );
    problem(
      await api("put", "/api/v1/admin/users/" + root.id + "/status", rootToken)
        .set("If-Match", rootUser.headers.etag)
        .send({ status: "SUSPENDED", reason: "Last administrator test" }),
      409,
      "RBAC_LAST_SUPER_ADMIN",
    );
    problem(
      await api("put", "/api/v1/admin/users/" + root.id + "/roles", adminToken)
        .set("If-Match", rootUser.headers.etag)
        .send({ roles: ["MEMBER"], reason: "Forbidden assignment" }),
      403,
      "AUTH_FORBIDDEN",
    );
    const memberUser = status(
      await api("get", "/api/v1/admin/users/" + member.id, rootToken),
      200,
    );
    const suspended = status(
      await api(
        "put",
        "/api/v1/admin/users/" + member.id + "/status",
        rootToken,
      )
        .set("If-Match", memberUser.headers.etag)
        .send({ status: "SUSPENDED", reason: "Integration suspension" }),
      200,
    );
    assert.equal(suspended.body.status, "SUSPENDED");
    checks++;
    problem(
      await api("get", "/api/v1/me", memberToken),
      401,
      "AUTH_SESSION_REVOKED",
    );
    await fixtures.query(
      "INSERT INTO movie.content_reports(reporter_user_id,title_id,category,message) VALUES ($1,$2,'METADATA','Private reporter message')",
      [member.id, titleId],
    );
    const reports = status(
      await api("get", "/api/v1/admin/reports", auditorToken),
      200,
    );
    assert.equal(reports.body.data[0].message, undefined);
    checks++;
    const logs = status(
      await api("get", "/api/v1/admin/audit-logs?limit=1", auditorToken),
      200,
    );
    status(
      await api(
        "get",
        "/api/v1/admin/audit-logs?limit=1&cursor=" +
          encodeURIComponent(logs.body.page.nextCursor),
        auditorToken,
      ),
      200,
    );
    assert.equal(JSON.stringify(logs.body).includes("passwordHash"), false);
    checks++;
    status(
      await api("get", "/api/v1/admin/metrics/summary", auditorToken),
      200,
    );
    const spec = status(await api("get", "/api/openapi.json", rootToken), 200);
    assert.ok(Object.keys(spec.body.paths).length >= 35);
    assert.ok(spec.body.components.schemas.CreateTitleDto);
    assert.equal(
      spec.body.paths["/api/v1/admin/titles"].post.security[0].bearer.length,
      0,
    );
    checks += 3;
    status(await api("get", "/api/openapi.json", memberToken), 200);
    const docsAgent = request.agent(server);
    status(await docsAgent.get("/api/docs"), 200);
    status(await docsAgent.get("/api/docs/swagger-ui.css"), 200);
    status(await docsAgent.get("/api/openapi.json"), 200);
    problem(
      await docsAgent.get("/api/v1/admin/titles"),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    status(await docsAgent.get("/api/docs-session"), 404);
    for (let retry = 0; retry < 2; retry++)
      status(
        await api("delete", "/api/v1/auth/sessions/current", auditorToken),
        204,
      );
    status(await docsAgent.get("/api/docs").set("Accept", "text/html"), 200);
    await fixtures.query("REVOKE INSERT ON movie.audit_logs FROM movie_api");
    try {
      problem(
        await api("post", "/api/v1/admin/titles", rootToken).send({
          kind: "SERIES",
          slug: "must-rollback",
          localizedTitle: "Audit rollback",
        }),
        503,
        "AUDIT_WRITE_UNAVAILABLE",
      );
    } finally {
      await fixtures.query("GRANT INSERT ON movie.audit_logs TO movie_api");
    }
    assert.equal(
      (
        await fixtures.query(
          "SELECT count(*)::int AS count FROM movie.titles WHERE slug='must-rollback'",
        )
      ).rows[0].count,
      0,
    );
    checks++;
    const refreshKey = randomUUID(),
      renewals = await Promise.all([
        api("post", "/api/v1/auth/token-renewals")
          .set("Idempotency-Key", refreshKey)
          .send({ refreshToken: rootRefresh }),
        api("post", "/api/v1/auth/token-renewals")
          .set("Idempotency-Key", refreshKey)
          .send({ refreshToken: rootRefresh }),
      ]);
    renewals.forEach((r) => status(r, 200));
    assert.equal(renewals[0].body.refreshToken, renewals[1].body.refreshToken);
    checks++;
    status(
      await api("post", "/api/v1/auth/token-renewals")
        .set("Idempotency-Key", refreshKey)
        .send({ refreshToken: renewals[0].body.refreshToken }),
      200,
    );
    problem(
      await api("post", "/api/v1/auth/token-renewals")
        .set("Idempotency-Key", randomUUID())
        .send({ refreshToken: rootRefresh }),
      409,
      "AUTH_REFRESH_RETRY_CONFLICT",
    );
    await fixtures.query(
      "UPDATE movie.auth_replay_receipts SET created_at=now()-interval '1 minute',credential_expires_at=now()-interval '1 second' WHERE input_refresh_token_id=(SELECT id FROM movie.refresh_tokens WHERE token_hash=$1)",
      [hash(rootRefresh)],
    );
    problem(
      await api("post", "/api/v1/auth/token-renewals")
        .set("Idempotency-Key", refreshKey)
        .send({ refreshToken: rootRefresh }),
      409,
      "IDEMPOTENCY_RESULT_EXPIRED",
    );
    const aged = await fixtures.query(
      "UPDATE movie.refresh_tokens SET consumed_at=now()-interval '31 seconds' WHERE token_hash=$1 RETURNING consumed_at",
      [hash(rootRefresh)],
    );
    assert.equal(aged.rowCount, 1);
    assert.ok(Date.now() - aged.rows[0].consumed_at.getTime() >= 30000);
    checks += 2;
    problem(
      await api("post", "/api/v1/auth/token-renewals")
        .set("Idempotency-Key", randomUUID())
        .send({ refreshToken: rootRefresh }),
      401,
      "AUTH_REFRESH_REUSED",
    );
    problem(
      await api("get", "/api/v1/me", rootToken),
      401,
      "AUTH_SESSION_REVOKED",
    );
    const unknown =
      "not-found-" + randomBytes(5).toString("hex") + "@example.test";
    for (let i = 0; i < 10; i++)
      status(
        await api("post", "/api/v1/auth/sessions").send({
          email: unknown,
          password: "invalid",
        }),
        401,
      );
    problem(
      await api("post", "/api/v1/auth/sessions").send({
        email: unknown,
        password: "invalid",
      }),
      429,
      "RATE_LIMITED",
    );
    const previousMode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const productionApp = await createApplication();
      try {
        status(
          await request(productionApp.app.getHttpServer()).get("/api/docs"),
          404,
        );
        status(
          await request(productionApp.app.getHttpServer()).get(
            "/api/openapi.json",
          ),
          404,
        );
      } finally {
        await productionApp.app.close();
      }
    } finally {
      process.env.NODE_ENV = previousMode;
    }
    const mfaPolicyChecks = await runMfaPolicyChecks({
      fixtures,
      server,
      seed,
    });
    checks += mfaPolicyChecks;
    const authSecurityChecks = await runAuthSecurityChecks({
      app,
      fixtures,
      seed,
    });
    checks += authSecurityChecks;
    const swaggerChecks = await runSwaggerChecks({ server });
    checks += swaggerChecks;
    const frontendChecks =
      process.env.PJ_FLIM_TEST_WEB === "true"
        ? await runFrontendChecks({ server, fixtures, seed })
        : 0;
    checks += frontendChecks;
    const liveTables = await fixtures.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE'",
    );
    assert.equal(liveTables.rows[0].count, 50);
    checks++;
    await mkdir(".local/api", { recursive: true });
    await writeFile(
      ".local/api/integration-result.json",
      JSON.stringify(
        {
          checks,
          encodingChecks,
          exceptionChecks,
          mfaPolicyChecks,
          authSecurityChecks,
          swaggerChecks,
          frontendChecks,
          viewerIncluded: true,
          viewerChecks,
          paginationChecks,
          workerIncluded: process.env.PJ_FLIM_TEST_WORKER === "true",
          database: "isolated temporary PostgreSQL",
          durationMs: Date.now() - started,
          passed: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        event: "integration.passed",
        checks,
        durationMs: Date.now() - started,
      }),
    );
  } finally {
    if (app) await app.close();
    if (owner) await owner.end();
    if (created) {
      if (!/^pj_flim_test_[a-f0-9]{12}$/.test(databaseName))
        throw new Error("Unsafe cleanup database name.");
      await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)');
    }
    await admin.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
