import { Item, Signal, rank, vectors, cosine } from "./content";
export type EvaluationCase = {
  id: string;
  signals: Signal[];
  relevance: Record<string, number>;
  asOf: string;
};
export function rankingMetrics(
  ids: string[],
  relevance: Record<string, number>,
  k: number,
) {
  if (!Number.isInteger(k) || k < 1 || k > 100)
    throw Error("EVALUATION_K_INVALID");
  if (new Set(ids).size !== ids.length)
    throw Error("EVALUATION_DUPLICATE_PREDICTION");
  if (
    Object.values(relevance).some((g) => !Number.isInteger(g) || g < 0 || g > 3)
  )
    throw Error("EVALUATION_GAIN_INVALID");
  const positives = Object.values(relevance).filter((v) => v > 0).length,
    top = ids.slice(0, k);
  if (!positives)
    return { precision: null, recall: null, ndcg: null, hitRate: null };
  const gains = top.map((id) => relevance[id] || 0),
    hits = gains.filter((v) => v > 0).length;
  const dcg = (values: number[]) =>
    values.reduce((n, g, i) => n + (2 ** g - 1) / Math.log2(i + 2), 0);
  const ideal = dcg(
    Object.values(relevance)
      .filter((v) => v > 0)
      .sort((a, b) => b - a)
      .slice(0, k),
  );
  return {
    precision: hits / k,
    recall: hits / positives,
    ndcg: ideal ? dcg(gains) / ideal : 0,
    hitRate: hits ? 1 : 0,
  };
}
export function metadataAudit(items: Item[]) {
  return {
    titles: items.length,
    missingText: items.filter((t) => !t.text.trim()).length,
    missingGenres: items.filter((t) => !t.genres.length).length,
    missingCredits: items.filter((t) => !t.credits.length).length,
    missingYear: items.filter((t) => !t.year).length,
    missingLanguage: items.filter((t) => !t.language).length,
  };
}
export function evaluateRecommendations(
  items: Item[],
  cases: EvaluationCase[],
  k = 5,
) {
  if (
    items.length > 1000 ||
    cases.length > 200 ||
    new Set(cases.map((c) => c.id)).size !== cases.length ||
    new Set(items.map((i) => i.id)).size !== items.length
  )
    throw Error("EVALUATION_SIZE_OR_IDS_INVALID");
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = cases.map((c) => {
    const now = Date.parse(c.asOf);
    if (!Number.isFinite(now)) throw Error("EVALUATION_DATE_INVALID");
    if (
      !c.signals.length ||
      c.signals.some(
        (s) => !byId.has(s.id) || !Number.isFinite(s.weight) || s.weight <= 0,
      )
    )
      throw Error("EVALUATION_SIGNALS_INVALID");
    const seedIds = new Set(c.signals.map((s) => s.id));
    for (const [id, gain] of Object.entries(c.relevance))
      if (
        !byId.has(id) ||
        seedIds.has(id) ||
        !Number.isInteger(gain) ||
        gain < 0 ||
        gain > 3
      )
        throw Error("EVALUATION_LABEL_INVALID");
    const available = items.filter((i) => i.publishedAt.getTime() <= now);
    if (
      c.signals.some((s) => !available.some((i) => i.id === s.id)) ||
      Object.keys(c.relevance).some((id) => !available.some((i) => i.id === id))
    )
      throw Error("EVALUATION_TEMPORAL_LEAKAGE");
    const candidates = available
      .filter((i) => !seedIds.has(i.id))
      .map((i) => i.id);
    const baseline = available
      .filter((i) => candidates.includes(i.id))
      .sort(
        (a, b) =>
          b.publishedAt.getTime() - a.publishedAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice(0, k)
      .map((i) => i.id);
    const started = performance.now(),
      predictions = rank(available, candidates, c.signals, now, k).items.map(
        (x) => x.id,
      ),
      latencyMs = performance.now() - started;
    const index = vectors(available),
      pairs: number[] = [];
    for (let a = 0; a < predictions.length; a++)
      for (let b = a + 1; b < predictions.length; b++)
        pairs.push(
          1 - cosine(index.get(predictions[a])!, index.get(predictions[b])!),
        );
    return {
      caseId: c.id,
      candidateCount: candidates.length,
      content: {
        ids: predictions,
        ...rankingMetrics(predictions, c.relevance, k),
      },
      recency: { ids: baseline, ...rankingMetrics(baseline, c.relevance, k) },
      intraListDiversity: pairs.length
        ? pairs.reduce((a, b) => a + b, 0) / pairs.length
        : null,
      latencyMs,
    };
  });
  const summarize = (key: "content" | "recency") => {
    const judged = rows.filter((r) => r[key].ndcg !== null);
    return {
      judgedCases: judged.length,
      precision: judged.length
        ? judged.reduce((n, r) => n + r[key].precision!, 0) / judged.length
        : null,
      recall: judged.length
        ? judged.reduce((n, r) => n + r[key].recall!, 0) / judged.length
        : null,
      ndcg: judged.length
        ? judged.reduce((n, r) => n + r[key].ndcg!, 0) / judged.length
        : null,
      coverage: items.length
        ? new Set(rows.flatMap((r) => r[key].ids)).size / items.length
        : 0,
    };
  };
  return {
    k,
    cases: rows,
    content: summarize("content"),
    recency: summarize("recency"),
    metadata: metadataAudit(items),
    limitations: ["OFFLINE_METADATA_ONLY", "NOT_USER_PREFERENCE_OR_AB_UPLIFT"],
  };
}
