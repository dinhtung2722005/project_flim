import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { expect, type Browser } from "@playwright/test";
import type { Pool } from "pg";
import { hash } from "../apps/api/src/common";
import { totp } from "../apps/api/src/security";
export async function runExperienceChecks(c: {
  browser: Browser;
  origin: string;
  fixtures: Pool;
  titleId: string;
  seed: (role: string, withMfa?: boolean) => Promise<any>;
}) {
  let checks = 0;
  const errors: string[] = [],
    eq = (a: any, b: any) => {
      assert.deepEqual(a, b);
      checks++;
    };
  async function open(role: string) {
    const user = await c.seed(role, false),
      context = await c.browser.newContext({
        baseURL: c.origin,
        viewport: { width: 390, height: 844 },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.name));
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
    const wait = page.waitForResponse(
      (r) =>
        r.url().endsWith("/auth/sessions") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    const credentials = await (await wait).json();
    await page.waitForURL(c.origin + "/");
    return {
      user,
      context,
      page,
      headers: { Authorization: "Bearer " + credentials.accessToken },
    };
  }
  const member = await open("MEMBER"),
    root = await open("SUPER_ADMIN");
  const savedSettings = (
    await c.fixtures.query(
      "SELECT value FROM movie.system_settings WHERE key='site'",
    )
  ).rows[0].value;
  const bannerIds: string[] = [];
  try {
    let refreshCalls = 0;
    member.page.on("request", (r) => {
      if (r.url().endsWith("/auth/token-renewals")) refreshCalls++;
    });
    await member.page.goto("/account");
    await expect(
      member.page.getByRole("heading", { name: "Tài khoản và bảo mật" }),
    ).toBeVisible();
    checks++;
    await member.page.getByLabel("Mật khẩu hiện tại").fill("wrong-password");
    await member.page
      .getByRole("button", { name: "Thiết lập MFA", exact: true })
      .click();
    await expect(member.page.getByRole("alert")).toBeVisible();
    checks++;
    eq(refreshCalls, 0);
    await member.page
      .getByLabel("Mật khẩu hiện tại")
      .fill(member.user.password);
    await member.page
      .getByRole("button", { name: "Thiết lập MFA", exact: true })
      .click();
    const secret = await member.page
      .locator(".enrollment-secret")
      .textContent();
    assert.ok(secret);
    checks++;
    const valid = totp(secret!).generate();
    const wrong = String((Number(valid) + 123) % 1000000).padStart(6, "0");
    await member.page.getByLabel("Mã từ ứng dụng xác thực").fill(wrong);
    await member.page.getByRole("button", { name: "Xác nhận bật MFA" }).click();
    await expect(member.page.getByRole("alert")).toBeVisible();
    checks++;
    await member.page
      .getByLabel("Mã từ ứng dụng xác thực")
      .fill(totp(secret!).generate());
    await member.page.getByRole("button", { name: "Xác nhận bật MFA" }).click();
    await expect(member.page.locator(".recovery-codes code")).toHaveCount(8);
    checks++;
    eq(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS n FROM movie.mfa_recovery_codes r JOIN movie.mfa_factors f ON f.id=r.factor_id WHERE f.user_id=$1 AND f.verified_at IS NOT NULL",
          [member.user.id],
        )
      ).rows[0].n,
      8,
    );
    const recovery = await member.page
      .locator(".recovery-codes code")
      .allTextContents();
    eq(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS n FROM movie.mfa_recovery_codes WHERE code_hash=ANY($1::text[])",
          [recovery],
        )
      ).rows[0].n,
      0,
    );
    await member.page
      .getByRole("button", { name: "Tôi đã lưu mã khôi phục" })
      .click();
    await expect(
      member.page.getByText("Xác thực hai bước đã được bật.", { exact: true }),
    ).toBeVisible();
    checks++;

    // Owner-bound enrollment and persisted attempt budget, independent of UI.
    const other = await c.seed("MEMBER", false),
      session = await member.context.request.post("/api/v1/auth/sessions", {
        data: { email: other.email, password: other.password },
      });
    const h = { Authorization: "Bearer " + (await session.json()).accessToken };
    const start = await member.context.request.post(
      "/api/v1/me/mfa/enrollments",
      { headers: h, data: { password: other.password } },
    );
    eq(start.status(), 201);
    eq(start.headers()["cache-control"], "no-store");
    const pending = await start.json();
    eq(
      (
        await root.context.request.post(
          "/api/v1/me/mfa/enrollments/" + pending.id + "/verifications",
          {
            headers: root.headers,
            data: { code: totp(pending.secret).generate() },
          },
        )
      ).status(),
      422,
    );
    const invalid = String(
      (Number(totp(pending.secret).generate()) + 123) % 1000000,
    ).padStart(6, "0");
    for (let i = 0; i < 5; i++)
      eq(
        (
          await member.context.request.post(
            "/api/v1/me/mfa/enrollments/" + pending.id + "/verifications",
            { headers: h, data: { code: invalid } },
          )
        ).status(),
        422,
      );
    eq(
      (
        await member.context.request.post(
          "/api/v1/me/mfa/enrollments/" + pending.id + "/verifications",
          { headers: h, data: { code: totp(pending.secret).generate() } },
        )
      ).status(),
      422,
    );
    eq(
      (
        await c.fixtures.query(
          "SELECT attempt_count FROM movie.mfa_challenges WHERE id=$1",
          [pending.id],
        )
      ).rows[0].attempt_count,
      5,
    );

    const verifyToken = randomBytes(48).toString("base64url");
    await c.fixtures.query(
      "INSERT INTO movie.email_verification_tokens(user_id,email_normalized,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [member.user.id, member.user.email, hash(verifyToken)],
    );
    await member.page.goto("/verify-email#token=" + verifyToken);
    await expect(
      member.page.getByLabel("Mã xác minh", { exact: true }),
    ).toHaveValue(verifyToken);
    checks++;
    eq(member.page.url().includes(verifyToken), false);
    eq(
      (
        await c.fixtures.query(
          "SELECT consumed_at FROM movie.email_verification_tokens WHERE token_hash=$1",
          [hash(verifyToken)],
        )
      ).rows[0].consumed_at,
      null,
    );
    await member.page
      .getByRole("button", { name: "Xác minh email", exact: true })
      .click();
    await expect(
      member.page.getByText("Email đã được xác minh.", { exact: true }),
    ).toBeVisible();
    checks++;
    assert.ok(
      (
        await c.fixtures.query(
          "SELECT email_verified_at FROM movie.users WHERE id=$1",
          [member.user.id],
        )
      ).rows[0].email_verified_at,
    );
    checks++;
    eq(
      (
        await member.context.request.post("/api/v1/auth/email-verifications", {
          data: { token: verifyToken },
        })
      ).status(),
      422,
    );
    await member.page.goto("/forgot-password");
    await member.page
      .getByLabel("Email", { exact: true })
      .fill("unknown-" + randomUUID() + "@example.test");
    await member.page.getByRole("button", { name: "Gửi hướng dẫn" }).click();
    await expect(
      member.page.getByText(
        "Nếu tài khoản đủ điều kiện, email hướng dẫn đã được gửi.",
        { exact: true },
      ),
    ).toBeVisible();
    checks++;
    const reset = randomBytes(48).toString("base64url");
    await c.fixtures.query(
      "INSERT INTO movie.password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
      [member.user.id, hash(reset)],
    );
    await member.page.goto("/reset-password#token=" + reset);
    await expect.poll(() => member.page.url().includes(reset)).toBe(false);
    checks++;
    await member.page
      .getByLabel("Mật khẩu mới", { exact: true })
      .fill("New-Strong-" + randomUUID());
    await member.page
      .getByLabel("Nhập lại mật khẩu mới")
      .fill("Different-Strong-Password");
    await member.page
      .getByRole("button", { name: "Đổi mật khẩu", exact: true })
      .click();
    await expect(
      member.page.getByText("Hai mật khẩu chưa khớp.", { exact: true }),
    ).toBeVisible();
    checks++;
    const nextPassword = "Reset-" + randomUUID();
    await member.page
      .getByLabel("Mật khẩu mới", { exact: true })
      .fill(nextPassword);
    await member.page.getByLabel("Nhập lại mật khẩu mới").fill(nextPassword);
    await member.page
      .getByRole("button", { name: "Đổi mật khẩu", exact: true })
      .click();
    await expect(
      member.page.getByText("Mật khẩu đã được đổi. Hãy đăng nhập lại.", {
        exact: true,
      }),
    ).toBeVisible();
    checks++;
    eq(
      (
        await member.context.request.get("/api/v1/me", {
          headers: member.headers,
        })
      ).status(),
      401,
    );
    eq(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS n FROM movie.mfa_factors WHERE user_id=$1 AND disabled_at IS NULL AND verified_at IS NOT NULL",
          [member.user.id],
        )
      ).rows[0].n,
      1,
    );

    const personId = randomUUID();
    await c.fixtures.query(
      "INSERT INTO movie.people(id,name,normalized_name) VALUES($1,'Người kiểm thử đoàn phim','nguoi kiem thu doan phim')",
      [personId],
    );
    await root.page.goto("/admin/titles/" + c.titleId);
    await expect(
      root.page.getByRole("heading", {
        name: "Diễn viên và đoàn phim",
        exact: true,
      }),
    ).toBeVisible();
    checks++;
    const n = (await root.page.getByLabel(/^Người tham gia /).count()) + 1;
    await root.page
      .getByRole("button", { name: "Thêm người tham gia", exact: true })
      .click();
    await root.page
      .getByLabel("Người tham gia " + n, { exact: true })
      .selectOption(personId);
    await root.page
      .getByLabel("Vai trò " + n, { exact: true })
      .selectOption("DIRECTOR");
    const saved = root.page.waitForResponse(
      (r) =>
        r.url().endsWith("/admin/titles/" + c.titleId) &&
        r.request().method() === "PATCH",
    );
    await root.page
      .getByRole("button", { name: "Lưu đoàn phim", exact: true })
      .click();
    eq((await saved).status(), 200);
    const pub = await root.context.request.get("/api/v1/titles/" + c.titleId);
    eq(
      (await pub.json()).credits.some(
        (r: any) => r.personId === personId && r.role === "DIRECTOR",
      ),
      true,
    );

    const siteBefore = await root.context.request.get(
      "/api/v1/admin/settings/site",
      { headers: root.headers },
    );
    eq(
      (
        await root.context.request.put("/api/v1/admin/settings/site", {
          headers: { ...root.headers, "If-Match": siteBefore.headers().etag },
          data: {
            name: "Rạp kiểm thử",
            description: "Nội dung cấu hình công khai",
            supportEmail: "support@example.test",
          },
        })
      ).status(),
      200,
    );
    for (const enabled of [true, false]) {
      const response = await root.context.request.post(
        "/api/v1/admin/banners",
        {
          headers: root.headers,
          data: {
            titleId: c.titleId,
            imageAssetRef: "fixture/banner",
            headline: enabled ? "Banner công khai" : "Banner ẩn",
            enabled,
          },
        },
      );
      eq(response.status(), 201);
      bannerIds.push((await response.json()).id);
    }
    const site = await (await root.context.request.get("/api/v1/site")).json();
    eq(site.settings.name, "Rạp kiểm thử");
    eq("updatedBy" in site.settings, false);
    eq(
      site.banners.some((b: any) => b.headline === "Banner ẩn"),
      false,
    );
    await root.page.goto("/");
    await expect(
      root.page.getByRole("link", { name: "Banner công khai", exact: true }),
    ).toBeVisible();
    checks++;
    await expect(root.page.locator(".brand").first()).toContainText(
      "Rạp kiểm thử",
    );
    checks++;
    const reportId = randomUUID();
    await c.fixtures.query(
      "INSERT INTO movie.content_reports(id,reporter_user_id,title_id,category,message) VALUES($1,$2,$3,'METADATA','Experience triage fixture')",
      [reportId, member.user.id, c.titleId],
    );
    await root.page.goto("/admin/reports");
    const card = root.page
      .locator(".report-card")
      .filter({ hasText: "Experience triage fixture" });
    await card.getByLabel("Xử lý báo lỗi").selectOption("IN_REVIEW");
    await card.getByLabel("Ghi chú xử lý").fill("Đã tiếp nhận");
    await card.getByRole("button", { name: "Lưu xử lý" }).click();
    await expect(
      card.getByText("Đang xem xét", { exact: true }).first(),
    ).toBeVisible();
    checks++;
    eq(
      (
        await c.fixtures.query(
          "SELECT status,version::text FROM movie.content_reports WHERE id=$1",
          [reportId],
        )
      ).rows[0],
      { status: "IN_REVIEW", version: "2" },
    );
    eq(
      (
        await root.context.request.patch("/api/v1/admin/reports/" + reportId, {
          headers: {
            ...root.headers,
            "If-Match": '"report:' + reportId + ':1"',
          },
          data: { status: "RESOLVED", resolutionNote: "old" },
        })
      ).status(),
      412,
    );
    const auditor = await open("AUDITOR");
    try {
      await auditor.page.goto("/admin/reports");
      eq(await auditor.page.getByLabel("Xử lý báo lỗi").count(), 0);
      eq(
        (
          await auditor.context.request.patch(
            "/api/v1/admin/reports/" + reportId,
            {
              headers: {
                ...auditor.headers,
                "If-Match": '"report:' + reportId + ':2"',
              },
              data: { status: "RESOLVED" },
            },
          )
        ).status(),
        403,
      );
    } finally {
      await auditor.context.close();
    }
    await root.page.screenshot({
      path: ".local/web/screenshots/experience-reports-mobile.png",
      fullPage: true,
    });
    eq(errors, []);
  } finally {
    if (bannerIds.length)
      await c.fixtures.query(
        "DELETE FROM movie.homepage_banners WHERE id=ANY($1::uuid[])",
        [bannerIds],
      );
    await c.fixtures.query(
      "UPDATE movie.system_settings SET value=$1::jsonb WHERE key='site'",
      [JSON.stringify(savedSettings)],
    );
    await root.context.close();
    await member.context.close();
  }
  return checks;
}
