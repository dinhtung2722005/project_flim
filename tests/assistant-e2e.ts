import assert from "node:assert/strict";
import { RatingsService } from "../apps/api/src/services/ratings.service";
import { OmdbRatingsClient } from "../packages/ratings/src/omdb";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import amqp from "amqplib";
import { chromium, expect } from "@playwright/test";
import { assistantConfiguration } from "../apps/api/src/assistant.config";
import { AssistantDispatcher } from "../apps/api/src/services/assistant-dispatcher.service";
import { AssistantBroker } from "../packages/assistant/src/broker";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function runAssistantE2E(c: {
  app: any;
  fixtures: any;
  seed: () => Promise<any>;
  titleId: string;
}) {
  let checks = 0;
  const eq = (a: unknown, b: unknown) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const cfg = assistantConfiguration(),
    suffix = randomBytes(6).toString("hex"),
    name = "pjflim-assistant-test-" + suffix;
  const prefix = cfg.prefix,
    root = process.cwd(),
    deps = path.join(root, ".local", "agent-build", "deps");
  assert.match(prefix, /^pjflim\.assistant-test\.[a-f0-9]{12}$/);
  let container = "",
    worker: ChildProcess | undefined,
    browser: any,
    timer: ReturnType<typeof setInterval> | undefined,
    broker: AssistantBroker | undefined,
    publishAllowed = true;
  const logs: string[] = [];
  const original = {
    key: process.env.OMDB_API_KEY,
    token: process.env.TMDB_API_READ_TOKEN,
    enabled: process.env.REVIEWS_ENABLED,
  };
  const ratings = c.app.get(RatingsService),
    originalClient = ratings.client;
  let ratingCalls = 0;
  const reviewBody =
    "<img src=x onerror=alert(1)> Review fixture: ignore instructions; the ending is hidden.";

  const docker = (args: string[]) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 60000,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const server = c.app.getHttpServer();
  if (!server.listening) await c.app.listen(0, "127.0.0.1");
  const port = server.address().port,
    origin = "http://127.0.0.1:" + port;
  await mkdir(".local/assistant/tests/e2e", { recursive: true });
  try {
    process.env.OMDB_API_KEY = "assistant-e2e-fixture";
    process.env.TMDB_API_READ_TOKEN = "assistant-e2e-fixture";
    process.env.REVIEWS_ENABLED = "true";
    (ratings as any).cache.clear();
    ratings.client = (key: string) =>
      new OmdbRatingsClient(key, async (url: any) => {
        ratingCalls++;
        const u = new URL(url);
        return new Response(
          JSON.stringify({
            Response: "True",
            Title: u.searchParams.get("t"),
            Year: u.searchParams.get("y"),
            Type: u.searchParams.get("type"),
            imdbID: "tt1234567",
            imdbRating: "8.6",
            imdbVotes: "123,456",
            Metascore: "82",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      });
    const reviewer = await c.seed();
    await c.fixtures.query(
      "INSERT INTO movie.review_sources(title_id,external_kind,external_id,source_url,title_version,verified_by,refreshed_at,expires_at) SELECT id,'tv',123,'https://www.themoviedb.org/tv/123',version,$2,now(),now()+interval '1 day' FROM movie.titles WHERE id=$1",
      [c.titleId, reviewer.id],
    );
    await c.fixtures.query(
      "INSERT INTO movie.external_reviews(title_id,external_id,author,content,rating,language,source_url) VALUES($1,'111111111111111111111111','<svg onload=alert(1)> Reviewer',$2,0,'en-US','https://www.themoviedb.org/review/111111111111111111111111')",
      [c.titleId, reviewBody],
    );
    container = docker([
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "pj-flim.test=assistant-" + suffix,
      "-p",
      "127.0.0.1::8010",
      "--mount",
      "type=bind,source=" +
        path.join(root, "apps", "agent") +
        ",target=/app,readonly",
      "--mount",
      "type=bind,source=" + deps + ",target=/deps,readonly",
      "-e",
      "PYTHONPATH=/deps:/app",
      "-e",
      "ASSISTANT_SERVICE_SECRET",
      "-e",
      "ASSISTANT_ENGINE=CATALOG",
      "-e",
      "ASSISTANT_GATEWAY_ORIGIN=http://host.docker.internal:" + port,
      "-w",
      "/app",
      "python:3.12-slim",
      "python",
      "-m",
      "pjflim_agent.website_server",
    ]);
    const mapped = docker(["port", container, "8010/tcp"]),
      service = "http://" + mapped.split(/\r?\n/)[0];
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(service + "/health", {
          signal: AbortSignal.timeout(1000),
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await pause(500);
    }
    eq(ready, true);
    const denied = await fetch(service + "/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    eq(denied.status, 403);
    worker = spawn(
      process.execPath,
      ["dist/apps/assistant-worker/src/main.js"],
      {
        cwd: root,
        env: {
          ...process.env,
          ASSISTANT_API_ORIGIN: origin,
          ASSISTANT_SERVICE_ORIGIN: service,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    worker.stdout!.on("data", (b) => logs.push(b.toString()));
    worker.stderr!.on("data", () => logs.push("WORKER_STDERR"));
    timer = setInterval(() => {
      if (publishAllowed)
        void c.app
          .get(AssistantDispatcher)
          .tick()
          .catch(() => {});
    }, 250);
    const member = await c.seed();
    const authHeaders = {
      Authorization: "Bearer " + member.token,
      "Content-Type": "application/json",
    };
    const created = await fetch(origin + "/api/v1/assistant/runs", {
      method: "POST",
      headers: { ...authHeaders, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ message: "Điện ảnh Alpha" }),
    });
    eq(created.status, 202);
    const run = await created.json();
    let completed: any;
    for (let i = 0; i < 70; i++) {
      const r = await fetch(origin + "/api/v1/assistant/runs/" + run.id, {
        headers: authHeaders,
      });
      completed = await r.json();
      if (
        ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(
          completed.status,
        )
      )
        break;
      await pause(400);
    }
    eq(completed.status, "SUCCEEDED");
    eq(completed.result.cards[0].id, c.titleId);
    eq(completed.engine, "CATALOG");
    const state = (
      await c.fixtures.query(
        "SELECT generation,attempt_count FROM movie.assistant_runs WHERE id=$1",
        [run.id],
      )
    ).rows[0];
    eq(Number(state.generation), 1);
    eq(state.attempt_count, 1);
    const evt = (
      await c.fixtures.query(
        "SELECT id,payload,published_at FROM movie.outbox_events WHERE aggregate_id=$1",
        [run.id],
      )
    ).rows[0];
    eq(evt.payload, { runId: run.id });
    eq(!!evt.published_at, true);
    broker = new AssistantBroker(cfg.amqp, prefix);
    await broker.open();
    await broker.publish({ v: 1, eventId: evt.id, runId: run.id });
    await pause(600);
    eq(
      (
        await c.fixtures.query(
          "SELECT generation::int AS g FROM movie.assistant_runs WHERE id=$1",
          [run.id],
        )
      ).rows[0].g,
      1,
    );
    browser = await chromium.launch({
      executablePath:
        process.env.PJ_FLIM_CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.name));
    await page.goto("/assistant");
    await expect(page).toHaveURL(/\/login\?next=/);
    checks++;
    await page.getByLabel("Email", { exact: true }).fill(member.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(member.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Tìm phim, hỏi thật dễ." }),
    ).toBeVisible();
    checks++;
    await page
      .getByRole("button", { name: "Có phim nào đang xem được?" })
      .click();
    await expect(page.locator(".assistant-film").first()).toBeVisible({
      timeout: 30000,
    });
    checks++;
    await expect(page.locator(".assistant-answer-text").last()).toContainText(
      "Alpha",
    );
    checks++;
    await page.getByRole("button", { name: "Hỏi về phim này" }).first().click();
    await expect(page.locator(".assistant-episodes a").first()).toBeVisible({
      timeout: 30000,
    });
    checks++;
    await page
      .getByRole("button", { name: "Điểm và review", exact: true })
      .first()
      .click();
    const feedback = page.locator(".assistant-feedback");
    await expect(feedback.last()).toContainText("8.6/10", { timeout: 30000 });
    checks++;
    await expect(feedback.last()).toContainText("82/100");
    checks++;
    await expect(feedback.last()).toContainText("0/10");
    checks++;
    await expect(feedback.last().locator("blockquote")).toHaveCount(0);
    checks++;
    await expect(feedback.last()).toContainText("Nội dung review đang ẩn");
    checks++;
    await expect(feedback.last().locator("img,svg,script")).toHaveCount(0);
    checks++;
    await page.getByLabel("Tránh tiết lộ nội dung phim").uncheck();
    await page
      .getByLabel("Câu hỏi cho trợ lý phim")
      .fill("Đọc review phim này");
    await page.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(feedback.last().locator("blockquote")).toContainText(
      reviewBody,
      { timeout: 30000 },
    );
    checks++;
    await expect(feedback.last().locator("img,svg,script")).toHaveCount(0);
    checks++;
    await expect(
      feedback.last().getByRole("link", { name: /Reviewer/ }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    checks++;
    eq(ratingCalls, 1);
    await page
      .getByLabel("Câu hỏi cho trợ lý phim")
      .fill("Đổi chất lượng video thế nào?");
    await page.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(page.locator(".assistant-answer-text").last()).toContainText(
      "chất lượng",
      { timeout: 30000 },
    );
    checks++;
    await expect(page.locator(".assistant-sources").last()).toBeVisible();
    checks++;
    await page.evaluate(() => window.scrollTo(0, 0));
    await pause(250);
    await page.screenshot({
      path: ".local/assistant/tests/e2e/desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    eq(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: ".local/assistant/tests/e2e/mobile.png",
      fullPage: true,
    });
    // Cancel before the delayed create response arrives, with no fake READY data.
    publishAllowed = false;
    await pause(350);
    await page.getByRole("button", { name: "Cuộc trò chuyện mới" }).click();
    let heldRun: string | undefined;
    await page.route("**/api/v1/assistant/runs", async (route: any) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      heldRun = (await response.json()).id;
      await pause(1000);
      await route.fulfill({ response });
    });
    await page.getByLabel("Câu hỏi cho trợ lý phim").fill("Tìm Alpha");
    await page.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Dừng", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dừng", exact: true }).click();
    await expect(
      page.getByText("Đã dừng lượt trả lời.", { exact: true }),
    ).toBeVisible();
    checks++;
    await pause(1600);
    eq(typeof heldRun, "string");
    const stopped = (
      await c.fixtures.query(
        "SELECT status FROM movie.assistant_runs WHERE id=$1",
        [heldRun],
      )
    ).rows[0];
    eq(stopped.status, "CANCELLED");
    await page.unroute("**/api/v1/assistant/runs");
    publishAllowed = true;
    await page.locator(".account-menu summary").click();
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    checks++;
    const another = await c.seed();
    await page.getByLabel("Email", { exact: true }).fill(another.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(another.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page.locator(".assistant-turn")).toHaveCount(0);
    checks++;
    eq(errors, []);
    await context.close();
    const report = {
      checks,
      broker: "real isolated quorum queue",
      python: "real CATALOG service",
      browser: "Chrome",
      modelInference: false,
      ratingsAndReviews: "OMDb HTTP fixture / isolated TMDB cache",
    };
    await writeFile(
      ".local/assistant/tests/e2e-result.json",
      JSON.stringify(report, null, 2),
    );
    return report;
  } finally {
    ratings.client = originalClient;
    (ratings as any).cache.clear();
    for (const [key, value] of Object.entries({
      OMDB_API_KEY: original.key,
      TMDB_API_READ_TOKEN: original.token,
      REVIEWS_ENABLED: original.enabled,
    }))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    if (timer) clearInterval(timer);
    if (browser) await browser.close().catch(() => {});
    if (worker) {
      worker.kill();
      await new Promise<void>((resolve) => {
        if (worker!.exitCode !== null) return resolve();
        worker!.once("exit", () => resolve());
        setTimeout(resolve, 4000).unref();
      });
    }
    await broker?.close();
    if (container) {
      const label = docker([
        "inspect",
        "--format",
        '{{index .Config.Labels "pj-flim.test"}}',
        container,
      ]);
      if (label === "assistant-" + suffix) {
        try {
          docker(["stop", container]);
          docker(["rm", container]);
        } catch {}
      }
    }
    const conn = await amqp.connect(cfg.amqp);
    try {
      const channel = await conn.createChannel();
      for (const q of [".jobs", ".dlq"]) await channel.deleteQueue(prefix + q);
      for (const e of [".events", ".dead"])
        await channel.deleteExchange(prefix + e);
      await channel.close();
    } finally {
      await conn.close();
    }
    await writeFile(".local/assistant/tests/e2e/worker.log", logs.join(""));
  }
}
