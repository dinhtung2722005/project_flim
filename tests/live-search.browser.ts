import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, type Browser, type Page, type Route } from "@playwright/test";
import type { Pool } from "pg";

export async function runLiveSearchChecks(c: {
  browser: Browser;
  origin: string;
  fixtures: Pool;
  titleId: string;
  titleName: string;
  rootId: string;
}) {
  let checks = 0;
  const check = async (assertion: () => Promise<unknown>) => {
    await assertion();
    checks++;
  };
  const eq = (actual: unknown, expected: unknown) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const database = (await c.fixtures.query("SELECT current_database() AS name"))
    .rows[0].name;
  assert.match(database, /^pj_flim_test_[a-f0-9]{12}$/);
  const alias = "Hành Trình Tìm Kiếm " + randomUUID().slice(0, 8);
  const normalized = alias
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  await c.fixtures.query(
    "INSERT INTO movie.title_aliases(title_id,alias,normalized_alias) VALUES($1,$2,$3)",
    [c.titleId, alias, normalized],
  );
  const draftName = "Browser Film Draft " + randomUUID().slice(0, 8);
  await c.fixtures.query(
    "INSERT INTO movie.titles(kind,slug,localized_title,normalized_title,created_by,updated_by) VALUES('MOVIE',$1,$2,$3,$4,$4)",
    [
      "live-draft-" + randomUUID(),
      draftName,
      draftName.toLowerCase(),
      c.rootId,
    ],
  );
  const context = await c.browser.newContext({
    baseURL: c.origin,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: { term: string; kind: string | null; auth: boolean }[] = [];
  const suggestionPattern = "**/api/v1/titles?**";
  const isSuggestion = (url: string) => {
    const parsed = new URL(url);
    return (
      parsed.pathname === "/api/v1/titles" &&
      parsed.searchParams.get("limit") === "6"
    );
  };
  page.on("pageerror", (error) => errors.push(error.name));
  page.on("request", (request) => {
    if (isSuggestion(request.url())) {
      const u = new URL(request.url());
      requests.push({
        term: u.searchParams.get("q") || "",
        kind: u.searchParams.get("kind"),
        auth: !!request.headers().authorization,
      });
    }
  });
  async function home(path = "/") {
    await page.goto(c.origin + path);
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("combobox", { name: "Tìm phim", exact: true })
      .scrollIntoViewIfNeeded();
  }
  const input = page.getByRole("combobox", { name: "Tìm phim", exact: true });
  const options = page
    .getByRole("option")
    .filter({ has: page.locator(".search-option-copy") });
  const list = page.getByRole("listbox", { name: "Gợi ý phim" });
  const result = () =>
    page.getByRole("option", { name: new RegExp(c.titleName) });

  try {
    await home();
    await input.fill("B");
    await page.waitForTimeout(400);
    eq(requests.length, 0);
    await check(() => expect(input).toHaveAttribute("aria-expanded", "false"));

    // Real API: debounce typing and find a published/playable movie as a guest.
    await input.fill("Bro");
    await input.fill("Brow");
    await input.fill("Browser Film");
    await check(() => expect(result()).toBeVisible());
    eq(requests.length, 1);
    eq(requests[0].auth, false);
    await check(() => expect(options).toHaveCount(1));
    await check(() =>
      expect(
        page.getByRole("option", { name: new RegExp(draftName) }),
      ).toHaveCount(0),
    );
    eq(new URL(page.url()).searchParams.has("q"), false);
    await input.press("ArrowDown");
    await check(() =>
      expect(result()).toHaveAttribute("aria-selected", "true"),
    );
    const selectedId = await result().getAttribute("id");
    eq(await input.getAttribute("aria-activedescendant"), selectedId);
    await check(() => expect(input).toBeFocused());
    await input.press("Escape");
    await check(() => expect(list).toHaveCount(0));
    await check(() => expect(input).toHaveValue("Browser Film"));

    await input.press("ArrowDown");
    await check(() => expect(result()).toBeVisible());
    await input.press("ArrowUp");
    await input.press("Enter");
    await check(() =>
      expect(page).toHaveURL(c.origin + "/titles/" + c.titleId),
    );

    await home();
    await input.fill(normalized);
    await check(() => expect(result()).toBeVisible());
    await result().click();
    await check(() =>
      expect(page).toHaveURL(c.origin + "/titles/" + c.titleId),
    );

    // Keep query scope, then submit all results with URL/history support.
    await home("/?kind=MOVIE&sort=oldest");
    await input.fill("Browser Film");
    await check(() => expect(result()).toBeVisible());
    eq(requests.at(-1)?.kind, "MOVIE");
    await page
      .getByRole("button", { name: "Xem tất cả kết quả", exact: true })
      .click();
    await check(() => expect(page).toHaveURL(/q=Browser/));
    eq(new URL(page.url()).searchParams.get("kind"), "MOVIE");
    eq(new URL(page.url()).searchParams.get("sort"), "oldest");
    await check(() => expect(input).toHaveValue("Browser Film"));
    await page
      .getByRole("button", { name: "Xóa từ khóa", exact: true })
      .click();
    await check(() => expect(input).toHaveValue(""));
    eq(new URL(page.url()).searchParams.has("q"), false);
    eq(new URL(page.url()).searchParams.get("kind"), "MOVIE");
    await page.goBack();
    await check(() => expect(input).toHaveValue("Browser Film"));
    await page.goForward();
    await check(() => expect(input).toHaveValue(""));

    await input.fill("Nothing-" + randomUUID());
    await check(() =>
      expect(
        page.getByText(
          "Không tìm thấy phim phù hợp. Thử từ khóa khác hoặc bỏ bớt bộ lọc.",
        ),
      ).toBeVisible(),
    );
    await check(() => expect(options).toHaveCount(0));
    await page.getByRole("heading", { level: 1 }).click();
    await check(() => expect(list).toHaveCount(0));

    // A failed request remains recoverable without touching the full catalog.
    let failed = false;
    const failing = async (route: Route) => {
      if (isSuggestion(route.request().url()) && !failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({ code: "SERVICE_UNAVAILABLE" }),
        });
      } else await route.continue();
    };
    await page.route(suggestionPattern, failing);
    await input.fill("Browser Film");
    await check(() =>
      expect(
        page.getByText("Chưa tải được gợi ý. Bạn có thể thử lại."),
      ).toBeVisible(),
    );
    await page
      .getByRole("button", { name: "Thử lại gợi ý", exact: true })
      .click();
    await check(() => expect(result()).toBeVisible());
    await page.unroute(suggestionPattern, failing);

    // Delayed old responses must not replace the latest query.
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received: () => void = () => {};
    const oldRequest = new Promise<void>((resolve) => {
      received = resolve;
    });
    const delayed = async (route: Route) => {
      const url = new URL(route.request().url());
      if (
        isSuggestion(url.toString()) &&
        url.searchParams.get("q") === "Outdated"
      ) {
        received();
        await barrier;
        await route
          .fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [
                {
                  id: c.titleId,
                  localizedTitle: "Outdated result",
                  kind: "MOVIE",
                },
              ],
              page: { limit: 6, nextCursor: null, hasMore: false },
            }),
          })
          .catch(() => {}); // Aborted browser requests need not accept a response.
      } else await route.continue();
    };
    await page.route(suggestionPattern, delayed);
    try {
      await input.fill("Outdated");
      await oldRequest;
      await check(() => expect(page.getByText("Đang tìm phim…")).toBeVisible());
      await input.fill("Browser Film");
      await check(() => expect(result()).toBeVisible());
      release();
      await page.waitForTimeout(100);
      await check(() =>
        expect(
          page.getByRole("option", { name: /Outdated result/ }),
        ).toHaveCount(0),
      );
      await check(() => expect(result()).toBeVisible());
    } finally {
      release();
      await page.unroute(suggestionPattern, delayed);
    }

    // Vietnamese/IME composition does not fetch or submit incomplete text.
    await page
      .getByRole("button", { name: "Xóa từ khóa", exact: true })
      .click();
    const countBeforeIme = requests.length;
    await input.dispatchEvent("compositionstart");
    await input.fill(normalized);
    await input.press("Enter");
    await page.waitForTimeout(400);
    eq(requests.length, countBeforeIme);
    eq(new URL(page.url()).searchParams.has("q"), false);
    await input.dispatchEvent("compositionend", { data: normalized });
    await check(() => expect(result()).toBeVisible());
    await input.press("Tab");
    await check(() => expect(list).toHaveCount(0));

    // Responsive popover and a keyboard-selected row must stay within viewport.
    const layouts: { width: number; options: number }[] = [];
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await input.click();
      await input.fill("Browser Film");
      await check(() => expect(result()).toBeVisible());
      await page.locator(".live-search").scrollIntoViewIfNeeded();
      eq(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const bounds = await page.locator(".search-suggestions").boundingBox();
      eq(!!bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, true);
      layouts.push({ width, options: await options.count() });
      await page.screenshot({
        path: ".local/web/live-search/search-" + width + ".png",
        fullPage: true,
      });
      await input.press("Escape");
    }
    eq(errors.length, 0);
    await mkdir(".local/web/live-search", { recursive: true });
    await writeFile(
      ".local/web/live-search/result.json",
      JSON.stringify(
        {
          passed: true,
          checks,
          layouts,
          suggestionRequests: requests.length,
          transportFaultsSimulated: ["503/retry", "delayed old response"],
          realAPI: [
            "published title",
            "draft excluded",
            "Vietnamese alias",
            "kind/sort scope",
          ],
          database: "isolated temporary PostgreSQL",
          pageErrors: errors,
        },
        null,
        2,
      ) + "\n",
    );
    return checks;
  } finally {
    await context.close();
  }
}
