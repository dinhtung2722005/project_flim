import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { mapException } from "../exceptions/exception-mapper";
type ErrorRequest = Request & { requestId?: string };
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    this.render(
      error,
      context.getRequest<ErrorRequest>(),
      context.getResponse<Response>(),
    );
  }
  render(error: unknown, req: ErrorRequest, res: Response): void {
    const mapped = mapException(error);
    const requestId =
      typeof req.requestId === "string" &&
      /^[a-f0-9-]{36}$/i.test(req.requestId)
        ? req.requestId
        : randomUUID();
    req.requestId = requestId;
    const instance = (
      typeof req.path === "string" ? req.path : (req.url ?? "/").split("?")[0]
    )
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 2048);
    if (mapped.status >= 500)
      console.error(
        JSON.stringify({
          level: "error",
          event: "http.exception",
          code: mapped.code,
          status: mapped.status,
          kind: mapped.kind,
          requestId,
          method: req.method,
          path: instance,
          headersSent: res.headersSent,
        }),
      );
    if (res.writableEnded || res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res
      .status(mapped.status)
      .type("application/problem+json")
      .set("Cache-Control", "no-store")
      .set("X-Request-Id", requestId);
    if (mapped.retryAfter) res.set("Retry-After", mapped.retryAfter);
    res.json({
      type:
        "urn:pj-flim:problem:" + mapped.code.toLowerCase().replaceAll("_", "-"),
      title: mapped.code.replaceAll("_", " "),
      status: mapped.status,
      code: mapped.code,
      detail: mapped.detail,
      instance,
      requestId,
      retryable: mapped.retryable,
      ...(mapped.errors ? { errors: mapped.errors } : {}),
    });
  }
}
