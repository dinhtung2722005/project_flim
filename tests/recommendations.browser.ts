import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, type Browser, type Page } from "@playwright/test";
import type { Pool } from "pg";
type User = { id: string; email: string; password: string };
export async function runRecommendationBrowserChecks(c: {
  browser: Browser;
  origin: string;
  fixtures: Pool;
  titleId: string;
  titleName: string;
  seed: (role: string, withMfa?: boolean) => Promise<User>;
}) {
  let checks = 0;
  const errors: string[] = [];
  const user = await c.seed("MEMBER", false),
    second = await c.seed("MEMBER", false);
  const context = await c.browser.newContext({
    baseURL: c.origin,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.name));
  const eq = (a: unknown, b: unknown) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const check = async (fn: () => Promise<unknown>) => {
    await fn();
    checks++;
  };
  async function login(p: Page, who: User) {
    await p.goto(c.origin + "/login?next=/for-you");
    await p.getByLabel("Email", { exact: true }).fill(who.email);
    await p.getByLabel("Mật khẩu", { exact: true }).fill(who.password);
    await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.waitForURL(c.origin + "/for-you");
    await p.waitForLoadState("networkidle");
  }
  const consent = () => page.getByLabel("Bật cá nhân hóa", { exact: true });
  try {
    await page.goto(c.origin + "/for-you");
    await check(() => expect(page).toHaveURL(/login\?next=/));
    await login(page, user);
    await check(() =>
      expect(
        page.getByRole("heading", { name: "Dành cho bạn", exact: true }),
      ).toBeVisible(),
    );
    await check(() => expect(consent()).not.toBeChecked());
    await check(() =>
      expect(page.locator(".recommendation-card").first()).toBeVisible(),
    );
    await check(() =>
      expect(page.getByRole("button", { name: /Không quan tâm:/ })).toHaveCount(
        0,
      ),
    );
    // Display opt-in fallback without signals, then personalized feed after a saved title.
    await consent().click();
    await page.waitForLoadState("networkidle");
    await check(() => expect(consent()).toBeChecked());
    eq(
      (
        await c.fixtures.query(
          "SELECT enabled FROM movie.recommendation_preferences WHERE user_id=$1",
          [user.id],
        )
      ).rows[0].enabled,
      true,
    );
    const card = page
      .locator(".recommendation-card")
      .filter({
        has: page.getByRole("heading", { name: c.titleName, exact: true }),
      })
      .first();
    await check(() => expect(card).toBeVisible());
    await card.getByRole("button", { name: /Không quan tâm:/ }).click();
    await check(() => expect(card).toHaveCount(0));
    await check(() =>
      expect(
        page.getByRole("button", { name: "Hoàn tác", exact: true }),
      ).toBeVisible(),
    );
    eq(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS n FROM movie.recommendation_feedback WHERE user_id=$1 AND title_id=$2",
          [user.id, c.titleId],
        )
      ).rows[0].n,
      1,
    );
    await page.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await check(() => expect(card).toBeVisible());
    eq(
      (
        await c.fixtures.query(
          "SELECT count(*)::int AS n FROM movie.recommendation_feedback WHERE user_id=$1",
          [user.id],
        )
      ).rows[0].n,
      0,
    );
    // Another tab changes the ETag; preserving visible state until explicit reload prevents a stale overwrite.
    await c.fixtures.query(
      "UPDATE movie.recommendation_preferences SET version=version+1 WHERE user_id=$1",
      [user.id],
    );
    await consent().click();
    await check(() =>
      expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Dữ liệu vừa được thay đổi" }),
      ).toBeVisible(),
    );
    eq(
      (
        await c.fixtures.query(
          "SELECT enabled FROM movie.recommendation_preferences WHERE user_id=$1",
          [user.id],
        )
      ).rows[0].enabled,
      true,
    );
    await page.getByRole("button", { name: "Thử lại", exact: true }).click();
    await check(() => expect(consent()).toBeChecked());
    await consent().click();
    await page.waitForLoadState("networkidle");
    await check(() => expect(consent()).not.toBeChecked());
    await check(() =>
      expect(page.getByRole("button", { name: /Không quan tâm:/ })).toHaveCount(
        0,
      ),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await check(() =>
      expect(
        page.getByRole("heading", { name: "Dành cho bạn", exact: true }),
      ).toBeVisible(),
    );
    eq(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await mkdir(".local/recommendations/screenshots", { recursive: true });
    await page.screenshot({
      path: ".local/recommendations/screenshots/for-you-mobile.png",
      fullPage: true,
    });
    // Private response arriving after logout cannot repopulate the next account's page.
    await page.setViewportSize({ width: 1440, height: 1000 });
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      hit = new Promise<void>((r) => {
        started = r;
      });
    await page.route("**/api/v1/me/recommendations?**", async (route) => {
      const response = await route.fetch();
      started();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {}
    });
    await page
      .getByRole("button", { name: "Làm mới gợi ý", exact: true })
      .click();
    await hit;
    await page.locator(".account-menu summary").click();
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await check(() => expect(page).toHaveURL(/login\?next=/));
    release();
    await page.unrouteAll({ behavior: "wait" });
    await login(page, second);
    await check(() => expect(consent()).not.toBeChecked());
    await check(() =>
      expect(
        page.getByRole("button", { name: "Hoàn tác", exact: true }),
      ).toHaveCount(0),
    );
    eq(errors, []);
    await writeFile(
      ".local/recommendations/browser-result.json",
      JSON.stringify(
        { passed: true, checks, errors, viewportWidths: [1440, 390] },
        null,
        2,
      ) + "\n",
    );
    return checks;
  } finally {
    await context.close();
  }
}
