import { GlobalExceptionFilter } from "./filters/global-exception.filter";
import { configureViewerOpenApi } from "./viewer.openapi";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ArgumentMetadata, ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ApiError } from "./common";
import { Database, query } from "../../../packages/database/src/database";
import { configuration } from "./config";
import { ERROR_STATUS } from "../../../packages/contracts/src/errors";
function validationErrors(errors: any[], parent = ""): any[] {
  return errors.flatMap((error) => {
    const pointer =
      parent + "/" + error.property.replaceAll("~", "~0").replaceAll("/", "~1");
    return [
      ...Object.entries(error.constraints ?? {}).map(
        ([constraint, message]) => ({
          location: "body",
          pointer,
          code:
            constraint === "whitelistValidation"
              ? "FIELD_UNKNOWN"
              : constraint === "isDefined"
                ? "FIELD_REQUIRED"
                : constraint === "isInt" ||
                    constraint === "isString" ||
                    constraint === "isBoolean"
                  ? "FIELD_INVALID_TYPE"
                  : "FIELD_INVALID_FORMAT",
          message,
        }),
      ),
      ...validationErrors(error.children ?? [], pointer),
    ];
  });
}
class ApiValidationPipe extends ValidationPipe {
  async transform(value: any, metadata: ArgumentMetadata) {
    try {
      return await super.transform(value, metadata);
    } catch (error) {
      if (error instanceof ApiError && error.errors)
        error.errors = error.errors.map((item: any) => ({
          ...item,
          location: metadata.type === "query" ? "query" : "body",
        }));
      throw error;
    }
  }
}
export async function createApplication() {
  const cfg = configuration();
  const app = await NestFactory.create(AppModule, {
    logger: ["warn", "error"],
    bodyParser: false,
  });
  const server = app.getHttpAdapter().getInstance() as express.Express;
  const db = app.get(Database),
    filter = app.get(GlobalExceptionFilter);
  const handleExpressError = (
    error: unknown,
    req: Request,
    res: Response,
    _next: unknown,
  ) => filter.render(error, req, res);
  server.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(
    (
      req: Request & { requestId?: string },
      res: Response,
      next: () => void,
    ) => {
      const incoming = req.get("x-request-id");
      req.requestId =
        incoming && /^[a-f0-9-]{36}$/i.test(incoming) ? incoming : randomUUID();
      res.set("X-Request-Id", req.requestId).set("Cache-Control", "no-store");
      const started = Date.now();
      res.on("finish", () => {
        console.log(
          JSON.stringify({
            level: "info",
            requestId: req.requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
        if (res.statusCode >= 400)
          void query(
            db,
            "INSERT INTO movie.security_events(category,outcome,request_id,safe_metadata) VALUES ('http.request.failed',$1,$2,$3::jsonb) RETURNING id",
            [
              res.statusCode === 403 ? "DENIED" : "FAILED",
              req.requestId,
              JSON.stringify({
                method: req.method,
                path: req.path,
                status: res.statusCode,
              }),
            ],
          ).catch(() =>
            console.error(
              JSON.stringify({
                level: "error",
                code: "SECURITY_EVENT_WRITE_FAILED",
                requestId: req.requestId,
              }),
            ),
          );
      });
      next();
    },
  );
  app.use(
    "/api/v1/webhooks/cloudinary",
    express.raw({ type: "application/json", limit: "256kb", inflate: false }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  server.use(handleExpressError);
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ApiValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      exceptionFactory: (errors) =>
        new ApiError(
          "VALIDATION_FAILED",
          "Request validation failed.",
          validationErrors(errors),
        ),
    }),
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("pj-Flim API")
      .setDescription(
        "Public catalog, accounts, playback, personal library and reports; admin API with MFA/RBAC, audit and publication checks; RabbitMQ HLS/backup worker and signed webhook. Development Swagger UI and JSON are public. Use Authorize with an access JWT for protected API requests. Local signed CDN delivery URLs do not expire with API playback sessions.",
      )
      .setVersion("0.2.0")
      .addBearerAuth({
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Access JWT after password and MFA when required. Local AUTH_MFA_REQUIRED=false allows password-only API login. Use Authorize to supply this JWT; Swagger never grants API permissions.",
      })
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Limited challengeToken returned by login or step-up. Cannot call admin endpoints.",
        },
        "mfa-context",
      )
      .addApiKey(
        {
          type: "apiKey",
          in: "header",
          name: "X-Playback-Management",
          description:
            "Guest-only management token; cannot be replaced by telemetry token.",
        },
        "playback-management",
      )
      .addApiKey(
        {
          type: "apiKey",
          in: "header",
          name: "X-Playback-Telemetry",
          description:
            "Session-scoped event ingestion token; cannot manage playback.",
        },
        "playback-telemetry",
      )
      .build(),
  );
  document.components ??= {};
  document.components.schemas ??= {};
  configureViewerOpenApi(document);
  document.components.schemas.ProblemDetails = {
    type: "object",
    required: [
      "type",
      "title",
      "status",
      "code",
      "detail",
      "instance",
      "requestId",
      "retryable",
    ],
    properties: {
      type: { type: "string" },
      title: { type: "string" },
      status: { type: "integer" },
      code: { type: "string", enum: Object.keys(ERROR_STATUS) },
      detail: { type: "string" },
      instance: { type: "string" },
      requestId: { type: "string", format: "uuid" },
      retryable: {
        type: "boolean",
        description:
          "Retry only safe operations or the same idempotent intent.",
      },
      errors: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          required: ["location", "pointer", "code", "message"],
          properties: {
            location: {
              type: "string",
              enum: ["body", "query", "path", "header"],
            },
            pointer: { type: "string" },
            code: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  };
  for (const path of Object.values(document.paths))
    for (const operation of Object.values(path ?? {}))
      if (
        operation &&
        typeof operation === "object" &&
        "responses" in operation
      ) {
        const op = operation as any;
        for (const status of [
          "400",
          "401",
          "403",
          "404",
          "405",
          "406",
          "408",
          "409",
          "412",
          "413",
          "415",
          "422",
          "428",
          "429",
          "500",
          "502",
          "503",
          "504",
        ])
          op.responses[status] ??= {
            description: "Problem Details",
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" },
              },
            },
          };
      }
  if (cfg.docs) {
    // Keep old bookmarks usable without creating a docs authentication session.
    server.get("/api/docs-login", (_req, res) =>
      res.redirect(302, "/api/docs"),
    );
    SwaggerModule.setup("api/docs", app, document, {
      jsonDocumentUrl: "/api/openapi.json",
      raw: ["json"],
      customSiteTitle: "pj-Flim API",
      swaggerOptions: {
        persistAuthorization: false,
        validatorUrl: null,
      },
    });
  }
  await app.init();
  server.use(handleExpressError);
  return { app, document };
}
