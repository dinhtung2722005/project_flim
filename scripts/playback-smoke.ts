import "../apps/api/src/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Database, one } from "../packages/database/src/database";
import { CloudinaryProvider } from "../packages/media/src/cloudinary.provider";
import { verifyHls } from "../packages/media/src/hls-verifier";
let smokeStage = "database";
async function main() {
  const db = new Database(),
    provider = new CloudinaryProvider();
  try {
    await db.$connect();
    const asset = await one(
      db,
      "SELECT a.*,i.expected_policy,e.publication_status FROM movie.video_assets a JOIN movie.upload_intents i ON i.verified_asset_id=a.id JOIN movie.episodes e ON e.id=a.episode_id WHERE a.processing_status='READY' AND a.backup_status='VERIFIED' AND a.lifecycle_status='ACTIVE' ORDER BY a.updated_at DESC LIMIT 1",
    );
    if (!asset) throw new Error("VERIFIED_ASSET_REQUIRED");
    smokeStage = "adapter";
    const policy = asset.expected_policy;
    const url = provider.playbackUrl(asset, policy.streamingProfile);
    assert.equal(url, provider.deliveryUrl(asset, policy, true));
    smokeStage = "cdn";
    const renditions = await verifyHls(url, policy.cloudName, {
      width: asset.width,
      height: asset.height,
      duration: Number(asset.duration_seconds),
    });
    const result = {
      passed: true,
      checkedAt: new Date().toISOString(),
      assetId: asset.id,
      publicationStatus: asset.publication_status,
      adapterMatchesVerifiedPipeline: true,
      durationSeconds: Number(asset.duration_seconds),
      deliveryAuthorization: "SIGNED_URL",
      deliveryExpiresAt: null,
      renditions: renditions.map((r) => ({
        width: r.width,
        height: r.height,
        segmentVerified: true,
      })),
    };
    await mkdir(".local/api", { recursive: true });
    await writeFile(
      ".local/api/playback-smoke-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        event: "playback.smoke.passed",
        renditions: renditions.length,
        publicationStatus: asset.publication_status,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "playback.smoke.failed",
      stage: smokeStage,
      code: error?.code ?? "MEDIA_PROVIDER_UNAVAILABLE",
    }),
  );
  process.exitCode = 1;
});
