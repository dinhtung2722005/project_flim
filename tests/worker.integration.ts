import {
  createEncodingSnapshot,
  fittedDimensions,
  processingConfigHash,
  assertEncodingSnapshot,
} from "../packages/media/src/encoding-profiles";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WorkerStore } from "../apps/worker/src/store";
import { MediaWorker } from "../apps/worker/src/media-worker";
import { Broker } from "../apps/worker/src/broker";
import { OutboxPublisher } from "../apps/worker/src/outbox";
import {
  CloudinaryProvider,
  UploadPolicy,
} from "../packages/media/src/cloudinary.provider";
import { BackupStorage } from "../packages/media/src/backup-storage";
import { ApiError, hash } from "../apps/api/src/common";
import { verifyHls, MediaPending } from "../packages/media/src/hls-verifier";
type Input = {
  fixtures: any;
  api: any;
  rootToken: string;
  editorToken: string;
  adminToken: string;
};
export async function runWorkerIntegration(c: Input) {
  let checks = 0,
    requests = 0,
    pending = false,
    foreign = false,
    sourceError = false;
  const keys = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "CLOUDINARY_WEBHOOK_URL",
    "RABBITMQ_PREFIX",
    "BACKUP_LOCAL_ROOT",
    "BACKUP_DRIVER",
    "MEDIA_MAX_FAILURES",
    "MEDIA_RECONCILE_SECONDS",
  ];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]])),
    originalFetch = globalThis.fetch;
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "123456789";
  process.env.CLOUDINARY_API_SECRET = "isolated-worker-secret";
  process.env.CLOUDINARY_WEBHOOK_URL =
    "https://test.invalid/api/v1/webhooks/cloudinary";
  process.env.RABBITMQ_PREFIX =
    "pjflim.test." + randomUUID().replaceAll("-", "");
  process.env.BACKUP_DRIVER = "filesystem";
  process.env.BACKUP_LOCAL_ROOT = resolve(
    ".local/worker/tests/" + randomUUID(),
  );
  process.env.MEDIA_MAX_FAILURES = "2";
  process.env.MEDIA_RECONCILE_SECONDS = "1";
  const source = Buffer.alloc(16384, 42),
    callbacks = new Map<string, string>();
  const store = new WorkerStore(),
    backup = new BackupStorage();
  let broker: Broker | undefined;
  let pauseLookup: (() => Promise<void>) | undefined;
  const expect = async (req: any, status: number, code?: string) => {
    const r = await req;
    assert.equal(r.status, status, JSON.stringify(r.body));
    if (code) assert.equal(r.body.code, code);
    checks++;
    return r;
  };
  const rootId = (
    await c.fixtures.query(
      "SELECT id FROM movie.users WHERE email_normalized LIKE 'super_admin-%' LIMIT 1",
    )
  ).rows[0].id;
  const editorId = (
    await c.fixtures.query(
      "SELECT id FROM movie.users WHERE email_normalized LIKE 'editor-%' LIMIT 1",
    )
  ).rows[0].id;
  const title = (
    await expect(
      c.api("post", "/api/v1/admin/titles", c.rootToken).send({
        kind: "MOVIE",
        slug: "worker-test-" + randomUUID(),
        localizedTitle: "Worker test",
      }),
      201,
    )
  ).body;
  const season = (
    await expect(
      c.api(
        "get",
        "/api/v1/admin/titles/" + title.id + "/seasons",
        c.rootToken,
      ),
      200,
    )
  ).body.data[0];
  const episode = (
    await expect(
      c.api(
        "get",
        "/api/v1/admin/seasons/" + season.id + "/episodes",
        c.rootToken,
      ),
      200,
    )
  ).body.data[0];
  let version = 0;
  async function fixture(owner = rootId) {
    const assetId = randomUUID(),
      attemptId = randomUUID(),
      operationId = randomUUID(),
      intentId = randomUUID(),
      eventId = randomUUID(),
      publicId = "test/" + assetId;
    const p: UploadPolicy = {
      assetId,
      internalVersion: ++version,
      cloudName: "test-cloud",
      apiKey: "123456789",
      preset: "signed",
      deliveryType: "authenticated",
      expectedBytes: source.length,
      sourceFormat: "mp4",
      maxBytes: 104857600,
      maxDurationSeconds: 21600,
      streamingProfile: "hd",
      profileVersion: "hls-hd-v1",
      signatureTimestamp: Math.floor(Date.now() / 1000),
      parameters: {},
    };
    await c.fixtures.query(
      "INSERT INTO movie.video_assets(id,episode_id,public_id,delivery_type,internal_version,provider_asset_id,provider_version,bytes,duration_seconds,width,height,source_format,processing_status) VALUES ($1,$2,$3,'authenticated',$4,$5,'1234',$6,12,1280,720,'mp4','UPLOADED')",
      [
        assetId,
        episode.id,
        publicId,
        version,
        assetId.replaceAll("-", ""),
        source.length,
      ],
    );
    await c.fixtures.query(
      "INSERT INTO movie.upload_intents(id,episode_id,owner_user_id,target_public_id,expected_policy,status,verified_asset_id,verified_at,expires_at) VALUES ($1,$2,$3,$4,$5,'VERIFIED',$6,now(),now()+interval '1 hour')",
      [intentId, episode.id, owner, publicId, JSON.stringify(p), assetId],
    );
    await c.fixtures.query(
      "INSERT INTO movie.operations(id,owner_user_id,principal_scope,type,resource_id) VALUES ($1,$2,$3,'MEDIA_PROCESSING',$4)",
      [operationId, owner, "user:" + owner, assetId],
    );
    await c.fixtures.query(
      "INSERT INTO movie.media_attempts(id,asset_id,operation_id,profile_version,config_hash,attempt_no,callback_context_hash) VALUES ($1,$2,$3,'hls-hd-v1',$4,1,$5)",
      [attemptId, assetId, operationId, hash("hls-hd-v1"), hash(randomUUID())],
    );
    await c.fixtures.query(
      "UPDATE movie.video_assets SET current_attempt_id=$2 WHERE id=$1",
      [assetId, attemptId],
    );
    await c.fixtures.query(
      "INSERT INTO movie.media_outputs(attempt_id,format,profile_version,config_hash,status) VALUES ($1,'HLS','hls-hd-v1',$2,'PENDING')",
      [attemptId, hash("hls-hd-v1")],
    );
    await c.fixtures.query(
      "INSERT INTO movie.outbox_events(id,type,aggregate_type,aggregate_id,aggregate_version,operation_id,initiating_actor_id,payload) VALUES ($1,'media.processing.requested','video_asset',$2,1,$3,$4,$5)",
      [
        eventId,
        assetId,
        operationId,
        owner,
        JSON.stringify({ attemptId, assetId, operationId }),
      ],
    );
    return { assetId, attemptId, operationId, intentId, eventId, publicId };
  }
  class FakeProvider extends CloudinaryProvider {
    override async lookup(publicId: string, policy: UploadPolicy) {
      if (pauseLookup) await pauseLookup();
      const x = (
        await c.fixtures.query(
          "SELECT * FROM movie.upload_intents WHERE target_public_id=$1",
          [publicId],
        )
      ).rows[0];
      return {
        public_id: publicId,
        asset_id: policy.assetId.replaceAll("-", ""),
        version: 1234,
        resource_type: "video",
        type: "authenticated",
        format: "mp4",
        bytes: source.length,
        duration: 12,
        width: 1280,
        height: 720,
        created_at: x.created_at.toISOString(),
        context: {
          custom: {
            intent_id: x.id,
            episode_id: x.episode_id,
            asset_id: policy.assetId,
            owner_user_id: x.owner_user_id,
          },
        },
      };
    }
    override async requestHls(asset: any, _policy: any, url: string) {
      requests++;
      callbacks.set(asset.current_attempt_id, url);
      return { batch_id: undefined, eager: [{ status: "processing" }] } as any;
    }
    override deliveryUrl(asset: any, _policy: any, hls = false) {
      return (
        "https://res.cloudinary.com/test-cloud/video/authenticated/" +
        (hls ? "sp_hd/" : "") +
        "v1234/" +
        asset.public_id +
        (hls ? ".m3u8" : ".mp4")
      );
    }
  }
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "res.cloudinary.com")
      return originalFetch(input, options);
    if (
      url.pathname.includes("/sp_hd/") &&
      !/\/(?:720|360)\.m3u8$/.test(url.pathname) &&
      !url.pathname.endsWith(".ts")
    ) {
      if (pending)
        return new Response("", {
          status: 423,
          headers: { "x-cld-error": "Processing" },
        });
      return new Response(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n" +
          (foreign ? "https://attacker.invalid/720.m3u8" : "720.m3u8") +
          "\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\n360.m3u8\n",
      );
    }
    if (url.pathname.endsWith(".m3u8"))
      return new Response(
        "#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXTINF:6,\nsegment2.ts\n#EXT-X-ENDLIST\n",
      );
    if (url.pathname.endsWith(".ts"))
      return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
    if (sourceError) return new Response("", { status: 503 });
    return new Response(new Uint8Array(source), {
      headers: { "Content-Length": String(source.length) },
    });
  };
  const worker = new MediaWorker(store, new FakeProvider(), backup);
  async function jobs(f: any) {
    await worker.receiveEvent(f.eventId);
    return (
      await c.fixtures.query(
        "SELECT * FROM movie.job_runs WHERE logical_key=$1 ORDER BY handler",
        [f.attemptId],
      )
    ).rows;
  }
  async function due(id: string) {
    await c.fixtures.query(
      "UPDATE movie.job_runs SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
  }
  async function state(f: any) {
    return (
      await c.fixtures.query(
        "SELECT v.processing_status,v.backup_status,a.status AS attempt_status,o.status AS operation_status FROM movie.video_assets v JOIN movie.media_attempts a ON a.id=v.current_attempt_id JOIN movie.operations o ON o.id=a.operation_id WHERE v.id=$1",
        [f.assetId],
      )
    ).rows[0];
  }
  async function webhook(
    f: any,
    opts: {
      badSignature?: boolean;
      timestamp?: string;
      raw?: string;
      nonce?: string;
    } = {},
  ) {
    const callback = new URL(callbacks.get(f.attemptId)!);
    const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
    const raw =
      opts.raw ??
      JSON.stringify({
        notification_type: "eager",
        public_id: f.publicId,
        resource_type: "video",
        type: "authenticated",
        asset_id: f.assetId.replaceAll("-", ""),
        version: 1234,
        extraFutureField: true,
      });
    const signature = createHash("sha1")
      .update(raw + timestamp + process.env.CLOUDINARY_API_SECRET)
      .digest("hex");
    return c
      .api(
        "post",
        "/api/v1/webhooks/cloudinary?attemptId=" +
          f.attemptId +
          "&context=" +
          (opts.nonce ?? callback.searchParams.get("context")),
      )
      .set("Content-Type", "application/json")
      .set("x-cld-timestamp", timestamp)
      .set("x-cld-signature", opts.badSignature ? "a".repeat(40) : signature)
      .send(raw);
  }
  try {
    await backup.check();
    assert.equal(
      (await store.pool.query("SELECT current_user")).rows[0].current_user,
      "pj_flim_worker",
    );
    checks++;
    await assert.rejects(
      store.pool.query("UPDATE movie.audit_logs SET action='tamper'"),
      (e) => (e as any).code === "42501",
    );
    checks++;
    await assert.rejects(
      store.pool.query("SELECT password_hash FROM movie.users"),
      (e) => (e as any).code === "42501",
    );
    checks++;
    // New immutable encoding policy completes the same backup/READY gate on a disposable DB.
    const encoded = await fixture();
    const legacyPolicy = (
      await c.fixtures.query(
        "SELECT expected_policy FROM movie.upload_intents WHERE verified_asset_id=$1",
        [encoded.assetId],
      )
    ).rows[0].expected_policy;
    const encoding = createEncodingSnapshot("balanced-720p-v1", {
      width: 1280,
      height: 720,
    });
    const encodedPolicy = {
      ...legacyPolicy,
      encodingPreset: encoding.presetId,
      encoding,
      streamingProfile: encoding.profileName,
      profileVersion: encoding.profileVersion,
    };
    const encodedHash = processingConfigHash(encodedPolicy);
    await c.fixtures.query(
      "UPDATE movie.upload_intents SET expected_policy=$2 WHERE verified_asset_id=$1",
      [encoded.assetId, encodedPolicy],
    );
    await c.fixtures.query(
      "UPDATE movie.media_attempts SET config_hash=$2,profile_version=$3 WHERE id=$1",
      [encoded.attemptId, encodedHash, encoding.profileVersion],
    );
    await c.fixtures.query(
      "UPDATE movie.media_outputs SET config_hash=$2,profile_version=$3 WHERE attempt_id=$1",
      [encoded.attemptId, encodedHash, encoding.profileVersion],
    );
    class EncodedProvider extends FakeProvider {
      override async assertStreamingProfile(p: any) {
        assertEncodingSnapshot(p, { width: 1280, height: 720 });
      }
      override deliveryUrl(asset: any, policy: any, hls = false) {
        return hls
          ? "https://res.cloudinary.com/test-cloud/encoded/master.m3u8"
          : super.deliveryUrl(asset, policy, hls);
      }
    }
    const legacyFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      if (
        String(input) ===
        "https://res.cloudinary.com/test-cloud/encoded/master.m3u8"
      )
        return new Response(
          "#EXTM3U\n" +
            encoding.rungs
              .map((r, i) => {
                const d = fittedDimensions(r, { width: 1280, height: 720 });
                return (
                  "#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=" +
                  d.width +
                  "x" +
                  d.height +
                  ',CODECS="avc1.64001f,mp4a.40.2"\n' +
                  i +
                  ".m3u8\n"
                );
              })
              .join(""),
        );
      return legacyFetch(input, options);
    };
    try {
      const encodedWorker = new MediaWorker(
        store,
        new EncodedProvider(),
        backup,
      );
      const encodedJobs = await jobs(encoded);
      const encodedHls = encodedJobs.find(
        (j: any) => j.handler === "media.hls",
      );
      const encodedBackup = encodedJobs.find(
        (j: any) => j.handler === "media.backup",
      );
      await encodedWorker.run(encodedHls.id);
      assert.notEqual((await state(encoded)).processing_status, "READY");
      checks++;
      await encodedWorker.run(encodedBackup.id);
      assert.equal((await state(encoded)).processing_status, "READY");
      checks++;
      const encodedOutput = (
        await c.fixtures.query(
          "SELECT rendition_summary FROM movie.media_outputs WHERE attempt_id=$1",
          [encoded.attemptId],
        )
      ).rows[0];
      assert.deepEqual(
        encodedOutput.rendition_summary.map((r: any) => r.height),
        [240, 360, 480, 720],
      );
      checks++;
      assert.ok(
        encodedOutput.rendition_summary.every((r: any) =>
          r.codecs.includes("avc1"),
        ),
      );
      checks++;
    } finally {
      globalThis.fetch = legacyFetch;
    }
    const f = await fixture(),
      list = await jobs(f),
      hls = list.find((j: any) => j.handler === "media.hls"),
      copy = list.find((j: any) => j.handler === "media.backup");
    await worker.receiveEvent(f.eventId);
    assert.equal((await jobs(f)).length, 2);
    checks++;
    pending = true;
    assert.equal(await worker.run(hls.id), "ack");
    checks++;
    assert.equal((await state(f)).processing_status, "PROCESSING");
    checks++;
    await due(hls.id);
    const before = requests;
    await worker.run(hls.id);
    assert.equal(requests, before);
    checks++;
    await expect(
      await webhook(f, { badSignature: true }),
      401,
      "WEBHOOK_SIGNATURE_INVALID",
    );
    await expect(
      await webhook(f, {
        timestamp: String(Math.floor(Date.now() / 1000) - 600),
      }),
      401,
      "WEBHOOK_TIMESTAMP_INVALID",
    );
    await expect(
      await webhook(f, { nonce: "b".repeat(64) }),
      401,
      "WEBHOOK_SIGNATURE_INVALID",
    );
    await expect(
      await webhook(f, { raw: "{broken" }),
      400,
      "REQUEST_MALFORMED_JSON",
    );
    await expect(await webhook(f), 200);
    const duplicate = await expect(await webhook(f), 200);
    assert.equal(duplicate.body.duplicate, true);
    checks++;
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS count FROM movie.inbox_events WHERE attempt_id=$1",
          [f.attemptId],
        )
      ).rows[0].count,
      1,
    );
    checks++;
    const hookEvent = (
      await c.fixtures.query(
        "SELECT id FROM movie.outbox_events WHERE type='media.webhook.received' AND aggregate_id=$1",
        [f.attemptId],
      )
    ).rows[0].id;
    await worker.receiveEvent(hookEvent);
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT status FROM movie.inbox_events WHERE attempt_id=$1",
          [f.attemptId],
        )
      ).rows[0].status,
      "PROCESSED",
    );
    checks++;
    pending = false;
    await due(hls.id);
    await worker.run(hls.id);
    assert.equal((await state(f)).processing_status, "PROCESSING");
    checks++;
    const ep = await expect(
      c.api("get", "/api/v1/admin/episodes/" + episode.id, c.rootToken),
      200,
    );
    await expect(
      c
        .api("patch", "/api/v1/admin/episodes/" + episode.id, c.rootToken)
        .set("If-Match", ep.headers.etag)
        .send({ activeAssetId: f.assetId }),
      409,
      "MEDIA_NOT_READY",
    );
    sourceError = true;
    await worker.run(copy.id);
    assert.notEqual((await state(f)).backup_status, "VERIFIED");
    checks++;
    sourceError = false;
    await due(copy.id);
    await worker.run(copy.id);
    assert.deepEqual(await state(f), {
      processing_status: "READY",
      backup_status: "VERIFIED",
      attempt_status: "SUCCEEDED",
      operation_status: "SUCCEEDED",
    });
    checks++;
    const saved = (
      await c.fixtures.query(
        "SELECT * FROM movie.source_backups WHERE asset_id=$1",
        [f.assetId],
      )
    ).rows[0];
    assert.equal(
      saved.sha256,
      createHash("sha256").update(source).digest("hex"),
    );
    assert.equal(Number(saved.bytes), source.length);
    checks += 2;
    assert.deepEqual(
      await readFile(resolve(process.env.BACKUP_LOCAL_ROOT!, saved.object_key)),
      source,
    );
    checks++;
    await worker.run(copy.id);
    await worker.receiveEvent(f.eventId);
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS count FROM movie.audit_logs WHERE action='media.processing.succeeded' AND operation_id=$1",
          [f.operationId],
        )
      ).rows[0].count,
      1,
    );
    checks++;
    const latest = await expect(
      c.api("get", "/api/v1/admin/episodes/" + episode.id, c.rootToken),
      200,
    );
    await c.fixtures.query(
      "UPDATE movie.source_backups SET bytes=bytes+1 WHERE asset_id=$1",
      [f.assetId],
    );
    await expect(
      c
        .api("patch", "/api/v1/admin/episodes/" + episode.id, c.rootToken)
        .set("If-Match", latest.headers.etag)
        .send({ activeAssetId: f.assetId }),
      409,
      "MEDIA_BACKUP_NOT_VERIFIED",
    );
    await c.fixtures.query(
      "UPDATE movie.source_backups SET bytes=bytes-1 WHERE asset_id=$1",
      [f.assetId],
    );
    const activated = await expect(
      c
        .api("patch", "/api/v1/admin/episodes/" + episode.id, c.rootToken)
        .set("If-Match", latest.headers.etag)
        .send({ activeAssetId: f.assetId }),
      200,
    );
    await expect(
      c
        .api(
          "put",
          "/api/v1/admin/episodes/" + episode.id + "/publication",
          c.rootToken,
        )
        .set("If-Match", activated.headers.etag)
        .send({ status: "PUBLISHED" }),
      200,
    );
    assert.equal((await expect(await webhook(f), 200)).body.ignored, true);
    checks++;
    // A same-size corrupted backup is detected by the full re-read SHA-256.
    const p = resolve(process.env.BACKUP_LOCAL_ROOT!, saved.object_key);
    await writeFile(p, Buffer.alloc(source.length, 7));
    await assert.rejects(
      backup.verifyExisting({
        provider: saved.storage_provider,
        bucket: saved.bucket,
        key: saved.object_key,
        version: null,
        manifestRef: saved.source_manifest_ref,
        sha256: saved.sha256,
        bytes: Number(saved.bytes),
      }),
    );
    checks++;
    await writeFile(p, source);
    const bad = await fixture(editorId),
      badJobs = await jobs(bad);
    await c.fixtures.query(
      "UPDATE movie.users SET status='SUSPENDED' WHERE id=$1",
      [editorId],
    );
    try {
      assert.equal(await worker.run(badJobs[0].id), "dead");
      checks++;
      assert.equal((await state(bad)).operation_status, "FAILED");
      checks++;
    } finally {
      await c.fixtures.query(
        "UPDATE movie.users SET status='ACTIVE' WHERE id=$1",
        [editorId],
      );
    }
    const retryPath =
        "/api/v1/admin/media-assets/" + bad.assetId + "/processing-attempts",
      retryKey = randomUUID();
    await expect(
      c
        .api("post", retryPath, c.editorToken)
        .set("Idempotency-Key", retryKey)
        .send({ reason: "Retry after recovery" }),
      403,
      "AUTH_FORBIDDEN",
    );
    const retried = await expect(
      c
        .api("post", retryPath, c.rootToken)
        .set("Idempotency-Key", retryKey)
        .send({ reason: "Retry after recovery" }),
      202,
    );
    assert.equal(retried.headers.location, retried.body.operationUrl);
    checks++;
    assert.deepEqual(
      (
        await expect(
          c
            .api("post", retryPath, c.rootToken)
            .set("Idempotency-Key", retryKey)
            .send({ reason: "Retry after recovery" }),
          202,
        )
      ).body,
      retried.body,
    );
    checks++;
    await expect(
      c
        .api("post", retryPath, c.rootToken)
        .set("Idempotency-Key", randomUUID())
        .send({ reason: "Retry while active" }),
      409,
      "MEDIA_PROCESSING_ALREADY_ACTIVE",
    );
    await expect(
      c
        .api("post", retryPath, c.rootToken)
        .set("Idempotency-Key", retryKey)
        .send({ reason: "Changed request" }),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    const oldVersion = (
      await c.fixtures.query(
        "SELECT current_attempt_id FROM movie.video_assets WHERE id=$1",
        [bad.assetId],
      )
    ).rows[0].current_attempt_id;
    await worker.run(badJobs[1].id);
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT current_attempt_id FROM movie.video_assets WHERE id=$1",
          [bad.assetId],
        )
      ).rows[0].current_attempt_id,
      oldVersion,
    );
    checks++;
    // A stale worker loses its fencing token before it can request a provider side effect.
    const fenced = await fixture(),
      fencedJobs = await jobs(fenced),
      fj = fencedJobs.find((j: any) => j.handler === "media.hls");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      seen = new Promise<void>((r) => (entered = r));
    pauseLookup = async () => {
      entered();
      await gate;
    };
    const running = worker.run(fj.id);
    await seen;
    await c.fixtures.query(
      "UPDATE movie.job_runs SET lease_owner='stolen',lease_token=lease_token+1,lease_until=now()+interval '1 minute' WHERE id=$1",
      [fj.id],
    );
    const requestsBefore = requests;
    release();
    await running;
    pauseLookup = undefined;
    assert.equal(requests, requestsBefore);
    checks++;
    await c.fixtures.query(
      "UPDATE movie.job_runs SET lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE id=$1",
      [fj.id],
    );
    await worker.run(fj.id);
    assert.equal(
      (
        await c.fixtures.query("SELECT state FROM movie.job_runs WHERE id=$1", [
          fj.id,
        ])
      ).rows[0].state,
      "SUCCEEDED",
    );
    checks++;
    const savedFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response("", {
          status: 400,
          headers: {
            "x-cld-error":
              "This transformation is a byproduct of a streaming profile, and cannot be derived directly",
          },
        });
      await assert.rejects(
        verifyHls(
          "https://res.cloudinary.com/test-cloud/video/authenticated/sp_hd/test.m3u8",
          "test-cloud",
          { width: 1280, height: 720, duration: 12 },
        ),
        MediaPending,
      );
      checks++;
      globalThis.fetch = async () =>
        new Response("", {
          status: 400,
          headers: { "x-cld-error": "Unknown streaming profile" },
        });
      await assert.rejects(
        verifyHls(
          "https://res.cloudinary.com/test-cloud/video/authenticated/sp_hd/test.m3u8",
          "test-cloud",
          { width: 1280, height: 720, duration: 12 },
        ),
        (e) =>
          e instanceof ApiError && e.code === "MEDIA_PROVIDER_BAD_RESPONSE",
      );
      checks++;
    } finally {
      globalThis.fetch = savedFetch;
    }
    foreign = true;
    await assert.rejects(
      verifyHls(
        "https://res.cloudinary.com/test-cloud/video/authenticated/sp_hd/test.m3u8",
        "test-cloud",
        { width: 1280, height: 720, duration: 12 },
      ),
      (e) => e instanceof ApiError,
    );
    checks++;
    foreign = false;
    // Confirmed publish, broker redelivery/deduplication, unroutable publish and DLQ.
    broker = new Broker();
    await broker.open();
    const real = await fixture(),
      publisher = new OutboxPublisher(store, broker);
    let events = 0;
    await broker.consume(async (message) => {
      if (message.kind === "event" && message.eventId === real.eventId) {
        events++;
        return worker.receiveEvent(message.eventId);
      }
      return "ack";
    });
    await publisher.tick();
    for (let i = 0; i < 100 && events < 1; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(events >= 1);
    checks++;
    assert.ok(
      (
        await c.fixtures.query(
          "SELECT published_at FROM movie.outbox_events WHERE id=$1",
          [real.eventId],
        )
      ).rows[0].published_at,
    );
    checks++;
    await broker.publish(
      { kind: "event", eventId: real.eventId },
      randomUUID(),
    );
    for (let i = 0; i < 100 && events < 2; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS count FROM movie.job_runs WHERE logical_key=$1",
          [real.attemptId],
        )
      ).rows[0].count,
      2,
    );
    checks++;
    const channel = (broker as any).channel,
      prefix = broker.cfg.prefix;
    await channel.unbindQueue(prefix + ".jobs", prefix + ".events", "work");
    await assert.rejects(
      broker.publish({ kind: "event", eventId: real.eventId }, randomUUID()),
    );
    checks++;
    await channel.bindQueue(prefix + ".jobs", prefix + ".events", "work");
    await new Promise<void>((resolve, reject) =>
      channel.publish(
        prefix + ".events",
        "work",
        Buffer.from("invalid-json"),
        { persistent: true },
        (e: any) => (e ? reject(e) : resolve()),
      ),
    );
    let dead: any;
    for (let i = 0; i < 100; i++) {
      dead = await channel.get(prefix + ".dlq", { noAck: true });
      if (dead) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(dead);
    checks++;
    await channel.deleteQueue(prefix + ".jobs");
    await channel.deleteQueue(prefix + ".dlq");
    await channel.deleteExchange(prefix + ".events");
    await channel.deleteExchange(prefix + ".dead");
    await broker.close();
    broker = undefined;
    const unpublished = await fixture();
    await c.fixtures.query(
      "UPDATE movie.outbox_events SET published_at=now()-interval '2 minutes' WHERE id=$1",
      [unpublished.eventId],
    );
    const failedPublisher = new OutboxPublisher(store, {
      publish: async () => {
        throw new Error("offline");
      },
    } as any);
    await assert.rejects(failedPublisher.tick());
    checks++;
    assert.equal(
      (
        await c.fixtures.query(
          "SELECT published_at FROM movie.outbox_events WHERE id=$1",
          [unpublished.eventId],
        )
      ).rows[0].published_at,
      null,
    );
    checks++;
    return checks;
  } finally {
    await broker?.close();
    backup.close();
    await store.close();
    globalThis.fetch = originalFetch;
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}
