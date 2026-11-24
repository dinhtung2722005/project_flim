import type { OpenAPIObject } from "@nestjs/swagger";
export function configureCatalogBatchesOpenApi(doc: OpenAPIObject) {
  const s = doc.components!.schemas!,
    str = { type: "string" as const },
    id = { ...str, format: "uuid" },
    date = { ...str, format: "date-time" },
    count = { ...str, pattern: "^[0-9]+$" },
    counts = {
      type: "object" as const,
      required: ["ready", "blocked", "unchanged", "applied", "failed"],
      properties: Object.fromEntries(
        ["ready", "blocked", "unchanged", "applied", "failed"].map((k) => [
          k,
          { type: "integer", minimum: 0 },
        ]),
      ),
    };
  s.CatalogBatchItem = {
    type: "object",
    required: ["titleId", "title", "expectedVersion", "state"],
    properties: {
      titleId: id,
      title: { ...str, nullable: true },
      expectedVersion: { ...count, nullable: true },
      state: {
        ...str,
        enum: ["READY", "BLOCKED", "UNCHANGED", "APPLIED", "FAILED"],
      },
      beforeStatus: str,
      targetStatus: str,
      beforeGenreIds: { type: "array", items: id },
      targetGenreIds: { type: "array", items: id },
      code: str,
      resultVersion: count,
    },
  };
  const fields = {
    id,
    action: {
      ...str,
      enum: ["PUBLISH", "UNPUBLISH", "ADD_GENRES", "REPLACE_GENRES"],
    },
    reason: { ...str, minLength: 3, maxLength: 500 },
    genreIds: { type: "array" as const, items: id },
    state: { ...str, enum: ["PREVIEW", "RUNNING", "COMPLETED"] },
    items: {
      type: "array" as const,
      minItems: 1,
      maxItems: 20,
      items: { $ref: "#/components/schemas/CatalogBatchItem" },
    },
    counts,
    version: count,
    createdAt: date,
    updatedAt: date,
    expiresAt: date,
    expired: { type: "boolean" as const },
    sameSession: { type: "boolean" as const },
    startedAt: { ...date, nullable: true },
    finishedAt: { ...date, nullable: true },
  };
  s.CatalogBatch = {
    type: "object",
    required: Object.keys(fields),
    properties: fields,
  };
  const headers = {
    ETag: {
      schema: str,
      description:
        "Retain this opaque ETag for If-Match. The original preview ETag can replay or resume the immutable execution.",
    },
  };
  const base = "/api/v1/admin/catalog-batches";
  for (const [path, method, status] of [
    [base + "/previews", "post", "201"],
    [base + "/{id}", "get", "200"],
    [base + "/{id}/execution", "post", "200"],
  ] as const) {
    const op = doc.paths[path]![method]!;
    op.responses[status] = {
      description:
        status === "201"
          ? "Immutable preview; no film changes. Expires in five minutes."
          : "Private current batch result.",
      headers:
        status === "201" ? { ...headers, Location: { schema: str } } : headers,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/CatalogBatch" },
        },
      },
    };
    if (method === "post")
      op.description =
        (op.description ?? "") +
        " Requires catalog.read_drafts and a current action permission: catalog.publish for PUBLISH/UNPUBLISH, catalog.write for genre actions. Same user and login session. Execution expires after 15 minutes; each item commits with audit and receipt. Partial conflicts are returned in items; fatal errors leave a resumable RUNNING job.";
    if (path.endsWith("/execution"))
      op.parameters = [
        ...(op.parameters ?? []).filter(
          (p) =>
            !(
              "name" in p &&
              p.in === "header" &&
              p.name.toLowerCase() === "if-match"
            ),
        ),
        {
          in: "header",
          name: "If-Match",
          required: true,
          schema: str,
          description: "Preview ETag, or a current execution receipt ETag.",
        },
      ];
  }
  const summary = {
    type: "object" as const,
    required: [
      "id",
      "action",
      "state",
      "createdAt",
      "finishedAt",
      "expiresAt",
      "expired",
      "counts",
    ],
    properties: {
      id,
      action: fields.action,
      state: fields.state,
      createdAt: date,
      finishedAt: { ...date, nullable: true },
      expiresAt: date,
      expired: fields.expired,
      counts,
    },
  };
  doc.paths[base]!.get!.responses["200"] = {
    description:
      "Only the current user's batches; cursor is bound to user and state.",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data", "page"],
          properties: {
            data: { type: "array", items: summary },
            page: {
              type: "object",
              required: ["hasMore", "nextCursor", "limit"],
              properties: {
                hasMore: { type: "boolean" },
                nextCursor: { ...str, nullable: true },
                limit: { type: "integer", minimum: 1, maximum: 100 },
              },
            },
          },
        },
      },
    },
  };
}
