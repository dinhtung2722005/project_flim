import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  MethodNotAllowedException,
  NotAcceptableException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { PublicCatalogService } from "../apps/api/src/services/public-catalog.service";
import { GlobalExceptionFilter } from "../apps/api/src/filters/global-exception.filter";
import { ApiError } from "../packages/backend-core/src/errors";
import { Database } from "../packages/database/src/database";
import { ERROR_STATUS } from "../packages/contracts/src/errors";

export async function runGlobalExceptionChecks(c: {
  api: any;
  fixtures: any;
  app: any;
}) {
  let checks = 0;
  const service = c.app.get(PublicCatalogService) as PublicCatalogService,
    original = service.titles;
  const log = console.error,
    logs: string[] = [];
  const secret = "private-test-" + randomUUID();
  const requestId = randomUUID();
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  const ok = (value: unknown) => {
    assert.ok(value);
    checks++;
  };
  const eq = (actual: unknown, expected: unknown) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  async function problem(req: any, status: number, code: string) {
    const response = await req;
    eq(response.status, status);
    eq(response.body.status, status);
    eq(response.body.code, code);
    ok(response.headers["content-type"].startsWith("application/problem+json"));
    eq(response.headers["cache-control"], "no-store");
    eq(response.headers["x-request-id"], response.body.requestId);
    ok(/^[a-f0-9-]{36}$/i.test(response.body.requestId));
    eq(typeof response.body.retryable, "boolean");
    ok(!JSON.stringify(response.body).includes(secret));
    eq(response.body.stack, undefined);
    eq(response.body.query, undefined);
    return response;
  }
  try {
    const cases: { error: unknown; status: number; code: string }[] = [
      {
        error: new ApiError(
          "MEDIA_NOT_READY",
          "The episode is still processing.",
        ),
        status: 409,
        code: "MEDIA_NOT_READY",
      },
      {
        error: new BadRequestException({ message: secret, password: secret }),
        status: 400,
        code: "REQUEST_INVALID",
      },
      {
        error: new UnsupportedMediaTypeException(secret),
        status: 415,
        code: "REQUEST_UNSUPPORTED_MEDIA_TYPE",
      },
      {
        error: new MethodNotAllowedException(secret),
        status: 405,
        code: "REQUEST_METHOD_NOT_ALLOWED",
      },
      {
        error: new NotAcceptableException(secret),
        status: 406,
        code: "REQUEST_NOT_ACCEPTABLE",
      },
      {
        error: new ConflictException(secret),
        status: 409,
        code: "RESOURCE_CONFLICT",
      },
      {
        error: new ServiceUnavailableException(secret),
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      },
      {
        error: new GatewayTimeoutException(secret),
        status: 504,
        code: "UPSTREAM_TIMEOUT",
      },
      {
        error: new HttpException(secret, 502),
        status: 502,
        code: "UPSTREAM_BAD_RESPONSE",
      },
      {
        error: new Error("SELECT password_hash FROM private_table; " + secret),
        status: 500,
        code: "INTERNAL_ERROR",
      },
      { error: null, status: 500, code: "INTERNAL_ERROR" },
      { error: secret, status: 500, code: "INTERNAL_ERROR" },
      {
        error: { status: 401, message: secret, stack: secret },
        status: 401,
        code: "AUTHENTICATION_REQUIRED",
      },
      {
        error: new ApiError("UNREGISTERED_ERROR", secret),
        status: 500,
        code: "INTERNAL_ERROR",
      },
      {
        error: Object.assign(new Error(secret), {
          code: "23503",
          detail: secret,
        }),
        status: 422,
        code: "VALIDATION_FAILED",
      },
      {
        error: { code: "P2002", meta: { target: ["unknown_unique_field"] } },
        status: 409,
        code: "RESOURCE_CONFLICT",
      },
      {
        error: { code: "P2025", meta: { cause: secret } },
        status: 404,
        code: "RESOURCE_NOT_FOUND",
      },
      {
        error: {
          code: "P2010",
          meta: {
            driverAdapterError: {
              cause: {
                originalCode: "23505",
                constraint: { index: "users_email_normalized_key" },
                originalMessage: secret,
              },
            },
          },
        },
        status: 409,
        code: "ACCOUNT_CONFLICT",
      },
      {
        error: {
          code: "P2010",
          meta: {
            driverAdapterError: {
              cause: { originalCode: "40P01", originalMessage: secret },
            },
          },
        },
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      },
      {
        error: {
          name: "PrismaClientInitializationError",
          errorCode: "P1001",
          message: secret,
        },
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      },
      {
        error: new AggregateError(
          [Object.assign(new Error(secret), { code: "ECONNREFUSED" })],
          secret,
        ),
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      },
      {
        error: { code: "42501", message: secret, detail: secret },
        status: 500,
        code: "INTERNAL_ERROR",
      },
      {
        error: {
          code: "P2010",
          meta: {
            driverAdapterError: {
              cause: { originalCode: "23502", originalMessage: secret },
            },
          },
        },
        status: 422,
        code: "VALIDATION_FAILED",
      },
    ];
    cases.push(
      {
        error: new HttpException(secret, 408),
        status: 408,
        code: "REQUEST_TIMEOUT",
      },
      {
        error: new GatewayTimeoutException(secret, {
          cause: Object.assign(new Error(secret), { code: "ETIMEDOUT" }),
        }),
        status: 504,
        code: "UPSTREAM_TIMEOUT",
      },
    );
    for (const item of cases) {
      service.titles = async () => {
        throw item.error;
      };
      const r = await problem(
        c
          .api("get", "/api/v1/titles?q=" + secret)
          .set("X-Request-Id", requestId),
        item.status,
        item.code,
      );
      eq(r.body.requestId, requestId);
      eq(r.body.instance, "/api/v1/titles");
      eq(r.body.status, ERROR_STATUS[r.body.code]);
    }
    const circular: any = { message: secret };
    circular.cause = circular;
    service.titles = async () => {
      throw circular;
    };
    await problem(c.api("get", "/api/v1/titles"), 500, "INTERNAL_ERROR");

    service.titles = async () => {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Invalid request.",
        Array.from({ length: 60 }, () => ({
          location: "body",
          pointer: "/password",
          code: "FIELD_INVALID_FORMAT",
          message: secret,
          value: secret,
          stack: secret,
        })),
      );
    };
    let r = await problem(
      c.api("get", "/api/v1/titles"),
      422,
      "VALIDATION_FAILED",
    );
    eq(r.body.errors.length, 50);
    eq(Object.keys(r.body.errors[0]).sort(), [
      "code",
      "location",
      "message",
      "pointer",
    ]);
    eq(r.body.retryable, false);
    service.titles = async () => {
      throw new ApiError("RATE_LIMITED");
    };
    r = await problem(c.api("get", "/api/v1/titles"), 429, "RATE_LIMITED");
    eq(r.headers["retry-after"], "60");
    eq(r.body.retryable, true);
    service.titles = async () => {
      throw new ApiError("AUTH_REFRESH_RETRY_CONFLICT");
    };
    r = await problem(
      c.api("get", "/api/v1/titles"),
      409,
      "AUTH_REFRESH_RETRY_CONFLICT",
    );
    eq(r.headers["retry-after"], "2");

    const genreId = randomUUID(),
      slug = "exception-" + randomUUID();
    await c.fixtures.query(
      "INSERT INTO movie.genres(id,slug,name) VALUES ($1,$2,'Exception fixture')",
      [genreId, slug],
    );
    const db = c.app.get(Database) as Database;
    service.titles = async () =>
      db.$queryRawUnsafe(
        "INSERT INTO movie.genres(slug,name) VALUES ($1,'Duplicate') RETURNING id",
        slug,
      ) as any;
    await problem(c.api("get", "/api/v1/titles"), 409, "CATALOG_SLUG_CONFLICT");
    service.titles = async () =>
      db.$queryRawUnsafe(
        "INSERT INTO movie.genres(id,slug,name) VALUES ($1::uuid,$2,'Duplicate id') RETURNING id",
        genreId,
        "different-" + slug,
      ) as any;
    await problem(c.api("get", "/api/v1/titles"), 409, "RESOURCE_CONFLICT");

    service.titles = original;
    r = await problem(
      c
        .api("post", "/api/v1/users?private=" + secret)
        .set("Content-Type", "application/json")
        .send('{"email":'),
      400,
      "REQUEST_MALFORMED_JSON",
    );
    eq(r.body.instance, "/api/v1/users");
    await problem(
      c
        .api("post", "/api/v1/users")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ payload: "x".repeat(70000) })),
      413,
      "REQUEST_TOO_LARGE",
    );
    await problem(
      c
        .api("post", "/api/v1/users")
        .set("Content-Type", "application/json; charset=iso-8859-1")
        .send("{}"),
      415,
      "REQUEST_UNSUPPORTED_MEDIA_TYPE",
    );
    r = await problem(
      c
        .api("post", "/api/v1/users")
        .send({ email: secret, password: secret, displayName: "" }),
      422,
      "VALIDATION_FAILED",
    );
    ok(r.body.errors.some((field: any) => field.pointer === "/email"));
    ok(r.body.errors.every((field: any) => field.location === "body"));
    await problem(
      c.api("get", "/api/v1/does-not-exist?private=" + secret),
      404,
      "RESOURCE_NOT_FOUND",
    );
    await problem(c.api("get", "/api/docs-session"), 404, "RESOURCE_NOT_FOUND");
    await problem(
      c.api("post", "/api/docs-login").send({}),
      404,
      "RESOURCE_NOT_FOUND",
    );

    const filter = c.app.get(GlobalExceptionFilter) as GlobalExceptionFilter;
    let destroyed = 0,
      replies = 0;
    const closed: any = {
      headersSent: true,
      writableEnded: false,
      destroyed: false,
      destroy() {
        destroyed++;
      },
      status() {
        replies++;
        throw Error("Must not write headers twice");
      },
    };
    filter.render(
      new Error(secret),
      { method: "GET", path: "/stream" } as any,
      closed,
    );
    eq(destroyed, 1);
    eq(replies, 0);
    filter.render(
      new Error(secret),
      { method: "GET", path: "/stream" } as any,
      { ...closed, writableEnded: true },
    );
    eq(destroyed, 1);
    ok(logs.length > 0);
    ok(
      logs.every(
        (line) =>
          !line.includes(secret) &&
          !line.includes("password_hash") &&
          !line.includes("private_table"),
      ),
    );
    const entries = logs.map((line) => JSON.parse(line));
    ok(
      entries.some(
        (entry) =>
          entry.event === "http.exception" &&
          entry.status === 500 &&
          entry.kind === "unknown" &&
          entry.requestId === requestId,
      ),
    );
    const health = await c.api("get", "/api/v1/health");
    eq(health.status, 200);
  } finally {
    service.titles = original;
    console.error = log;
  }
  console.log(
    JSON.stringify({ event: "global.exception.integration.passed", checks }),
  );
  return checks;
}
