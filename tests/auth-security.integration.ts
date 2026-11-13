import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Pool } from "pg";
import request from "supertest";
import { AuthService } from "../apps/api/src/services/auth.service";
import { configuration } from "../apps/api/src/config";

type Fixture = { id: string; email: string; password: string };
type Context = {
  app: INestApplication;
  fixtures: Pool;
  seed: (role: string, withMfa?: boolean) => Promise<Fixture>;
};
type Session = Fixture & { sid: string; token: string; av: string };
type Route = { method: string; path: string; permissions: string[] };
const roles = ["MEMBER", "EDITOR", "ADMIN", "SUPER_ADMIN", "AUDITOR"] as const;
// Product policy, deliberately independent of controller metadata and database grants.
const policy: Record<string, readonly string[]> = {
  "catalog.read_drafts": ["EDITOR", "ADMIN", "SUPER_ADMIN"],
  "media.preview": ["EDITOR", "ADMIN", "SUPER_ADMIN"],
  "catalog.write": ["EDITOR", "ADMIN", "SUPER_ADMIN"],
  "catalog.publish": ["ADMIN", "SUPER_ADMIN"],
  "media.upload": ["EDITOR", "ADMIN", "SUPER_ADMIN"],
  "media.retry": ["ADMIN", "SUPER_ADMIN"],
  "media.delete": ["ADMIN", "SUPER_ADMIN"],
  "reports.read": ["EDITOR", "ADMIN", "SUPER_ADMIN", "AUDITOR"],
  "users.read": ["ADMIN", "SUPER_ADMIN"],
  "users.suspend": ["ADMIN", "SUPER_ADMIN"],
  "rbac.read": ["ADMIN", "SUPER_ADMIN", "AUDITOR"],
  "rbac.assign": ["SUPER_ADMIN"],
  "mfa.reset_others": ["SUPER_ADMIN"],
  "audit.read": ["ADMIN", "SUPER_ADMIN", "AUDITOR"],
  "audit.export": ["SUPER_ADMIN", "AUDITOR"],
  "metrics.read": ["ADMIN", "SUPER_ADMIN", "AUDITOR"],
  "docs.read": ["EDITOR", "ADMIN", "SUPER_ADMIN", "AUDITOR"],
  "settings.write": ["SUPER_ADMIN"],
};

// Endpoint security contract: changing a decorator cannot silently weaken this oracle.
const endpointPolicy: Record<string, string[]> = {
  "catalog.read_drafts": [
    "get titles",
    "get titles/:id",
    "get titles/:id/publication",
    "get titles/:id/seasons",
    "get seasons/:id",
    "get seasons/:id/episodes",
    "get episodes/:id",
    "get episodes/:id/publication",
    "get genres",
    "get genres/:id",
    "get people",
    "get people/:id",
    "get banners",
    "get banners/:id",
  ],
  "catalog.write": [
    "post titles",
    "patch titles/:id",
    "post titles/:id/seasons",
    "patch seasons/:id",
    "post seasons/:id/episodes",
    "patch episodes/:id",
    "post genres",
    "patch genres/:id",
    "post people",
    "patch people/:id",
    "post banners",
    "patch banners/:id",
  ],
  "catalog.publish": [
    "put titles/:id/publication",
    "put episodes/:id/publication",
  ],
  "users.read": ["get users", "get users/:id", "get users/:id/status"],
  "users.suspend": ["put users/:id/status"],
  "rbac.read": ["get roles", "get permissions", "get users/:id/roles"],
  "rbac.assign": ["put users/:id/roles"],
  "settings.write": ["get settings/site", "put settings/site"],
  "metrics.read": ["get metrics/summary"],
  "reports.read": ["get reports"],
  "audit.read": ["get audit-logs", "get audit-logs/:id"],
  "media.preview": [
    "get media-assets/:id",
    "get processing-attempts/:id",
    "get operations/:id",
  ],
  "media.upload": [
    "post episodes/:id/upload-intents",
    "get upload-intents/:id",
    "post upload-intents/:id/verifications",
  ],
  "media.retry": ["post media-assets/:id/processing-attempts"],
};
const expectedPermissions = new Map(
  Object.entries(endpointPolicy).flatMap(([permission, endpoints]) =>
    endpoints.map((endpoint) => [endpoint, permission] as const),
  ),
);

