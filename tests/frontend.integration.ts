import { runRecommendationBrowserChecks } from "./recommendations.browser";
import { runLiveSearchChecks } from "./live-search.browser";
import { runAdminPagesChecks } from "./admin-pages.browser";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, expect, type Page } from "@playwright/test";
import { v2 as cloudinary } from "cloudinary";
import type { Pool } from "pg";

type Fixture = { id: string; email: string; password: string };
export async function runFrontendChecks(c: {
  server: any;
  fixtures: Pool;
  seed: (role: string, withMfa?: boolean) => Promise<Fixture>;
}) {
  let checks = 0;
  const prior = process.env.AUTH_MFA_REQUIRED;
  const originalPreset = cloudinary.api.upload_preset,
    originalResource = cloudinary.api.resource;
  const cloud = cloudinary as any;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const errors: string[] = [];
  const check = async (assertion: () => Promise<unknown>) => {
    await assertion();
    checks++;
  };
  const eq = (a: unknown, b: unknown) => {
    assert.equal(a, b);
    checks++;
  };
  await mkdir(".local/web/screenshots", { recursive: true });
  try {
    process.env.AUTH_MFA_REQUIRED = "false";
    const database = (
      await c.fixtures.query("SELECT current_database() AS name")
    ).rows[0].name;
    assert.match(database, /^pj_flim_test_[a-f0-9]{12}$/);
    // A prior API rate-limit test deliberately exhausts registration quota.
    // Reset only that fixture budget inside the verified disposable database.
    await c.fixtures.query(
      "DELETE FROM movie.security_events WHERE category='account.register'",
    );
    const root = await c.seed("SUPER_ADMIN", false),
      member = await c.seed("MEMBER", false),
      editor = await c.seed("EDITOR", false);
    if (!c.server.listening)
      await new Promise<void>((resolve, reject) => {
        c.server.once("error", reject);
        c.server.listen(0, "127.0.0.1", resolve);
      });
    const origin = "http://127.0.0.1:" + c.server.address().port;
    browser = await chromium.launch({
      executablePath:
        process.env.PJ_FLIM_CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      baseURL: origin,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.name));
    async function goto(path: string) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    async function login(user: Fixture, next = "/admin") {
      await goto("/login?next=" + encodeURIComponent(next));
      await page.getByLabel("Email", { exact: true }).fill(user.email);
      await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
      await page
        .getByRole("button", { name: "Đăng nhập", exact: true })
        .click();
      await page.waitForURL(origin + next);
      await page.waitForLoadState("networkidle");
    }
    async function noOverflow(p: Page) {
      eq(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    const home = await page.goto(origin + "/");
    eq(home?.status(), 200);
    await check(() =>
      expect(page.getByRole("heading", { level: 1 })).toBeVisible(),
    );
    eq(
      (await home!.allHeaders())["content-security-policy"].includes(
        "script-src 'self'",
      ),
      true,
    );
    await page.screenshot({
      path: ".local/web/screenshots/home-desktop.png",
      fullPage: true,
    });
    await noOverflow(page);
    await page
      .getByRole("link", { name: "Tìm phim trong kho", exact: true })
      .click();
    await check(() =>
      expect(page.getByLabel("Tìm phim", { exact: true })).toBeFocused(),
    );
    await page.getByLabel("Tìm phim", { exact: true }).fill("Tu khoa UX");
    await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
    await check(() => expect(page).toHaveURL(/q=Tu/));
    await page
      .getByRole("button", { name: "Xóa từ khóa", exact: true })
      .click();
    await check(() =>
      expect(page.getByLabel("Tìm phim", { exact: true })).toHaveValue(""),
    );
    eq(new URL(page.url()).searchParams.has("q"), false);
    const unknown = await context.request.get("/api/v1/no-such-api");
    eq(unknown.status(), 404);
    eq(
      unknown.headers()["content-type"].includes("application/problem+json"),
      true,
    );
    for (const path of [
      "/.env.api.local",
      "/.local/api/bootstrap-admin.json",
    ]) {
      const r = await context.request.get(path);
      const text = await r.text();
      eq(text.includes("CLOUDINARY_API_SECRET"), false);
      eq(text.includes("password"), false);
    }
    await goto("/admin");
    await check(() => expect(page).toHaveURL(/\/login\?next=/));
    await login(root);
    await page.locator(".account-menu summary").click();
    await check(() =>
      expect(page.locator(".account-menu")).toHaveAttribute("open", ""),
    );
    await page.keyboard.press("Escape");
    eq(await page.locator(".account-menu").getAttribute("open"), null);
    await check(() =>
      expect(page.locator(".account-menu summary")).toBeFocused(),
    );
    await page.locator(".account-menu summary").click();
    await page
      .getByRole("heading", { name: "Mọi thứ, trong tầm tay." })
      .click();
    eq(await page.locator(".account-menu").getAttribute("open"), null);
    await check(() =>
      expect(
        page.getByRole("heading", { name: "Mọi thứ, trong tầm tay." }),
      ).toBeVisible(),
    );
    await page.screenshot({
      path: ".local/web/screenshots/admin-desktop.png",
      fullPage: true,
    });
    await goto("/admin/titles/new");
    const name = "Browser Film " + randomUUID().slice(0, 8);
    await page.getByLabel("Tên phim *", { exact: true }).fill(name);
    await page.getByLabel("Loại phim", { exact: true }).selectOption("SERIES");
    await check(() =>
      expect(page.getByLabel("Loại phim", { exact: true })).toHaveValue(
        "SERIES",
      ),
    );
    await page.getByLabel("Loại phim", { exact: true }).selectOption("MOVIE");
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/admin/titles") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Tạo phim", exact: true }).click();
    const titleResponse = await created;
    eq(titleResponse.status(), 201);
    const title = await titleResponse.json();
    await page.waitForURL(origin + "/admin/titles/" + title.id);
    await page.waitForLoadState("networkidle");
    await check(() =>
      expect(page.getByRole("heading", { name, exact: true })).toBeVisible(),
    );
    await page
      .getByLabel("Giới thiệu", { exact: true })
      .fill("Nội dung kiểm thử giao diện trong database tạm.");
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/titles/" + title.id) &&
        r.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Lưu thay đổi", exact: true })
      .click();
    eq((await saved).status(), 200);
    page.once("dialog", (dialog) => void dialog.accept());
    const publication = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/titles/" + title.id + "/publication") &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Xuất bản phim", exact: true })
      .click();
    eq((await publication).status(), 409);
    await check(() => expect(page.getByRole("alert").first()).toBeVisible());
    const episode = (
      await c.fixtures.query(
        "SELECT id FROM movie.episodes WHERE title_id=$1",
        [title.id],
      )
    ).rows[0];
    assert.ok(episode);
    checks++;
    await page.locator(".admin-episode").first().click();
    await page.getByLabel("Tên tập", { exact: true }).fill("Tập kiểm thử");
    const episodeSaved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/episodes/" + episode.id) &&
        r.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Lưu thông tin tập", exact: true })
      .click();
    eq((await episodeSaved).status(), 200);
    // Mock only the external Cloudinary boundary, never the application's API or production database.
    cloud.api.upload_preset = async () => ({
      unsigned: false,
      settings: { allowed_formats: ["mp4"], overwrite: false },
    });
    cloud.api.resource = async (publicId: string) => {
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
        duration: 100,
        width: 1280,
        height: 720,
        created_at: new Date().toISOString(),
        context: {
          custom: {
            intent_id: row.id,
            episode_id: row.episode_id,
            asset_id: row.expected_policy.assetId,
            owner_user_id: row.owner_user_id,
          },
        },
      };
    };
    let uploadCount = 0;
    await page.route("https://api.cloudinary.com/**", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "POST,OPTIONS",
            "access-control-allow-headers":
              "content-range,x-unique-upload-id,content-type",
          },
        });
        return;
      }
      eq(route.request().headers()["authorization"], undefined);
      eq(route.request().headers()["cookie"], undefined);
      uploadCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": origin },
        body: JSON.stringify({ asset_id: "browser-test", done: true }),
      });
    });
    await check(() =>
      expect(
        page.getByLabel("Chất lượng và dung lượng video", { exact: true }),
      ).toHaveValue("balanced-720p-v1"),
    );
    await page
      .getByLabel("Chất lượng và dung lượng video", { exact: true })
      .selectOption("data-saver-v1");
    await page.getByLabel("Chọn video", { exact: true }).setInputFiles({
      name: "browser-test.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(1024, 1),
    });
    const verified = page.waitForResponse(
      (r) =>
        r.url().includes("/verifications") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Tải video", exact: true }).click();
    eq((await verified).status(), 200);
    eq(uploadCount, 1);
    await check(() => expect(page.locator(".processing-status")).toBeVisible());
    const upload = (
      await c.fixtures.query(
        "SELECT a.id,a.current_attempt_id FROM movie.video_assets a WHERE episode_id=$1 ORDER BY internal_version DESC LIMIT 1",
        [episode.id],
      )
    ).rows[0];
    eq(
      (
        await c.fixtures.query(
          "SELECT processing_status FROM movie.video_assets WHERE id=$1",
          [upload.id],
        )
      ).rows[0].processing_status,
      "UPLOADED",
    );
    await page.screenshot({
      path: ".local/web/screenshots/admin-upload.png",
      fullPage: true,
    });
    await noOverflow(page);
    // Ready HLS/backup fixtures exist only in this randomly named temporary database.
    await c.fixtures.query(
      "UPDATE movie.media_attempts SET status='SUCCEEDED',completed_at=now() WHERE id=$1",
      [upload.current_attempt_id],
    );
    await c.fixtures.query(
      "UPDATE movie.video_assets SET processing_status='READY',backup_status='VERIFIED',duration_seconds=100 WHERE id=$1",
      [upload.id],
    );
    await c.fixtures.query(
      "UPDATE movie.media_outputs SET status='READY',manifest_ref='test/manifest',verified_at=now(),rendition_summary='[{\"height\":720}]' WHERE attempt_id=$1",
      [upload.current_attempt_id],
    );
    await c.fixtures.query(
      "INSERT INTO movie.source_backups(asset_id,storage_provider,bucket,object_key,sha256,bytes,status,verified_at,source_manifest_ref,object_version) VALUES ($1::uuid,'S3','test',$1::text,$2,1024,'VERIFIED',now(),'test/manifest','v1')",
      [upload.id, "0".repeat(64)],
    );
    await check(() =>
      expect(
        page.getByRole("button", { name: "Sử dụng video này" }),
      ).toBeVisible({ timeout: 15000 }),
    );
    const active = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/episodes/" + episode.id) &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Sử dụng video này" }).click();
    eq((await active).status(), 200);
    const publishEpisode = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/episodes/" + episode.id + "/publication") &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Xuất bản tập phim", exact: true })
      .click();
    eq((await publishEpisode).status(), 200);
    page.once("dialog", (dialog) => void dialog.accept());
    const publishTitle = page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/titles/" + title.id + "/publication") &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Xuất bản phim", exact: true })
      .click();
    eq((await publishTitle).status(), 200);
    checks += await runLiveSearchChecks({
      browser,
      origin,
      fixtures: c.fixtures,
      titleId: title.id,
      titleName: name,
      rootId: root.id,
    });
    checks += await runAdminPagesChecks({
      page,
      browser,
      origin,
      fixtures: c.fixtures,
      titleId: title.id,
      titleName: name,
      rootId: root.id,
      seed: c.seed,
    });
    checks += await runRecommendationBrowserChecks({
      browser,
      origin,
      fixtures: c.fixtures,
      titleId: title.id,
      titleName: name,
      seed: c.seed,
    });
    await goto("/admin/users");
    await check(() =>
      expect(
        page.getByRole("button", { name: "Phân quyền", exact: true }).first(),
      ).toBeVisible(),
    );
    await goto("/admin/roles");
    await check(() =>
      expect(
        page.getByRole("heading", { name: "SUPER_ADMIN", exact: true }),
      ).toBeVisible(),
    );
    await goto("/admin/audit-logs");
    await check(() => expect(page.locator("tbody tr").first()).toBeVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    await goto("/admin");
    await noOverflow(page);
    await check(() =>
      expect(
        page.getByRole("navigation", { name: "Quản trị", exact: true }),
      ).toBeHidden(),
    );
    await page.getByRole("button", { name: "Danh mục", exact: true }).click();
    await check(() =>
      expect(
        page.getByRole("navigation", { name: "Quản trị", exact: true }),
      ).toBeVisible(),
    );
    await page
      .getByRole("link", { name: "Phim & tập phim", exact: true })
      .click();
    await check(() => expect(page).toHaveURL(origin + "/admin/titles"));
    await check(() =>
      expect(
        page.getByRole("button", { name: "Danh mục", exact: true }),
      ).toHaveAttribute("aria-expanded", "false"),
    );
    await goto("/admin");
    await page.screenshot({
      path: ".local/web/screenshots/admin-mobile.png",
      fullPage: true,
    });
    await context.close();
    const memberContext = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
    });
    const memberPage = await memberContext.newPage();
    memberPage.on("pageerror", (e) => errors.push(e.name));
    await memberPage.goto(origin + "/register");
    const newEmail = "browser-" + randomUUID() + "@example.test",
      newPassword = randomUUID() + "Ab12!";
    await memberPage
      .getByLabel("Tên hiển thị", { exact: true })
      .fill("Người xem thử");
    await memberPage.getByLabel("Email", { exact: true }).fill(newEmail);
    await memberPage.getByLabel("Mật khẩu", { exact: true }).fill(newPassword);
    await memberPage
      .getByRole("button", { name: "Tạo tài khoản", exact: true })
      .click();
    await memberPage.waitForURL(origin + "/");
    checks++;
    await memberPage.goto(origin + "/titles/" + title.id);
    await check(() =>
      expect(
        memberPage.getByRole("heading", { name, exact: true }),
      ).toBeVisible(),
    );
    await memberPage
      .getByRole("button", { name: "Lưu yêu thích", exact: true })
      .click();
    await check(() =>
      expect(
        memberPage.getByRole("button", { name: "Đã lưu", exact: true }),
      ).toBeVisible(),
    );
    await memberPage.reload();
    await check(() =>
      expect(
        memberPage.getByRole("button", { name: "Đã lưu", exact: true }),
      ).toBeVisible(),
    );
    await memberPage.goto(origin + "/library");
    await check(() =>
      expect(
        memberPage.getByRole("heading", { name, exact: true }),
      ).toBeVisible(),
    );
    await memberPage.goto(origin + "/admin");
    await check(() =>
      expect(
        memberPage.getByText(
          "Tài khoản của bạn chưa được cấp quyền quản trị.",
          { exact: true },
        ),
      ).toBeVisible(),
    );
    await noOverflow(memberPage);
    await memberPage.goto(origin + "/titles/" + title.id);
    await noOverflow(memberPage);
    await memberPage.screenshot({
      path: ".local/web/screenshots/title-mobile.png",
      fullPage: true,
    });
    // CDN failure must show recovery UI without crashing the whole app.
    await memberPage.route("https://res.cloudinary.com/**", (route) =>
      route.fulfill({ status: 400, body: "Fixture CDN unavailable" }),
    );
    const sessionResponse = memberPage.waitForResponse(
      (r) =>
        r.url().endsWith("/episodes/" + episode.id + "/playback-sessions") &&
        r.request().method() === "POST",
    );
    await memberPage
      .getByRole("link", { name: "Xem ngay", exact: true })
      .click();
    const playback = await sessionResponse;
    eq(playback.status(), 201);
    const sessionId = (await playback.json()).id;
    await check(() => expect(memberPage.locator("video")).toBeVisible());
    await check(() =>
      expect(
        memberPage.getByLabel("Tốc độ phát", { exact: true }),
      ).toBeVisible(),
    );
    await memberPage
      .getByLabel("Tốc độ phát", { exact: true })
      .selectOption("1.5");
    eq(
      await memberPage
        .locator("video")
        .evaluate((v: HTMLVideoElement) => v.playbackRate),
      1.5,
    );
    await memberPage
      .getByRole("button", { name: "Báo lỗi", exact: true })
      .click();
    await memberPage
      .getByLabel("Bạn gặp vấn đề gì?", { exact: true })
      .fill("Video thử không tải được trong kiểm thử.");
    const report = memberPage.waitForResponse(
      (r) => r.url().endsWith("/reports") && r.request().method() === "POST",
    );
    await memberPage
      .getByRole("button", { name: "Gửi báo lỗi", exact: true })
      .click();
    eq((await report).status(), 201);
    await check(() =>
      expect(
        memberPage.getByRole("button", { name: "Mở lại video", exact: true }),
      ).toBeVisible({ timeout: 30000 }),
    );
    // A fatal incompatible-codec manifest must switch to the signed original,
    // rather than waiting forever after recoverMediaError with no loaded source.
    await memberPage.unroute("https://res.cloudinary.com/**");
    let fallbackRequests = 0;
    await memberPage.route("https://res.cloudinary.com/**", (route) => {
      if (new URL(route.request().url()).pathname.endsWith(".mp4")) {
        fallbackRequests++;
        return route.fulfill({ status: 400, body: "Fixture MP4 unavailable" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/vnd.apple.mpegurl",
        body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=600000,CODECS="avc1.ffffff,mp4a.40.2",RESOLUTION=640x360\nunsupported.m3u8\n',
      });
    });
    const nextPlayback = memberPage.waitForResponse(
      (r) =>
        r.url().endsWith("/episodes/" + episode.id + "/playback-sessions") &&
        r.request().method() === "POST",
    );
    await memberPage
      .getByRole("button", { name: "Mở lại video", exact: true })
      .click();
    const nextSessionId = (await (await nextPlayback).json()).id;
    await check(() => expect.poll(() => fallbackRequests).toBe(1));
    await check(() =>
      expect(
        memberPage.getByText("Phát dự phòng MP4 · không tự đổi chất lượng", {
          exact: true,
        }),
      ).toBeVisible(),
    );
    await check(() =>
      expect(memberPage.getByRole("alert").first()).toContainText(
        "MEDIA_SOURCE_ERROR_",
        { timeout: 10000 },
      ),
    );
    await check(() =>
      expect(
        memberPage.getByLabel("Chất lượng video", { exact: true }),
      ).toBeDisabled(),
    );
    await check(() =>
      expect(
        memberPage.getByRole("button", {
          name: "Thử lại HLS để đổi độ phân giải",
          exact: true,
        }),
      ).toBeVisible(),
    );
    const adaptivePlayback = memberPage.waitForResponse(
      (r) =>
        r.url().endsWith("/episodes/" + episode.id + "/playback-sessions") &&
        r.request().method() === "POST",
    );
    const oldClosed = memberPage.waitForResponse(
      (r) =>
        r.url().endsWith("/playback-sessions/" + nextSessionId) &&
        r.request().method() === "DELETE",
    );
    await memberPage
      .getByRole("button", {
        name: "Thử lại HLS để đổi độ phân giải",
        exact: true,
      })
      .click();
    eq((await oldClosed).status(), 204);
    const adaptiveSessionId = (await (await adaptivePlayback).json()).id;
    await check(() => expect.poll(() => fallbackRequests).toBe(2));
    await check(() =>
      expect(
        memberPage.getByLabel("Chất lượng video", { exact: true }),
      ).toBeDisabled(),
    );
    const closed = memberPage.waitForResponse(
      (r) =>
        r.url().endsWith("/playback-sessions/" + adaptiveSessionId) &&
        r.request().method() === "DELETE",
    );
    // Hold teardown telemetry in flight while navigating away and logging out.
    // Revoking authentication first would make DELETE playback fail and consume a slot.
    await memberPage.route(
      "**/api/v1/playback-sessions/" + adaptiveSessionId + "/events",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.continue();
      },
    );
    const order: string[] = [];
    const playbackClosed = (response: any) => {
      if (
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname.endsWith(
          "/playback-sessions/" + adaptiveSessionId,
        ) &&
        response.status() === 204
      )
        order.push("playback-closed");
    };
    const authLogout = (request: any) => {
      if (
        request.method() === "DELETE" &&
        new URL(request.url()).pathname.endsWith("/auth/sessions/current")
      )
        order.push("auth-logout");
    };
    memberPage.on("response", playbackClosed);
    memberPage.on("request", authLogout);
    const loggedOut = memberPage.waitForResponse(
      (r) =>
        r.request().method() === "DELETE" &&
        new URL(r.url()).pathname.endsWith("/auth/sessions/current"),
    );
    await memberPage
      .getByRole("link", { name: "Chi tiết phim", exact: true })
      .click();
    await memberPage.locator(".account-menu summary").click();
    await memberPage
      .getByRole("button", { name: "Đăng xuất", exact: true })
      .click();
    eq((await closed).status(), 204);
    eq((await loggedOut).status(), 204);
    eq(order.join(","), "playback-closed,auth-logout");
    eq(
      (
        await c.fixtures.query(
          "SELECT closed_at IS NOT NULL AS closed FROM movie.playback_sessions WHERE id=$1",
          [adaptiveSessionId],
        )
      ).rows[0].closed,
      true,
    );
    memberPage.off("response", playbackClosed);
    memberPage.off("request", authLogout);
    await memberContext.close();
    const editorContext = await browser.newContext({ baseURL: origin });
    const editorPage = await editorContext.newPage();
    editorPage.on("pageerror", (e) => errors.push(e.name));
    await editorPage.goto(origin + "/login?next=/admin");
    await editorPage.getByLabel("Email", { exact: true }).fill(editor.email);
    await editorPage
      .getByLabel("Mật khẩu", { exact: true })
      .fill(editor.password);
    await editorPage
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .click();
    await editorPage.waitForURL(origin + "/admin");
    await check(() =>
      expect(
        editorPage
          .getByRole("navigation", { name: "Quản trị" })
          .getByRole("link", { name: "Người dùng", exact: true }),
      ).toHaveCount(0),
    );
    await editorPage.goto(origin + "/admin/titles/" + title.id);
    await expect(
      editorPage.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await check(() =>
      expect(
        editorPage.getByRole("button", { name: "Ẩn phim", exact: true }),
      ).toHaveCount(0),
    );
    await editorPage.goto(origin + "/admin/settings");
    await check(() =>
      expect(
        editorPage.getByRole("heading", {
          name: "Bạn chưa có quyền truy cập",
          exact: true,
        }),
      ).toBeVisible(),
    );
    await editorContext.close();
    eq(errors.length, 0);
    return checks;
  } finally {
    if (browser) await browser.close();
    cloud.api.upload_preset = originalPreset;
    cloud.api.resource = originalResource;
    process.env.AUTH_MFA_REQUIRED = prior;
  }
}
