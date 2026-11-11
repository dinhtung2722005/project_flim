// Isolated, in-memory SQL checks. Requires an external @electric-sql/pglite install.
// node docs/design/sql/verify-movie-database.mjs <path-to-pglite-dist/index.js>
// No network, project database connection, persistent data or package edits here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
if (!modulePath)
  throw new Error("Provide path to @electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
let checks = 0;
const sqlFile = async (name) =>
  db.exec(await readFile(new URL(name, import.meta.url), "utf8"));
const scalar = async (sql, args = []) =>
  Object.values((await db.query(sql, args)).rows[0])[0];
async function rejects(sql, code, args = []) {
  await assert.rejects(db.query(sql, args), (error) => error.code === code);
  checks++;
}
async function equal(actual, expected) {
  assert.equal(await actual, expected);
  checks++;
}
try {
  await sqlFile("movie-database-schema.sql");
  await sqlFile("movie-database-rbac-seed.sql");
  await equal(
    scalar(
      "SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'movie' AND table_type = 'BASE TABLE'",
    ),
    47,
  );
  await equal(scalar("SELECT count(*)::int FROM movie.roles"), 5);
  await equal(scalar("SELECT count(*)::int FROM movie.permissions"), 18);
  await equal(
    scalar(
      "SELECT count(*)::int FROM movie.role_permissions rp JOIN movie.roles r ON r.id=rp.role_id WHERE r.code='MEMBER'",
    ),
    0,
  );
  await db.exec("SET search_path = movie, pg_catalog");
  const u1 = await scalar(
    "INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('a@example.test','fixture-hash','A') RETURNING id",
  );
  const u2 = await scalar(
    "INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('b@example.test','fixture-hash','B') RETURNING id",
  );
  await rejects(
    "INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('a@example.test','fixture','Duplicate')",
    "23505",
  );
  await rejects(
    "INSERT INTO users(email_normalized,password_hash,display_name) VALUES ('UPPER@example.test','fixture','Upper')",
    "23514",
  );
  const t1 = await scalar(
    "INSERT INTO titles(kind,slug,localized_title,normalized_title,created_by,updated_by) VALUES ('MOVIE','movie-one','Movie one','movie one',$1,$1) RETURNING id",
    [u1],
  );
  const t2 = await scalar(
    "INSERT INTO titles(kind,slug,localized_title,normalized_title,created_by,updated_by) VALUES ('SERIES','series-one','Series one','series one',$1,$1) RETURNING id",
    [u1],
  );
  const se1 = await scalar(
    "INSERT INTO seasons(title_id,number,is_technical) VALUES ($1,0,true) RETURNING id",
    [t1],
  );
  const se2 = await scalar(
    "INSERT INTO seasons(title_id,number) VALUES ($1,1) RETURNING id",
    [t2],
  );
  const e1 = await scalar(
    "INSERT INTO episodes(title_id,season_id,number,name) VALUES ($1,$2,1,'Full movie') RETURNING id",
    [t1, se1],
  );
  const e2 = await scalar(
    "INSERT INTO episodes(title_id,season_id,number,name) VALUES ($1,$2,1,'Episode 1') RETURNING id",
    [t2, se2],
  );
  await rejects(
    "INSERT INTO episodes(title_id,season_id,number,name) VALUES ($1,$2,2,'Wrong title')",
    "23503",
    [t1, se2],
  );
  await rejects(
    "INSERT INTO episodes(title_id,season_id,number,name) VALUES ($1,$2,1,'Duplicate')",
    "23505",
    [t1, se1],
  );
  const asset = async (episode, n, publicId) =>
    scalar(
      "INSERT INTO video_assets(episode_id,internal_version,public_id,delivery_type) VALUES ($1,$2,$3,'authenticated') RETURNING id",
      [episode, n, publicId],
    );
  const a1 = await asset(e1, 1, "fixtures/movie/v1");
  const a2 = await asset(e1, 2, "fixtures/movie/v2");
  const other = await asset(e2, 1, "fixtures/series/v1");
  await rejects("UPDATE episodes SET active_asset_id=$1 WHERE id=$2", "23503", [
    other,
    e1,
  ]);
  await rejects(
    "UPDATE episodes SET publication_status='PUBLISHED', published_at=now() WHERE id=$1",
    "23514",
    [e1],
  );
  await rejects(
    "UPDATE video_assets SET processing_status='READY' WHERE id=$1",
    "23514",
    [a1],
  );
  await rejects(
    "UPDATE video_assets SET duration_seconds='NaN'::numeric WHERE id=$1",
    "23514",
    [a1],
  );
  await rejects(
    "INSERT INTO source_backups(asset_id,storage_provider,bucket,object_key,status) VALUES ($1,'S3','private','fixture','VERIFIED')",
    "23514",
    [a1],
  );
  const op = await scalar(
    "INSERT INTO operations(owner_user_id,principal_scope,type) VALUES ($1,'user:fixture','MEDIA_PROCESS') RETURNING id",
    [u1],
  );
  const attempt = await scalar(
    "INSERT INTO media_attempts(asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash) VALUES ($1,$2,'v1','config-a','VERIFYING_OUTPUT',1,'context-a') RETURNING id",
    [a1, op],
  );
  await rejects(
    "INSERT INTO media_attempts(asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash) VALUES ($1,$2,'v1','config-a','RECONCILING',2,'context-b')",
    "23505",
    [a1, op],
  );
  await rejects(
    "UPDATE video_assets SET current_attempt_id=$1 WHERE id=$2",
    "23503",
    [attempt, a2],
  );
  await db.query("UPDATE video_assets SET current_attempt_id=$1 WHERE id=$2", [
    attempt,
    a1,
  ]);
  const playSql =
    "INSERT INTO playback_sessions(user_id,guest_id_hash,episode_id,asset_id,asset_version,resume_generation,management_token_hash,telemetry_token_hash,expires_at,max_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '1 hour',now()+interval '4 hours') RETURNING id";
  await rejects(playSql, "23514", [
    null,
    null,
    e1,
    a1,
    1,
    null,
    "m-none",
    "t-none",
  ]);
  await rejects(playSql, "23514", [
    u1,
    "guest",
    e1,
    a1,
    1,
    1,
    "m-both",
    "t-both",
  ]);
  await rejects(playSql, "23503", [
    u1,
    null,
    e1,
    a1,
    9,
    1,
    "m-bad-version",
    "t-bad-version",
  ]);
  await rejects(playSql, "23514", [
    u1,
    null,
    e1,
    a1,
    1,
    1,
    "same-token",
    "same-token",
  ]);
  const s1 = await scalar(playSql, [u1, null, e1, a1, 1, 1, "m-one", "t-one"]);
  await db.query(
    "INSERT INTO resume_heads(user_id,episode_id) VALUES ($1,$2)",
    [u1, e1],
  );
  await db.query(
    "UPDATE resume_heads SET generation=1,active_session_id=$1 WHERE user_id=$2 AND episode_id=$3",
    [s1, u1, e1],
  );
  await db.query(
    "INSERT INTO resume_heads(user_id,episode_id) VALUES ($1,$2)",
    [u2, e1],
  );
  await rejects(
    "UPDATE resume_heads SET generation=1,active_session_id=$1 WHERE user_id=$2 AND episode_id=$3",
    "23503",
    [s1, u2, e1],
  );
  await db.query(
    "INSERT INTO watch_progress(user_id,episode_id,session_id,asset_id,asset_version,resume_generation,last_sequence,position_seconds) VALUES ($1,$2,$3,$4,1,1,10,95)",
    [u1, e1, s1, a1],
  );
  await rejects(
    "UPDATE watch_progress SET user_id=$1 WHERE user_id=$2 AND episode_id=$3",
    "23503",
    [u2, u1, e1],
  );
  const s2 = await scalar(playSql, [u1, null, e1, a2, 2, 2, "m-two", "t-two"]);
  await db.query(
    "UPDATE resume_heads SET generation=2,active_session_id=$1 WHERE user_id=$2 AND episode_id=$3",
    [s2, u1, e1],
  );
  const fencedProgress = `UPDATE watch_progress p
    SET session_id=$3,asset_id=$4,asset_version=$5,resume_generation=$6,last_sequence=$7,position_seconds=$8,updated_at=now()
    FROM resume_heads h
    WHERE p.user_id=$1 AND p.episode_id=$2 AND h.user_id=p.user_id AND h.episode_id=p.episode_id
      AND h.active_session_id=$3 AND h.generation=$6
      AND (p.resume_generation<$6 OR (p.resume_generation=$6 AND p.session_id=$3 AND p.last_sequence<$7))
    RETURNING p.position_seconds`;
  await equal(
    db
      .query(fencedProgress, [u1, e1, s1, a1, 1, 1, 11, 99])
      .then((r) => r.rows.length),
    0,
  );
  await equal(
    db
      .query(fencedProgress, [u1, e1, s2, a2, 2, 2, 1, 10])
      .then((r) => Number(r.rows[0].position_seconds)),
    10,
  );
  await equal(
    db
      .query(fencedProgress, [u1, e1, s2, a2, 2, 2, 1, 90])
      .then((r) => r.rows.length),
    0,
  );
  await equal(
    db
      .query(fencedProgress, [u1, e1, s2, a2, 2, 2, 2, 5])
      .then((r) => Number(r.rows[0].position_seconds)),
    5,
  );
  const auth = await scalar(
    "INSERT INTO auth_sessions(user_id,state,auth_version,idle_expires_at,absolute_expires_at) VALUES ($1,'ACTIVE',1,now()+interval '1 hour',now()+interval '8 hours') RETURNING id",
    [u1],
  );
  const family = await scalar("SELECT gen_random_uuid()");
  const rt1 = await scalar(
    "INSERT INTO refresh_tokens(session_id,family_id,generation,token_hash,expires_at) VALUES ($1,$2,1,'refresh-hash-one',now()+interval '1 day') RETURNING id",
    [auth, family],
  );
  await rejects(
    "INSERT INTO refresh_tokens(session_id,family_id,generation,token_hash,expires_at) VALUES ($1,$2,2,'refresh-hash-conflict',now()+interval '1 day')",
    "23505",
    [auth, family],
  );
  await db.query("UPDATE refresh_tokens SET consumed_at=now() WHERE id=$1", [
    rt1,
  ]);
  const rt2 = await scalar(
    "INSERT INTO refresh_tokens(session_id,family_id,generation,token_hash,expires_at) VALUES ($1,$2,2,'refresh-hash-two',now()+interval '1 day') RETURNING id",
    [auth, family],
  );
  await db.query("UPDATE refresh_tokens SET replaced_by_id=$1 WHERE id=$2", [
    rt2,
    rt1,
  ]);
  const idempotency =
    "INSERT INTO idempotency_records(actor_scope,method,route_key,request_key_hash,request_fingerprint,expires_at) VALUES ($1,'POST','/api/v1/playback-sessions','request-key','body-hash',now()+interval '1 day')";
  await db.query(idempotency, ["user:a"]);
  await rejects(idempotency, "23505", ["user:a"]);
  await db.query(idempotency, ["user:b"]);
  const job = await scalar(
    "INSERT INTO job_runs(handler,logical_key,lease_token) VALUES ('fixture','asset:fixture:process',2) RETURNING id",
  );
  await equal(
    db
      .query(
        "UPDATE job_runs SET state='SUCCEEDED',completed_at=now() WHERE id=$1 AND lease_token=1 RETURNING id",
        [job],
      )
      .then((r) => r.rows.length),
    0,
  );
  await equal(
    db
      .query(
        "UPDATE job_runs SET state='SUCCEEDED',completed_at=now() WHERE id=$1 AND lease_token=2 RETURNING id",
        [job],
      )
      .then((r) => r.rows.length),
    1,
  );
  await db.exec(
    "CREATE ROLE movie_api NOLOGIN; CREATE ROLE movie_worker NOLOGIN; CREATE ROLE movie_auditor NOLOGIN; CREATE ROLE movie_retention NOLOGIN;",
  );
  await sqlFile("movie-database-grants.sql");
  await db.exec("SET ROLE movie_api");
  await db.query(
    "INSERT INTO audit_logs(actor_user_id,actor_kind,action,resource_type,resource_id,outcome) VALUES ($1,'USER','fixture.created','title',$2,'SUCCESS')",
    [u1, t1],
  );
  await rejects("UPDATE audit_logs SET reason='tampered'", "42501");
  await rejects("DELETE FROM audit_logs", "42501");
  await rejects("TRUNCATE audit_logs", "42501");
  await rejects("UPDATE permissions SET description='tampered'", "42501");
  await rejects("CREATE TABLE movie.runtime_owned(id integer)", "42501");
  // The grant for row locking must actually allow the locking query.
  await db.exec(
    "BEGIN; SELECT key FROM policy_locks WHERE key='super_admin_roster' FOR UPDATE; ROLLBACK;",
  );
  checks++;
  await db.exec("RESET ROLE; SET ROLE movie_worker");
  await rejects("SELECT password_hash FROM users", "42501");
  await rejects("SELECT encrypted_secret FROM mfa_factors", "42501");
  await rejects("DELETE FROM audit_logs", "42501");
  await db.exec("RESET ROLE; SET ROLE movie_auditor");
  await equal(scalar("SELECT count(*)::int FROM audit_logs"), 1);
  await rejects(
    "INSERT INTO audit_logs(actor_kind,action,resource_type,resource_id,outcome) VALUES ('SYSTEM','fixture','title','fixture','SUCCESS')",
    "42501",
  );
  await db.exec("RESET ROLE; SET ROLE movie_retention");
  await db.query("DELETE FROM audit_logs WHERE action='fixture.created'");
  await db.exec("RESET ROLE");
  await equal(scalar("SELECT count(*)::int FROM audit_logs"), 0);
  console.log(
    JSON.stringify(
      {
        engine: await scalar("SELECT version()"),
        checks,
        tables: 47,
        roles: 5,
        permissions: 18,
        rolePermissionLinks: await scalar(
          "SELECT count(*)::int FROM role_permissions",
        ),
        limitation:
          "Single connection; no concurrency, load, real-server deployment or production-readiness claim.",
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
