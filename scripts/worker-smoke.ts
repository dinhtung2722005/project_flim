import "../apps/api/src/config";
import "../apps/worker/src/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { WorkerStore } from "../apps/worker/src/store";
import { BackupStorage } from "../packages/media/src/backup-storage";
import { CloudinaryProvider } from "../packages/media/src/cloudinary.provider";
import { verifyHls, MediaPending } from "../packages/media/src/hls-verifier";
export async function verifyMediaPipeline(
  assetId?: string,
  timeoutMs = 15 * 60 * 1000,
) {
  const previous = JSON.parse(
    await readFile(".local/media/smoke-result.json", "utf8").catch(() => "{}"),
  );
  assetId = assetId ?? previous.assetId;
  if (!assetId || !/^[a-f0-9-]{36}$/i.test(assetId))
    throw new Error("ASSET_ID_REQUIRED");
  const store = new WorkerStore(),
    storage = new BackupStorage(),
    provider = new CloudinaryProvider(),
    started = Date.now();
  let snapshot: any,
    lastState = "";
  try {
    for (;;) {
      snapshot = (
        await store.pool.query(
          "SELECT v.*,a.id AS attempt_id,a.status AS attempt_status,a.config_hash,a.profile_version,o.id AS operation_id,o.status AS operation_status,e.publication_status,i.expected_policy FROM movie.video_assets v JOIN movie.media_attempts a ON a.id=v.current_attempt_id JOIN movie.operations o ON o.id=a.operation_id JOIN movie.episodes e ON e.id=v.episode_id JOIN movie.upload_intents i ON i.verified_asset_id=v.id WHERE v.id=$1",
          [assetId],
        )
      ).rows[0];
      if (!snapshot) throw new Error("ASSET_NOT_VERIFIED");
      const state = [
        snapshot.processing_status,
        snapshot.backup_status,
        snapshot.operation_status,
      ].join("/");
      if (state !== lastState) {
        console.log(JSON.stringify({ event: "worker.smoke.progress", state }));
        lastState = state;
      }
      if (snapshot.operation_status === "FAILED")
        throw new Error("MEDIA_PROCESSING_FAILED");
      if (
        snapshot.processing_status === "READY" &&
        snapshot.backup_status === "VERIFIED" &&
        snapshot.attempt_status === "SUCCEEDED" &&
        snapshot.operation_status === "SUCCEEDED"
      ) {
        const delivered = (
          await store.pool.query(
            "SELECT count(*)::int AS count FROM movie.inbox_events WHERE source='CLOUDINARY' AND attempt_id=$1 AND status IN ('PROCESSED','REJECTED')",
            [snapshot.attempt_id],
          )
        ).rows[0].count;
        if (delivered > 0) break;
      }
      if (Date.now() - started > timeoutMs)
        throw new Error("WORKER_PIPELINE_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const output = (
      await store.pool.query(
        "SELECT * FROM movie.media_outputs WHERE attempt_id=$1 AND format='HLS' AND config_hash=$2 AND profile_version=$3 AND status='READY' AND verified_at IS NOT NULL",
        [snapshot.attempt_id, snapshot.config_hash, snapshot.profile_version],
      )
    ).rows[0];
    if (!output) throw new Error("HLS_OUTPUT_MISSING");
    async function verifyPublishedHls(): Promise<
      Awaited<ReturnType<typeof verifyHls>>
    > {
      for (;;) {
        try {
          return await verifyHls(
            provider.deliveryUrl(snapshot, snapshot.expected_policy, true),
            snapshot.expected_policy.cloudName,
            {
              width: snapshot.width,
              height: snapshot.height,
              duration: Number(snapshot.duration_seconds),
            },
            undefined,
            snapshot.expected_policy.encoding,
          );
        } catch (error) {
          if (
            !(error instanceof MediaPending) ||
            Date.now() - started >= timeoutMs
          )
            throw error;
          console.log(JSON.stringify({ event: "worker.smoke.cdn_pending" }));
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }
    const renditions = await verifyPublishedHls();
    const backup = (
      await store.pool.query(
        "SELECT * FROM movie.source_backups WHERE asset_id=$1 AND status='VERIFIED'",
        [assetId],
      )
    ).rows[0];
    if (
      !backup ||
      Number(backup.bytes) !== Number(snapshot.bytes) ||
      !backup.source_manifest_ref
    )
      throw new Error("BACKUP_NOT_VERIFIED");
    await storage.verifyExisting({
      provider: backup.storage_provider,
      bucket: backup.bucket,
      key: backup.object_key,
      version: backup.object_version,
      manifestRef: backup.source_manifest_ref,
      sha256: backup.sha256,
      bytes: Number(backup.bytes),
    });
    if (
      previous.assetId === assetId &&
      previous.sourceSha256 &&
      previous.sourceSha256 !== backup.sha256
    )
      throw new Error("BACKUP_SOURCE_HASH_MISMATCH");
    const callbacks = (
      await store.pool.query(
        "SELECT count(*)::int AS count FROM movie.inbox_events WHERE source='CLOUDINARY' AND attempt_id=$1 AND status IN ('PROCESSED','REJECTED')",
        [snapshot.attempt_id],
      )
    ).rows[0].count;
    if (callbacks < 1) throw new Error("VERIFIED_WEBHOOK_NOT_RECEIVED");
    const jobs = (
      await store.pool.query(
        "SELECT handler,state,attempt_count FROM movie.job_runs WHERE logical_key=$1 ORDER BY handler",
        [snapshot.attempt_id],
      )
    ).rows;
    if (jobs.length !== 2 || jobs.some((j) => j.state !== "SUCCEEDED"))
      throw new Error("WORKER_JOBS_INCOMPLETE");
    const result = {
      passed: true,
      checkedAt: new Date().toISOString(),
      assetId,
      attemptId: snapshot.attempt_id,
      operationId: snapshot.operation_id,
      processingStatus: snapshot.processing_status,
      backupStatus: snapshot.backup_status,
      operationStatus: snapshot.operation_status,
      publicationStatus: snapshot.publication_status,
      durationSeconds: Number(snapshot.duration_seconds),
      bytes: Number(snapshot.bytes),
      backup: {
        provider: backup.storage_provider,
        sha256: backup.sha256,
        bytes: Number(backup.bytes),
        rereadVerified: true,
        sourceHashMatches:
          previous.assetId === assetId &&
          previous.sourceSha256 === backup.sha256,
      },
      verifiedWebhooks: callbacks,
      renditions,
      jobs,
    };
    await mkdir(".local/worker", { recursive: true });
    await writeFile(
      ".local/worker/pipeline-smoke-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        event: "worker.smoke.passed",
        assetId,
        backup: backup.storage_provider,
        renditions: renditions.length,
        verifiedWebhooks: callbacks,
      }),
    );
    return result;
  } finally {
    storage.close();
    await store.close();
  }
}
if (require.main === module)
  verifyMediaPipeline(process.argv[2]).catch(() => {
    console.error(
      JSON.stringify({
        event: "worker.smoke.failed",
        code: "MEDIA_PROCESSING_FAILED",
        report: ".local/worker/pipeline-smoke-result.json",
      }),
    );
    process.exitCode = 1;
  });
