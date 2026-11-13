import "../apps/api/src/config";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { CloudinaryProvider } from "../packages/media/src/cloudinary.provider";
import { cloudinaryConfiguration } from "../packages/media/src/cloudinary.config";
import {
  ENCODING_PRESETS,
  createEncodingSnapshot,
} from "../packages/media/src/encoding-profiles";
const fullHd = process.env.PJ_FLIM_ENCODING_FULL_HD === "true";
const folder = fullHd ? ".local/encoding/full-hd" : ".local/encoding";
async function main() {
  if (process.env.PJ_FLIM_LIVE_ENCODING !== "true")
    throw Error("LIVE_ENCODING_OPT_IN_REQUIRED");
  const state = JSON.parse(await readFile(folder + "/live-state.json", "utf8"));
  if (!state.publicId?.startsWith("pj-flim/encoding-smoke/"))
    throw Error("DEDICATED_SMOKE_ASSET_REQUIRED");
  const cfg = cloudinaryConfiguration(),
    provider = new CloudinaryProvider(),
    src = state.source;
  if (state.cloudName !== cfg.cloudName) throw Error("ACCOUNT_MISMATCH");
  const browser = await chromium.launch({
    executablePath:
      process.env.PJ_FLIM_CHROME_PATH ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const checks: any[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    for (const preset of ENCODING_PRESETS.filter(
      (p) => !fullHd || p.id === "balanced-1080p-v1",
    )) {
      const plan = createEncodingSnapshot(preset.id, src);
      const policy: any = {
        cloudName: cfg.cloudName,
        apiKey: cfg.apiKey,
        parameters: { timestamp: 1 },
        signatureTimestamp: 1,
        deliveryType: "authenticated",
        streamingProfile: plan.profileName,
      };
      const url = provider.deliveryUrl(
        {
          public_id: state.publicId,
          provider_version: src.version,
          source_format: src.format,
        },
        policy,
        true,
      );
      await page.goto("about:blank");
      await page.setContent(
        '<video muted autoplay playsinline loop style="width:100%;max-height:650px;background:black"></video>',
      );
      await page.addScriptTag({
        path: require.resolve("hls.js/dist/hls.min.js"),
      });
      await page.evaluate((url) => {
        const w = window as any,
          v = document.querySelector("video")!;
        v.muted = true;
        w.failures = [];
        w.hls = new w.Hls({
          enableWorker: false,
          maxBufferLength: 6,
          maxMaxBufferLength: 12,
        });
        w.hls.on(w.Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal)
            w.failures.push({ type: data.type, details: data.details });
        });
        w.hls.attachMedia(v);
        w.hls.loadSource(url);
      }, url);
      await page.waitForFunction(
        () => ((window as any).hls?.levels?.length ?? 0) > 0,
        undefined,
        { timeout: 45000 },
      );
      const levels = await page.evaluate(() =>
        (window as any).hls.levels.map((l: any, i: number) => ({
          index: i,
          width: l.width,
          height: l.height,
        })),
      );
      for (const level of levels) {
        await page.evaluate((i) => {
          const v = document.querySelector("video")!;
          (window as any).hls.currentLevel = i;
          v.currentTime = 1;
          void v.play();
        }, level.index);
        await page.waitForFunction(
          (height) => {
            const v = document.querySelector("video")!;
            return (
              v.readyState >= 2 &&
              v.videoHeight === height &&
              v.currentTime > 1.5 &&
              !v.error
            );
          },
          level.height,
          { timeout: 45000 },
        );
        const actual = await page.evaluate(() => {
          const v = document.querySelector("video")!;
          return {
            width: v.videoWidth,
            height: v.videoHeight,
            time: v.currentTime,
            decoded: v.getVideoPlaybackQuality().totalVideoFrames,
            failures: (window as any).failures,
          };
        });
        if (actual.failures.length || actual.decoded < 1)
          throw Error("PLAYER_DECODE_FAILED");
        checks.push({
          preset: preset.id,
          requested: level.height,
          decodedWidth: actual.width,
          decodedHeight: actual.height,
          decodedFrames: actual.decoded,
        });
        console.log(
          JSON.stringify({
            event: "encoding.player.level",
            preset: preset.id,
            height: actual.height,
            decodedFrames: actual.decoded,
          }),
        );
      }
      await page.screenshot({
        path: folder + "/player-" + preset.id + ".png",
      });
      await page.evaluate(() => {
        (window as any).hls.destroy();
        const v = document.querySelector("video")!;
        v.pause();
        v.removeAttribute("src");
        v.load();
      });
    }
    await writeFile(
      folder + "/player-result.json",
      JSON.stringify(
        {
          passed: true,
          checkedAt: new Date().toISOString(),
          browser: "Chrome Windows",
          provider: "Cloudinary live",
          source: {
            width: src.width,
            height: src.height,
            duration: src.duration,
          },
          checks,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        event: "encoding.player.passed",
        checks: checks.length,
      }),
    );
  } finally {
    await browser.close();
  }
}
main().catch(() => {
  console.error(JSON.stringify({ event: "encoding.player.failed" }));
  process.exitCode = 1;
});
