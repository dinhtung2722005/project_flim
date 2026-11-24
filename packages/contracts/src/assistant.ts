export const ASSISTANT_TOOLS = [
  "search_catalog",
  "get_title_details",
  "get_published_episodes",
  "search_help",
  "get_title_feedback",
] as const;
export type ToolName = (typeof ASSISTANT_TOOLS)[number];
export type Selection = {
  kind: "FOUND" | "EMPTY" | "HELP" | "NEEDS_INPUT";
  titleIds: string[];
  helpIds: string[];
  episodeIds: string[];
  evidenceIds: string[];
};
export type Evidence = {
  id: string;
  kind: "TITLE" | "HELP" | "EPISODE" | "FEEDBACK";
  entityId: string;
  version: string;
  retrievedAt: string;
  fields: Record<string, unknown>;
};
export const TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);
