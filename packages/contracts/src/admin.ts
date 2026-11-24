export const CATALOG_ISSUES = [
  "NO_POSTER",
  "NO_SYNOPSIS",
  "NO_GENRES",
  "NO_YEAR",
  "NO_LANGUAGE",
  "NO_CREDITS",
  "NO_PLAYABLE_EPISODE",
  "PUBLISHED_WITHOUT_PLAYABLE",
] as const;
export type CatalogIssue = (typeof CATALOG_ISSUES)[number];
