import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { configuration } from "../apps/api/src/config";

type Fixture = { id: string; email: string; password: string };
type Context = {
  fixtures: Pool;
  server: any;
  seed: (role: string, withMfa?: boolean) => Promise<Fixture>;
};

export async function runMfaPolicyChecks(c: Context) {
  let checks = 0;
  const previousPolicy = process.env.AUTH_MFA_REQUIRED;
  const previousMode = process.env.NODE_ENV;
  const status = (res: request.Response, expected: number) => {
    assert.equal(res.status, expected);
    checks++;
    return res;
  };
  const equal = (actual: unknown, expected: unknown) => {
    assert.equal(actual, expected);
    checks++;
  };
  const login = (user: Fixture, password = user.password) =>
    request(c.server).post("/api/v1/auth/sessions").send({
      email: user.email,
      password,
    });
  try {
    delete process.env.AUTH_MFA_REQUIRED;
    equal(configuration().mfaRequired, true);
    process.env.AUTH_MFA_REQUIRED = "false";
    equal(configuration().mfaRequired, false);
    process.env.NODE_ENV = "production";
    equal(configuration().mfaRequired, true);
    process.env.NODE_ENV = previousMode;

    const root = await c.seed("SUPER_ADMIN", false);
    const member = await c.seed("MEMBER", false);
    const editor = await c.seed("EDITOR", true);
    const rootLogin = status(await login(root), 201).body;
    equal(rootLogin.state, "ACTIVE");
    equal(rootLogin.challengeId, undefined);
    assert.ok(rootLogin.accessToken && rootLogin.refreshToken);
    checks++;
    const token = rootLogin.accessToken;
    const session = (
      await c.fixtures.query(
        "SELECT mfa_verified_at,step_up_at,idle_expires_at FROM movie.auth_sessions WHERE id=$1",
        [rootLogin.sessionId],
      )
    ).rows[0];
    equal(session.mfa_verified_at, null);
    equal(session.step_up_at, null);
    assert.ok(session.idle_expires_at.getTime() - Date.now() <= 30 * 60 * 1000);
    checks++;
    equal(
      status(await login(root, "wrong-password"), 401).body.code,
      "AUTH_INVALID_CREDENTIALS",
    );
    status(
      await request(c.server)
        .get("/api/v1/admin/titles")
        .auth(token, { type: "bearer" }),
      200,
    );
    equal(status(await login(editor), 201).body.state, "ACTIVE");
    status(
      await request(c.server)
        .get("/api/v1/me/watchlist")
        .auth(token, { type: "bearer" }),
      200,
    );

    const genre = status(
      await request(c.server)
        .post("/api/v1/admin/genres")
        .auth(token, { type: "bearer" })
        .send({
          slug: "local-policy-" + randomUUID(),
          name: "Local policy test",
        }),
      201,
    );
    const audit = await c.fixtures.query(
      "SELECT count(*)::int AS count FROM movie.audit_logs WHERE actor_user_id=$1 AND resource_id=$2",
      [root.id, genre.body.id],
    );
    equal(audit.rows[0].count, 1);
    const settings = status(
      await request(c.server)
        .get("/api/v1/admin/settings/site")
        .auth(token, { type: "bearer" }),
      200,
    );
    status(
      await request(c.server)
        .put("/api/v1/admin/settings/site")
        .auth(token, { type: "bearer" })
        .set("If-Match", settings.headers.etag)
        .send({ name: "Local password-only policy test" }),
      200,
    );
    const memberLogin = status(await login(member), 201).body;
    equal(
      status(
        await request(c.server)
          .get("/api/v1/admin/titles")
          .auth(memberLogin.accessToken, { type: "bearer" }),
        403,
      ).body.code,
      "AUTH_FORBIDDEN",
    );

    const roles = status(
      await request(c.server)
        .get("/api/v1/admin/users/" + member.id + "/roles")
        .auth(token, { type: "bearer" }),
      200,
    );
    status(
      await request(c.server)
        .put("/api/v1/admin/users/" + member.id + "/roles")
        .auth(token, { type: "bearer" })
        .set("If-Match", roles.headers.etag)
        .send({
          roles: ["EDITOR"],
          reason: "Verify local role assignment without MFA",
        }),
      200,
    );
    equal(
      status(
        await request(c.server)
          .get("/api/v1/me")
          .auth(memberLogin.accessToken, { type: "bearer" }),
        401,
      ).body.code,
      "AUTH_SESSION_REVOKED",
    );
    equal(status(await login(member), 201).body.state, "ACTIVE");

    // Enabling MFA again must reject sessions authenticated by password alone.
    process.env.AUTH_MFA_REQUIRED = "true";
    equal(
      status(
        await request(c.server)
          .get("/api/v1/admin/titles")
          .auth(token, { type: "bearer" }),
        403,
      ).body.code,
      "AUTH_MFA_REQUIRED",
    );
    equal(
      status(await login(root), 403).body.code,
      "AUTH_MFA_ENROLLMENT_REQUIRED",
    );
    equal(status(await login(editor), 201).body.state, "PENDING_MFA");
    // A local override cannot disable production MFA.
    process.env.AUTH_MFA_REQUIRED = "false";
    process.env.NODE_ENV = "production";
    equal(
      status(await login(root), 403).body.code,
      "AUTH_MFA_ENROLLMENT_REQUIRED",
    );
    equal(
      status(
        await request(c.server)
          .get("/api/v1/admin/titles")
          .auth(token, { type: "bearer" }),
        403,
      ).body.code,
      "AUTH_MFA_REQUIRED",
    );
    process.env.NODE_ENV = previousMode;
    process.env.AUTH_MFA_REQUIRED = "false";
    status(
      await request(c.server)
        .delete("/api/v1/auth/sessions/current")
        .auth(token, { type: "bearer" }),
      204,
    );
    equal(
      status(
        await request(c.server)
          .get("/api/v1/admin/titles")
          .auth(token, { type: "bearer" }),
        401,
      ).body.code,
      "AUTH_SESSION_REVOKED",
    );
    return checks;
  } finally {
    if (previousPolicy === undefined) delete process.env.AUTH_MFA_REQUIRED;
    else process.env.AUTH_MFA_REQUIRED = previousPolicy;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
}
