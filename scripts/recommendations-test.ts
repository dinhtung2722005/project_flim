import { runRecommendationAlgorithmChecks } from "../tests/recommendations.integration";
console.log(
  JSON.stringify({
    event: "recommendations.algorithm.passed",
    checks: runRecommendationAlgorithmChecks(),
  }),
);
