export function normalized(value: string) {
  return value
    .toLowerCase()
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const stop = new Set(
  "toi minh ban cho hay tim co nao khong cac nhung mot muon xem duoc dang trong kho phim voi va la ve gi the nao nay".split(
    " ",
  ),
);
export function terms(value: string) {
  return [
    ...new Set(
      normalized(value)
        .split(" ")
        .filter((x) => x.length > 1 && !stop.has(x)),
    ),
  ].slice(0, 30);
}
export type SearchItem = {
  id: string;
  localized_title: string;
  original_title?: string;
  normalized_title?: string;
  synopsis?: string;
  aliases?: string[];
  genres?: { slug: string; name: string }[];
  credits?: (string | { name: string; role: string })[];
  release_year?: number;
};
export function rankCatalog<T extends SearchItem>(
  items: T[],
  query: string,
  limit: number,
) {
  const phrase = normalized(query),
    tokens = terms(query);
  if (!tokens.length)
    return phrase && phrase.length > 0 && items.length > 0
      ? []
      : items.slice(0, limit);
  return items
    .map((item) => {
      const names = normalized(
        [
          item.localized_title,
          item.original_title,
          ...(item.aliases ?? []),
        ].join(" "),
      );
      const metadata = normalized(
        [
          item.synopsis,
          ...(item.genres?.map((g) => g.name + " " + g.slug) ?? []),
          ...(item.credits?.map((c) => (typeof c === "string" ? c : c.name)) ??
            []),
        ].join(" "),
      );
      const exact = phrase.length > 1 && names.includes(phrase) ? 12 : 0;
      const hits = tokens.reduce(
        (n, t) => n + (names.includes(t) ? 4 : metadata.includes(t) ? 1 : 0),
        0,
      );
      return { item, score: exact + hits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, limit)
    .map((x) => x.item);
}
