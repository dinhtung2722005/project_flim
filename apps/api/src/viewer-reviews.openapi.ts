import type { OpenAPIObject } from "@nestjs/swagger";
export function configureViewerReviewsOpenApi(doc: OpenAPIObject) {
  const schemas = doc.components!.schemas!;
  const string = { type: "string" } as const,
    id = { ...string, format: "uuid" },
    date = { ...string, format: "date-time" };
  const row = {
    type: "object" as const,
    required: [
      "id",
      "rating",
      "content",
      "containsSpoilers",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id,
      rating: { type: "integer" as const, minimum: 1, maximum: 10 },
      content: { ...string, maxLength: 2000 },
      containsSpoilers: { type: "boolean" as const },
      createdAt: date,
      updatedAt: date,
    },
  };
  schemas.ViewerReviewPublic = {
    ...row,
    properties: { ...row.properties, author: string },
    required: [...row.required, "author"],
  };
  schemas.ViewerReviewOwn = {
    ...row,
    properties: { ...row.properties, titleId: id, version: string },
    required: [...row.required, "titleId", "version"],
  };
  const page = {
    type: "object" as const,
    required: ["limit", "hasMore", "nextCursor"],
    properties: {
      limit: { type: "integer" as const },
      hasMore: { type: "boolean" as const },
      nextCursor: { ...string, nullable: true },
    },
  };
  const list = doc.paths["/api/v1/titles/{id}/viewer-reviews"]!.get!;
  list.responses["200"] = {
    description:
      "Reviews by active pj-Flim accounts, latest-created first; no email/userId/session data. Average is null when count is zero.",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data", "page", "summary"],
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/ViewerReviewPublic" },
            },
            page,
            summary: {
              type: "object",
              required: ["count", "average", "scale", "source"],
              properties: {
                count: { type: "integer", minimum: 0 },
                average: {
                  type: "number",
                  nullable: true,
                  minimum: 1,
                  maximum: 10,
                },
                scale: { type: "integer", enum: [10] },
                source: { type: "string", enum: ["PJ_FLIM_VIEWERS"] },
              },
            },
          },
        },
      },
    },
  };
  for (const method of ["get", "put"] as const) {
    doc.paths["/api/v1/me/title-reviews/{id}"]![method]!.responses["200"] = {
      description:
        "Your review; ETag fences create, update, delete and delete/recreate. Active owner/session only.",
      headers: {
        ETag: {
          description: "Send as If-Match on PUT/DELETE.",
          schema: string,
        },
      },
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["review"],
            properties: {
              review: {
                allOf: [{ $ref: "#/components/schemas/ViewerReviewOwn" }],
                nullable: method === "get",
              },
            },
          },
        },
      },
    };
  }
}
