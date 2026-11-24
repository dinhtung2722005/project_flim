import type { OpenAPIObject } from "@nestjs/swagger";
export function configureAssistantOpenApi(doc: OpenAPIObject) {
  const schemas = doc.components!.schemas!,
    str = { type: "string" } as const,
    id = { ...str, format: "uuid" },
    time = { ...str, format: "date-time" };
  const obj = (properties: Record<string, any>, required: string[] = []) => ({
    type: "object" as const,
    properties,
    required,
  });
  const array = (items: any) => ({ type: "array" as const, items });
  const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
  schemas.AssistantSource = obj(
    {
      id: str,
      kind: { ...str, enum: ["TITLE", "HELP", "EPISODE", "FEEDBACK"] },
      entityId: str,
      label: str,
      url: {
        ...str,
        description:
          "Relative allowlisted internal path; never a signed media URL.",
      },
      retrievedAt: time,
    },
    ["id", "kind", "entityId", "label", "url", "retrievedAt"],
  );
  schemas.AssistantCard = obj(
    {
      id,
      name: str,
      originalTitle: { ...str, nullable: true },
      kind: { ...str, enum: ["MOVIE", "SERIES"] },
      year: { type: "integer", nullable: true },
      genres: array(obj({ slug: str, name: str }, ["slug", "name"])),
      credits: array(obj({ name: str, role: str }, ["name", "role"])),
      countries: array(str),
      language: { ...str, nullable: true },
      version: str,
      synopsis: str,
      url: str,
    },
    ["id", "name", "kind", "year", "url"],
  );
  schemas.AssistantEpisode = obj(
    {
      id,
      titleId: id,
      seasonNumber: { type: "integer" },
      number: { type: "integer" },
      name: str,
      version: str,
      durationSeconds: { type: "number" },
      url: str,
    },
    ["id", "titleId", "seasonNumber", "number", "name", "url"],
  );
  schemas.AssistantMovieRatings = (
    doc.paths["/api/v1/titles/{id}/ratings"]!.get!.responses["200"] as any
  ).content["application/json"].schema;
  schemas.AssistantFeedback = obj(
    {
      titleId: id,
      titleName: str,
      ratings: ref("AssistantMovieRatings"),
      reviews: obj(
        {
          provider: { ...str, enum: ["TMDB"] },
          status: str,
          refreshedAt: { ...time, nullable: true },
          expiresAt: { ...time, nullable: true },
          sourceUrl: { ...str, nullable: true },
          attribution: str,
          scope: { ...str, enum: ["TMDB_USER_REVIEWS"] },
          ratingScale: { type: "integer", enum: [10] },
          hasMore: { type: "boolean" },
          textHidden: { type: "boolean" },
          items: array(
            obj(
              {
                id,
                author: str,
                rating: {
                  type: "number",
                  nullable: true,
                  minimum: 0,
                  maximum: 10,
                },
                language: str,
                sourceUrl: str,
                fetchedAt: time,
                excerpt: {
                  ...str,
                  maxLength: 600,
                  description:
                    "Only when avoidSpoilers=false; plain text, never an AI summary.",
                },
                truncated: { type: "boolean" },
              },
              ["id", "author", "rating", "sourceUrl", "fetchedAt"],
            ),
          ),
        },
        ["provider", "status", "items", "textHidden", "hasMore", "attribution"],
      ),
    },
    ["titleId", "titleName", "ratings", "reviews"],
  );
  schemas.AssistantResult = obj(
    {
      kind: { ...str, enum: ["FOUND", "EMPTY", "HELP", "NEEDS_INPUT"] },
      answer: str,
      cards: array(ref("AssistantCard")),
      feedback: array(ref("AssistantFeedback")),
      episodes: array(ref("AssistantEpisode")),
      sources: array(ref("AssistantSource")),
      warnings: array(str),
    },
    ["kind", "answer", "cards", "episodes", "sources", "warnings"],
  );
  schemas.AssistantRun = obj(
    {
      id,
      status: {
        ...str,
        enum: [
          "QUEUED",
          "RUNNING",
          "SUCCEEDED",
          "FAILED",
          "CANCELLED",
          "TIMED_OUT",
        ],
      },
      message: str,
      contextTitleId: { ...id, nullable: true },
      parentRunId: { ...id, nullable: true },
      createdAt: time,
      expiresAt: time,
      errorCode: { ...str, nullable: true },
      result: { ...ref("AssistantResult"), nullable: true },
      engine: { ...str, enum: ["CATALOG", "OLLAMA"], nullable: true },
    },
    ["id", "status", "message", "createdAt", "expiresAt"],
  );
  schemas.AssistantCapabilities = obj(
    {
      enabled: { type: "boolean" },
      engine: { ...str, enum: ["CATALOG", "OLLAMA"] },
      scope: { ...str, enum: ["PUBLIC_CATALOG_HELP_AND_FEEDBACK"] },
      retentionDays: { type: "integer", enum: [7] },
      maxContextTurns: { type: "integer", enum: [5] },
    },
    ["enabled", "engine", "scope", "retentionDays", "maxContextTurns"],
  );
  const response = (
    path: string,
    method: string,
    status: number,
    schema: any,
  ) => {
    const op = (doc.paths["/api/v1" + path] as any)?.[method];
    if (op)
      op.responses[status] = {
        description: "Validated owner-scoped assistant data.",
        content: { "application/json": { schema } },
      };
  };
  response("/assistant/capabilities", "get", 200, ref("AssistantCapabilities"));
  response("/assistant/runs", "post", 202, ref("AssistantRun"));
  response("/assistant/runs/{id}", "get", 200, ref("AssistantRun"));
  response(
    "/assistant/runs",
    "get",
    200,
    obj(
      {
        data: array(ref("AssistantRun")),
        page: obj(
          {
            limit: { type: "integer" },
            hasMore: { type: "boolean" },
            nextCursor: { ...str, nullable: true },
          },
          ["limit", "hasMore", "nextCursor"],
        ),
      },
      ["data", "page"],
    ),
  );
}
