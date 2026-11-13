import type { OpenAPIObject } from "@nestjs/swagger";
export function configureViewerOpenApi(doc: OpenAPIObject) {
  const schemas = doc.components!.schemas!;
  const str = { type: "string" } as const,
    num = { type: "number" } as const,
    int = { type: "integer" } as const,
    bool = { type: "boolean" } as const;
  const id = { type: "string", format: "uuid" } as const,
    time = { type: "string", format: "date-time" } as const,
    nullableTime = { ...time, nullable: true };
  const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
  const object = (
    properties: Record<string, any>,
    required: string[] = [],
  ) => ({ type: "object" as const, properties, required });
  schemas.PublicTitle = object(
    {
      id,
      kind: { ...str, enum: ["MOVIE", "SERIES"] },
      slug: str,
      localizedTitle: str,
      originalTitle: { ...str, nullable: true },
      synopsis: str,
      releaseYear: { ...int, nullable: true },
      countryCodes: { type: "array", items: str },
      originalLanguage: { ...str, nullable: true },
      ageRating: { ...str, nullable: true },
      posterAssetRef: { ...str, nullable: true },
      backdropAssetRef: { ...str, nullable: true },
      trailerAssetRef: { ...str, nullable: true },
      publishedAt: time,
    },
    ["id", "kind", "slug", "localizedTitle"],
  );
  schemas.PublicGenre = object({ id, slug: str, name: str }, [
    "id",
    "slug",
    "name",
  ]);
  schemas.PublicCredit = object({
    id,
    personId: id,
    name: str,
    role: str,
    characterName: str,
    sortOrder: int,
    photoAssetRef: { ...str, nullable: true },
  });
  schemas.PublicTitleDetail = {
    allOf: [
      ref("PublicTitle"),
      object({
        genres: { type: "array", items: ref("PublicGenre") },
        credits: { type: "array", items: ref("PublicCredit") },
      }),
    ],
  };
  schemas.PublicSeason = object(
    { id, titleId: id, number: int, name: { ...str, nullable: true } },
    ["id", "titleId", "number"],
  );
  schemas.PublicEpisode = object(
    {
      id,
      titleId: id,
      seasonId: id,
      number: int,
      name: str,
      synopsis: str,
      durationSeconds: num,
      introStartSeconds: { ...num, nullable: true },
      introEndSeconds: { ...num, nullable: true },
      creditsStartSeconds: { ...num, nullable: true },
    },
    ["id", "titleId", "name", "durationSeconds"],
  );
  schemas.PublicUser = object(
    {
      id,
      emailNormalized: { ...str, format: "email" },
      displayName: str,
      status: { ...str, enum: ["ACTIVE", "SUSPENDED", "DELETED"] },
      emailVerifiedAt: nullableTime,
      createdAt: time,
    },
    ["id", "emailNormalized", "displayName", "status"],
  );
  schemas.PlaybackSession = object(
    {
      id,
      episodeId: id,
      assetId: id,
      assetVersion: int,
      mode: { ...str, enum: ["PUBLIC"] },
      expiresAt: time,
      maxExpiresAt: time,
      deliveryGeneration: str,
      resumeGeneration: { ...str, nullable: true },
      durationSeconds: num,
      managementToken: {
        ...str,
        description:
          "Returned only for guests. Send via X-Playback-Management; never via query string.",
      },
      telemetryToken: {
        ...str,
        description: "Send only via X-Playback-Telemetry.",
      },
      delivery: object(
        {
          url: { ...str, format: "uri" },
          format: { ...str, enum: ["HLS"] },
          authorization: { ...str, enum: ["SIGNED_URL"] },
          expiresAt: {
            ...str,
            nullable: true,
            description:
              "Always null for current static signed delivery. API session expiry does not expire the CDN URL.",
          },
          revocation: { ...str, enum: ["SESSION_ONLY"] },
        },
        ["url", "format", "authorization", "expiresAt", "revocation"],
      ),
      capabilities: object({ adaptiveBitrate: bool, seek: bool }),
    },
    ["id", "episodeId", "assetId", "expiresAt", "telemetryToken", "delivery"],
  );
  schemas.WatchProgress = object(
    {
      episodeId: id,
      sessionId: id,
      assetId: id,
      assetVersion: int,
      resumeGeneration: str,
      lastSequence: str,
      positionSeconds: num,
      watchedSeconds: num,
      completedAt: nullableTime,
      updatedAt: time,
      resumeEligible: bool,
    },
    [
      "episodeId",
      "sessionId",
      "positionSeconds",
      "watchedSeconds",
      "completedAt",
    ],
  );
  schemas.HistoryEntry = {
    allOf: [
      ref("WatchProgress"),
      object({
        id,
        titleId: id,
        number: int,
        name: str,
        slug: str,
        localizedTitle: str,
        posterAssetRef: { ...str, nullable: true },
        resumeEligible: bool,
      }),
    ],
  };
  schemas.WatchlistEntry = {
    allOf: [ref("PublicTitle"), object({ savedAt: time })],
  };
  schemas.ContentReport = object(
    {
      id,
      titleId: id,
      episodeId: { ...id, nullable: true },
      category: { ...str, enum: ["PLAYBACK", "SUBTITLE", "METADATA", "OTHER"] },
      message: str,
      status: { ...str, enum: ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] },
      createdAt: time,
      updatedAt: time,
    },
    ["id", "titleId", "category", "message", "status"],
  );
  schemas.EventsReceipt = object(
    { id, batchId: id, accepted: bool, duplicate: bool },
    ["id", "batchId", "accepted", "duplicate"],
  );
  schemas.Pagination = object(
    { limit: int, hasMore: bool, nextCursor: { ...str, nullable: true } },
    ["limit", "hasMore", "nextCursor"],
  );
  const page = (item: string) =>
    object(
      { data: { type: "array", items: ref(item) }, page: ref("Pagination") },
      ["data", "page"],
    );
  const response = (
    route: string,
    method: string,
    status: number,
    schema: any,
    description = "Success",
  ) => {
    const op = (doc.paths["/api/v1" + route] as any)?.[method];
    if (!op) throw new Error("Missing viewer OpenAPI operation.");
    op.responses[String(status)] = {
      description,
      content: { "application/json": { schema } },
    };
    if (status === 201)
      op.responses["201"].headers = {
        Location: { description: "Created resource URL.", schema: str },
      };
  };
  response("/users", "post", 201, ref("PublicUser"));
  response("/users/{id}", "get", 200, ref("PublicUser"));
  response(
    "/auth/password-reset-requests",
    "post",
    202,
    object({ message: str }, ["message"]),
  );
  response(
    "/auth/email-verification-requests",
    "post",
    202,
    object({ message: str }, ["message"]),
  );
  response(
    "/auth/password-resets",
    "post",
    200,
    object({ reset: bool }, ["reset"]),
  );
  response(
    "/auth/email-verifications",
    "post",
    200,
    object({ verified: bool }, ["verified"]),
  );
  response("/titles", "get", 200, page("PublicTitle"));
  response("/titles/{id}", "get", 200, ref("PublicTitleDetail"));
  response("/genres", "get", 200, page("PublicGenre"));
  response("/titles/{id}/seasons", "get", 200, page("PublicSeason"));
  response("/seasons/{id}/episodes", "get", 200, page("PublicEpisode"));
  response("/episodes/{id}", "get", 200, ref("PublicEpisode"));
  response("/titles/{id}/recommendations", "get", 200, page("PublicTitle"));
  response(
    "/episodes/{id}/playback-sessions",
    "post",
    201,
    ref("PlaybackSession"),
  );
  (doc.paths["/api/v1/episodes/{id}/playback-sessions"]!.post as any).security =
    [{ bearer: [] }, {}];
  response("/playback-sessions/{id}", "get", 200, ref("PlaybackSession"));
  response(
    "/playback-sessions/{id}/renewals",
    "post",
    200,
    ref("PlaybackSession"),
  );
  response("/playback-sessions/{id}/events", "post", 202, ref("EventsReceipt"));
  response("/me/watchlist", "get", 200, page("WatchlistEntry"));
  response(
    "/me/watchlist/{id}",
    "put",
    201,
    object({ titleId: id }, ["titleId"]),
  );
  response("/me/history", "get", 200, page("HistoryEntry"));
  response("/me/continue-watching", "get", 200, page("HistoryEntry"));
  response("/me/watch-progress/{id}", "get", 200, ref("WatchProgress"));
  response("/me/watch-progress/{id}", "put", 200, ref("WatchProgress"));
  response("/me/watch-progress/{id}", "put", 201, ref("WatchProgress"));
  response("/reports", "post", 201, ref("ContentReport"));
  response("/reports/{id}", "get", 200, ref("ContentReport"));

  schemas.RecommendationPreferences = object(
    { enabled: bool, hideCompleted: bool, version: str, updatedAt: time },
    ["enabled", "hideCompleted", "version", "updatedAt"],
  );
  schemas.RecommendedTitle = {
    allOf: [
      ref("PublicTitle"),
      object(
        {
          recommendation: object(
            {
              reason: {
                ...str,
                enum: ["SIMILAR_CONTENT", "RECENTLY_PUBLISHED"],
              },
              text: str,
            },
            ["reason", "text"],
          ),
        },
        ["recommendation"],
      ),
    ],
  };
  schemas.RecommendationFeed = object(
    {
      data: { type: "array", items: ref("RecommendedTitle") },
      page: ref("Pagination"),
      meta: object(
        {
          modelVersion: str,
          personalized: bool,
          enabled: bool,
          candidateTruncated: bool,
          expiresAt: time,
        },
        [
          "modelVersion",
          "personalized",
          "enabled",
          "candidateTruncated",
          "expiresAt",
        ],
      ),
    },
    ["data", "page", "meta"],
  );
  response("/me/recommendations", "get", 200, ref("RecommendationFeed"));
  for (const method of ["get", "patch"]) {
    response(
      "/me/recommendation-preferences",
      method,
      200,
      ref("RecommendationPreferences"),
    );
    (doc.paths["/api/v1/me/recommendation-preferences"] as any)[
      method
    ].responses["200"].headers = {
      ETag: {
        description: "Current preference version for If-Match.",
        schema: str,
      },
      "Cache-Control": { schema: str, description: "private, no-store" },
    };
  }
  for (const method of ["put", "delete"]) {
    (doc.paths["/api/v1/me/recommendation-feedback/{titleId}"] as any)[
      method
    ].responses["204"] = {
      description: "Feedback saved/removed; no response body.",
    };
  }
}
