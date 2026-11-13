import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { NotificationsService } from "../apps/api/src/services/notifications.service";
import { privateHash } from "../apps/api/src/viewer-common";
import { hash } from "../apps/api/src/common";
export async function runViewerIntegration(c: {
  api: any;
  fixtures: any;
  app: any;
  rootId: string;
  rootToken: string;
  memberToken: string;
}) {
  let checks = 0;
  const expect = async (req: any, status: number, code?: string) => {
    const r = await req;
    assert.equal(r.status, status, JSON.stringify({ status, body: r.body }));
    checks++;
    if (code) {
      assert.equal(r.body.code, code);
      checks++;
    }
    return r;
  };
  const ok = (value: unknown) => {
    assert.ok(value);
    checks++;
  };
  const eq = (a: unknown, b: unknown) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const api = c.api,
    f = c.fixtures;
  async function fixture(name: string, published = true) {
    const titleId = randomUUID(),
      seasonId = randomUUID(),
      episodeId = randomUUID(),
      assetId = randomUUID(),
      attemptId = randomUUID(),
      operationId = randomUUID();
    await f.query(
      "INSERT INTO movie.titles(id,kind,slug,localized_title,normalized_title,release_year,country_codes,created_by,updated_by,publication_status,published_at) VALUES ($1,'SERIES',$2,$3,$4,2026,ARRAY['VN'],$5,$5,$6,CASE WHEN $6='PUBLISHED' THEN now() ELSE NULL END)",
      [
        titleId,
        "viewer-" + titleId,
        name,
        name.toLowerCase(),
        c.rootId,
        published ? "PUBLISHED" : "DRAFT",
      ],
    );
    await f.query(
      "INSERT INTO movie.seasons(id,title_id,number,name) VALUES ($1,$2,1,'Season 1')",
      [seasonId, titleId],
    );
    await f.query(
      "INSERT INTO movie.episodes(id,title_id,season_id,number,name) VALUES ($1,$2,$3,1,'Episode 1')",
      [episodeId, titleId, seasonId],
    );
    await f.query(
      "INSERT INTO movie.video_assets(id,episode_id,internal_version,provider_asset_id,public_id,provider_version,delivery_type,processing_status,backup_status,duration_seconds,bytes,source_format) VALUES ($1,$2,1,$3,$3,'1234','authenticated','READY','VERIFIED',100,100,'mp4')",
      [assetId, episodeId, "test/" + assetId],
    );
    await f.query(
      "INSERT INTO movie.operations(id,owner_user_id,principal_scope,type) VALUES ($1,$2,'test','MEDIA_PROCESS')",
      [operationId, c.rootId],
    );
    await f.query(
      "INSERT INTO movie.media_attempts(id,asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash,completed_at) VALUES ($1,$2,$3,'hls-hd-v1','viewer','SUCCEEDED',1,$4,now())",
      [attemptId, assetId, operationId, randomUUID()],
    );
    await f.query(
      "UPDATE movie.video_assets SET current_attempt_id=$2 WHERE id=$1",
      [assetId, attemptId],
    );
    await f.query(
      "INSERT INTO movie.media_outputs(attempt_id,format,profile_version,config_hash,status,manifest_ref,verified_at,rendition_summary) VALUES ($1,'HLS','hls-hd-v1','viewer','READY','test/manifest',now(),'[{\"height\":720}]')",
      [attemptId],
    );
    await f.query(
      "INSERT INTO movie.source_backups(asset_id,storage_provider,bucket,object_key,sha256,bytes,status,verified_at,source_manifest_ref,object_version) VALUES ($1,'S3','test',$2,$3,100,'VERIFIED',now(),'test/manifest','v1')",
      [assetId, assetId, "0".repeat(64)],
    );
    await f.query(
      "UPDATE movie.episodes SET active_asset_id=$2,publication_status=$3,published_at=CASE WHEN $3='PUBLISHED' THEN now() ELSE NULL END WHERE id=$1",
      [episodeId, assetId, published ? "PUBLISHED" : "DRAFT"],
    );
    return { titleId, seasonId, episodeId, assetId };
  }
  const visible = await fixture("Viewer Alpha"),
    second = await fixture("Viewer Beta"),
    hidden = await fixture("Viewer Secret", false);
  const genreId = randomUUID();
  await f.query(
    "INSERT INTO movie.genres(id,slug,name) VALUES ($1,$2,'Viewer genre')",
    [genreId, "viewer-" + genreId],
  );
  await f.query(
    "INSERT INTO movie.title_genres(title_id,genre_id) VALUES ($1,$3),($2,$3)",
    [visible.titleId, second.titleId, genreId],
  );
  await f.query(
    "INSERT INTO movie.title_aliases(title_id,alias,normalized_alias) VALUES ($1,'Bi danh','bi danh')",
    [visible.titleId],
  );
  let r = await expect(api("get", "/api/v1/titles?q=viewer&limit=1"), 200);
  eq(r.body.data.length, 1);
  ok(r.body.page.nextCursor);
  const firstId = r.body.data[0].id,
    cursor = r.body.page.nextCursor;
  r = await expect(
    api(
      "get",
      "/api/v1/titles?q=viewer&limit=1&cursor=" + encodeURIComponent(cursor),
    ),
    200,
  );
  ok(
    r.body.data.every((v: any) => v.id !== firstId && v.id !== hidden.titleId),
  );
  await expect(
    api(
      "get",
      "/api/v1/titles?q=different&cursor=" + encodeURIComponent(cursor),
    ),
    400,
    "REQUEST_INVALID_CURSOR",
  );
  await expect(api("get", "/api/v1/titles?sort=SQL"), 422, "VALIDATION_FAILED");
  await expect(
    api("get", "/api/v1/titles?limit=101"),
    422,
    "VALIDATION_FAILED",
  );
  r = await expect(
    api(
      "get",
      "/api/v1/titles?q=bi%20danh&kind=SERIES&year=2026&country=VN&genre=viewer-" +
        genreId,
    ),
    200,
  );
  eq(
    r.body.data.map((v: any) => v.id),
    [visible.titleId],
  );
  await expect(
    api("get", "/api/v1/titles/" + hidden.titleId),
    404,
    "RESOURCE_NOT_FOUND",
  );
  await expect(api("get", "/api/v1/episodes/" + hidden.episodeId), 404);
  await expect(
    api("get", "/api/v1/seasons/" + hidden.seasonId + "/episodes"),
    404,
  );
  r = await expect(api("get", "/api/v1/titles/" + visible.titleId), 200);
  eq(r.body.genres[0].id, genreId);
  eq(r.body.createdBy, undefined);
  eq(r.body.publicId, undefined);
  await expect(api("get", "/api/v1/genres?limit=1"), 200);
  r = await expect(
    api("get", "/api/v1/titles/" + visible.titleId + "/seasons"),
    200,
  );
  eq(r.body.data[0].id, visible.seasonId);
  r = await expect(
    api("get", "/api/v1/seasons/" + visible.seasonId + "/episodes"),
    200,
  );
  eq(r.body.data[0].id, visible.episodeId);
  eq(r.body.data[0].activeAssetId, undefined);
  r = await expect(
    api("get", "/api/v1/titles/" + visible.titleId + "/recommendations"),
    200,
  );
  eq(
    r.body.data.map((v: any) => v.id),
    [second.titleId],
  );
  await f.query("UPDATE movie.source_backups SET bytes=99 WHERE asset_id=$1", [
    visible.assetId,
  ]);
  await expect(api("get", "/api/v1/episodes/" + visible.episodeId), 404);
  await f.query("UPDATE movie.source_backups SET bytes=100 WHERE asset_id=$1", [
    visible.assetId,
  ]);

  const email = "viewer-" + randomUUID() + "@example.test",
    password = randomBytes(16).toString("hex"),
    displayName = "Viewer integration";
  await expect(
    api("post", "/api/v1/users").send({
      email,
      password,
      displayName,
      roles: ["SUPER_ADMIN"],
    }),
    422,
    "VALIDATION_FAILED",
  );
  await expect(
    api("post", "/api/v1/users").send({
      email,
      password: "short",
      displayName,
    }),
    422,
  );
  const registered = (
    await expect(
      api("post", "/api/v1/users").send({
        email: email.toUpperCase(),
        password,
        displayName,
      }),
      201,
    )
  ).body;
  eq(registered.emailNormalized, email);
  eq(registered.passwordHash, undefined);
  eq(registered.emailVerifiedAt, null);
  const roles = (
    await f.query(
      "SELECT r.code FROM movie.user_roles ur JOIN movie.roles r ON r.id=ur.role_id WHERE ur.user_id=$1",
      [registered.id],
    )
  ).rows;
  eq(
    roles.map((v: any) => v.code),
    ["MEMBER"],
  );
  await expect(
    api("post", "/api/v1/users").send({ email, password, displayName }),
    409,
    "ACCOUNT_CONFLICT",
  );
  const login = (
      await expect(
        api("post", "/api/v1/auth/sessions").send({ email, password }),
        201,
      )
    ).body,
    token = login.accessToken;
  ok(token);
  eq(login.challengeToken, undefined);
  await expect(
    api("get", "/api/v1/admin/titles", token),
    403,
    "AUTH_FORBIDDEN",
  );
  await expect(api("get", "/api/v1/users/" + registered.id, token), 200);
  await expect(api("get", "/api/v1/users/" + c.rootId, token), 404);
  await expect(api("get", "/api/v1/me/watchlist"), 401);
  await expect(api("get", "/api/openapi.json", token), 200);
  const mail = c.app.get(NotificationsService) as NotificationsService;
  await mail.drain();
  async function emails() {
    const results: any[] = [];
    for (const file of await readdir(process.env.MAIL_LOCAL_ROOT!)) {
      const data = JSON.parse(
        await readFile(process.env.MAIL_LOCAL_ROOT! + "/" + file, "utf8"),
      );
      if (data.to === email) results.push(data);
    }
    return results;
  }
  const verification = (await emails()).find((v) =>
    v.subject.includes("Xac minh"),
  );
  ok(verification);
  const verificationToken = /Token: ([A-Za-z0-9_-]{64})/.exec(
    verification.text,
  )![1];
  const inbox = (
    await f.query(
      "SELECT payload FROM movie.outbox_events WHERE type='notification.email.requested' AND aggregate_id=$1",
      [registered.id],
    )
  ).rows;
  ok(!JSON.stringify(inbox).includes(verificationToken));
  await expect(
    api("post", "/api/v1/auth/email-verifications").send({
      token: verificationToken,
    }),
    200,
  );
  await expect(
    api("post", "/api/v1/auth/email-verifications").send({
      token: verificationToken,
    }),
    422,
    "AUTH_VERIFICATION_TOKEN_INVALID",
  );

  const path = "/api/v1/episodes/" + visible.episodeId + "/playback-sessions";
  await expect(
    api("post", path, token).send({}),
    400,
    "IDEMPOTENCY_KEY_REQUIRED",
  );
  await expect(
    api("post", path).set("Idempotency-Key", randomUUID()).send({}),
    422,
    "VALIDATION_FAILED",
  );
  await expect(
    api("post", path, "invalid").set("Idempotency-Key", randomUUID()).send({}),
    401,
  );
  const key = randomUUID();
  const creates = await Promise.all([
    expect(api("post", path, token).set("Idempotency-Key", key).send({}), 201),
    expect(api("post", path, token).set("Idempotency-Key", key).send({}), 201),
  ]);
  eq(creates[0].body.id, creates[1].body.id);
  eq(creates[0].body.resumeGeneration, "1");
  const session = creates[0].body;
  eq(session.delivery.expiresAt, null);
  eq(session.delivery.revocation, "SESSION_ONLY");
  ok(session.delivery.url.startsWith("https://res.cloudinary.com/"));
  ok(!session.delivery.url.endsWith(".mp4"));
  eq(session.delivery.fallback.format, "MP4");
  eq(session.delivery.fallback.adaptiveBitrate, false);
  const fallbackUrl = new URL(session.delivery.fallback.url);
  eq(fallbackUrl.hostname, "res.cloudinary.com");
  ok(fallbackUrl.pathname.includes("/video/authenticated/s--"));
  ok(fallbackUrl.pathname.endsWith(".mp4"));
  ok(!fallbackUrl.pathname.includes("sp_"));
  eq(session.managementToken, undefined);
  const stored = (
    await f.query(
      "SELECT response_body FROM movie.idempotency_records WHERE resource_id=$1 AND method='POST'",
      [session.id],
    )
  ).rows;
  ok(!JSON.stringify(stored).includes(session.telemetryToken));
  ok(!JSON.stringify(stored).includes("res.cloudinary.com"));
  await expect(
    api("get", "/api/v1/playback-sessions/" + session.id, c.memberToken),
    404,
  );
  await expect(
    api("get", "/api/v1/playback-sessions/" + session.id).set(
      "X-Playback-Management",
      session.telemetryToken,
    ),
    404,
  );
  const renewKey = randomUUID();
  const renew = (
    await expect(
      api(
        "post",
        "/api/v1/playback-sessions/" + session.id + "/renewals",
        token,
      )
        .set("Idempotency-Key", renewKey)
        .send({}),
      200,
    )
  ).body;
  r = await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/renewals", token)
      .set("Idempotency-Key", renewKey)
      .send({}),
    200,
  );
  eq(r.body.deliveryGeneration, renew.deliveryGeneration);
  await f.query(
    "UPDATE movie.titles SET publication_status='UNPUBLISHED' WHERE id=$1",
    [visible.titleId],
  );
  await expect(
    api("get", "/api/v1/playback-sessions/" + session.id, token),
    404,
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/renewals", token)
      .set("Idempotency-Key", randomUUID())
      .send({}),
    404,
  );
  await f.query(
    "UPDATE movie.titles SET publication_status='PUBLISHED' WHERE id=$1",
    [visible.titleId],
  );

  const mode = process.env.NODE_ENV,
    allow = process.env.PLAYBACK_ALLOW_NON_EXPIRING_URLS,
    guestPolicy = process.env.ALLOW_GUEST_PLAYBACK;
  try {
    process.env.NODE_ENV = "production";
    process.env.PLAYBACK_ALLOW_NON_EXPIRING_URLS = "false";
    await expect(
      api("get", "/api/v1/playback-sessions/" + session.id, token),
      503,
      "SERVICE_UNAVAILABLE",
    );
    await expect(
      api("post", path, token).set("Idempotency-Key", key).send({}),
      503,
      "SERVICE_UNAVAILABLE",
    );
    await expect(
      api(
        "post",
        "/api/v1/playback-sessions/" + session.id + "/renewals",
        token,
      )
        .set("Idempotency-Key", renewKey)
        .send({}),
      503,
      "SERVICE_UNAVAILABLE",
    );
    process.env.PLAYBACK_ALLOW_NON_EXPIRING_URLS = "true";
    await expect(
      api("get", "/api/v1/playback-sessions/" + session.id, token),
      200,
    );
    await expect(
      api("post", "/api/v1/auth/password-reset-requests").send({ email }),
      503,
      "SERVICE_UNAVAILABLE",
    );
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    if (allow === undefined)
      delete process.env.PLAYBACK_ALLOW_NON_EXPIRING_URLS;
    else process.env.PLAYBACK_ALLOW_NON_EXPIRING_URLS = allow;
  }
  try {
    process.env.ALLOW_GUEST_PLAYBACK = "false";
    await expect(
      api("post", path)
        .set("X-Guest-Id", randomBytes(32).toString("base64url"))
        .set("Idempotency-Key", randomUUID())
        .send({}),
      401,
      "AUTHENTICATION_REQUIRED",
    );
  } finally {
    if (guestPolicy === undefined) delete process.env.ALLOW_GUEST_PLAYBACK;
    else process.env.ALLOW_GUEST_PLAYBACK = guestPolicy;
  }
  const guest = randomBytes(32).toString("base64url");
  const guestSession = (
    await expect(
      api("post", path)
        .set("X-Guest-Id", guest)
        .set("Idempotency-Key", randomUUID())
        .send({}),
      201,
    )
  ).body;
  ok(guestSession.managementToken);
  ok(guestSession.telemetryToken !== guestSession.managementToken);
  await expect(
    api("get", "/api/v1/playback-sessions/" + guestSession.id).set(
      "X-Playback-Management",
      guestSession.telemetryToken,
    ),
    404,
  );
  await expect(
    api("get", "/api/v1/playback-sessions/" + guestSession.id).set(
      "X-Playback-Management",
      guestSession.managementToken,
    ),
    200,
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + guestSession.id + "/events")
      .set("X-Playback-Telemetry", guestSession.managementToken)
      .send({
        batchId: randomUUID(),
        events: [{ id: randomUUID(), type: "play", sequence: 0, elapsedMs: 0 }],
      }),
    403,
    "TELEMETRY_SESSION_MISMATCH",
  );

  const batch = {
    batchId: randomUUID(),
    events: [
      {
        id: randomUUID(),
        type: "play",
        sequence: 0,
        elapsedMs: 0,
        positionSeconds: 0,
      },
    ],
  };
  r = await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/events")
      .set("X-Playback-Telemetry", session.telemetryToken)
      .send(batch),
    202,
  );
  eq(r.body.duplicate, false);
  r = await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/events")
      .set("X-Playback-Telemetry", session.telemetryToken)
      .send(batch),
    202,
  );
  eq(r.body.duplicate, true);
  await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/events")
      .set("X-Playback-Telemetry", session.telemetryToken)
      .send({ ...batch, events: [{ ...batch.events[0], positionSeconds: 1 }] }),
    422,
    "TELEMETRY_BATCH_INVALID",
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/events")
      .set("X-Playback-Telemetry", session.telemetryToken)
      .send({
        batchId: randomUUID(),
        events: [
          { id: randomUUID(), type: "play", sequence: 1, elapsedMs: 0 },
          { ...batch.events[0], positionSeconds: 2 },
        ],
      }),
    422,
  );
  eq(
    (
      await f.query(
        "SELECT count(*)::int AS n FROM movie.watch_events WHERE session_id=$1",
        [session.id],
      )
    ).rows[0].n,
    1,
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/events")
      .set("X-Playback-Telemetry", session.telemetryToken)
      .send({
        batchId: randomUUID(),
        events: Array.from({ length: 51 }, (_, sequence) => ({
          id: randomUUID(),
          type: "play",
          sequence,
          elapsedMs: 0,
        })),
      }),
    422,
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + session.id + "/events")
      .set("X-Playback-Telemetry", session.telemetryToken)
      .send({
        batchId: randomUUID(),
        events: [
          {
            id: randomUUID(),
            type: "error",
            sequence: 3,
            elapsedMs: 0,
            errorCode: "https://secret.invalid",
          },
        ],
      }),
    422,
  );

  await expect(
    api("put", "/api/v1/me/watchlist/" + visible.titleId, token),
    201,
  );
  await expect(
    api("put", "/api/v1/me/watchlist/" + visible.titleId, token),
    204,
  );
  await expect(
    api("put", "/api/v1/me/watchlist/" + hidden.titleId, token),
    404,
  );
  r = await expect(api("get", "/api/v1/me/watchlist", token), 200);
  eq(r.body.data[0].id, visible.titleId);
  r = await expect(api("get", "/api/v1/me/watchlist", c.memberToken), 200);
  ok(!r.body.data.some((v: any) => v.id === visible.titleId));
  await expect(
    api("delete", "/api/v1/me/watchlist/" + visible.titleId, token),
    204,
  );
  await expect(
    api("delete", "/api/v1/me/watchlist/" + visible.titleId, token),
    204,
  );
  const progressPath = "/api/v1/me/watch-progress/" + visible.episodeId;
  const progress = {
    sessionId: session.id,
    sequence: 1,
    positionSeconds: 1,
    intervalStartSeconds: 0,
    ended: false,
  };
  r = await expect(api("put", progressPath, token).send(progress), 201);
  eq(r.body.watchedSeconds, 1);
  await expect(api("put", progressPath, token).send(progress), 200);
  await expect(
    api("put", progressPath, token).send({ ...progress, positionSeconds: 2 }),
    409,
    "PROGRESS_SEQUENCE_CONFLICT",
  );
  await expect(
    api("put", progressPath, token).send({
      ...progress,
      sequence: 2,
      positionSeconds: 99,
      intervalStartSeconds: 0,
    }),
    422,
    "PROGRESS_INTERVAL_INVALID",
  );
  r = await expect(
    api("put", progressPath, token).send({
      sessionId: session.id,
      sequence: 2,
      positionSeconds: 0,
    }),
    200,
  );
  eq(r.body.positionSeconds, 0);
  r = await expect(api("get", "/api/v1/me/history", token), 200);
  eq(r.body.data[0].episodeId, visible.episodeId);
  r = await expect(api("get", "/api/v1/me/history", c.memberToken), 200);
  ok(!r.body.data.some((v: any) => v.id === visible.episodeId));
  const session2 = (
    await expect(
      api("post", path, token).set("Idempotency-Key", randomUUID()).send({}),
      201,
    )
  ).body;
  eq(session2.resumeGeneration, "2");
  await expect(
    api("put", progressPath, token).send({ ...progress, sequence: 3 }),
    409,
    "PROGRESS_SESSION_STALE",
  );
  await expect(
    api("put", progressPath, c.memberToken).send({
      sessionId: session2.id,
      sequence: 1,
      positionSeconds: 2,
    }),
    409,
  );
  r = await expect(
    api("put", progressPath, token).send({
      sessionId: session2.id,
      sequence: 1,
      positionSeconds: 50,
      ended: true,
    }),
    200,
  );
  eq(r.body.completedAt, null);
  r = await expect(api("get", "/api/v1/me/continue-watching", token), 200);
  eq(r.body.data[0].id, visible.episodeId);
  await f.query(
    "UPDATE movie.playback_sessions SET created_at=now()-interval '120 seconds' WHERE id=$1",
    [session2.id],
  );
  await f.query(
    "UPDATE movie.watch_progress SET updated_at=now()-interval '120 seconds' WHERE user_id=$1 AND episode_id=$2",
    [registered.id, visible.episodeId],
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + session2.id + "/events")
      .set("X-Playback-Telemetry", session2.telemetryToken)
      .send({
        batchId: randomUUID(),
        events: [
          {
            id: randomUUID(),
            type: "ended",
            sequence: 99,
            elapsedMs: 100000,
            positionSeconds: 100,
          },
        ],
      }),
    202,
  );
  r = await expect(
    api("put", progressPath, token).send({
      sessionId: session2.id,
      sequence: 2,
      positionSeconds: 100,
      intervalStartSeconds: 0,
      ended: true,
    }),
    200,
  );
  eq(r.body.watchedSeconds, 100);
  ok(r.body.completedAt);
  r = await expect(api("get", "/api/v1/me/continue-watching", token), 200);
  eq(r.body.data.length, 0);
  const session3 = (
    await expect(
      api("post", path, token).set("Idempotency-Key", randomUUID()).send({}),
      201,
    )
  ).body;
  await expect(
    api("post", path, token).set("Idempotency-Key", randomUUID()).send({}),
    409,
    "PLAYBACK_CONCURRENCY_LIMIT",
  );
  await expect(
    api("delete", "/api/v1/playback-sessions/" + session3.id, token),
    204,
  );
  await expect(
    api("delete", "/api/v1/playback-sessions/" + session3.id, token),
    204,
  );
  await expect(
    api("get", "/api/v1/playback-sessions/" + session3.id, token),
    403,
    "PLAYBACK_SESSION_REVOKED",
  );

  await f.query(
    "UPDATE movie.playback_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",
    [guestSession.id],
  );
  await expect(
    api("get", "/api/v1/playback-sessions/" + guestSession.id).set(
      "X-Playback-Management",
      guestSession.managementToken,
    ),
    401,
    "PLAYBACK_SESSION_EXPIRED",
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + guestSession.id + "/renewals")
      .set("X-Playback-Management", guestSession.managementToken)
      .set("Idempotency-Key", randomUUID())
      .send({}),
    401,
    "PLAYBACK_SESSION_EXPIRED",
  );
  await f.query(
    "UPDATE movie.playback_sessions SET expires_at=now()+interval '30 minutes' WHERE id=$1",
    [guestSession.id],
  );
  const newAsset = randomUUID(),
    newAttempt = randomUUID(),
    newOperation = randomUUID();
  await f.query(
    "INSERT INTO movie.video_assets(id,episode_id,internal_version,provider_asset_id,public_id,provider_version,delivery_type,processing_status,backup_status,duration_seconds,bytes,source_format) VALUES ($1,$2,2,$3,$3,'1235','authenticated','READY','VERIFIED',200,200,'mp4')",
    [newAsset, visible.episodeId, "test/" + newAsset],
  );
  await f.query(
    "INSERT INTO movie.operations(id,owner_user_id,principal_scope,type) VALUES ($1,$2,'test','MEDIA_PROCESS')",
    [newOperation, c.rootId],
  );
  await f.query(
    "INSERT INTO movie.media_attempts(id,asset_id,operation_id,profile_version,config_hash,status,attempt_no,callback_context_hash,completed_at) VALUES ($1,$2,$3,'hls-hd-v1','viewer','SUCCEEDED',1,$4,now())",
    [newAttempt, newAsset, newOperation, randomUUID()],
  );
  await f.query(
    "UPDATE movie.video_assets SET current_attempt_id=$2 WHERE id=$1",
    [newAsset, newAttempt],
  );
  await f.query(
    "INSERT INTO movie.media_outputs(attempt_id,format,profile_version,config_hash,status,manifest_ref,verified_at) VALUES ($1,'HLS','hls-hd-v1','viewer','READY','test/manifest2',now())",
    [newAttempt],
  );
  await f.query(
    "INSERT INTO movie.source_backups(asset_id,storage_provider,bucket,object_key,sha256,bytes,status,verified_at,source_manifest_ref) VALUES ($1,'S3','test',$2,$3,200,'VERIFIED',now(),'test/manifest2')",
    [newAsset, newAsset, "0".repeat(64)],
  );
  await f.query("UPDATE movie.episodes SET active_asset_id=$2 WHERE id=$1", [
    visible.episodeId,
    newAsset,
  ]);
  r = await expect(
    api("get", "/api/v1/playback-sessions/" + session2.id, token),
    200,
  );
  eq(r.body.assetId, visible.assetId);
  r = await expect(api("get", progressPath, token), 200);
  eq(r.body.resumeEligible, false);
  eq(r.body.positionSeconds, 0);
  const changed = (
    await expect(
      api("post", path, token).set("Idempotency-Key", randomUUID()).send({}),
      201,
    )
  ).body;
  eq(changed.assetId, newAsset);
  eq(changed.assetVersion, 2);
  await expect(
    api("delete", "/api/v1/playback-sessions/" + changed.id, token),
    204,
  );
  await f.query("UPDATE movie.episodes SET active_asset_id=$2 WHERE id=$1", [
    visible.episodeId,
    visible.assetId,
  ]);
  const report = (
    await expect(
      api("post", "/api/v1/reports", token).send({
        titleId: visible.titleId,
        episodeId: visible.episodeId,
        category: "PLAYBACK",
        message: "Player error",
      }),
      201,
    )
  ).body;
  await expect(api("get", "/api/v1/reports/" + report.id, token), 200);
  await expect(api("get", "/api/v1/reports/" + report.id, c.memberToken), 404);
  await expect(
    api("post", "/api/v1/reports", token).send({
      titleId: visible.titleId,
      episodeId: second.episodeId,
      category: "METADATA",
      message: "Wrong association",
    }),
    404,
  );
  await expect(
    api("post", "/api/v1/reports").send({
      titleId: visible.titleId,
      category: "OTHER",
      message: "Anonymous report",
    }),
    401,
  );
  const guestReport = (
    await expect(
      api("post", "/api/v1/reports")
        .set("X-Playback-Management", guestSession.managementToken)
        .send({
          titleId: visible.titleId,
          episodeId: visible.episodeId,
          playbackSessionId: guestSession.id,
          category: "PLAYBACK",
          message: "Guest player error",
        }),
      201,
    )
  ).body;
  await expect(
    api("get", "/api/v1/reports/" + guestReport.id).set(
      "X-Playback-Management",
      guestSession.managementToken,
    ),
    200,
  );
  await expect(
    api("get", "/api/v1/reports/" + guestReport.id).set(
      "X-Playback-Management",
      session.telemetryToken,
    ),
    404,
  );

  const unknown = (
    await expect(
      api("post", "/api/v1/auth/password-reset-requests").send({
        email: "unknown-" + randomUUID() + "@example.test",
      }),
      202,
    )
  ).body;
  const known = (
    await expect(
      api("post", "/api/v1/auth/password-reset-requests").send({ email }),
      202,
    )
  ).body;
  eq(known, unknown);
  await mail.drain();
  const resetEmail = (await emails()).find((v) =>
      v.subject.includes("Khoi phuc"),
    ),
    resetToken = /Token: ([A-Za-z0-9_-]{64})/.exec(resetEmail.text)![1];
  const nextPassword = randomBytes(16).toString("hex");
  await expect(
    api("post", "/api/v1/auth/password-resets").send({
      token: resetToken,
      password: nextPassword,
    }),
    200,
  );
  await expect(api("get", "/api/v1/me", token), 401, "AUTH_SESSION_REVOKED");
  await expect(
    api("post", "/api/v1/auth/password-resets").send({
      token: resetToken,
      password: nextPassword,
    }),
    422,
    "AUTH_RESET_TOKEN_INVALID",
  );
  await expect(
    api("post", "/api/v1/auth/sessions").send({ email, password }),
    401,
  );
  const newToken = (
    await expect(
      api("post", "/api/v1/auth/sessions").send({
        email,
        password: nextPassword,
      }),
      201,
    )
  ).body.accessToken;
  await expect(
    api("get", "/api/v1/playback-sessions/" + session2.id, newToken),
    403,
    "PLAYBACK_SESSION_REVOKED",
  );
  await expect(
    api("post", "/api/v1/playback-sessions/" + session2.id + "/events")
      .set("X-Playback-Telemetry", session2.telemetryToken)
      .send({
        batchId: randomUUID(),
        events: [
          { id: randomUUID(), sequence: 100, type: "play", elapsedMs: 0 },
        ],
      }),
    403,
  );

  const spec = (await expect(api("get", "/api/openapi.json", c.rootToken), 200))
    .body;
  ok(spec.components.schemas.PlaybackSession);
  ok(spec.components.schemas.PublicTitleDetail);
  eq(spec.paths["/api/v1/episodes/{id}/playback-sessions"].post.security, [
    { bearer: [] },
    {},
  ]);
  eq(spec.paths["/api/v1/playback-sessions/{id}/events"].post.security, [
    { "playback-telemetry": [] },
  ]);
  eq(
    spec.paths["/api/v1/titles"].get.responses["200"].content[
      "application/json"
    ].schema.properties.data.items.$ref,
    "#/components/schemas/PublicTitle",
  );
  r = await expect(
    api("post", "/api/v1/auth/email-verification-requests").send({ email }),
    202,
  );
  const unknownVerify = (
    await expect(
      api("post", "/api/v1/auth/email-verification-requests").send({
        email: "absent-" + randomUUID() + "@example.test",
      }),
      202,
    )
  ).body;
  eq(r.body, unknownVerify);
  const subjectHash = privateHash("account.register:" + "::ffff:127.0.0.1");
  await f.query(
    "INSERT INTO movie.security_events(category,outcome,subject_hash) SELECT 'account.register','SUCCESS',$1 FROM generate_series(1,5)",
    [subjectHash],
  );
  // Rate limits are exercised against the same IP observed by Supertest.
  const ipRow = (
    await f.query(
      "SELECT subject_hash FROM movie.security_events WHERE category='account.register' ORDER BY received_at LIMIT 1",
    )
  ).rows[0];
  if (ipRow) {
    await f.query(
      "INSERT INTO movie.security_events(category,outcome,subject_hash) SELECT 'account.register','SUCCESS',$1 FROM generate_series(1,5)",
      [ipRow.subject_hash],
    );
    await expect(
      api("post", "/api/v1/users").send({
        email: "limited-" + randomUUID() + "@example.test",
        password,
        displayName,
      }),
      429,
      "RATE_LIMITED",
    );
  }
  console.log(JSON.stringify({ event: "viewer.integration.passed", checks }));
  return checks;
}
