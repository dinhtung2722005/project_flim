import type { OpenAPIObject } from "@nestjs/swagger";
export function configureViewStatsOpenApi(doc: OpenAPIObject) {
  const count = {
      type: "string" as const,
      pattern: "^[0-9]+$",
      example: "1234",
      description: "Decimal bigint string; never a JSON number.",
    },
    date = { type: "string" as const, format: "date-time", nullable: true };
  const policy = {
    definitionVersion: { type: "integer" as const, enum: [2] },
    measurementStartedAt: date,
    aggregation: { type: "string" as const, enum: ["ASYNCHRONOUS"] },
    workerInitialized: { type: "boolean" as const },
    thresholdSeconds: { type: "integer" as const, enum: [120] },
    shortVideoFraction: { type: "number" as const, enum: [0.5] },
    dedup: { type: "string" as const, enum: ["VIEWER_TITLE_UTC_DAY"] },
    timezone: { type: "string" as const, enum: ["UTC"] },
  };
  const properties = { views: count, updatedAt: date, ...policy };
  doc.components!.schemas!.TitleViewStats = {
    type: "object",
    required: Object.keys(properties),
    properties,
  };
  const daily = {
    type: "object" as const,
    required: ["day", "views", "playbackStarts"],
    properties: {
      day: { type: "string" as const, format: "date" },
      views: count,
      playbackStarts: count,
    },
  };
  const admin = {
    ...policy,
    days: { type: "integer" as const, enum: [7, 30, 90] },
    total: {
      type: "object" as const,
      required: ["views", "playbackStarts"],
      properties: { views: count, playbackStarts: count },
    },
    daily: { type: "array" as const, items: daily },
    top: {
      type: "array" as const,
      maxItems: 10,
      items: {
        type: "object" as const,
        required: ["id", "name", "views", "playbackStarts"],
        properties: {
          id: { type: "string" as const, format: "uuid" },
          name: { type: "string" as const },
          views: count,
          playbackStarts: count,
        },
      },
    },
    processing: {
      type: "object" as const,
      required: ["pendingBatches", "lastProcessedAt"],
      properties: { pendingBatches: count, lastProcessedAt: date },
    },
  };
  doc.components!.schemas!.AdminViewMetrics = {
    type: "object",
    required: Object.keys(admin),
    properties: admin,
  };
  for (const [path, schema] of [
    ["/api/v1/titles/{id}/views", "TitleViewStats"],
    ["/api/v1/admin/metrics/views", "AdminViewMetrics"],
  ]) {
    doc.paths[path]!.get!.responses["200"] = {
      description:
        "Qualified view counts measured since policy start; eventual aggregation, no historical backfill. Public counts exclude draft/unplayable titles.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/" + schema },
        },
      },
    };
  }
}
