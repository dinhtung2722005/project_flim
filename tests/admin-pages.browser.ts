import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, type Page, type Browser } from "@playwright/test";
import type { Pool } from "pg";
type Fixture = { id: string; email: string; password: string };
export async function runAdminPagesChecks(c: {
  page: Page;
  browser: Browser;
  origin: string;
  fixtures: Pool;
  titleId: string;
  titleName: string;
  rootId: string;
  seed: (role: string, withMfa?: boolean) => Promise<Fixture>;
}) {
  let checks = 0;
  const page = c.page;
  const layoutSamples: { path: string; width: number; modal?: string }[] = [];
  const errors: string[] = [];
  const eq = (a: unknown, b: unknown) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const check = async (assertion: () => Promise<unknown>) => {
    await assertion();
    checks++;
  };
  const goto = async (path: string) => {
    await page.goto(c.origin + path);
    await page.waitForLoadState("networkidle");
  };
  async function call(
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
  ) {
    return page.evaluate(
      async ({ path, method, body }) => {
        const stored = JSON.parse(
          sessionStorage.getItem("pj-flim.auth") || "null",
        );
        const headers: Record<string, string> = {
          Authorization: "Bearer " + stored.accessToken,
        };
        if (body) {
          headers["Content-Type"] = "application/json";
          const latest = await fetch("/api/v1" + path, { headers });
          headers["If-Match"] = latest.headers.get("etag") || "";
        }
        const response = await fetch("/api/v1" + path, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status };
      },
      { path, method, body },
    );
  }
  async function response(
    path: string,
    method: string,
    action: () => Promise<unknown>,
  ) {
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1" + path) && r.request().method() === method,
    );
    await action();
    const result = await pending;
    eq(result.status(), method === "POST" ? 201 : 200);
    if (method === "PATCH" || method === "PUT") {
      assert.ok(result.request().headers()["if-match"]);
      checks++;
    }
    return result.json();
  }
  await mkdir(".local/web/admin-pages", { recursive: true });
  await goto("/admin/people");
  await page
    .getByRole("button", { name: "Thêm nhân vật", exact: true })
    .click();
  await check(() =>
    expect(
      page.getByRole("dialog", { name: "Thêm nhân vật", exact: true }),
    ).toBeVisible(),
  );
  const personName = "Nguyễn An " + randomUUID().slice(0, 8);
  await page.getByLabel("Tên nhân vật *", { exact: true }).fill(personName);
  await page
    .getByLabel("Tiểu sử", { exact: true })
    .fill("Tiểu sử thử giao diện.");
  const person = await response("/admin/people", "POST", () =>
    page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click(),
  );
  await check(() =>
    expect(
      page.getByRole("heading", { name: personName, exact: true }),
    ).toBeVisible(),
  );
  await page
    .getByRole("button", { name: "Chỉnh sửa " + personName, exact: true })
    .click();
  await page
    .getByLabel("Tiểu sử", { exact: true })
    .fill("Tiểu sử đã cập nhật qua UI.");
  await response("/admin/people/" + person.id, "PATCH", () =>
    page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click(),
  );
  eq(
    (
      await c.fixtures.query("SELECT biography FROM movie.people WHERE id=$1", [
        person.id,
      ])
    ).rows[0].biography,
    "Tiểu sử đã cập nhật qua UI.",
  );

  await page
    .getByRole("button", { name: "Chỉnh sửa " + personName, exact: true })
    .click();
  await page
    .getByLabel("Tiểu sử", { exact: true })
    .fill("Bản sửa cũ không được ghi đè.");
  eq(
    (
      await call("/admin/people/" + person.id, "PATCH", {
        name: personName,
        biography: "Bản mới từ người khác.",
      })
    ).status,
    200,
  );
  const conflict = page.waitForResponse(
    (r) =>
      r.url().endsWith("/admin/people/" + person.id) &&
      r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  eq((await conflict).status(), 412);
  await check(() =>
    expect(page.getByLabel("Tiểu sử", { exact: true })).toHaveValue(
      "Bản sửa cũ không được ghi đè.",
    ),
  );
  eq(
    (
      await c.fixtures.query("SELECT biography FROM movie.people WHERE id=$1", [
        person.id,
      ])
    ).rows[0].biography,
    "Bản mới từ người khác.",
  );
  await page
    .getByRole("button", {
      name: "Tải bản mới và bỏ bản đang sửa",
      exact: true,
    })
    .click();
  await check(() =>
    expect(page.getByLabel("Tiểu sử", { exact: true })).toHaveValue(
      "Bản mới từ người khác.",
    ),
  );
  await page.keyboard.press("Escape");
  await check(() => expect(page.getByRole("dialog")).toHaveCount(0));

  await c.fixtures.query(
    "INSERT INTO movie.people(name,normalized_name) SELECT 'Hồ sơ thử '||n,'ho so thu '||n FROM generate_series(1,22) n",
  );
  await goto("/admin/people");
  await page.getByRole("button", { name: "Tải thêm", exact: true }).click();
  await check(() =>
    expect(
      page.getByText("23 / 23 hồ sơ đã tải", { exact: true }),
    ).toBeVisible(),
  );
  await page
    .getByLabel("Tìm nhân vật đã tải", { exact: true })
    .fill("nguyen an");
  await check(() => expect(page.locator(".person-card")).toHaveCount(1));

  await goto("/admin/banners");
  await page.getByRole("button", { name: "Thêm banner", exact: true }).click();
  await page
    .getByLabel("Phim liên kết *", { exact: true })
    .selectOption(c.titleId);
  await page
    .getByLabel("Tiêu đề banner", { exact: true })
    .fill("Bộ phim nổi bật");
  await page
    .getByLabel("Mã ảnh Cloudinary *", { exact: true })
    .fill("tests/admin-banner");
  await check(() =>
    expect(page.getByLabel("Bật banner", { exact: true })).not.toBeChecked(),
  );
  await page.getByLabel("Bật banner", { exact: true }).check();
  await page.getByLabel("Bắt đầu", { exact: true }).fill("2030-01-03T10:00");
  await page.getByLabel("Kết thúc", { exact: true }).fill("2030-01-02T10:00");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await check(() =>
    expect(
      page.getByText("Thời gian kết thúc phải sau thời gian bắt đầu.", {
        exact: true,
      }),
    ).toBeVisible(),
  );
  eq(
    (
      await c.fixtures.query(
        "SELECT count(*)::int AS n FROM movie.homepage_banners",
      )
    ).rows[0].n,
    0,
  );
  await page.getByLabel("Kết thúc", { exact: true }).fill("2030-01-04T10:00");
  const banner = await response("/admin/banners", "POST", () =>
    page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click(),
  );
  await check(() =>
    expect(page.getByText("Đã lên lịch", { exact: true })).toBeVisible(),
  );
  await page
    .getByRole("button", { name: "Chỉnh sửa banner", exact: true })
    .click();
  await page.getByLabel("Bật banner", { exact: true }).uncheck();
  await page.getByLabel("Bắt đầu", { exact: true }).fill("");
  await page.getByLabel("Kết thúc", { exact: true }).fill("");
  await response("/admin/banners/" + banner.id, "PATCH", () =>
    page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click(),
  );
  const savedBanner = (
    await c.fixtures.query(
      "SELECT enabled,starts_at,ends_at FROM movie.homepage_banners WHERE id=$1",
      [banner.id],
    )
  ).rows[0];
  eq(savedBanner, { enabled: false, starts_at: null, ends_at: null });

  await goto("/admin/settings");
  await page.getByLabel("Tên website *", { exact: true }).fill("Studio Flim");
  await page
    .getByLabel("Mô tả", { exact: true })
    .fill("Nội dung được cập nhật qua giao diện.");
  await page
    .getByLabel("Email hỗ trợ", { exact: true })
    .fill("support@example.test");
  await response("/admin/settings/site", "PUT", () =>
    page.getByRole("button", { name: "Lưu cấu hình", exact: true }).click(),
  );
  eq(
    (
      await c.fixtures.query(
        "SELECT value FROM movie.system_settings WHERE key='site'",
      )
    ).rows[0].value,
    {
      name: "Studio Flim",
      description: "Nội dung được cập nhật qua giao diện.",
      supportEmail: "support@example.test",
    },
  );
  await page
    .getByLabel("Tên website *", { exact: true })
    .fill("Bản cũ trên trình duyệt");
  eq(
    (
      await call("/admin/settings/site", "PUT", {
        name: "Bản mới từ người khác",
      })
    ).status,
    200,
  );
  const settingsConflict = page.waitForResponse(
    (r) =>
      r.url().endsWith("/admin/settings/site") &&
      r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Lưu cấu hình", exact: true }).click();
  eq((await settingsConflict).status(), 412);
  await check(() =>
    expect(page.getByLabel("Tên website *", { exact: true })).toHaveValue(
      "Bản cũ trên trình duyệt",
    ),
  );
  await check(() =>
    expect(
      page.getByRole("button", { name: "Lưu cấu hình", exact: true }),
    ).toBeDisabled(),
  );
  await page.getByRole("button", { name: "Tải bản mới", exact: true }).click();
  await check(() =>
    expect(page.getByLabel("Tên website *", { exact: true })).toHaveValue(
      "Bản mới từ người khác",
    ),
  );

  await c.fixtures.query(
    "INSERT INTO movie.content_reports(reporter_user_id,title_id,category,message,status) VALUES ($1,$2,'PLAYBACK','Chi tiết phản hồi riêng tư','OPEN'),($1,$2,'METADATA','Phản hồi đã giải quyết','RESOLVED')",
    [c.rootId, c.titleId],
  );
  await goto("/admin/reports");
  await check(() =>
    expect(
      page.getByText("Chi tiết phản hồi riêng tư", { exact: true }),
    ).toBeVisible(),
  );
  await page
    .getByLabel("Trạng thái báo lỗi", { exact: true })
    .selectOption("RESOLVED");
  await check(() => expect(page.locator(".report-card")).toHaveCount(1));
  await check(() =>
    expect(
      page.getByText("Phản hồi đã giải quyết", { exact: true }),
    ).toBeVisible(),
  );

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/admin/people",
      "/admin/banners",
      "/admin/settings",
      "/admin/reports",
    ]) {
      await goto(path);
      eq(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      layoutSamples.push({ path, width });
      await page.screenshot({
        path:
          ".local/web/admin-pages/" +
          path.split("/").at(-1) +
          "-" +
          width +
          ".png",
        fullPage: true,
      });
    }
    for (const [path, button] of [
      ["/admin/people", "Thêm nhân vật"],
      ["/admin/banners", "Thêm banner"],
    ]) {
      await goto(path);
      await page.getByRole("button", { name: button, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await check(() => expect(dialog).toBeVisible());
      eq(
        await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        false,
      );
      layoutSamples.push({ path, width, modal: button });
      if (width === 390)
        await page.screenshot({
          path:
            ".local/web/admin-pages/dialog-" +
            path.split("/").at(-1) +
            "-390.png",
          fullPage: true,
        });
      await page.keyboard.press("Escape");
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await goto("/admin");

  const auditor = await c.seed("AUDITOR", false);
  const context = await c.browser.newContext({ baseURL: c.origin });
  try {
    const auditorPage = await context.newPage();
    auditorPage.on("pageerror", (e) => errors.push(e.name));
    await auditorPage.goto(c.origin + "/login?next=/admin/reports");
    await auditorPage.getByLabel("Email", { exact: true }).fill(auditor.email);
    await auditorPage
      .getByLabel("Mật khẩu", { exact: true })
      .fill(auditor.password);
    await auditorPage
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .click();
    await auditorPage.waitForURL(c.origin + "/admin/reports");
    await check(() =>
      expect(
        auditorPage
          .getByText("Nội dung chi tiết được ẩn theo quyền tài khoản.")
          .first(),
      ).toBeVisible(),
    );
    await check(() =>
      expect(
        auditorPage.getByText("Chi tiết phản hồi riêng tư", { exact: true }),
      ).toHaveCount(0),
    );
    await check(() =>
      expect(
        auditorPage.getByRole("link", {
          name: "Cấu hình website",
          exact: true,
        }),
      ).toHaveCount(0),
    );
    await auditorPage.goto(c.origin + "/admin/settings");
    await check(() =>
      expect(
        auditorPage.getByRole("heading", {
          name: "Bạn chưa có quyền truy cập",
          exact: true,
        }),
      ).toBeVisible(),
    );
    eq(errors.length, 0);
  } finally {
    await context.close();
  }
  const audit = (
    await c.fixtures.query(
      "SELECT count(*)::int AS n FROM movie.audit_logs WHERE action IN ('catalog.person.created','catalog.person.updated','catalog.banner.created','catalog.banner.updated','settings.updated')",
    )
  ).rows[0].n;
  assert.ok(audit >= 7);
  checks++;
  await writeFile(
    ".local/web/admin-pages/result.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        passed: true,
        checks,
        layoutSamples,
        database: "isolated temporary PostgreSQL",
        scope:
          "people/banner/settings mutations and conflict handling; report filtering and AUDITOR redaction; responsive pages/dialogs",
      },
      null,
      2,
    ) + "\n",
  );
  return checks;
}
