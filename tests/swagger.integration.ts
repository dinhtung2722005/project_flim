import assert from "node:assert/strict";
import request from "supertest";
import { createApplication } from "../apps/api/src/application";

export async function runSwaggerChecks(c: { server: any }) {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    assert.equal(actual, expected);
    checks++;
  };
  const get = (path: string) => request(c.server).get(path);
  for (const path of [
    "/api/docs",
    "/api/docs/",
    "/api/docs/swagger-ui.css",
    "/api/docs/swagger-ui-init.js",
    "/api/openapi.json",
  ]) {
    const response = await get(path);
    equal(response.status, 200);
    equal(response.headers["set-cookie"], undefined);
  }
  const spec = await get("/api/openapi.json");
  equal(
    spec.body.paths["/api/v1/admin/titles"].get.security[0].bearer.length,
    0,
  );
  equal(
    spec.body.paths["/api/v1/admin/titles"].post.security[0].bearer.length,
    0,
  );
  const init = await get("/api/docs/swagger-ui-init.js");
  equal(init.text.includes("/api/docs-session"), false);
  equal(init.text.includes("requestInterceptor"), false);

  const legacy = await get("/api/docs-login");
  equal(legacy.status, 302);
  equal(legacy.headers.location, "/api/docs");
  equal(legacy.headers["set-cookie"], undefined);
  const obsoletePost = await request(c.server)
    .post("/api/docs-login")
    .set("Accept", "text/html")
    .type("form")
    .send({ email: "ignored@example.test", password: "unused" });
  equal(obsoletePost.status, 404);
  equal(obsoletePost.body.code, "RESOURCE_NOT_FOUND");
  const oldSession = await get("/api/docs-session");
  equal(oldSession.status, 404);
  equal(oldSession.body.code, "RESOURCE_NOT_FOUND");

  // Obsolete cookies do not grant permission to call business endpoints.
  const admin = await get("/api/v1/admin/titles").set(
    "Cookie",
    "pj_flim_docs=obsolete; pj_flim_docs_csrf=obsolete",
  );
  equal(admin.status, 401);
  equal(admin.body.code, "AUTHENTICATION_REQUIRED");
  const mutation = await request(c.server).post("/api/v1/admin/genres").send({
    slug: "public-docs-does-not-grant-access",
    name: "Must not be created",
  });
  equal(mutation.status, 401);
  equal(mutation.body.code, "AUTHENTICATION_REQUIRED");
  const invalidBearer = await get("/api/v1/admin/titles").set(
    "Authorization",
    "Bearer invalid",
  );
  equal(invalidBearer.status, 401);

  const previousMode = process.env.NODE_ENV;
  const previousDocs = process.env.SWAGGER_ENABLED;
  try {
    for (const mode of ["production", "disabled"]) {
      process.env.NODE_ENV =
        mode === "production" ? "production" : "development";
      process.env.SWAGGER_ENABLED = mode === "production" ? "true" : "false";
      const instance = await createApplication();
      try {
        for (const path of [
          "/api/docs",
          "/api/docs/swagger-ui.css",
          "/api/openapi.json",
          "/api/docs-login",
          "/api/docs-session",
          "/api/docs-json",
          "/api/docs-yaml",
        ]) {
          equal(
            (await request(instance.app.getHttpServer()).get(path)).status,
            404,
          );
        }
      } finally {
        await instance.app.close();
      }
    }
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousDocs === undefined) delete process.env.SWAGGER_ENABLED;
    else process.env.SWAGGER_ENABLED = previousDocs;
  }
  return checks;
}
