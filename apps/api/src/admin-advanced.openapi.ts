import type { OpenAPIObject } from "@nestjs/swagger";
import { CATALOG_ISSUES } from "../../../packages/contracts/src/admin";
export function configureAdminAdvancedOpenApi(doc: OpenAPIObject) {
  const schemas = doc.components!.schemas!,
    str = { type: "string" as const },
    id = { ...str, format: "uuid" },
    date = { ...str, format: "date-time" },
    count = { ...str, pattern: "^[0-9]+$" };
  const status = { ...str, enum: ["VISIBLE", "HIDDEN"] },
    moderation = {
      moderationStatus: status,
      moderationReason: { ...str, nullable: true, maxLength: 500 },
      moderatedAt: { ...date, nullable: true },
    };
  const own = schemas.ViewerReviewOwn as any;
  Object.assign(own.properties, moderation);
  own.required.push(...Object.keys(moderation));
  const fields = {
    id,
    titleId: id,
    title: str,
    rating: { type: "integer" as const, minimum: 1, maximum: 10 },
    content: { ...str, maxLength: 2000 },
    containsSpoilers: { type: "boolean" as const },
    ...moderation,
    version: count,
    createdAt: date,
    updatedAt: date,
    author: str,
    authorStatus: str,
  };
  schemas.AdminViewerReview = {
    type: "object",
    required: Object.keys(fields),
    properties: fields,
  };
  const page = {
    type: "object" as const,
    required: ["hasMore", "nextCursor", "limit"],
    properties: {
      hasMore: { type: "boolean" as const },
      nextCursor: { ...str, nullable: true },
      limit: { type: "integer" as const, maximum: 100 },
    },
  };
  const response = (
    path: string,
    method: "get" | "patch",
    schema: any,
    headers?: any,
  ) => {
    doc.paths[path]![method]!.responses["200"] = {
      description: "Current authorized result; private, no-store.",
      headers,
      content: { "application/json": { schema } },
    };
  };
  const etag = {
    ETag: {
      schema: str,
      description:
        "Send unchanged in If-Match to moderate this exact review version.",
    },
  };
  response("/api/v1/admin/viewer-reviews", "get", {
    type: "object",
    required: ["data", "page"],
    properties: {
      data: {
        type: "array",
        items: { $ref: "#/components/schemas/AdminViewerReview" },
      },
      page,
    },
  });
  response(
    "/api/v1/admin/viewer-reviews/{id}",
    "get",
    { $ref: "#/components/schemas/AdminViewerReview" },
    etag,
  );
  response(
    "/api/v1/admin/viewer-reviews/{id}/moderation",
    "patch",
    { $ref: "#/components/schemas/AdminViewerReview" },
    etag,
  );
  response("/api/v1/admin/catalog-health", "get", {
    type: "object",
    required: ["data", "page", "summary", "checkedAt"],
    properties: {
      data: {
        type: "array",
        items: {
          type: "object",
          required: [
            "id",
            "localizedTitle",
            "publicationStatus",
            "videoReady",
            "issues",
            "createdAt",
          ],
          properties: {
            id,
            localizedTitle: str,
            publicationStatus: str,
            videoReady: { type: "boolean" },
            issues: {
              type: "array",
              items: { type: "string", enum: [...CATALOG_ISSUES] },
            },
            createdAt: date,
          },
        },
      },
      page,
      summary: {
        type: "object",
        required: ["titles", "needsAttention", "withoutPlayableVideo"],
        properties: {
          titles: count,
          needsAttention: count,
          withoutPlayableVideo: count,
        },
      },
      checkedAt: date,
    },
  });
  doc.paths["/api/v1/admin/metrics/views/export"]!.get!.responses["200"] = {
    description:
      "UTF-8 BOM CSV of daily metrics and current public top10. Counts remain decimal strings; formula characters escaped. Audited before sending.",
    headers: {
      "Content-Disposition": { schema: str },
      "Cache-Control": { schema: str },
    },
    content: { "text/csv": { schema: { type: "string" } } },
  };
}
