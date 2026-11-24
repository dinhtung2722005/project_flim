import assert from "node:assert/strict";
import {
  rankingMetrics,
  evaluateRecommendations,
} from "../packages/recommendations/src/evaluation";
const a = rankingMetrics(["a", "x", "b"], { a: 3, b: 1 }, 3);
assert.equal(a.precision, 2 / 3);
assert.equal(a.recall, 1);
assert.ok(a.ndcg! < 1);
assert.equal(rankingMetrics(["a", "b"], { a: 3, b: 1 }, 2).ndcg, 1);
assert.equal(rankingMetrics([], { a: 1 }, 5).precision, 0);
assert.equal(rankingMetrics(["a"], {}, 5).ndcg, null);
assert.throws(() => rankingMetrics(["a", "a"], { a: 1 }, 2));
const items = ["a", "b", "c"].map((id, i) => ({
  id,
  text: id,
  genres: [i < 2 ? "drama" : "action"],
  credits: [],
  language: null,
  countries: [],
  year: 2020,
  publishedAt: new Date("2020-01-01"),
}));
assert.throws(() =>
  evaluateRecommendations(items, [
    {
      id: "leak",
      signals: [{ id: "a", weight: 1 }],
      relevance: { a: 3 },
      asOf: "2021-01-01",
    },
  ]),
);
assert.throws(() =>
  evaluateRecommendations(items, [
    {
      id: "future",
      signals: [{ id: "a", weight: 1 }],
      relevance: { b: 3 },
      asOf: "2019-01-01",
    },
  ]),
);
const result = evaluateRecommendations(
  items,
  [
    {
      id: "known",
      signals: [{ id: "a", weight: 1 }],
      relevance: { b: 3 },
      asOf: "2021-01-01",
    },
  ],
  2,
);
assert.equal(result.cases[0].content.ids.includes("a"), false);
assert.equal(result.cases[0].candidateCount, 2);
console.log(
  JSON.stringify({ event: "recommendations.evaluation.passed", checks: 11 }),
);
