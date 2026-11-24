export const CATALOG_BATCH_ACTIONS = [
  "PUBLISH",
  "UNPUBLISH",
  "ADD_GENRES",
  "REPLACE_GENRES",
] as const;
export type CatalogBatchAction = (typeof CATALOG_BATCH_ACTIONS)[number];
export const MAX_CATALOG_BATCH_TITLES = 20;
export type CatalogBatchItem = {
  titleId: string;
  title: string | null;
  expectedVersion: string | null;
  beforeStatus?: string;
  targetStatus?: string;
  beforeGenreIds?: string[];
  targetGenreIds?: string[];
  state: "READY" | "BLOCKED" | "UNCHANGED" | "APPLIED" | "FAILED";
  code?: string;
  resultVersion?: string;
};
