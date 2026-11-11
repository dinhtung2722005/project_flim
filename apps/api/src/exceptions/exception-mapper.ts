import { HttpException } from "@nestjs/common";
import { ApiError } from "../../../../packages/backend-core/src/errors";
import {
  connectionError,
  databaseConstraint,
  prismaErrorCode,
  sqlState,
} from "../../../../packages/backend-core/src/database-errors";
import { ERROR_STATUS } from "../../../../packages/contracts/src/errors";
export interface FieldProblem {
  location: "body" | "query" | "path" | "header";
  pointer: string;
  code: string;
  message: string;
}
export interface MappedException {
  code: string;
  status: number;
  detail: string;
  retryable: boolean;
  errors?: FieldProblem[];
  kind: "business" | "http" | "parser" | "database" | "unknown";
  retryAfter?: string;
}
const httpCodes: Record<number, string> = {
  400: "REQUEST_INVALID",
  401: "AUTHENTICATION_REQUIRED",
  403: "AUTH_FORBIDDEN",
  404: "RESOURCE_NOT_FOUND",
  405: "REQUEST_METHOD_NOT_ALLOWED",
  406: "REQUEST_NOT_ACCEPTABLE",
  408: "REQUEST_TIMEOUT",
  409: "RESOURCE_CONFLICT",
  412: "RESOURCE_VERSION_MISMATCH",
  413: "REQUEST_TOO_LARGE",
  415: "REQUEST_UNSUPPORTED_MEDIA_TYPE",
  422: "VALIDATION_FAILED",
  428: "PRECONDITION_REQUIRED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "UPSTREAM_BAD_RESPONSE",
  503: "SERVICE_UNAVAILABLE",
  504: "UPSTREAM_TIMEOUT",
};
const retryCodes = new Set([
  "RATE_LIMITED",
  "AUTH_REFRESH_RETRY_CONFLICT",
  "REQUEST_TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "UPSTREAM_BAD_RESPONSE",
  "UPSTREAM_TIMEOUT",
  "MEDIA_PROVIDER_UNAVAILABLE",
  "MEDIA_PROVIDER_TIMEOUT",
  "AUDIT_WRITE_UNAVAILABLE",
]);
const uniqueConstraints: Record<string, string> = {
  users_email_normalized_key: "ACCOUNT_CONFLICT",
  titles_slug_key: "CATALOG_SLUG_CONFLICT",
  genres_slug_key: "CATALOG_SLUG_CONFLICT",
  seasons_title_id_number_key: "CATALOG_SEASON_NUMBER_CONFLICT",
  episodes_season_id_number_key: "CATALOG_EPISODE_NUMBER_CONFLICT",
};
const fieldMessages: Record<string, string> = {
  FIELD_UNKNOWN: "This field is not allowed.",
  FIELD_REQUIRED: "This field is required.",
  FIELD_INVALID_TYPE: "This field has an invalid type.",
  FIELD_INVALID_FORMAT: "This field has an invalid format or value.",
};
function fields(value: unknown): FieldProblem[] | undefined {
  if (!Array.isArray(value)) return;
  const result: FieldProblem[] = [];
  for (const item of value.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const { location, pointer, code } = item;
    if (
      !["body", "query", "path", "header"].includes(location) ||
      typeof pointer !== "string" ||
      !pointer.startsWith("/") ||
      pointer.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(pointer) ||
      typeof code !== "string" ||
      !Object.hasOwn(fieldMessages, code)
    )
      continue;
    result.push({ location, pointer, code, message: fieldMessages[code] });
  }
  return result.length ? result : undefined;
}
function mapped(
  code: string,
  kind: MappedException["kind"],
  detail?: string,
  errors?: FieldProblem[],
): MappedException {
  const known = Object.hasOwn(ERROR_STATUS, code) ? code : "INTERNAL_ERROR",
    status = ERROR_STATUS[known];
  return {
    code: known,
    status,
    kind,
    detail:
      status >= 500
        ? "Request could not be completed."
        : (detail ?? known.replaceAll("_", " ").toLowerCase()),
    retryable: retryCodes.has(known),
    ...(errors ? { errors } : {}),
    ...(known === "RATE_LIMITED"
      ? { retryAfter: "60" }
      : known === "AUTH_REFRESH_RETRY_CONFLICT"
        ? { retryAfter: "2" }
        : {}),
  };
}
export function mapException(error: unknown): MappedException {
  if (error instanceof ApiError) {
    const detail = error.message
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 1000);
    return mapped(
      error.code,
      "business",
      detail,
      error.code === "VALIDATION_FAILED" ? fields(error.errors) : undefined,
    );
  }
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  if (value.type === "entity.parse.failed")
    return mapped("REQUEST_MALFORMED_JSON", "parser");
  if (value.type === "entity.too.large")
    return mapped("REQUEST_TOO_LARGE", "parser");
  if (
    value.type === "encoding.unsupported" ||
    value.type === "charset.unsupported"
  )
    return mapped("REQUEST_UNSUPPORTED_MEDIA_TYPE", "parser");
  if (value.type === "request.aborted" || value.type === "request.size.invalid")
    return mapped("REQUEST_INVALID", "parser");
  if (error instanceof HttpException)
    return mapped(httpCodes[error.getStatus()] ?? "INTERNAL_ERROR", "http");
  const pg = sqlState(error),
    prisma = prismaErrorCode(error);
  if (pg === "23505" || prisma === "P2002")
    return mapped(
      uniqueConstraints[databaseConstraint(error) ?? ""] ?? "RESOURCE_CONFLICT",
      "database",
    );
  if (
    [
      "23502",
      "23503",
      "23514",
      "22P02",
      "22003",
      "22001",
      "22007",
      "22008",
    ].includes(pg ?? "") ||
    [
      "P2000",
      "P2003",
      "P2011",
      "P2012",
      "P2013",
      "P2014",
      "P2019",
      "P2020",
    ].includes(prisma ?? "")
  )
    return mapped("VALIDATION_FAILED", "database");
  if (prisma === "P2025") return mapped("RESOURCE_NOT_FOUND", "database");
  if (
    pg?.startsWith("08") ||
    [
      "40001",
      "40P01",
      "55P03",
      "57014",
      "53300",
      "57P01",
      "57P02",
      "57P03",
    ].includes(pg ?? "") ||
    [
      "P1000",
      "P1001",
      "P1002",
      "P1008",
      "P1011",
      "P1017",
      "P2024",
      "P2034",
    ].includes(prisma ?? "") ||
    connectionError(error)
  )
    return mapped("SERVICE_UNAVAILABLE", "database");
  const status = value.statusCode ?? value.status;
  if (typeof status === "number" && Object.hasOwn(httpCodes, status))
    return mapped(httpCodes[status], "http");
  return mapped("INTERNAL_ERROR", pg || prisma ? "database" : "unknown");
}
