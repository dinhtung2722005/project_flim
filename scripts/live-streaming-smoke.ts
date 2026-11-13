import "../apps/api/src/config";
import "../apps/worker/src/config";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  chromium,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { verifyMediaPipeline } from "./worker-smoke";

const folder = ".local/web/live-streaming";
let stage = "startup",
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let adminPage: Page | undefined;
let lastPage: Page | undefined;
let adminToken = "",
  viewerToken = "";
const base = process.env.PJ_FLIM_TEST_API_URL || "http://127.0.0.1:3000";
type Episode = {
  id: string;
  number: number;
  file: string;
  assetId?: string;
  intentId?: string;
  sha256?: string;
  published?: boolean;
};
type State = {
  titleId: string;
  seasonId?: string;
  name: string;
  episodes: Episode[];
  published?: boolean;
  createdAt: string;
};
let state: State;
const report: any = {
  startedAt: new Date().toISOString(),
  passed: false,
  checks: [],
  metrics: {},
  mockedProvider: false,
};
function event(name: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event: name, ...details }));
}
async function saveState() {
  await writeFile(folder + "/state.json", JSON.stringify(state, null, 2));
}
async function saveReport() {
  const mode = process.argv[2] || "all";
  if (["prepare", "playback"].includes(mode))
    await writeFile(
      folder + "/" + mode + "-result.json",
      JSON.stringify({ ...report, stage }, null, 2),
    );
  await writeFile(
    folder + "/result.json",
    JSON.stringify({ ...report, stage }, null, 2),
  );
}
function check(
  name: string,
  ok: boolean,
  details: Record<string, unknown> = {},
) {
  assert.ok(ok, name);
  report.checks.push({ name, passed: true, ...details });
  event("live.check", { name, ...details });
}
async function call(
  path: string,
  token = adminToken,
  method = "GET",
  body?: unknown,
) {
  if (token && token === adminToken && adminPage && !adminPage.isClosed()) {
    const latest = await adminPage.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("pj-flim.auth") || "null")
          ?.accessToken,
    );
    if (latest) token = adminToken = latest;
  }
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(data?.code || "API_" + r.status);
  return data;
}
async function login(
  page: Page,
  user: { email: string; password: string },
  next = "/admin",
) {
  await page.goto(base + "/login?next=" + encodeURIComponent(next));
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/auth/sessions") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const r = await response;
  assert.equal(r.status(), 201, "LOGIN_STATUS");
  const auth = await r.json();
  assert.equal(auth.state, "ACTIVE", "LOCAL_PASSWORD_POLICY");
  await page.waitForURL(base + next);
  await page.waitForLoadState("networkidle");
  return auth.accessToken as string;
}
async function waitMedia(page: Page, position: number, timeout = 60000) {
  await expect
    .poll(
      async () =>
        page.locator("video").evaluate((v: HTMLVideoElement) => ({
          time: v.currentTime,
          ready: v.readyState,
          paused: v.paused,
          error: !!v.error,
        })),
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toMatchObject({ ready: expect.any(Number), error: false });
  await page.waitForFunction(
    (p) => {
      const v = document.querySelector("video");
      return (
        v && !v.paused && !v.ended && v.readyState >= 2 && v.currentTime > p
      );
    },
    position,
    { timeout },
  );
}
async function play(page: Page) {
  const video = page.locator("video");
  for (let attempt = 0; attempt < 3; attempt++) {
    // The element is visible before resume lookup and attachMedia/loadSource finish.
    // Wait for a source, and only retry AbortError from an interrupted source load.
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), {
        timeout: 30000,
      })
      .toBeGreaterThanOrEqual(1);
    const started = await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          v.play(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("PLAYBACK_START_TIMEOUT")),
              25000,
            );
          }),
        ]);
        return true;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return false;
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
    if (started) return;
  }
  throw new Error("PLAYBACK_SOURCE_REPEATEDLY_INTERRUPTED");
}
async function pause(page: Page) {
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
}
async function logout(page: Page) {
  await page.locator(".account-menu summary").click();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
}
async function prepare(
  context: BrowserContext,
  admin: { email: string; password: string },
) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  adminPage = page;
  adminToken = await login(page, admin);
  try {
    state = JSON.parse(await readFile(folder + "/state.json", "utf8"));
  } catch {
    state = {
      titleId: "",
      name:
        "Kiểm thử streaming " +
        new Date().toISOString().slice(0, 10) +
        " " +
        randomUUID().slice(0, 6),
      episodes: [],
      createdAt: new Date().toISOString(),
    };
  }
  if (!state.titleId) {
    stage = "create-title";
    await page.goto(base + "/admin/titles/new");
    await page.getByLabel("Tên phim *", { exact: true }).fill(state.name);
    stage = "select-kind";
    await page.getByLabel("Loại phim", { exact: true }).selectOption("SERIES");
    await page
      .getByLabel("Giới thiệu", { exact: true })
      .fill(
        "Phim thử kỹ thuật: video dài và bản cắt ngắn để nghiệm thu HLS, đổi tập và tiến trình. Không phải nội dung phát hành.",
      );
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/titles") && r.request().method() === "POST",
    );
    stage = "submit-title";
    await page.getByRole("button", { name: "Tạo phim", exact: true }).click();
    const r = await response;
    assert.equal(r.status(), 201);
    state.titleId = (await r.json()).id;
    await saveState();
  }
  await page.goto(base + "/admin/titles/" + state.titleId);
  await page.waitForLoadState("networkidle");
  if (!state.seasonId) {
    const seasons = await call("/admin/titles/" + state.titleId + "/seasons");
    if (seasons.data.length) state.seasonId = seasons.data[0].id;
    else {
      await page.getByRole("button", { name: "Thêm mùa", exact: true }).click();
      await page
        .getByLabel("Tên mùa", { exact: true })
        .fill("Nghiệm thu local");
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/seasons") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Thêm", exact: true }).click();
      const r = await response;
      assert.equal(r.status(), 201);
      state.seasonId = (await r.json()).id;
    }
    await saveState();
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
  const sources = [
    process.env.PJ_FLIM_LIVE_VIDEO || ".local/media/test123-under-limit.mp4",
    process.env.PJ_FLIM_LIVE_SHORT_VIDEO ||
      ".local/media/streaming-short-test.mp4",
  ];
  for (let number = 1; number <= 2; number++) {
    stage = "episode-" + number;
    let item = state.episodes.find((e) => e.number === number);
    if (!item) {
      const existing = (
        await call("/admin/seasons/" + state.seasonId + "/episodes")
      ).data.find((e: any) => e.number === number);
      if (existing)
        item = { id: existing.id, number, file: sources[number - 1] };
      else {
        await page
          .getByRole("button", { name: "Thêm tập", exact: true })
          .click();
        await page.getByLabel("Số tập", { exact: true }).fill(String(number));
        await page
          .getByLabel("Tên tập", { exact: true })
          .fill(
            number === 1
              ? "Video dài — kiểm tra HD và tua"
              : "Video ngắn — kiểm tra đổi tập và kết thúc",
          );
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/episodes") && r.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Thêm", exact: true }).click();
        const r = await response;
        assert.equal(r.status(), 201);
        item = { id: (await r.json()).id, number, file: sources[number - 1] };
      }
      state.episodes.push(item!);
      await saveState();
    }
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .locator(".admin-episode")
      .filter({ hasText: number === 1 ? "Video dài" : "Video ngắn" })
      .click();
    await expect(page.getByLabel("Chọn video", { exact: true })).toBeVisible();
    const file = resolve(item.file);
    assert.ok((await stat(file)).size > 0);
    if (!item.sha256) {
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(file)) digest.update(chunk);
      item.sha256 = digest.digest("hex");
      await saveState();
    }
    if (!item.assetId) {
      stage = "upload-" + number;
      const uploaded = page.waitForResponse(
        (r) =>
          r.url().includes("/upload-intents/") &&
          r.url().endsWith("/verifications") &&
          r.request().method() === "POST",
        { timeout: 20 * 60 * 1000 },
      );
      const capture = async (r: any) => {
        if (
          r.url().endsWith("/episodes/" + item!.id + "/upload-intents") &&
          r.request().method() === "POST" &&
          r.status() === 201
        ) {
          const intent = await r.json();
          item!.assetId = intent.assetId;
          item!.intentId = intent.id;
          await saveState();
        }
      };
      page.on("response", capture);
      await page.getByLabel("Chọn video", { exact: true }).setInputFiles(file);
      await page
        .getByRole("button", { name: "Tải video", exact: true })
        .click();
      event("live.upload.started", {
        episode: number,
        bytes: (await stat(file)).size,
      });
      const heartbeat = setInterval(
        () => event("live.upload.waiting", { episode: number }),
        30000,
      );
      try {
        const r = await uploaded;
        assert.equal(r.status(), 200, "VERIFICATION_STATUS");
        const data = await r.json();
        item.assetId = data.assetId;
        await saveState();
      } finally {
        clearInterval(heartbeat);
        page.off("response", capture);
      }
    } else {
      // Reconcile a completed upload after an interrupted browser run.
      const asset = await call("/admin/media-assets/" + item.assetId);
      if (asset.processingStatus === "PENDING_UPLOAD")
        throw new Error("UPLOAD_INTERRUPTED_VERIFY_INTENT_BEFORE_REUPLOAD");
    }
    stage = "pipeline-" + number;
    event("live.pipeline.waiting", { episode: number, assetId: item.assetId });
    const verified = await verifyMediaPipeline(item.assetId, 20 * 60 * 1000);
    check(
      "episode-" + number + "-pipeline",
      verified.processingStatus === "READY" &&
        verified.backupStatus === "VERIFIED" &&
        verified.backup.sha256 === item.sha256,
      {
        durationSeconds: verified.durationSeconds,
        renditions: verified.renditions.map((r: any) => r.height),
        verifiedWebhooks: verified.verifiedWebhooks,
      },
    );
    report["pipeline" + number] = {
      assetId: item.assetId,
      durationSeconds: verified.durationSeconds,
      renditions: verified.renditions.map((r: any) => ({
        width: r.width,
        height: r.height,
      })),
      backupHashMatchesSource: true,
      webhooks: verified.verifiedWebhooks,
    };
    await saveReport();
    // Recover the UI upload record across a new browser process using IDs only.
    await page.evaluate(
      ({ id, asset, owner, intent }) => {
        const key = "pj-flim.upload:" + owner + ":" + id;
        const existing = sessionStorage.getItem(key);
        if (!existing)
          sessionStorage.setItem(
            key,
            JSON.stringify({
              intentId: intent,
              assetId: asset,
              verifyKey: crypto.randomUUID(),
            }),
          );
      },
      {
        id: item.id,
        asset: item.assetId,
        owner: (await call("/me")).id,
        intent: item.intentId || "",
      },
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .locator(".admin-episode")
      .filter({ hasText: number === 1 ? "Video dài" : "Video ngắn" })
      .click();
    const episode = await call("/admin/episodes/" + item.id);
    if (episode.activeAssetId !== item.assetId) {
      await expect(
        page.getByRole("button", { name: "Sử dụng video này", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/admin/episodes/" + item!.id) &&
          r.request().method() === "PATCH",
      );
      await page
        .getByRole("button", { name: "Sử dụng video này", exact: true })
        .click();
      assert.equal((await response).status(), 200);
    }
    if (episode.publicationStatus !== "PUBLISHED") {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/admin/episodes/" + item!.id + "/publication") &&
          r.request().method() === "PUT",
      );
      await page
        .getByRole("button", { name: "Xuất bản tập phim", exact: true })
        .click();
      assert.equal((await response).status(), 200);
    }
    item.published = true;
    await saveState();
    event("live.episode.published", { number });
  }
  if (!state.published) {
    page.once("dialog", (d) => void d.accept());
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/titles/" + state.titleId + "/publication") &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Xuất bản phim", exact: true })
      .click();
    assert.equal((await response).status(), 200);
    state.published = true;
    await saveState();
  }
  check(
    "public-title-visible",
    (await call("/titles/" + state.titleId, "")).id === state.titleId,
  );
  await page.goto(base + "/titles/" + state.titleId);
  await expect(
    page.getByRole("heading", { name: state.name, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: folder + "/title.png", fullPage: true });
  await call("/auth/sessions/current", adminToken, "DELETE");
  adminToken = "";
  await page.close();
}
async function playback(context: BrowserContext) {
  stage = "playback";
  state = JSON.parse(await readFile(folder + "/state.json", "utf8"));
  assert.ok(state.published);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  lastPage = page;
  let workerCount = 0;
  page.on("worker", () => workerCount++);
  const requests: { status: number; host: string; kind: string }[] = [],
    pageErrors: string[] = [];
  report.metrics.cdnResponses = requests;
  page.on("pageerror", (e) => pageErrors.push(e.name));
  page.on("response", (r) => {
    const url = new URL(r.url());
    if (url.hostname === "res.cloudinary.com")
      requests.push({
        status: r.status(),
        host: url.hostname,
        kind: url.pathname.endsWith(".m3u8") ? "playlist" : "media",
      });
  });
  let user: { email: string; password: string };
  try {
    if (process.env.PJ_FLIM_LIVE_FRESH_VIEWER === "true")
      throw new Error("FRESH_VIEWER_REQUESTED");
    user = JSON.parse(await readFile(folder + "/viewer.json", "utf8"));
  } catch {
    user = {
      email: "stream-" + randomUUID().slice(0, 12) + "@example.test",
      password: randomUUID() + "Az1!",
    };
    await call("/users", "", "POST", {
      ...user,
      displayName: "Người xem nghiệm thu",
    });
    await writeFile(folder + "/viewer.json", JSON.stringify(user));
  }
  viewerToken = await login(page, user, "/");
  const first = state.episodes.find((e) => e.number === 1)!,
    second = state.episodes.find((e) => e.number === 2)!;
  await page.goto(base + "/titles/" + state.titleId);
  const opened = page.waitForResponse(
    (r) =>
      r.url().endsWith("/episodes/" + first.id + "/playback-sessions") &&
      r.request().method() === "POST",
  );
  const started = Date.now();
  await page.getByRole("link", { name: "Xem ngay", exact: true }).click();
  assert.equal((await opened).status(), 201);
  await expect(page.locator("video")).toBeVisible();
  await play(page);
  await waitMedia(page, 1);
  report.metrics.startupMs = Date.now() - started;
  check(
    "decoded-playback",
    await page
      .locator("video")
      .evaluate(
        (v: HTMLVideoElement) =>
          v.videoWidth > 0 &&
          v.videoHeight > 0 &&
          v.getVideoPlaybackQuality().totalVideoFrames > 0,
      ),
  );
  await expect(
    page.getByLabel("Chất lượng video", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const options = await page
    .getByLabel("Chất lượng video", { exact: true })
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        value: (n as HTMLOptionElement).value,
        label: n.textContent,
      })),
    );
  report.metrics.availableQualities = options.map((o) => o.label);
  const hd = options.find((o) => o.label === "720p");
  assert.ok(hd, "720P_REQUIRED");
  await page
    .getByLabel("Chất lượng video", { exact: true })
    .selectOption(hd.value);
  await page.waitForFunction(
    () => document.querySelector("video")?.videoHeight === 720,
    null,
    { timeout: 60000 },
  );
  await waitMedia(page, 2);
  check("hd-720p", true);
  const low =
    options.find((o) => o.label === "360p") ||
    options.find((o) => o.label === "270p");
  assert.ok(low);
  await page
    .getByLabel("Chất lượng video", { exact: true })
    .selectOption(low.value);
  const lowHeight = Number(low.label!.replace("p", ""));
  await page.waitForFunction(
    (h) => document.querySelector("video")?.videoHeight === h,
    lowHeight,
    { timeout: 60000 },
  );
  check("manual-quality-down", true, { height: lowHeight });
  await page.getByLabel("Chất lượng video", { exact: true }).selectOption("-1");
  check("quality-auto", true);
  stage = "seek";
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 300;
  });
  await play(page);
  await waitMedia(page, 301);
  check("seek-forward", true);
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 60;
  });
  await play(page);
  await waitMedia(page, 62);
  check("seek-backward", true);
  await page.getByLabel("Tốc độ phát", { exact: true }).selectOption("1.5");
  check(
    "speed-1.5",
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.playbackRate === 1.5),
  );
  stage = "progress";
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 150;
  });
  await play(page);
  await waitMedia(page, 154);
  await pause(page);
  await expect
    .poll(
      async () =>
        Number(
          (await call("/me/watch-progress/" + first.id, viewerToken))
            .positionSeconds,
        ),
      { timeout: 30000 },
    )
    .toBeGreaterThan(150);
  const saved = await call("/me/watch-progress/" + first.id, viewerToken);
  check(
    "progress-persisted",
    saved.positionSeconds >= 150 && saved.watchedSeconds < 100,
    {
      positionSeconds: saved.positionSeconds,
      watchedSeconds: saved.watchedSeconds,
    },
  );
  await page.getByRole("link", { name: "Chi tiết phim", exact: true }).click();
  await logout(page);
  viewerToken = await login(page, user, "/library");
  await page.getByRole("button", { name: "Xem tiếp", exact: true }).click();
  await page.getByRole("link").filter({ hasText: "Video dài" }).first().click();
  await expect(page.locator("video")).toBeVisible();
  await play(page);
  await page.waitForFunction(
    (p) => {
      const v = document.querySelector("video");
      return !!v && v.currentTime >= p - 2;
    },
    saved.positionSeconds,
    { timeout: 60000 },
  );
  check("resume-after-login", true, {
    savedPositionSeconds: saved.positionSeconds,
  });
  stage = "offline-recovery";
  await context.setOffline(true);
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 650;
  });
  await page.waitForTimeout(8000);
  const stalled = await page
    .locator("video")
    .evaluate((v: HTMLVideoElement) => v.currentTime < 651 || v.readyState < 3);
  await context.setOffline(false);
  await play(page);
  await waitMedia(page, 651, 90000);
  check("offline-recovery", stalled);
  await page.screenshot({ path: folder + "/player.png", fullPage: true });
  stage = "episode-switch";
  const oldSession = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("pj-flim.auth") || "null"),
  );
  assert.ok(oldSession); // tokens stay in browser/runtime; never add to report.
  const closed = page.waitForResponse(
    (r) =>
      /\/playback-sessions\/[^/]+$/.test(new URL(r.url()).pathname) &&
      r.request().method() === "DELETE",
  );
  await page.getByRole("link").filter({ hasText: "Video ngắn" }).click();
  assert.equal((await closed).status(), 204);
  await play(page);
  await waitMedia(page, 1);
  check("episode-switch", (await page.locator("video").count()) === 1);
  const shortDuration = await page
    .locator("video")
    .evaluate((v: HTMLVideoElement) => v.duration);
  check("second-source-duration", shortDuration > 40 && shortDuration < 50, {
    durationSeconds: shortDuration,
  });
  await page.getByLabel("Tốc độ phát", { exact: true }).selectOption("2");
  // Let the short episode play naturally to establish real watched coverage.
  await page.waitForFunction(
    () => document.querySelector("video")?.ended,
    null,
    { timeout: 60000 },
  );
  await expect
    .poll(
      async () =>
        !!(await call("/me/watch-progress/" + second.id, viewerToken))
          .completedAt,
      { timeout: 30000 },
    )
    .toBe(true);
  check("ended-completed", true);
  const endProgress = await call(
    "/me/watch-progress/" + second.id,
    viewerToken,
  );
  report.metrics.completedWatchedSeconds = endProgress.watchedSeconds;
  const collector = await call("/me/history?limit=100", viewerToken);
  check(
    "history-two-episodes",
    collector.data.some((r: any) => r.episodeId === first.id) &&
      collector.data.some((r: any) => r.episodeId === second.id),
  );
  check(
    "cdn-playlists-and-segments",
    requests.some((r) => r.kind === "playlist" && r.status === 200) &&
      requests.some((r) => r.kind === "media" && [200, 206].includes(r.status)),
    { cdnResponses: requests.length },
  );
  check("hls-worker-started", workerCount > 0, { workers: workerCount });
  check("no-browser-crash", pageErrors.length === 0);
  await page.getByRole("link", { name: "Chi tiết phim", exact: true }).click();
  await logout(page);
  viewerToken = "";
  await page.close();
}
async function main() {
  if (process.env.PJ_FLIM_LIVE_MEDIA !== "true")
    throw new Error(
      "Set PJ_FLIM_LIVE_MEDIA=true: this smoke uploads real video, consumes Cloudinary quota and publishes its own local test title.",
    );
  const origin = new URL(base);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname)
  )
    throw new Error("LOCAL_API_REQUIRED");
  await mkdir(folder, { recursive: true });
  const mode = process.argv[2] || "all";
  if (!["all", "prepare", "playback"].includes(mode))
    throw new Error("INVALID_MODE");
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PJ_FLIM_CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const admin = JSON.parse(
    await readFile(".local/api/bootstrap-admin.json", "utf8"),
  );
  if (mode !== "playback") await prepare(context, admin);
  if (mode !== "prepare") await playback(context);
  report.passed = true;
  report.finishedAt = new Date().toISOString();
  if (state) report.titleId = state.titleId;
  await saveReport();
  event("live.smoke.passed", {
    checks: report.checks.length,
    titleId: state?.titleId,
    mode,
  });
}
main()
  .catch(async (error) => {
    if (lastPage && !lastPage.isClosed()) {
      report.metrics.video = await lastPage
        .locator("video")
        .evaluate((v: HTMLVideoElement) => ({
          ready: v.readyState,
          network: v.networkState,
          time: v.currentTime,
          error: v.error?.code,
          nativeHls: v.canPlayType("application/vnd.apple.mpegurl"),
          managed: "ManagedMediaSource" in window,
          frames: v.getVideoPlaybackQuality().totalVideoFrames,
        }))
        .catch(() => null);
      report.metrics.playerError = await lastPage
        .locator(".video-error")
        .innerText()
        .catch(() => "");
      await lastPage
        .screenshot({ path: folder + "/failure.png", fullPage: true })
        .catch(() => {});
    }
    report.error = {
      stage,
      message: String(error?.message || "")
        .replace(/https?:\/\/[^\s]+/g, "[redacted-url]")
        .slice(0, 1500),
      code: /^[A-Z0-9_]+$/.test(error?.message || "")
        ? error.message
        : error?.name || "LIVE_TEST_FAILED",
    };
    await saveReport().catch(() => {});
    event("live.smoke.failed", report.error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (adminToken)
      await call("/auth/sessions/current", adminToken, "DELETE").catch(
        () => {},
      );
    if (viewerToken)
      await call("/auth/sessions/current", viewerToken, "DELETE").catch(
        () => {},
      );
    await browser?.close();
  });