export async function runAuthSecurityChecks(c: Context) {
  let checks = 0;
  let deniedRequests = 0;
  let allowedReadRequests = 0;
  const groups: string[] = [];
  const server = c.app.getHttpServer();
  const auth = c.app.get(AuthService);
  const jwt = c.app.get(JwtService);
  const reflector = c.app.get(Reflector);
  const previousPolicy = process.env.AUTH_MFA_REQUIRED;
  const equal = (actual: unknown, expected: unknown, label: string) => {
    assert.deepEqual(actual, expected, label);
    checks++;
  };
  const ok = (value: unknown, label: string) => {
    assert.ok(value, label);
    checks++;
  };
  const problem = (res: request.Response, expected: number, code: string) => {
    equal(res.status, expected, "security response status");
    equal(res.body.code, code, "security problem code");
    ok(
      /application\/problem\+json/.test(res.headers["content-type"] ?? ""),
      "problem media type",
    );
  };
  const api = (method: string, path: string, token?: string) => {
    const res = (request(server) as any)[method](path) as request.Test;
    return token ? res.auth(token, { type: "bearer" }) : res;
  };
  async function session(role: string): Promise<Session> {
    const user = await c.seed(role);
    // Trusted session fixtures exist only in the runner's disposable PostgreSQL.
    // Password/MFA exchange is separately exercised by the main integration suite.
    const result = await c.fixtures.query(
      "INSERT INTO movie.auth_sessions(user_id,state,auth_version,mfa_verified_at,step_up_at,idle_expires_at,absolute_expires_at) SELECT id,'ACTIVE',auth_version,now(),now(),now()+interval '30 minutes',now()+interval '8 hours' FROM movie.users WHERE id=$1 RETURNING id,auth_version",
      [user.id],
    );
    const sid = result.rows[0].id,
      av = result.rows[0].auth_version.toString();
    return {
      ...user,
      sid,
      av,
      token: auth.sign({ sub: user.id, sid, av, kind: "access" }),
    };
  }
  try {
    process.env.AUTH_MFA_REQUIRED = "true";
    const originalCursor = process.env.CURSOR_SECRET;
    try {
      for (const value of ["x", "x".repeat(63)]) {
        process.env.CURSOR_SECRET = value;
        assert.throws(
          () => configuration(),
          /Invalid authentication key configuration/,
        );
        checks++;
      }
      process.env.CURSOR_SECRET = "x".repeat(64);
      equal(
        configuration().cursor.length,
        64,
        "minimum cursor key length accepted",
      );
    } finally {
      if (originalCursor === undefined) delete process.env.CURSOR_SECRET;
      else process.env.CURSOR_SECRET = originalCursor;
    }
    groups.push("fail-fast validation of cursor/playback signing key length");

    const actors = new Map<string, Session>();
    for (const role of roles) actors.set(role, await session(role));
    const member = actors.get("MEMBER")!,
      root = actors.get("SUPER_ADMIN")!;
    const routes: Route[] = [];
    for (const module of c.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype;
        if (!controller) continue;
        const base = Reflect.getMetadata(PATH_METADATA, controller) ?? "";
        const prototype = controller.prototype;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (typeof handler !== "function") continue;
          const verb = Reflect.getMetadata(METHOD_METADATA, handler);
          if (verb === undefined) continue;
          const child = Reflect.getMetadata(PATH_METADATA, handler) ?? "";
          const path = "/api/v1/" + [base, child].filter(Boolean).join("/");
          if (!path.startsWith("/api/v1/admin/")) continue;
          equal(
            reflector.getAllAndOverride("public", [handler, controller]) ??
              false,
            false,
            "admin is never public",
          );
          const permissions =
            reflector.getAllAndOverride<string[]>("permissions", [
              handler,
              controller,
            ]) ?? [];
          ok(permissions.length > 0, "admin has permission metadata");
          for (const permission of permissions)
            ok(policy[permission], "known permission policy");
          const method = RequestMethod[verb].toLowerCase();
          const endpoint = method + " " + path.slice("/api/v1/admin/".length);
          equal(
            permissions,
            [expectedPermissions.get(endpoint)],
            "endpoint requires its independently specified permission",
          );
          if (["put users/:id/roles", "put settings/site"].includes(endpoint))
            equal(
              reflector.getAllAndOverride("stepUp", [handler, controller]),
              true,
              "sensitive endpoint declares step-up",
            );
          routes.push({
            method: RequestMethod[verb].toLowerCase(),
            path,
            permissions,
          });
        }
      }
    }
    equal(routes.length, 49, "all current admin operations enumerated");
    groups.push("admin route metadata coverage");

    const dummyId = randomUUID();
    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z]+)/g, (_, key) =>
        key === "key" ? "site" : dummyId,
      );
      problem(
        await api(route.method, path).send(
          route.method === "get" ? undefined : {},
        ),
        401,
        "AUTHENTICATION_REQUIRED",
      );
      deniedRequests++;
      for (const role of roles) {
        const actor = actors.get(role)!;
        const permitted = route.permissions.every((p) =>
          policy[p].includes(role),
        );
        if (!permitted) {
          problem(
            await api(route.method, path, actor.token).send(
              route.method === "get" ? undefined : {},
            ),
            403,
            "AUTH_FORBIDDEN",
          );
          deniedRequests++;
        } else if (route.method === "get") {
          const res = await api("get", path, actor.token);
          ok(
            ![401, 403].includes(res.status),
            "permitted read passes access control",
          );
          allowedReadRequests++;
        }
      }
    }
    groups.push("five-role matrix over every admin operation");

    const claims = {
      sub: member.id,
      sid: member.sid,
      av: member.av,
      kind: "access",
    };
    const sign = (
      payload: Record<string, unknown>,
      options: Record<string, unknown> = {},
    ) =>
      jwt.sign(payload, {
        secret: configuration().jwt,
        algorithm: "HS256",
        issuer: "pj-Flim",
        audience: "pj-Flim-api",
        expiresIn: 900,
        ...options,
      });
    const validParts = member.token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claims, sub: root.id, roles: ["SUPER_ADMIN"] }),
    ).toString("base64url");
    const invalidTokens = [
      "invalid.jwt.value",
      validParts[0] + "." + forgedPayload + "." + validParts[2],
      Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url") +
        "." +
        validParts[1] +
        ".",
      sign(claims, { secret: "untrusted-test-key" }),
      sign(claims, { algorithm: "HS384" }),
      sign(claims, { issuer: "another-issuer" }),
      sign(claims, { audience: "another-audience" }),
      sign({ ...claims, kind: "mfa" }),
    ];
    for (const token of invalidTokens)
      problem(
        await api("get", "/api/v1/me", token),
        401,
        "AUTHENTICATION_REQUIRED",
      );
    problem(
      await api("get", "/api/v1/me", sign(claims, { expiresIn: -1 })),
      401,
      "AUTH_TOKEN_EXPIRED",
    );
    problem(
      await request(server)
        .get("/api/v1/me")
        .set("Authorization", "Basic ignored"),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    const roleInjection = sign({
      ...claims,
      roles: ["SUPER_ADMIN"],
      permissions: ["rbac.assign", "settings.write"],
    });
    problem(
      await api("get", "/api/v1/admin/users", roleInjection),
      403,
      "AUTH_FORBIDDEN",
    );
    equal(
      (await api("get", "/api/v1/me", member.token)).status,
      200,
      "valid access credential accepted",
    );
    groups.push(
      "JWT signature, none, algorithm, issuer, audience, kind, expiry and untrusted role claims",
    );

    const other = await session("MEMBER");
    for (const actor of [member, root]) {
      problem(
        await api("get", "/api/v1/users/" + other.id, actor.token),
        404,
        "RESOURCE_NOT_FOUND",
      );
      problem(
        await api("get", "/api/v1/auth/sessions/" + other.sid, actor.token),
        404,
        "RESOURCE_NOT_FOUND",
      );
    }
    equal(
      (await api("get", "/api/v1/users/" + other.id, other.token)).status,
      200,
      "own account readable",
    );
    equal(
      (await api("get", "/api/v1/auth/sessions/" + other.sid, other.token))
        .status,
      200,
      "own auth session readable",
    );
    problem(
      await api(
        "put",
        "/api/v1/admin/users/" + root.id + "/roles",
        member.token,
      ).send({ roles: ["SUPER_ADMIN"], reason: "Unauthorized promotion test" }),
      403,
      "AUTH_FORBIDDEN",
    );
    const editor = actors.get("EDITOR")!;
    const target = await api(
      "get",
      "/api/v1/admin/users/" + editor.id,
      root.token,
    );
    equal(target.status, 200, "staff target fixture exists");
    problem(
      await api(
        "put",
        "/api/v1/admin/users/" + editor.id + "/status",
        actors.get("ADMIN")!.token,
      )
        .set("If-Match", target.headers.etag)
        .send({
          status: "SUSPENDED",
          reason: "Unauthorized staff suspension test",
        }),
      403,
      "RBAC_ROLE_NOT_ASSIGNABLE",
    );
    equal(
      (
        await c.fixtures.query("SELECT status FROM movie.users WHERE id=$1", [
          editor.id,
        ])
      ).rows[0].status,
      "ACTIVE",
      "denied operation made no status change",
    );
    groups.push("cross-account access and privilege escalation");

    await c.fixtures.query("DELETE FROM movie.user_roles WHERE user_id=$1", [
      editor.id,
    ]);
    problem(
      await api("get", "/api/v1/admin/titles", editor.token),
      403,
      "AUTH_FORBIDDEN",
    );
    groups.push(
      "permissions reloaded instead of trusting previously issued token",
    );

    await c.fixtures.query(
      "UPDATE movie.users SET status='SUSPENDED' WHERE id=$1",
      [other.id],
    );
    problem(
      await api("get", "/api/v1/me", other.token),
      401,
      "AUTH_SESSION_REVOKED",
    );
    await c.fixtures.query(
      "UPDATE movie.users SET status='ACTIVE' WHERE id=$1",
      [other.id],
    );
    for (const column of ["idle_expires_at", "absolute_expires_at"]) {
      await c.fixtures.query(
        column === "absolute_expires_at"
          ? "UPDATE movie.auth_sessions SET created_at=now()-interval '1 hour',idle_expires_at=now()-interval '2 minutes',absolute_expires_at=now()-interval '1 minute' WHERE id=$1"
          : "UPDATE movie.auth_sessions SET idle_expires_at=now()-interval '1 minute' WHERE id=$1",
        [other.sid],
      );
      problem(
        await api("get", "/api/v1/me", other.token),
        401,
        "AUTH_SESSION_REVOKED",
      );
      await c.fixtures.query(
        "UPDATE movie.auth_sessions SET idle_expires_at=now()+interval '30 minutes',absolute_expires_at=now()+interval '8 hours' WHERE id=$1",
        [other.sid],
      );
    }
    await c.fixtures.query(
      "UPDATE movie.auth_sessions SET state='PENDING_MFA' WHERE id=$1",
      [other.sid],
    );
    problem(
      await api("get", "/api/v1/me", other.token),
      401,
      "AUTH_SESSION_REVOKED",
    );
    await c.fixtures.query(
      "UPDATE movie.auth_sessions SET state='ACTIVE' WHERE id=$1",
      [other.sid],
    );
    await c.fixtures.query(
      "UPDATE movie.users SET auth_version=auth_version+1 WHERE id=$1",
      [other.id],
    );
    problem(
      await api("get", "/api/v1/me", other.token),
      401,
      "AUTH_SESSION_REVOKED",
    );
    equal(
      (await api("delete", "/api/v1/auth/sessions/current", member.token))
        .status,
      204,
      "logout succeeds",
    );
    problem(
      await api("get", "/api/v1/me", member.token),
      401,
      "AUTH_SESSION_REVOKED",
    );
    groups.push(
      "suspension, idle and absolute expiry, pending MFA, auth-version change and logout",
    );

    await mkdir(".local/api", { recursive: true });
    await writeFile(
      ".local/api/auth-security-result.json",
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          passed: true,
          checks,
          groups,
          adminOperations: routes.length,
          roles: roles.length,
          deniedRequests,
          allowedReadRequests,
          database: "runner-owned isolated temporary PostgreSQL",
          authenticationFixture:
            "trusted ACTIVE session seeds; password/MFA exchange covered by main suite",
          limitations: [
            "no external penetration test",
            "no load test",
            "CDN signed URL expiry remains open",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    return checks;
  } finally {
    if (previousPolicy === undefined) delete process.env.AUTH_MFA_REQUIRED;
    else process.env.AUTH_MFA_REQUIRED = previousPolicy;
  }
}
