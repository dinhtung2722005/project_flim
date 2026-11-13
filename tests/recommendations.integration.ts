import { RecommendationsService } from "../apps/api/src/services/recommendations.service";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  MODEL_VERSION,
  Item,
  cosine,
  unit,
  vectors,
  rank,
  decayedWeight,
  qualifiedSeconds,
  normalizeText,
} from "../packages/recommendations/src/content";
export function runRecommendationAlgorithmChecks() {
  let checks = 0;
  function eq(a: unknown, b: unknown) {
    assert.deepEqual(a, b);
    checks++;
  }
  function ok(a: unknown) {
    assert.ok(a);
    checks++;
  }
  eq(normalizeText("Điện ảnh — HÀNH ĐỘNG!"), "dien anh   hanh dong");
  eq(cosine(new Map(), new Map()), 0);
  eq(
    cosine(
      unit(
        new Map([
          ["x", 3],
          ["y", 4],
        ]),
      ),
      unit(
        new Map([
          ["x", 3],
          ["y", 4],
        ]),
      ),
    ),
    1,
  );
  ok(
    Math.abs(
      cosine(
        unit(
          new Map([
            ["x", 3],
            ["y", 4],
          ]),
        ),
        new Map([["x", 1]]),
      ) - 0.6,
    ) < 1e-12,
  );
  eq(qualifiedSeconds(5), 5);
  eq(qualifiedSeconds(100), 20);
  eq(qualifiedSeconds(3600), 120);
  eq(decayedWeight(2, new Date(0), 30 * 86400000), 1);
  const now = Date.UTC(2026, 10, 13);
  const item = (id: string, genres: string[], text = ""): Item => ({
    id,
    genres,
    text,
    credits: [],
    language: null,
    countries: [],
    year: null,
    publishedAt: new Date(now),
  });
  const items = [
    item("seed", ["action"], "anh hung chien dau"),
    item("similar", ["action"], "anh hung chien dau"),
    item("other", ["comedy"], "hai huoc gia dinh"),
    item("empty", []),
  ];
  const index = vectors(items);
  eq(index.get("empty")!.size, 0);
  ok(cosine(index.get("seed")!, index.get("similar")!) > 0.99);
  eq(cosine(index.get("seed")!, index.get("other")!), 0);
  const result = rank(
    items,
    items.map((i) => i.id),
    [{ id: "seed", weight: 2 }],
    now,
  );
  eq(result.personalized, true);
  eq(result.items[0].id, "similar");
  ok(!result.items.some((i) => i.id === "seed"));
  eq(result.items[0].reason, "SIMILAR_CONTENT");
  eq(rank(items, ["other", "similar"], [], now).personalized, false);
  eq(
    rank(items, ["other", "similar"], [{ id: "empty", weight: 4 }], now)
      .personalized,
    false,
  );
  eq(rank([], [], [], now).items, []);
  eq(rank(items, ["similar", "similar"], [], now).items.length, 1);
  eq(
    rank(items, ["similar"], [{ id: "seed", weight: NaN }], now).personalized,
    false,
  );
  eq(
    rank(
      items,
      items.map((i) => i.id),
      [{ id: "seed", weight: 2 }],
      now,
    ),
    result,
  );
  // Equal relevance: MMR chooses a different genre before the second duplicate.
  const diversity = [
    item("a", ["action"]),
    item("b", ["action"]),
    item("c", ["comedy"]),
  ];
  eq(
    rank(diversity, ["a", "b", "c"], [], now).items.map((i) => i.id),
    ["a", "c", "b"],
  );
  eq(MODEL_VERSION, "content-v1");
  return checks;
}
export async function runRecommendationIntegration(c: {
  app: any;
  api: any;
  fixtures: any;
  rootId: string;
  rootToken: string;
  memberToken: string;
  fixture: (
    name: string,
    published?: boolean,
  ) => Promise<{ titleId: string; episodeId: string; assetId: string }>;
}) {
  let checks = runRecommendationAlgorithmChecks();
  const f = c.fixtures,
    api = c.api,
    token = c.memberToken;
  const expect = async (req: any, status: number, code?: string) => {
    const r = await req;
    assert.equal(r.status, status, JSON.stringify({ status, body: r.body }));
    checks++;
    if (code) {
      assert.equal(r.body.code, code);
      checks++;
    }
    return r;
  };
  const eq = (a: unknown, b: unknown) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const ok = (a: unknown) => {
    assert.ok(a);
    checks++;
  };
  const me = (await expect(api("get", "/api/v1/me", token), 200)).body.id;
  const seed = await c.fixture("Rec seed"),
    near = await c.fixture("Rec near"),
    other = await c.fixture("Rec other"),
    hidden = await c.fixture("Rec hidden", false);
  const genre = randomUUID();
  await f.query(
    "INSERT INTO movie.genres(id,slug,name) VALUES ($1,$2,'Rec action')",
    [genre, "rec-" + genre],
  );
  await f.query(
    "INSERT INTO movie.title_genres(title_id,genre_id) VALUES ($1,$3),($2,$3)",
    [seed.titleId, near.titleId, genre],
  );
  await f.query(
    "UPDATE movie.titles SET original_language=NULL,country_codes='{}',release_year=NULL,synopsis=CASE WHEN id IN($1,$2) THEN 'chien binh hanh dong tren vu tru' ELSE 'hai huoc gia dinh' END WHERE id=ANY($3::uuid[])",
    [
      seed.titleId,
      near.titleId,
      [seed.titleId, near.titleId, other.titleId, hidden.titleId],
    ],
  );
  await f.query(
    "INSERT INTO movie.watchlist(user_id,title_id) VALUES ($1,$2)",
    [me, seed.titleId],
  );
  const path = "/api/v1/me/recommendations?limit=1&surface=home";
  await expect(api("get", path), 401);
  let pref = await expect(
    api("get", "/api/v1/me/recommendation-preferences", token),
    200,
  );
  eq(pref.body.enabled, false);
  ok(pref.headers.etag);
  let first = await expect(api("get", path, token), 200);
  eq(first.body.meta.personalized, false);
  ok(first.headers["cache-control"].includes("no-store"));
  ok(!JSON.stringify(first.body).includes("providerAssetId"));
  await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token).send({
      enabled: true,
      hideCompleted: true,
    }),
    428,
    "PRECONDITION_REQUIRED",
  );
  await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", pref.headers.etag)
      .send({ enabled: true, hideCompleted: true, userId: c.rootId }),
    422,
    "VALIDATION_FAILED",
  );
  await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", pref.headers.etag)
      .send({ enabled: null, hideCompleted: true }),
    422,
    "VALIDATION_FAILED",
  );
  await expect(
    api(
      "put",
      "/api/v1/me/recommendation-feedback/" + near.titleId,
      token,
    ).send({ kind: "NOT_INTERESTED" }),
    409,
    "RESOURCE_CONFLICT",
  );
  const oldTag = pref.headers.etag;
  pref = await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", oldTag)
      .send({ enabled: true, hideCompleted: true }),
    200,
  );
  await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", oldTag)
      .send({ enabled: false, hideCompleted: true }),
    412,
    "RESOURCE_VERSION_MISMATCH",
  );
  await expect(
    api(
      "get",
      path + "&cursor=" + encodeURIComponent(first.body.page.nextCursor),
      token,
    ),
    409,
    "RECOMMENDATION_FEED_EXPIRED",
  );
  first = await expect(api("get", path, token), 200);
  eq(first.body.meta.personalized, true);
  eq(first.body.data[0].id, near.titleId);
  eq(first.body.data[0].recommendation.reason, "SIMILAR_CONTENT");
  const cursor = first.body.page.nextCursor;
  ok(cursor);
  await expect(
    api("get", path + "&cursor=" + encodeURIComponent(cursor), c.rootToken),
    400,
    "REQUEST_INVALID_CURSOR",
  );
  await expect(
    api("get", path + "&cursor=" + encodeURIComponent(cursor + "x"), token),
    400,
    "REQUEST_INVALID_CURSOR",
  );
  await expect(
    api("get", "/api/v1/me/recommendations?surface=admin", token),
    422,
    "VALIDATION_FAILED",
  );
  await expect(
    api("get", "/api/v1/me/recommendations?limit=31", token),
    422,
    "VALIDATION_FAILED",
  );
  await expect(
    api("get", "/api/v1/me/recommendations?cursor=null", token),
    400,
    "REQUEST_INVALID_CURSOR",
  );
  await expect(
    api(
      "put",
      "/api/v1/me/recommendation-feedback/" + hidden.titleId,
      token,
    ).send({ kind: "NOT_INTERESTED" }),
    404,
    "RESOURCE_NOT_FOUND",
  );
  await expect(
    api(
      "put",
      "/api/v1/me/recommendation-feedback/" + near.titleId,
      token,
    ).send({ kind: "LIKED" }),
    422,
    "VALIDATION_FAILED",
  );
  for (let i = 0; i < 2; i++)
    await expect(
      api(
        "put",
        "/api/v1/me/recommendation-feedback/" + near.titleId,
        token,
      ).send({ kind: "NOT_INTERESTED" }),
      204,
    );
  let r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  ok(
    !r.body.data.some(
      (x: any) =>
        x.id === near.titleId ||
        x.id === hidden.titleId ||
        x.id === seed.titleId,
    ),
  );

  const firstPayload = JSON.parse(
    Buffer.from(cursor.split(".")[0], "base64url").toString(),
  );
  const firstSnapshot = (
    await f.query(
      "SELECT items FROM movie.recommendation_snapshots WHERE id=$1",
      [firstPayload.id],
    )
  ).rows[0];
  const upcoming = firstSnapshot.items[1].id;
  await expect(
    api("put", "/api/v1/me/recommendation-feedback/" + upcoming, token).send({
      kind: "NOT_INTERESTED",
    }),
    204,
  );
  r = await expect(
    api("get", path + "&cursor=" + encodeURIComponent(cursor), token),
    200,
  );
  eq(r.body.data.length, 0);
  await expect(
    api("delete", "/api/v1/me/recommendation-feedback/" + upcoming, token),
    204,
  );
  // Every remaining page is unique and drawn from the original snapshot even after a metadata edit.
  const ids = new Set([first.body.data[0].id]);
  let next = cursor;
  await f.query(
    "UPDATE movie.titles SET published_at=now()+interval '1 hour' WHERE id=$1",
    [other.titleId],
  );
  while (next) {
    r = await expect(
      api("get", path + "&cursor=" + encodeURIComponent(next), token),
      200,
    );
    for (const row of r.body.data) {
      ok(!ids.has(row.id));
      ids.add(row.id);
    }
    next = r.body.page.nextCursor;
  }
  await expect(
    api(
      "delete",
      "/api/v1/me/recommendation-feedback/" + near.titleId,
      c.rootToken,
    ),
    204,
  );
  eq(
    (
      await f.query(
        "SELECT count(*)::int AS n FROM movie.recommendation_feedback WHERE user_id=$1 AND title_id=$2",
        [me, near.titleId],
      )
    ).rows[0].n,
    1,
  );
  await expect(
    api("delete", "/api/v1/me/recommendation-feedback/" + near.titleId, token),
    204,
  );
  r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  ok(r.body.data.some((x: any) => x.id === near.titleId));
  // Revalidate eligibility of future page; short pages must not refill or expose hidden title metadata.
  first = await expect(api("get", path, token), 200);
  const payload = JSON.parse(
    Buffer.from(
      first.body.page.nextCursor.split(".")[0],
      "base64url",
    ).toString(),
  );
  const snap = (
    await f.query(
      "SELECT items FROM movie.recommendation_snapshots WHERE id=$1",
      [payload.id],
    )
  ).rows[0];
  const future = snap.items[1].id;
  await f.query(
    "UPDATE movie.titles SET publication_status='UNPUBLISHED' WHERE id=$1",
    [future],
  );
  r = await expect(
    api(
      "get",
      path + "&cursor=" + encodeURIComponent(first.body.page.nextCursor),
      token,
    ),
    200,
  );
  eq(r.body.data.length, 0);
  await f.query(
    "UPDATE movie.titles SET publication_status='PUBLISHED' WHERE id=$1",
    [future],
  );
  // Expiry is DB-enforced even if the cursor's HMAC is still valid.
  await f.query(
    "UPDATE movie.recommendation_snapshots SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",
    [payload.id],
  );
  await expect(
    api(
      "get",
      path + "&cursor=" + encodeURIComponent(first.body.page.nextCursor),
      token,
    ),
    409,
    "RECOMMENDATION_FEED_EXPIRED",
  );
  for (let i = 0; i < 6; i++) await expect(api("get", path, token), 200);
  eq(
    (
      await f.query(
        "SELECT count(*)::int AS n FROM movie.recommendation_snapshots WHERE user_id=$1",
        [me],
      )
    ).rows[0].n,
    5,
  );
  await expect(
    api(
      "put",
      "/api/v1/me/recommendation-feedback/" + near.titleId,
      token,
    ).send({ kind: "NOT_INTERESTED" }),
    204,
  );
  pref = await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", pref.headers.etag)
      .send({ enabled: false, hideCompleted: true }),
    200,
  );
  eq(
    (
      await f.query(
        "SELECT count(*)::int AS n FROM movie.recommendation_feedback WHERE user_id=$1",
        [me],
      )
    ).rows[0].n,
    0,
  );
  eq(
    (
      await f.query(
        "SELECT count(*)::int AS n FROM movie.recommendation_snapshots WHERE user_id=$1",
        [me],
      )
    ).rows[0].n,
    0,
  );
  eq(
    (
      await f.query(
        "SELECT count(*)::int AS n FROM movie.watchlist WHERE user_id=$1 AND title_id=$2",
        [me, seed.titleId],
      )
    ).rows[0].n,
    1,
  );
  r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  eq(r.body.meta.personalized, false);
  eq(
    (
      await expect(
        api("get", "/api/v1/me/recommendation-preferences", c.rootToken),
        200,
      )
    ).body.enabled,
    false,
  );

  // Derive interest from accepted coverage, never from a seek or ended flag.
  await f.query(
    "DELETE FROM movie.watchlist WHERE user_id=$1 AND title_id=$2",
    [me, seed.titleId],
  );
  pref = await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", pref.headers.etag)
      .send({ enabled: true, hideCompleted: true }),
    200,
  );
  const play = (
    await expect(
      api(
        "post",
        "/api/v1/episodes/" + seed.episodeId + "/playback-sessions",
        token,
      )
        .set("Idempotency-Key", randomUUID())
        .send({}),
      201,
    )
  ).body;
  const progressPath = "/api/v1/me/watch-progress/" + seed.episodeId;
  await expect(
    api("put", progressPath, token).send({
      sessionId: play.id,
      sequence: 1,
      positionSeconds: 99,
      ended: true,
    }),
    201,
  );
  r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  eq(r.body.meta.personalized, false);
  await f.query(
    "UPDATE movie.playback_sessions SET created_at=now()-interval '120 seconds' WHERE id=$1",
    [play.id],
  );
  await f.query(
    "UPDATE movie.watch_progress SET updated_at=now()-interval '120 seconds' WHERE user_id=$1 AND episode_id=$2",
    [me, seed.episodeId],
  );
  r = await expect(
    api("put", progressPath, token).send({
      sessionId: play.id,
      sequence: 2,
      positionSeconds: 20,
      intervalStartSeconds: 0,
    }),
    200,
  );
  eq(r.body.watchedSeconds, 20);
  r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  eq(r.body.meta.personalized, true);
  eq(r.body.data[0].id, near.titleId);
  await f.query(
    "UPDATE movie.watch_progress SET updated_at=now()-interval '120 seconds' WHERE user_id=$1 AND episode_id=$2",
    [me, seed.episodeId],
  );
  r = await expect(
    api("put", progressPath, token).send({
      sessionId: play.id,
      sequence: 3,
      positionSeconds: 100,
      intervalStartSeconds: 20,
      ended: true,
    }),
    200,
  );
  eq(r.body.completedAt, null);
  await expect(
    api("post", "/api/v1/playback-sessions/" + play.id + "/events")
      .set("X-Playback-Telemetry", play.telemetryToken)
      .send({
        batchId: randomUUID(),
        events: [
          {
            id: randomUUID(),
            type: "ended",
            sequence: 99,
            elapsedMs: 100000,
            positionSeconds: 100,
          },
        ],
      }),
    202,
  );
  r = await expect(
    api("put", progressPath, token).send({
      sessionId: play.id,
      sequence: 4,
      positionSeconds: 100,
      ended: true,
    }),
    200,
  );
  ok(r.body.completedAt);
  r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  eq(r.body.meta.personalized, true);
  ok(!r.body.data.some((x: any) => x.id === seed.titleId));
  pref = await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", pref.headers.etag)
      .send({ enabled: true, hideCompleted: false }),
    200,
  );
  r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  ok(r.body.data.some((x: any) => x.id === seed.titleId));
  // Progress belonging to a title without a current playable asset cannot build the profile.
  await f.query(
    "UPDATE movie.episodes SET active_asset_id=NULL,publication_status='UNPUBLISHED' WHERE id=$1",
    [seed.episodeId],
  );
  r = await expect(
    api("get", "/api/v1/me/recommendations?limit=30", token),
    200,
  );
  eq(r.body.meta.personalized, false);
  await f.query(
    "UPDATE movie.episodes SET active_asset_id=$2,publication_status='PUBLISHED' WHERE id=$1",
    [seed.episodeId, seed.assetId],
  );
  await expect(
    api("delete", "/api/v1/playback-sessions/" + play.id, token),
    204,
  );
  pref = await expect(
    api("patch", "/api/v1/me/recommendation-preferences", token)
      .set("If-Match", pref.headers.etag)
      .send({ enabled: false, hideCompleted: true }),
    200,
  );

  const concurrent = await Promise.all(
    [true, false].map((hideCompleted) =>
      api("patch", "/api/v1/me/recommendation-preferences", token)
        .set("If-Match", pref.headers.etag)
        .send({ enabled: false, hideCompleted }),
    ),
  );
  eq(concurrent.map((r) => r.status).sort(), [200, 412]);
  // Exercise the same bounded automatic expiry cleanup used by the API timer.
  await f.query(
    "INSERT INTO movie.recommendation_snapshots(user_id,preference_version,model_version,surface,personalized,candidate_truncated,items,created_at,expires_at) VALUES ($1,1,$2,'home',false,false,'[]',now()-interval '11 minutes',now()-interval '1 minute')",
    [me, MODEL_VERSION],
  );
  await (
    c.app.get(RecommendationsService) as RecommendationsService
  ).pruneExpired();
  eq(
    (
      await f.query(
        "SELECT count(*)::int AS n FROM movie.recommendation_snapshots WHERE expires_at<=now()",
      )
    ).rows[0].n,
    0,
  );
  const spec = (await expect(api("get", "/api/openapi.json"), 200)).body;
  ok(spec.components.schemas.RecommendationFeed);
  ok(spec.components.schemas.RecommendationPreferences);
  eq(spec.paths["/api/v1/me/recommendations"].get.security, [{ bearer: [] }]);
  // Narrow grants: the media worker and auditor cannot read private recommendation state.
  for (const role of ["movie_worker", "movie_auditor"])
    for (const table of [
      "recommendation_preferences",
      "recommendation_feedback",
      "recommendation_snapshots",
    ]) {
      eq(
        (
          await f.query("SELECT has_table_privilege($1,$2,'SELECT') AS ok", [
            role,
            "movie." + table,
          ])
        ).rows[0].ok,
        false,
      );
    }
  await f.query(
    "DELETE FROM movie.watchlist WHERE user_id=$1 AND title_id=$2",
    [me, seed.titleId],
  );
  console.log(
    JSON.stringify({ event: "recommendations.integration.passed", checks }),
  );
  return checks;
}
