import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkColabReport,
  inspectColabReport,
} from "../scripts/check-colab-acceptance.mjs";

const now = Date.parse("2026-11-25T00:00:00Z");
const config = JSON.parse(
  await readFile(
    new URL("../apps/agent/model-versions.json", import.meta.url),
    "utf8",
  ),
);
function fixture() {
  return {
    report_schema_version: 2,
    timestamp: new Date(now).toISOString(),
    hardware: {
      system: "Linux",
      python: "3.12.16",
      gpus: ["Synthetic GPU record for unit test"],
    },
    dependencies: {
      "langchain-core": "1.8.0",
      "langchain-ollama": "1.1.0",
      pydantic: "2.14.3",
      httpx: "0.28.1",
      numpy: "2.2.6",
      "faiss-cpu": "1.16.0",
      "sentence-transformers": "6.3.0",
      ddgs: "9.16.1",
      torch: "2.9.1+cpu",
    },
    model: {
      model: config.model,
      digest: "a".repeat(64),
      size: 4000000000,
      ollama_version: config.ollama,
    },
    model_smoke: {
      nonempty_text: true,
      tool_call: true,
      json_schema: true,
      duration_seconds: 1,
      runtime: {
        model: config.model,
        digest: "a".repeat(64),
        gpu_offload: true,
        size_vram_bytes: 4000000000,
      },
    },
    context_tokens: 8192,
    embedding_model: config.embeddingModel,
    embedding_revision: config.embeddingRevision,
    embedding_shape: [4, 384],
    contract_tests: 134,
    contract_failures: 0,
    contract_errors: 0,
    contract_skipped: 2,
    demo: true,
    agent_result_status: "FOUND",
    catalog_live_check: false,
    agent_evaluation: {
      status: "PASSED",
      scope: "SYNTHETIC_DEMO_ONLY",
      passedCases: 3,
      totalCases: 3,
      cases: [
        ["exact-title", "demo-sao-hoa"],
        ["series-year", "demo-hai-dang"],
        ["untrusted-instruction", "demo-bep-nho"],
      ].map(([caseId, id]) => ({
        caseId,
        expectedIds: [id],
        retrievedIds: [id],
        selectedIds: [id],
        grounded: true,
        passed: true,
        toolCalls: 2,
        seconds: 1,
      })),
    },
  };
}
function denied(r, code) {
  const result = checkColabReport(r, now);
  assert.equal(result.status, "REPORTED_DEMO_CHECKS_FAILED");
  assert.equal(result.checks.find((c) => c.code === code).passed, false);
}
test("valid reported facts do not attest actual Colab execution or full acceptance", () => {
  const result = checkColabReport(fixture(), now);
  assert.equal(result.status, "REPORTED_DEMO_CHECKS_PASSED");
  assert.equal(result.independentColabObservation, false);
  assert.equal(result.finalAcceptance, "PENDING_MANUAL_REVIEW");
  assert.ok(result.pending.includes("RESET_CHECKPOINT_RESTORE"));
});
test("GPU assigned without model offload fails", () => {
  const r = fixture();
  r.model_smoke.runtime.size_vram_bytes = 0;
  denied(r, "LOADED_MODEL_MATCHES_GPU");
});
test("model digest mismatch fails", () => {
  const r = fixture();
  r.model_smoke.runtime.digest = "b".repeat(64);
  denied(r, "LOADED_MODEL_MATCHES_GPU");
});
test("old schema or stale/future reports fail", () => {
  let r = fixture();
  r.report_schema_version = 1;
  denied(r, "REPORT_SCHEMA_2");
  r = fixture();
  r.timestamp = "2026-11-10T00:00:00Z";
  denied(r, "REPORT_RECENT_7_DAYS");
  r = fixture();
  r.timestamp = "2027-01-01T00:00:00Z";
  denied(r, "REPORT_RECENT_7_DAYS");
});
test("contract pass cannot hide quality NEEDS_REVIEW or skipped demo", () => {
  for (const status of ["NEEDS_REVIEW", "SKIPPED"]) {
    const r = fixture();
    r.agent_evaluation.status = status;
    denied(r, "DEMO_AGENT_3_CASES_GROUNDED");
  }
});
test("forged selected IDs or duplicate quality cases fail", () => {
  let r = fixture();
  r.agent_evaluation.cases[0].selectedIds = ["forged"];
  denied(r, "DEMO_AGENT_3_CASES_GROUNDED");
  r = fixture();
  r.agent_evaluation.cases[1] = r.agent_evaluation.cases[0];
  denied(r, "DEMO_AGENT_3_CASES_GROUNDED");
});
test("fixtures and zero contract execution fail", () => {
  let r = fixture();
  r.FIXTURE_RUNTIME_NOT_LIVE_INFERENCE = true;
  denied(r, "NO_EXPLICIT_FIXTURE_MARKER");
  r = fixture();
  r.contract_tests = 0;
  denied(r, "CONTRACT_TESTS_PASS");
});
test("revision drift and non-demo shape cannot pass initial demo acceptance", () => {
  let r = fixture();
  r.embedding_revision = "wrong";
  denied(r, "EMBEDDING_MODEL_REVISION");
  r = fixture();
  r.embedding_shape = [4, 768];
  denied(r, "DEMO_EMBEDDING_4_BY_384");
  r = fixture();
  r.demo = false;
  denied(r, "DEMO_EMBEDDING_4_BY_384");
});
test("malformed values are safely rejected without dumping unknown fields", () => {
  for (const value of [
    null,
    [],
    42,
    "secret",
    { model: { digest: "PRIVATE_KEY" } },
  ]) {
    const result = checkColabReport(value, now);
    assert.equal(result.status, "REPORTED_DEMO_CHECKS_FAILED");
    assert.ok(!JSON.stringify(result).includes("PRIVATE_KEY"));
  }
});
test("input failures, large files and arbitrary provider text stay private", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pjflim-colab-report-"));
  try {
    const invalid = path.join(dir, "invalid.json");
    await writeFile(invalid, "PRIVATE_API_KEY{");
    const a = await inspectColabReport(invalid);
    assert.equal(a.status, "REPORT_INPUT_INVALID");
    assert.ok(!JSON.stringify(a).includes("PRIVATE_API_KEY"));
    const large = path.join(dir, "large.json");
    await writeFile(large, " ".repeat(256001));
    assert.equal(
      (await inspectColabReport(large)).status,
      "REPORT_INPUT_INVALID",
    );
    assert.equal(
      (await inspectColabReport(dir)).status,
      "REPORT_INPUT_INVALID",
    );
  } finally {
    const tempRoot = await realpath(os.tmpdir()),
      target = await realpath(dir);
    const relative = path.relative(tempRoot, target);
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    );
    await rm(target, { recursive: true, force: true });
  }
});
