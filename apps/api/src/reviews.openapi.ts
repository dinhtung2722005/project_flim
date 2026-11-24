import type { OpenAPIObject } from "@nestjs/swagger";
export function configureReviewsOpenApi(doc: OpenAPIObject) {
  const schemas = doc.components!.schemas!,
    str = { type: "string" } as const;
  const time = { ...str, format: "date-time", nullable: true },
    id = { ...str, format: "uuid" };
  const obj = (
    properties: Record<string, any>,
    required: string[] = Object.keys(properties),
  ) => ({ type: "object" as const, properties, required });
  const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
  const status = {
    ...str,
    enum: [
      "DISABLED",
      "NOT_CONFIGURED",
      "UNMAPPED",
      "NOT_FETCHED",
      "STALE",
      "READY",
    ],
  };
  schemas.ExternalReview = obj({
    id,
    author: str,
    content: {
      ...str,
      maxLength: 12000,
      description:
        "Plain text, limited excerpt; original source link is provided.",
    },
    rating: { type: "number", minimum: 0, maximum: 10, nullable: true },
    language: { ...str, enum: ["vi-VN", "en-US"] },
    sourceUrl: { ...str, format: "uri" },
    sourceCreatedAt: time,
    sourceUpdatedAt: time,
    fetchedAt: time,
  });
  schemas.ReviewSource = obj({
    titleId: id,
    provider: { ...str, enum: ["TMDB"] },
    configured: { type: "boolean" },
    enabled: { type: "boolean" },
    externalId: { type: "integer", nullable: true },
    externalKind: { ...str, enum: ["movie", "tv"], nullable: true },
    sourceUrl: { ...str, nullable: true },
    verifiedAt: time,
    version: str,
    cacheVersion: { ...str, nullable: true },
    etagVersion: str,
    refreshedAt: time,
    expiresAt: time,
    lastError: { ...str, nullable: true },
    refreshing: { type: "boolean" },
    status,
  });
  schemas.ReviewPage = obj({
    data: { type: "array", items: ref("ExternalReview") },
    page: obj({
      limit: { type: "integer" },
      hasMore: { type: "boolean" },
      nextCursor: { ...str, nullable: true },
    }),
    meta: obj({
      provider: { ...str, enum: ["TMDB"] },
      status,
      refreshedAt: time,
      expiresAt: time,
      attribution: str,
      sourceUrl: { ...str, nullable: true },
      scope: { ...str, enum: ["TMDB_USER_REVIEWS"] },
      ratingScale: { type: "integer", enum: [10] },
    }),
  });
  schemas.ReviewCandidates = obj({
    data: {
      type: "array",
      maxItems: 10,
      items: obj({
        externalId: { type: "integer" },
        name: str,
        originalName: str,
        releaseDate: str,
        kind: { ...str, enum: ["movie", "tv"] },
        sourceUrl: { ...str, format: "uri" },
        verified: { type: "boolean", enum: [false] },
      }),
    },
  });
  schemas.ReviewSync = {
    allOf: [
      ref("ReviewPage"),
      obj({
        sync: obj({
          count: { type: "integer", minimum: 0, maximum: 20 },
          language: { ...str, enum: ["vi-VN", "en-US"] },
          truncated: { type: "boolean" },
        }),
      }),
    ],
  };
  for (const [path, method, schema] of [
    ["/titles/{id}/reviews", "get", "ReviewPage"],
    ["/admin/titles/{id}/reviews", "get", "ReviewPage"],
    ["/admin/titles/{id}/review-source", "get", "ReviewSource"],
    ["/admin/titles/{id}/review-source", "put", "ReviewSource"],
    ["/admin/titles/{id}/review-candidates", "get", "ReviewCandidates"],
    ["/admin/titles/{id}/review-sync", "post", "ReviewSync"],
  ]) {
    const op: any = (doc.paths["/api/v1" + path] as any)?.[method];
    if (!op) throw Error("Missing review OpenAPI operation.");
    op.responses["200"] = {
      description:
        "Review source/cache response; see status and source attribution.",
      content: { "application/json": { schema: ref(schema) } },
    };
    if (path.endsWith("/review-source"))
      op.responses["200"].headers = {
        ETag: {
          schema: str,
          description:
            "Opaque mapping version; use the entire quoted value in If-Match.",
        },
      };
  }
}
