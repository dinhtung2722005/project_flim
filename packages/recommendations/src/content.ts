// Bounded, deterministic content baseline. No network calls, training or inferred ratings.
export const MODEL_VERSION = "content-v1";
export type Item = {
  id: string;
  text: string;
  genres: string[];
  credits: string[];
  language: string | null;
  countries: string[];
  year: number | null;
  publishedAt: Date;
};
export type Signal = { id: string; weight: number };
export type Vector = Map<string, number>;
export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}
const stop = new Set(
  "va la cua nhung cac mot voi trong cho khi duoc tren tu ve phim cau chuyen the a an of to in and is".split(
    " ",
  ),
);
function terms(text: string) {
  const words = normalizeText(text.slice(0, 6000))
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stop.has(w))
    .slice(0, 180);
  return [...words, ...words.slice(1).map((w, i) => words[i] + " " + w)];
}
export function unit(vector: Vector): Vector {
  const norm = Math.sqrt([...vector.values()].reduce((n, v) => n + v * v, 0));
  return norm ? new Map([...vector].map(([k, v]) => [k, v / norm])) : new Map();
}
export function cosine(a: Vector, b: Vector) {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let total = 0;
  for (const [key, value] of small) total += value * (large.get(key) || 0);
  return Math.max(0, Math.min(1, total));
}
export function vectors(items: Item[]): Map<string, Vector> {
  const docs = items.map((i) => terms(i.text));
  const df = new Map<string, number>();
  for (const doc of docs)
    for (const t of new Set(doc)) df.set(t, (df.get(t) || 0) + 1);
  const vocabulary = new Set(
    [...df]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10000)
      .map(([t]) => t),
  );
  return new Map(
    items.map((item, index) => {
      const vector: Vector = new Map();
      function group(
        prefix: string,
        entries: [string, number][],
        weight: number,
      ) {
        for (const [k, v] of unit(new Map(entries)))
          vector.set(prefix + k, v * Math.sqrt(weight));
      }
      group(
        "g:",
        [...new Set(item.genres)].map((x) => [x, 1]),
        0.4,
      );
      const tf = new Map<string, number>();
      for (const t of docs[index])
        if (vocabulary.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
      group(
        "t:",
        [...tf].map(([t, n]) => [
          t,
          (1 + Math.log(n)) *
            (1 + Math.log((items.length + 1) / ((df.get(t) || 0) + 1))),
        ]),
        0.3,
      );
      group(
        "p:",
        [...new Set(item.credits)].map((x) => [x, 1]),
        0.15,
      );
      group(
        "l:",
        [
          ...new Set([
            ...(item.language ? ["lang:" + item.language] : []),
            ...item.countries.map((c) => "country:" + c),
          ]),
        ].map((x) => [x, 1]),
        0.1,
      );
      // Adjacent release years share decade features; missing year stays empty.
      group(
        "y:",
        item.year ? [[String(Math.floor(item.year / 10)), 1]] : [],
        0.05,
      );
      return [item.id, unit(vector)];
    }),
  );
}
export function rank(
  items: Item[],
  candidates: string[],
  signals: Signal[],
  now = Date.now(),
  take = 100,
  excludeSeedIds?: string[],
) {
  const index = vectors(items),
    byId = new Map(items.map((i) => [i.id, i]));
  const profile: Vector = new Map();
  for (const signal of signals) {
    if (!Number.isFinite(signal.weight) || signal.weight <= 0) continue;
    for (const [k, v] of index.get(signal.id) || [])
      profile.set(k, (profile.get(k) || 0) + v * Math.min(5, signal.weight));
  }
  const query = unit(profile),
    personalized = query.size > 0;
  const seen = new Set(
    excludeSeedIds ?? signals.filter((s) => s.weight > 0).map((s) => s.id),
  );
  const scored = [...new Set(candidates)]
    .filter((id) => byId.has(id) && !seen.has(id))
    .map((id) => {
      const item = byId.get(id)!;
      const relevance = cosine(index.get(id)!, query);
      const recency = Math.exp(
        -Math.max(0, now - item.publishedAt.getTime()) / (90 * 86400000),
      );
      return {
        id,
        relevance,
        score: personalized ? 0.85 * relevance + 0.15 * recency : recency,
        redundancy: 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 200);
  const selected: {
    id: string;
    reason: "SIMILAR_CONTENT" | "RECENTLY_PUBLISHED";
  }[] = [];
  while (scored.length && selected.length < Math.min(100, take)) {
    scored.sort(
      (a, b) =>
        0.8 * b.score -
          0.2 * b.redundancy -
          (0.8 * a.score - 0.2 * a.redundancy) || a.id.localeCompare(b.id),
    );
    const next = scored.shift()!;
    selected.push({
      id: next.id,
      reason:
        personalized && next.relevance > 0.1
          ? "SIMILAR_CONTENT"
          : "RECENTLY_PUBLISHED",
    });
    for (const row of scored)
      row.redundancy = Math.max(
        row.redundancy,
        cosine(index.get(row.id)!, index.get(next.id)!),
      );
  }
  return { personalized, items: selected };
}
export function decayedWeight(
  weight: number,
  updatedAt: Date,
  now = Date.now(),
) {
  return (
    weight *
    Math.pow(0.5, Math.max(0, now - updatedAt.getTime()) / (30 * 86400000))
  );
}
export function qualifiedSeconds(duration: number) {
  return Math.min(duration, Math.max(10, Math.min(120, 0.2 * duration)));
}
