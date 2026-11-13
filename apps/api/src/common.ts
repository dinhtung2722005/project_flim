export { sqlState } from "../../../packages/backend-core/src/database-errors";
import { Prisma } from "@prisma/client";
import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { Tx } from "../../../packages/database/src/database";
import { one, query } from "../../../packages/database/src/database";
import { configuration } from "./config";
import {
  ApiError,
  fail,
  hash,
  secureEqual,
} from "../../../packages/backend-core/src/errors";
export { ApiError, fail, hash, secureEqual };
export interface Principal {
  id: string;
  sid: string;
  authVersion: string;
  roles: string[];
  permissions: string[];
  stepUpAt: Date | null;
  requestId: string;
}
export const Public = () => SetMetadata("public", true);
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata("permissions", permissions);
export const StepUp = () => SetMetadata("stepUp", true);
export const Actor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    (ctx.switchToHttp().getRequest() as Request & { actor: Principal }).actor,
);
export function json(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value))
    throw new Error("Private byte data cannot be serialized.");
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === "object") {
    if (Prisma.Decimal.isDecimal(value)) return Number(value.toString());
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        json(item),
      ]),
    );
  }
  return value;
}
export function normalize(text: string) {
  return text
    .toLowerCase()
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function etag(
  type: string,
  id: string,
  version: string | number | bigint,
) {
  return '"' + type + ":" + id + ":" + version.toString() + '"';
}
export function requireMatch(
  header: string | undefined,
  type: string,
  id: string,
  version: string | number | bigint,
) {
  if (!header)
    fail(
      "PRECONDITION_REQUIRED",
      "If-Match is required. Read the resource ETag first.",
    );
  if (header !== etag(type, id, version))
    fail(
      "RESOURCE_VERSION_MISMATCH",
      "The resource changed. Read its current ETag.",
    );
}
export function rowTag(type: string, row: Record<string, any>) {
  return etag(
    type,
    row.id ?? row.key,
    hash(JSON.stringify(json(row))).slice(0, 24),
  );
}
export function requireRowMatch(
  header: string | undefined,
  type: string,
  row: Record<string, any>,
) {
  if (!header) fail("PRECONDITION_REQUIRED");
  if (header !== rowTag(type, row)) fail("RESOURCE_VERSION_MISMATCH");
}
export function assertStepUp(actor: Principal) {
  if (!configuration().mfaRequired) return;
  if (!actor.stepUpAt || Date.now() - actor.stepUpAt.getTime() > 300000)
    fail("AUTH_STEP_UP_REQUIRED");
}
export function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail("REQUEST_INVALID_IDENTIFIER");
  return value;
}
@Injectable()
export class UuidPipe implements PipeTransform {
  transform(value: string) {
    return uuid(value);
  }
}
export function changedFields(body: object) {
  return Object.entries(body)
    .filter(([, v]) => v !== undefined)
    .map(([key]) => key)
    .sort();
}
export async function audit(
  tx: Tx,
  actor: Principal,
  action: string,
  type: string,
  id: string,
  diff: Record<string, unknown> = {},
  reason?: string,
) {
  try {
    if (Buffer.byteLength(JSON.stringify(json(diff))) > 16384)
      throw new Error("Audit diff too large.");
    const inserted = await query(
      tx,
      "INSERT INTO movie.audit_logs(actor_user_id,actor_kind,actor_role_codes_snapshot,action,resource_type,resource_id,outcome,safe_diff,reason,request_id) VALUES ($1::uuid,'USER',$2::text[],$3,$4,$5,'SUCCESS',$6::jsonb,$7,$8) RETURNING id",
      [
        actor.id,
        actor.roles,
        action,
        type,
        id,
        JSON.stringify(json(diff)),
        reason ?? null,
        actor.requestId,
      ],
    );
    return inserted[0].id as bigint;
  } catch {
    throw new ApiError("AUDIT_WRITE_UNAVAILABLE");
  }
}
export async function outbox(
  tx: Tx,
  actor: Principal,
  type: string,
  id: string,
  version: bigint | number | string,
) {
  await query(
    tx,
    "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,initiating_actor_id,correlation_id,payload) VALUES ('catalog.changed',$1,$2::uuid,$3::bigint,$4::uuid,$5,$6::jsonb) RETURNING id",
    [
      type,
      id,
      version.toString(),
      actor.id,
      actor.requestId,
      JSON.stringify({ resourceType: type, resourceId: id }),
    ],
  );
}
export async function checkMutation(
  tx: Tx,
  actor: Principal,
  permission: string,
) {
  const user = await one(
    tx,
    "SELECT u.id FROM movie.users u JOIN movie.auth_sessions s ON s.user_id=u.id WHERE u.id=$1::uuid AND s.id=$2::uuid AND u.status='ACTIVE' AND s.state='ACTIVE' AND u.auth_version=$3::bigint AND s.auth_version=u.auth_version AND (NOT $4::boolean OR s.mfa_verified_at IS NOT NULL) AND s.absolute_expires_at>now() AND s.idle_expires_at>now() FOR SHARE OF u,s",
    [actor.id, actor.sid, actor.authVersion, configuration().mfaRequired],
  );
  if (!user) fail("AUTH_SESSION_REVOKED");
  const permitted = await one(
    tx,
    "SELECT 1 FROM movie.user_roles ur JOIN movie.role_permissions rp ON rp.role_id=ur.role_id JOIN movie.permissions p ON p.id=rp.permission_id WHERE ur.user_id=$1::uuid AND p.code=$2 LIMIT 1",
    [actor.id, permission],
  );
  if (!permitted) fail("AUTH_FORBIDDEN");
}
export function pageCursor(
  resource: string,
  filter: unknown,
  last: unknown[],
): string {
  const text = Buffer.from(
    JSON.stringify({ resource, filter: hash(JSON.stringify(filter)), last }),
  ).toString("base64url");
  return (
    text +
    "." +
    createHmac("sha256", configuration().cursor)
      .update(text)
      .digest("base64url")
  );
}
export function readCursor(
  cursor: string | undefined,
  resource: string,
  filter: unknown,
): unknown[] | null {
  if (!cursor) return null;
  try {
    const [text, signature, ...extra] = cursor.split(".");
    if (
      extra.length ||
      !signature ||
      !secureEqual(
        signature,
        createHmac("sha256", configuration().cursor)
          .update(text)
          .digest("base64url"),
      )
    )
      throw Error();
    const parsed = JSON.parse(Buffer.from(text, "base64url").toString());
    if (
      parsed.resource !== resource ||
      parsed.filter !== hash(JSON.stringify(filter)) ||
      !Array.isArray(parsed.last) ||
      parsed.last.length !== 2 ||
      !Number.isFinite(Date.parse(parsed.last[0])) ||
      !(
        /^[a-f0-9-]{36}$/i.test(parsed.last[1]) ||
        /^[1-9][0-9]{0,18}$/.test(parsed.last[1])
      )
    )
      throw Error();
    return parsed.last;
  } catch {
    fail("REQUEST_INVALID_CURSOR");
  }
}
export function paginated(
  rows: Record<string, any>[],
  limit: number,
  resource: string,
  filter: unknown,
  time = "created_at",
) {
  const hasMore = rows.length > limit,
    data = rows.slice(0, limit),
    last = data.at(-1);
  return {
    data: json(data.map(({ __cursor_time, ...row }) => row)),
    page: {
      limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? pageCursor(resource, filter, [
              last.__cursor_time ?? new Date(last[time]).toISOString(),
              last.id.toString(),
            ])
          : null,
    },
  };
}
