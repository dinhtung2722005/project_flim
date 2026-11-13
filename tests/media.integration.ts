import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryProvider } from "../packages/media/src/cloudinary.provider";
import { ApiError } from "../apps/api/src/common";

export async function runMediaIntegration(c: {
  api: any;
  fixtures: any;
  app: any;
  episodeId: string;
  rootToken: string;
  editorToken: string;
  adminToken: string;
  auditorToken: string;
  memberToken: string;
}) {
  c = {
    ...c,
    episodeId: (
      await c.fixtures.query(
        "INSERT INTO movie.episodes(title_id,season_id,number,name) SELECT title_id,season_id,99,'Upload test' FROM movie.episodes WHERE id=$1 RETURNING id",
        [c.episodeId],
      )
    ).rows[0].id,
  };
  let checks = 0,
    lookups = 0;
  const envKeys = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "CLOUDINARY_UPLOAD_PRESET",
    "CLOUDINARY_MAX_VIDEO_BYTES",
  ];
  const originalEnv = Object.fromEntries(
    envKeys.map((k) => [k, process.env[k]]),
  );
  const originalPreset = cloudinary.api.upload_preset,
    originalResource = cloudinary.api.resource;
  const cloud = cloudinary as any;
  let badPreset = false;
  cloud.api.upload_preset = async () => ({
    unsigned: badPreset,
    settings: {
      allowed_formats: ["mp4", "mov", "mkv", "webm", "m4v", "avi"],
      overwrite: false,
    },
  });
  let lookupError: any, override: object | undefined;
  cloud.api.resource = async (publicId: string) => {
    lookups++;
    if (lookupError) throw lookupError;
    const row = (
      await c.fixtures.query(
        "SELECT * FROM movie.upload_intents WHERE target_public_id=$1",
        [publicId],
      )
    ).rows[0];
    return {
      asset_id: randomUUID().replaceAll("-", ""),
      public_id: publicId,
      version: 123456789,
      resource_type: "video",
      type: "authenticated",
      format: "mp4",
      bytes: 1024,
      duration: 7200,
      width: 1920,
      height: 1080,
      created_at: new Date().toISOString(),
      context: {
        custom: {
          intent_id: row.id,
          episode_id: row.episode_id,
          asset_id: row.expected_policy.assetId,
          owner_user_id: row.owner_user_id,
        },
      },
      ...override,
    };
  };
  const expect = async (req: any, status: number, code?: string) => {
    const r = await req;
    assert.equal(r.status, status, JSON.stringify(r.body));
    if (code) assert.equal(r.body.code, code);
    checks++;
    return r;
  };
  const createPath =
    "/api/v1/admin/episodes/" + c.episodeId + "/upload-intents";
  const payload = {
    expectedBytes: 1024,
    sourceFormat: "mp4",
    encodingPreset: "balanced-1080p-v1",
  };
  const issue = (
    token = c.editorToken,
    key: string = randomUUID(),
    body = payload,
  ) => c.api("post", createPath, token).set("Idempotency-Key", key).send(body);
  const path = (id: string) => "/api/v1/admin/upload-intents/" + id;
  const verify = (
    id: string,
    token = c.editorToken,
    key: string = randomUUID(),
    episodeId = c.episodeId,
  ) =>
    c
      .api("post", path(id) + "/verifications", token)
      .set("Idempotency-Key", key)
      .send({ episodeId });
  try {
    process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "123456789012345";
    process.env.CLOUDINARY_API_SECRET = "test-cloudinary-secret";
    process.env.CLOUDINARY_UPLOAD_PRESET = "pj_flim_test_signed";
    process.env.CLOUDINARY_MAX_VIDEO_BYTES = "1048576";
    await expect(issue(c.memberToken), 403, "AUTH_FORBIDDEN");
    await expect(
      issue(c.editorToken, randomUUID(), {
        ...payload,
        encodingPreset: "unknown",
      }),
      422,
      "VALIDATION_FAILED",
    );
    await expect(
      issue(c.editorToken, randomUUID(), {
        ...payload,
        encodingPreset: null,
      } as any),
      422,
      "VALIDATION_FAILED",
    );
    await expect(issue(c.auditorToken), 403, "AUTH_FORBIDDEN");
    await expect(
      c.api("post", createPath, c.editorToken).send(payload),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    await expect(issue(c.editorToken, "tiny"), 422, "VALIDATION_FAILED");
    await expect(
      issue(c.editorToken, randomUUID(), { ...payload, sourceFormat: "exe" }),
      422,
      "VALIDATION_FAILED",
    );
    await expect(
      issue(c.editorToken, randomUUID(), {
        ...payload,
        publicId: "attacker",
      } as any),
      422,
      "VALIDATION_FAILED",
    );
    await expect(
      issue(c.editorToken, randomUUID(), {
        ...payload,
        expectedBytes: 1048577,
      }),
      422,
      "MEDIA_FILE_LIMIT_EXCEEDED",
    );
    const secret = process.env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_API_SECRET;
    await expect(issue(), 503, "MEDIA_PROVIDER_UNAVAILABLE");
    process.env.CLOUDINARY_API_SECRET = secret;
    badPreset = true;
    await expect(issue(), 503, "MEDIA_PROVIDER_UNAVAILABLE");
    badPreset = false;
    const key: string = randomUUID();
    const created = await Promise.all([
      issue(c.editorToken, key),
      issue(c.editorToken, key),
    ]);
    created.forEach((r) => {
      assert.equal(r.status, 201, JSON.stringify(r.body));
      checks++;
    });
    assert.equal(created[0].body.id, created[1].body.id);
    checks++;
    const intent = created[0].body;
    assert.equal(intent.status, "PENDING");
    assert.equal(intent.upload.fields.overwrite, false);
    assert.equal(intent.upload.fields.type, "authenticated");
    assert.match(intent.upload.fields.signature, /^[a-f0-9]{64}$/);
    assert.equal(created[0].headers["cache-control"], "no-store");
    assert.equal(created[0].headers.location, path(intent.id));
    checks += 6;
    const { api_key, signature, ...parameters } = intent.upload.fields;
    const serialized = Object.entries(parameters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => k + "=" + v)
      .join("&");
    assert.equal(
      signature,
      createHash("sha256")
        .update(serialized + secret)
        .digest("hex"),
    );
    checks++;
    await expect(c.api("get", path(intent.id), c.editorToken), 200);
    await expect(
      c.api("get", path(intent.id), c.rootToken),
      404,
      "RESOURCE_NOT_FOUND",
    );
    await expect(verify(intent.id, c.adminToken), 404, "RESOURCE_NOT_FOUND");
    await expect(
      issue(c.editorToken, key, { ...payload, expectedBytes: 2048 }),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    await expect(
      verify(intent.id, c.editorToken, randomUUID(), randomUUID()),
      422,
      "MEDIA_UPLOAD_MISMATCH",
    );
    await expect(
      c
        .api("post", path(intent.id) + "/verifications", c.editorToken)
        .send({ episodeId: c.episodeId }),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    await expect(
      c
        .api("post", path(intent.id) + "/verifications", c.editorToken)
        .set("Idempotency-Key", randomUUID())
        .send({
          episodeId: c.episodeId,
          secureUrl: "https://attacker.invalid",
        }),
      422,
      "VALIDATION_FAILED",
    );
    lookupError = { error: { http_code: 404 } };
    await expect(verify(intent.id), 409, "MEDIA_NOT_READY");
    lookupError = { error: { http_code: 429 } };
    await expect(verify(intent.id), 503, "MEDIA_PROVIDER_UNAVAILABLE");
    lookupError = { error: { message: { code: "ECONNRESET" } } };
    await expect(verify(intent.id), 503, "MEDIA_PROVIDER_UNAVAILABLE");
    lookupError = { http_code: 499 };
    await expect(verify(intent.id), 504, "MEDIA_PROVIDER_TIMEOUT");
    lookupError = undefined;
    // Verified metadata alone cannot bypass the existing HLS/backup publication guard.
    const verificationKey = randomUUID(),
      before = lookups;
    const verified = await Promise.all([
      verify(intent.id, c.editorToken, verificationKey),
      verify(intent.id, c.editorToken, verificationKey),
    ]);
    verified.forEach((r) => {
      assert.equal(r.status, 200, JSON.stringify(r.body));
      checks++;
    });
    assert.deepEqual(verified[0].body, verified[1].body);
    checks++;
    const result = verified[0].body;
    const pinned = (
      await c.fixtures.query(
        "SELECT i.expected_policy,a.config_hash FROM movie.upload_intents i JOIN movie.media_attempts a ON a.asset_id=i.verified_asset_id WHERE i.id=$1",
        [intent.id],
      )
    ).rows[0];
    assert.equal(pinned.expected_policy.encoding.presetId, "balanced-1080p-v1");
    assert.equal(pinned.expected_policy.encoding.rungs.at(-1).height, 1080);
    assert.equal(
      pinned.expected_policy.streamingProfile,
      pinned.expected_policy.encoding.profileName,
    );
    checks += 3;
    await expect(
      issue(c.editorToken, key, {
        ...payload,
        encodingPreset: "data-saver-v1",
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    assert.equal(result.processingStatus, "UPLOADED");
    checks++;
    const after = lookups;
    assert.ok(after > before);
    checks++;
    await expect(verify(intent.id, c.editorToken, verificationKey), 200);
    assert.equal(lookups, after);
    checks++;
    await expect(verify(intent.id), 200);
    assert.equal(lookups, after);
    checks++;
    const records = (
      await c.fixtures.query(
        "SELECT (SELECT count(*)::int FROM movie.operations WHERE resource_id=$1) AS operations,(SELECT count(*)::int FROM movie.outbox_events WHERE aggregate_id=$1 AND type='media.processing.requested') AS events,(SELECT count(*)::int FROM movie.media_attempts WHERE asset_id=$1) AS attempts,(SELECT count(*)::int FROM movie.audit_logs WHERE resource_id=$2 AND action='media.upload_intent.verified') AS audits",
        [intent.assetId, intent.id],
      )
    ).rows[0];
    assert.deepEqual(records, {
      operations: 1,
      events: 1,
      attempts: 1,
      audits: 1,
    });
    checks++;
    await expect(c.api("get", result.operationUrl, c.editorToken), 200);
    await expect(
      c.api("get", result.operationUrl, c.rootToken),
      404,
      "RESOURCE_NOT_FOUND",
    );
    const dbIntent = (
      await c.fixtures.query(
        "SELECT i.*,v.processing_status,v.backup_status,e.active_asset_id FROM movie.upload_intents i JOIN movie.video_assets v ON v.id=i.verified_asset_id JOIN movie.episodes e ON e.id=i.episode_id WHERE i.id=$1",
        [intent.id],
      )
    ).rows[0];
    assert.equal(dbIntent.status, "VERIFIED");
    assert.equal(dbIntent.processing_status, "UPLOADED");
    assert.equal(dbIntent.backup_status, "PENDING");
    assert.equal(dbIntent.active_asset_id, null);
    checks += 4;
    const privateRows = await c.fixtures.query(
      "SELECT response_body::text AS text FROM movie.idempotency_records WHERE resource_id=$1 UNION ALL SELECT safe_diff::text FROM movie.audit_logs WHERE resource_id=$2",
      [intent.id, intent.id],
    );
    assert.ok(
      privateRows.rows.every(
        (r: any) => !r.text.includes(secret!) && !r.text.includes(signature),
      ),
    );
    checks++;
    // Every terminal mismatch is committed with its audit before the API returns 422.
    const rejected = (await expect(issue(), 201)).body;
    override = {
      context: { custom: { intent_id: rejected.id, episode_id: randomUUID() } },
    };
    const rejectKey = randomUUID();
    await expect(
      verify(rejected.id, c.editorToken, rejectKey),
      422,
      "MEDIA_UPLOAD_MISMATCH",
    );
    const rejectionLookups = lookups;
    await expect(
      verify(rejected.id, c.editorToken, rejectKey),
      422,
      "MEDIA_UPLOAD_MISMATCH",
    );
    assert.equal(lookups, rejectionLookups);
    checks++;
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT status FROM movie.upload_intents WHERE id=$1",
          [rejected.id],
        )
      ).rows[0].status,
      "REJECTED",
    );
    checks++;
    override = undefined;
    const expired = (await expect(issue(), 201)).body;
    await c.fixtures.query(
      "UPDATE movie.upload_intents SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",
      [expired.id],
    );
    await expect(verify(expired.id), 409, "MEDIA_UPLOAD_INTENT_EXPIRED");
    assert.equal(
      (await expect(c.api("get", path(expired.id), c.editorToken), 200)).body
        .status,
      "EXPIRED",
    );
    checks++;
    const malformed = (await expect(issue(), 201)).body;
    override = { width: 0 };
    await expect(verify(malformed.id), 502, "MEDIA_PROVIDER_BAD_RESPONSE");
    override = undefined;
    const mismatch = (await expect(issue(), 201)).body;
    override = { bytes: 2048 };
    await expect(verify(mismatch.id), 422, "MEDIA_UPLOAD_MISMATCH");
    const tooLarge = (await expect(issue(), 201)).body;
    override = { duration: 21601 };
    await expect(verify(tooLarge.id), 422, "MEDIA_FILE_LIMIT_EXCEEDED");
    override = undefined;
    const provider = c.app.get(CloudinaryProvider);
    const intentRow = (
      await c.fixtures.query("SELECT * FROM movie.upload_intents WHERE id=$1", [
        intent.id,
      ])
    ).rows[0];
    assert.throws(
      () => provider.inspect({ public_id: "wrong" }, intentRow),
      (e: any) => e instanceof ApiError && e.code === "MEDIA_UPLOAD_MISMATCH",
    );
    checks++;
    // Audit failure must roll back reservation and idempotency, not mint an orphan asset.
    await c.fixtures.query("REVOKE INSERT ON movie.audit_logs FROM movie_api");
    try {
      await expect(issue(c.rootToken), 503, "AUDIT_WRITE_UNAVAILABLE");
    } finally {
      await c.fixtures.query("GRANT INSERT ON movie.audit_logs TO movie_api");
    }
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS count FROM movie.upload_intents WHERE owner_user_id=(SELECT user_id FROM movie.auth_sessions WHERE id=(SELECT id FROM movie.auth_sessions WHERE user_id=(SELECT id FROM movie.users WHERE email_normalized LIKE 'super_admin-%' LIMIT 1) LIMIT 1))",
        )
      ).rows[0].count,
      0,
    );
    checks++;
    // Same episode version allocation is serialized even with different keys/users.
    const parallel = await Promise.all([
      issue(c.editorToken),
      issue(c.adminToken),
    ]);
    parallel.forEach((r) => {
      assert.equal(r.status, 201, JSON.stringify(r.body));
      checks++;
    });
    assert.notEqual(
      parallel[0].body.internalVersion,
      parallel[1].body.internalVersion,
    );
    checks++;
    const editorId = (
      await c.fixtures.query(
        "SELECT owner_user_id FROM movie.upload_intents WHERE id=$1",
        [intent.id],
      )
    ).rows[0].owner_user_id;
    let count = (
      await c.fixtures.query(
        "SELECT count(*)::int AS count FROM movie.upload_intents WHERE owner_user_id=$1 AND created_at>now()-interval '1 hour'",
        [editorId],
      )
    ).rows[0].count;
    while (count++ < 10) await expect(issue(), 201);
    await expect(issue(), 429, "RATE_LIMITED");
    await c.fixtures.query(
      "INSERT INTO movie.security_events(category,outcome,user_id) SELECT 'media.verification.requested','SUCCESS',$1 FROM generate_series(1,30)",
      [editorId],
    );
    const lookupCount = lookups;
    await expect(verify(malformed.id), 429, "RATE_LIMITED");
    assert.equal(lookups, lookupCount);
    checks++;
    await c.fixtures.query(
      "UPDATE movie.idempotency_records SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE resource_id=$1",
      [intent.id],
    );
    await expect(issue(c.editorToken, key), 409, "IDEMPOTENCY_RESULT_EXPIRED");
    return checks;
  } finally {
    cloud.api.upload_preset = originalPreset;
    cloud.api.resource = originalResource;
    for (const k of envKeys) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  }
}
