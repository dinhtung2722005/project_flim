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
  await mkdir(".local/catalog-batches", { recursive: true });
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

    async function role(code: string) {
      const actor = await seed();
      await f!.query(
        "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code=$2",
        [actor.id, code],
      );
      return actor;
    }
    const staff = await role("ADMIN"),
      other = await role("ADMIN"),
      editor = await role("EDITOR"),
      auditor = await role("AUDITOR");
    const g1 = randomUUID(),
      g2 = randomUUID();
    for (const [id, label] of [
      [g1, "Thể loại một"],
      [g2, "Thể loại hai"],
    ])
      await f!.query(
        "INSERT INTO movie.genres(id,slug,name) VALUES($1::uuid,$1::text,$2)",
        [id, label],
      );
    const film = await fixture("Batch A <img src=x onerror=alert(1)>"),
      film2 = await fixture("Batch B"),
      draft = await fixture("Batch Draft", false),
      archived = await fixture("Batch Archived");
    await f!.query(
      "UPDATE movie.titles SET publication_status='ARCHIVED' WHERE id=$1",
      [archived.titleId],
    );
    const base = "/admin/catalog-batches";
    const params = (
      ids: string[] = [film.titleId],
      action = "ADD_GENRES",
      genres: string[] = [g1],
    ) => ({
      action,
      titleIds: ids,
      reason: "  Kiểm tra hàng loạt  ",
      ...(["ADD_GENRES", "REPLACE_GENRES"].includes(action)
        ? { genreIds: genres }
        : {}),
    });
    const preview = (body: any, user = staff) =>
      api("post", base + "/previews", user.token).send(body);
    const run = (p: any, user = staff, tag = p.headers.etag) => {
      let r = api(
        "post",
        base + "/" + p.body.id + "/execution",
        user.token,
      ).send({ confirm: true });
      if (tag) r = r.set("If-Match", tag);
      return r;
    };
    const read = (id: string, user = staff) =>
      api("get", base + "/" + id, user.token);
    const snapshot = async () =>
      (
        await f!.query(
          "SELECT (SELECT count(*) FROM movie.outbox_events)::text outbox,(SELECT jsonb_agg(jsonb_build_array(id,version,publication_status) ORDER BY id) FROM movie.titles) titles,(SELECT jsonb_agg(jsonb_build_array(title_id,genre_id) ORDER BY title_id,genre_id) FROM movie.title_genres) genres",
        )
      ).rows[0];
    const genres = async (id: string) =>
      (
        await f!.query(
          "SELECT genre_id::text id FROM movie.title_genres WHERE title_id=$1 ORDER BY genre_id",
          [id],
        )
      ).rows.map((r) => r.id);
    const version = async (id: string) =>
      String(
        (await f!.query("SELECT version FROM movie.titles WHERE id=$1", [id]))
          .rows[0].version,
      );
    await expect(api("get", base), 401);
    for (const user of [a, auditor]) {
      await expect(api("get", base, user.token), 403);
      await expect(preview(params(), user), 403);
    }
    for (const action of ["PUBLISH", "UNPUBLISH"])
      await expect(preview(params(undefined, action), editor), 403);
    for (const invalid of [
      { ...params(), titleIds: [] },
      { ...params(), titleIds: Array.from({ length: 21 }, () => randomUUID()) },
      { ...params(), titleIds: [film.titleId, film.titleId.toUpperCase()] },
      { ...params(), titleIds: ["bad-id"] },
      { ...params(), reason: "  " },
      { ...params(), reason: "a".repeat(501) },
      { ...params(), action: "DELETE" },
      { ...params(), genreIds: [] },
      { ...params(), genreIds: undefined },
      { ...params(), genreIds: [g1, g1.toUpperCase()] },
      { ...params(), genreIds: Array.from({ length: 31 }, () => randomUUID()) },
      { ...params(), ownerUserId: staff.id },
      { ...params(undefined, "PUBLISH"), genreIds: [g1] },
    ])
      await expect(preview(invalid), 422, "VALIDATION_FAILED");
    await expect(preview(params(undefined, "ADD_GENRES", [randomUUID()])), 404);
    const before = await snapshot(),
      p = await expect(
        preview(params([film.titleId.toUpperCase(), film2.titleId])),
        201,
      );
    eq(await snapshot(), before);
    eq(p.body.reason, "Kiểm tra hàng loạt");
    eq(p.body.counts.ready, 2);
    eq(p.body.sameSession, true);
    eq(p.headers.location, "/api/v1" + base + "/" + p.body.id);
    ok(p.headers.etag);
    ok(p.headers["cache-control"].includes("no-store"));
    ok(!JSON.stringify(p.body).includes(staff.sid));
    ok(!("ownerUserId" in p.body));
    await expect(run(p, other), 404);
    await expect(read(p.body.id, other), 404);
    const secondSid = randomUUID();
    await f!.query(
      "INSERT INTO movie.auth_sessions(id,user_id,state,auth_version,idle_expires_at,absolute_expires_at) VALUES($1,$2,'ACTIVE',1,now()+interval '1 hour',now()+interval '2 hours')",
      [secondSid, staff.id],
    );
    const anotherSession = {
      ...staff,
      token: auth.sign({
        sub: staff.id,
        sid: secondSid,
        av: "1",
        kind: "access",
      }),
    };
    eq(
      (await expect(read(p.body.id, anotherSession), 200)).body.sameSession,
      false,
    );
    await expect(run(p, anotherSession), 409);
    await expect(run(p, staff, ""), 428);
    await expect(run(p, staff, '"wrong"'), 412);
    await expect(
      api("post", base + "/" + p.body.id + "/execution", staff.token)
        .set("If-Match", p.headers.etag)
        .send({ confirm: false }),
      422,
    );
    await expect(
      api("post", base + "/" + p.body.id + "/execution", staff.token)
        .set("If-Match", p.headers.etag)
        .send({ confirm: true, genreIds: [g2] }),
      422,
    );
    const completed = await expect(run(p), 200);
    eq(completed.body.state, "COMPLETED");
    eq(completed.body.counts.applied, 2);
    eq(await genres(film.titleId), [g1]);
    eq(await genres(film2.titleId), [g1]);
    const stable = await snapshot(),
      batchAudit = Number(
        (
          await f!.query(
            "SELECT count(*) n FROM movie.audit_logs WHERE resource_id=$1",
            [p.body.id],
          )
        ).rows[0].n,
      );
    eq((await expect(run(p), 200)).body.version, completed.body.version);
    eq(await snapshot(), stable);
    eq(
      Number(
        (
          await f!.query(
            "SELECT count(*) n FROM movie.audit_logs WHERE resource_id=$1",
            [p.body.id],
          )
        ).rows[0].n,
      ),
      batchAudit,
    );
    const addition = await expect(
      preview(params([film.titleId], "ADD_GENRES", [g2]), editor),
      201,
    );
    await expect(run(addition, editor), 200);
    eq(await genres(film.titleId), [g1, g2].sort());
    const replacement = await expect(
      preview(params([film.titleId], "REPLACE_GENRES", [g2])),
      201,
    );
    await expect(run(replacement), 200);
    eq(await genres(film.titleId), [g2]);
    const unchanged = await expect(
      preview(params([film.titleId], "ADD_GENRES", [g2])),
      201,
    );
    eq(unchanged.body.counts.unchanged, 1);
    await expect(run(unchanged), 409);
    const unknown = await expect(preview(params([randomUUID()])), 201);
    eq(unknown.body.items[0].code, "RESOURCE_NOT_FOUND");
    await expect(run(unknown), 409);
    const blocked = await expect(
      preview(
        params([draft.titleId, archived.titleId, film.titleId], "PUBLISH"),
      ),
      201,
    );
    eq(blocked.body.counts.blocked, 2);
    eq(blocked.body.counts.unchanged, 1);
    await expect(run(blocked), 409);
    await f!.query(
      "UPDATE movie.titles SET publication_status='DRAFT',version=version+1 WHERE id=$1",
      [film.titleId],
    );
    const pub = await expect(preview(params([film.titleId], "PUBLISH")), 201);
    eq(pub.body.counts.ready, 1);
    await expect(run(pub), 200);
    eq(
      (
        await f!.query(
          "SELECT publication_status FROM movie.titles WHERE id=$1",
          [film.titleId],
        )
      ).rows[0].publication_status,
      "PUBLISHED",
    );
    const hide = await expect(
      preview(params([film.titleId], "UNPUBLISH")),
      201,
    );
    await expect(run(hide), 200);
    eq(
      (
        await f!.query(
          "SELECT publication_status FROM movie.episodes WHERE id=$1",
          [film.episodeId],
        )
      ).rows[0].publication_status,
      "PUBLISHED",
    );
    // Stale title snapshot fails only the affected item; never refresh the expected film version.
    const partial = await expect(
      preview(params([film.titleId, film2.titleId], "REPLACE_GENRES", [g1])),
      201,
    );
    await f!.query("UPDATE movie.titles SET version=version+1 WHERE id=$1", [
      film.titleId,
    ]);
    const partialResult = await expect(run(partial), 200);
    eq(partialResult.body.counts.failed, 1);
    eq(partialResult.body.counts.unchanged, 1);
    eq(partialResult.body.items[0].code, "RESOURCE_VERSION_MISMATCH");
    eq(await genres(film.titleId), [g2]);
    const partialApply = await expect(
      preview(params([film.titleId, film2.titleId], "REPLACE_GENRES", [g2])),
      201,
    );
    // film is unchanged; make film2 stale and verify no overwrite.
    await f!.query("UPDATE movie.titles SET version=version+1 WHERE id=$1", [
      film2.titleId,
    ]);
    eq((await expect(run(partialApply), 200)).body.counts.failed, 1);
    // A ready video becomes unusable after preview.
    const changedMedia = await expect(
      preview(params([film.titleId], "PUBLISH")),
      201,
    );
    await f!.query(
      "UPDATE movie.video_assets SET processing_status='FAILED' WHERE id=$1",
      [film.assetId],
    );
    const mediaResult = await expect(run(changedMedia), 200);
    eq(mediaResult.body.items[0].code, "CATALOG_NO_PLAYABLE_EPISODE");
    eq(
      (
        await f!.query(
          "SELECT publication_status FROM movie.titles WHERE id=$1",
          [film.titleId],
        )
      ).rows[0].publication_status,
      "UNPUBLISHED",
    );
    await f!.query(
      "UPDATE movie.video_assets SET processing_status='READY' WHERE id=$1",
      [film.assetId],
    );
    const expired = await expect(preview(params()), 201);
    await f!.query(
      "UPDATE movie.catalog_batches SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.body.id],
    );
    eq((await expect(read(expired.body.id), 200)).body.expired, true);
    await expect(run(expired), 409);
    const revoked = await expect(
      preview(params([film2.titleId], "REPLACE_GENRES", [g2]), editor),
      201,
    );
    await f!.query(
      "DELETE FROM movie.user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM movie.roles WHERE code='EDITOR')",
      [editor.id],
    );
    await expect(run(revoked, editor), 403);
    await f!.query(
      "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1,id FROM movie.roles WHERE code='EDITOR'",
      [editor.id],
    );
    // Audit failure rolls back title, genre changes, outbox AND receipt. The RUNNING marker remains resumable.
    const interrupted = await expect(
        preview(params([film2.titleId], "REPLACE_GENRES", [g2])),
        201,
      ),
      rollback = await snapshot();
    await f!.query(
      "CREATE FUNCTION movie.test_batch_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='catalog.batch.item.applied' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_batch_audit_failure BEFORE INSERT ON movie.audit_logs FOR EACH ROW EXECUTE FUNCTION movie.test_batch_audit_failure()",
    );
    await expect(run(interrupted), 503, "AUDIT_WRITE_UNAVAILABLE");
    eq(await snapshot(), rollback);
    const pending = await expect(read(interrupted.body.id), 200);
    eq(pending.body.state, "RUNNING");
    eq(pending.body.items[0].state, "READY");
    await f!.query(
      "DROP TRIGGER test_batch_audit_failure ON movie.audit_logs;DROP FUNCTION movie.test_batch_audit_failure()",
    );
    const recovered = await expect(run(interrupted), 200);
    eq(recovered.body.counts.applied, 1);
    eq(await genres(film2.titleId), [g2]);
    // Parallel replay may interleave between items, but never duplicates a committed item.
    const concurrent = await expect(
        preview(params([film.titleId, film2.titleId], "REPLACE_GENRES", [g1])),
        201,
      ),
      v1 = BigInt(await version(film.titleId)),
      v2 = BigInt(await version(film2.titleId));
    const both = await Promise.all([run(concurrent), run(concurrent)]);
    both.forEach((r) => eq(r.status, 200));
    eq(BigInt(await version(film.titleId)), v1 + 1n);
    eq(BigInt(await version(film2.titleId)), v2 + 1n);
    eq((await expect(read(concurrent.body.id), 200)).body.counts.applied, 2);
    const page1 = await expect(api("get", base + "?limit=2", staff.token), 200);
    eq(page1.body.data.length, 2);
    ok(page1.body.page.nextCursor);
    const page2 = await expect(
      api(
        "get",
        base +
          "?limit=2&cursor=" +
          encodeURIComponent(page1.body.page.nextCursor),
        staff.token,
      ),
      200,
    );
    eq(
      new Set([...page1.body.data, ...page2.body.data].map((r: any) => r.id))
        .size,
      4,
    );
    await expect(
      api(
        "get",
        base +
          "?state=COMPLETED&cursor=" +
          encodeURIComponent(page1.body.page.nextCursor),
        staff.token,
      ),
      400,
    );
    await expect(
      api(
        "get",
        base + "?cursor=" + encodeURIComponent(page1.body.page.nextCursor),
        other.token,
      ),
      400,
    );
    eq((await expect(api("get", base, other.token), 200)).body.data.length, 0);
    // Upper bound and combined genre cardinality.
    const manyIds = Array.from({ length: 20 }, () => randomUUID());
    eq((await expect(preview(params(manyIds)), 201)).body.items.length, 20);
    const allGenres = Array.from({ length: 30 }, () => randomUUID());
    for (const id of allGenres)
      await f!.query(
        "INSERT INTO movie.genres(id,slug,name) VALUES($1::uuid,$1::text,'Cardinality fixture')",
        [id],
      );
    await f!.query("DELETE FROM movie.title_genres WHERE title_id=$1", [
      draft.titleId,
    ]);
    for (const id of allGenres)
      await f!.query(
        "INSERT INTO movie.title_genres(title_id,genre_id) VALUES($1,$2)",
        [draft.titleId, id],
      );
    eq(
      (await expect(preview(params([draft.titleId])), 201)).body.items[0].code,
      "VALIDATION_FAILED",
    );

    // One stale item must not prevent another valid item from applying.
    const mixed = await expect(
      preview(params([film.titleId, film2.titleId], "REPLACE_GENRES", [g2])),
      201,
    );
    await f!.query("UPDATE movie.titles SET version=version+1 WHERE id=$1", [
      film.titleId,
    ]);
    const mixedResult = await expect(run(mixed), 200);
    eq(mixedResult.body.counts.failed, 1);
    eq(mixedResult.body.counts.applied, 1);
    eq(await genres(film.titleId), [g1]);
    eq(await genres(film2.titleId), [g2]);
    // Commit first item, simulate interruption on second, resume without repeating first.
    const interruptedPair = await expect(
      preview(
        params(
          [film.titleId, film2.titleId],
          "REPLACE_GENRES",
          allGenres.slice(0, 1),
        ),
      ),
      201,
    );
    const firstVersion = BigInt(await version(film.titleId)),
      secondVersion = BigInt(await version(film2.titleId));
    await f!.query(
      "CREATE FUNCTION movie.test_pair_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='catalog.batch.item.applied' AND NEW.safe_diff->>'titleId'='" +
        film2.titleId +
        "' THEN RAISE EXCEPTION 'fixture second item'; END IF; RETURN NEW; END $$;CREATE TRIGGER test_pair_audit_failure BEFORE INSERT ON movie.audit_logs FOR EACH ROW EXECUTE FUNCTION movie.test_pair_audit_failure()",
    );
    await expect(run(interruptedPair), 503, "AUDIT_WRITE_UNAVAILABLE");
    const half = await expect(read(interruptedPair.body.id), 200);
    eq(half.body.state, "RUNNING");
    eq(half.body.counts.applied, 1);
    eq(half.body.counts.ready, 1);
    eq(BigInt(await version(film.titleId)), firstVersion + 1n);
    eq(BigInt(await version(film2.titleId)), secondVersion);
    await f!.query(
      "DROP TRIGGER test_pair_audit_failure ON movie.audit_logs;DROP FUNCTION movie.test_pair_audit_failure()",
    );
    const resumed = await expect(run(interruptedPair), 200);
    eq(resumed.body.counts.applied, 2);
    eq(BigInt(await version(film.titleId)), firstVersion + 1n);
    eq(BigInt(await version(film2.titleId)), secondVersion + 1n);
    const reset = await expect(
      preview(params([film.titleId, film2.titleId], "REPLACE_GENRES", [g1])),
      201,
    );
    await expect(run(reset), 200);

    // Browser: real login, immutable preview, explicit execution and history. No film writes before confirmation.
    await app.listen(0, "127.0.0.1");
    const origin = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({
      executablePath:
        process.env.PJ_FLIM_CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    const ctx = await browser.newContext({
        baseURL: origin,
        viewport: { width: 1440, height: 1000 },
      }),
      page = await ctx.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(e.name));
    const bc = async (p: Promise<any>) => {
      await p;
      checks++;
      browserChecks++;
    };
    async function login(page: any, user: any) {
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(user.email);
      await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
      await page
        .getByRole("button", { name: "Đăng nhập", exact: true })
        .click();
      await page.waitForURL((u: URL) => u.pathname !== "/login");
    }
    await login(page, staff);
    await page.goto("/admin/titles");
    await page
      .getByRole("checkbox", { name: "Chọn phim Batch B", exact: true })
      .check();
    const tools = page.getByRole("region", { name: "Xử lý phim hàng loạt" });
    await bc(browserExpect(tools).toBeVisible());
    await tools
      .getByLabel("Thao tác hàng loạt", { exact: true })
      .selectOption("REPLACE_GENRES");
    await tools
      .getByRole("checkbox", { name: "Thể loại hai", exact: true })
      .check();
    await tools
      .getByLabel("Lý do thay đổi hàng loạt", { exact: true })
      .fill("Cập nhật từ trình duyệt");
    const browserBefore = await snapshot();
    await tools
      .getByRole("button", { name: "Xem trước thay đổi", exact: true })
      .click();
    await bc(
      browserExpect(
        tools.getByRole("button", { name: "Xác nhận thực hiện", exact: true }),
      ).toBeVisible(),
    );
    eq(await snapshot(), browserBefore);
    await bc(browserExpect(tools.locator("tbody")).toContainText("Sẵn sàng"));
    await tools
      .getByRole("button", { name: "Xác nhận thực hiện", exact: true })
      .click();
    await bc(browserExpect(tools.locator("tbody")).toContainText("Đã áp dụng"));
    eq(await genres(film2.titleId), [g2]);
    await tools
      .getByRole("link", { name: "Xem trong lịch sử xử lý", exact: true })
      .click();
    await bc(
      browserExpect(
        page.getByRole("heading", {
          name: "Lịch sử xử lý hàng loạt",
          exact: true,
        }),
      ).toBeVisible(),
    );
    await bc(
      browserExpect(page.locator(".batch-receipt")).toContainText(
        "Cập nhật từ trình duyệt",
      ),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: ".local/catalog-batches/history-mobile.png",
      fullPage: true,
    });
    const ec = await browser.newContext({ baseURL: origin }),
      ep = await ec.newPage();
    await login(ep, editor);
    await ep.goto("/admin/titles");
    await ep
      .getByRole("checkbox", { name: "Chọn phim Batch B", exact: true })
      .check();
    const options = await ep
      .getByLabel("Thao tác hàng loạt", { exact: true })
      .locator("option")
      .evaluateAll((list: any[]) => list.map((e) => e.value));
    eq(options.sort(), ["ADD_GENRES", "REPLACE_GENRES"]);
    await ep
      .getByRole("checkbox", {
        name: "Chọn phim Batch A <img src=x onerror=alert(1)>",
        exact: true,
      })
      .check();
    eq(await ep.locator(".table-movie img").count(), 0);
    eq(errors, []);
    await ec.close();
    await ctx.close();
    const adminOps = Object.entries(result.document.paths)
      .filter(([p]) => p.startsWith("/api/v1/admin/"))
      .reduce(
        (n, [, v]) =>
          n +
          Object.keys(v!).filter((k) =>
            ["get", "post", "put", "patch", "delete"].includes(k),
          ).length,
        0,
      );
    eq(adminOps, 66);
    ok(
      !result.document.paths["/api/v1/admin/catalog-batches/{id}/execution"]!
        .post!.responses["201"],
    );
    ok(result.document.components!.schemas!.CatalogBatch);
    const report = {
      passed: true,
      checks,
      browserChecks,
      database: "isolated disposable PostgreSQL",
      schemaTables: 59,
      realUserDataChanged: false,
    };
    await writeFile(
      ".local/catalog-batches/integration-result.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        event: "catalog-batches.integration.passed",
        ...report,
      }),
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
      event: "catalog-batches.integration.failed",
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
