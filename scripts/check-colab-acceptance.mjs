import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const modelConfig = JSON.parse(
  await readFile(path.join(root, "apps/agent/model-versions.json"), "utf8"),
);
const dependencies = {};
for (const file of ["requirements-test.txt", "requirements-colab.txt"]) {
  const text = await readFile(path.join(root, "apps/agent", file), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const pin = line.match(/^([a-z0-9-]+)==([^\s]+)$/i);
    if (pin) dependencies[pin[1]] = pin[2];
  }
}
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) =>
  typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/.test(value);
const equalIds = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((id, index) => id === expected[index]);

/** Checks reported facts only; a JSON file is not independent proof of a Colab execution. */
export function checkColabReport(report, now = Date.now()) {
  const checks = [];
  const add = (code, passed) => checks.push({ code, passed: passed === true });
  const r = record(report) ? report : {},
    hardware = r.hardware ?? {},
    smoke = r.model_smoke ?? {},
    model = r.model ?? {},
    runtime = smoke.runtime ?? {},
    evaluation = r.agent_evaluation ?? {};
  add("REPORT_SCHEMA_2", r.report_schema_version === 2);
  const timestamp =
    typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  add(
    "REPORT_RECENT_7_DAYS",
    Number.isFinite(timestamp) &&
      timestamp <= now + 300000 &&
      now - timestamp <= 7 * 86400000,
  );
  add(
    "NO_EXPLICIT_FIXTURE_MARKER",
    r.FIXTURE_RUNTIME_NOT_LIVE_INFERENCE !== true &&
      !Object.keys(r).some((key) => /fixture/i.test(key)) &&
      runtime.fixture !== true,
  );
  add(
    "LINUX_PYTHON_311_TO_313",
    hardware.system === "Linux" &&
      typeof hardware.python === "string" &&
      /^3\.(11|12|13)\./.test(hardware.python),
  );
  add(
    "GPU_ASSIGNED",
    Array.isArray(hardware.gpus) &&
      hardware.gpus.length > 0 &&
      hardware.gpus.every(
        (gpu) =>
          typeof gpu === "string" &&
          gpu.trim().length > 0 &&
          !/fixture/i.test(gpu),
      ),
  );
  add(
    "DEPENDENCIES_MATCH_PINS",
    record(r.dependencies) &&
      Object.entries(dependencies).every(
        ([name, version]) => r.dependencies[name] === version,
      ) &&
      r.dependencies.torch === "2.9.1+cpu",
  );
  add(
    "MODEL_TAG_DIGEST_VERSION",
    model.model === modelConfig.model &&
      digest(model.digest) &&
      integer(model.size) &&
      model.size > 0 &&
      model.ollama_version === modelConfig.ollama,
  );
  add(
    "SMOKE_TEXT_TOOL_JSON",
    smoke.nonempty_text === true &&
      smoke.tool_call === true &&
      smoke.json_schema === true &&
      typeof smoke.duration_seconds === "number" &&
      Number.isFinite(smoke.duration_seconds) &&
      smoke.duration_seconds > 0,
  );
  add(
    "LOADED_MODEL_MATCHES_GPU",
    runtime.model === model.model &&
      digest(runtime.digest) &&
      runtime.digest === model.digest &&
      runtime.gpu_offload === true &&
      integer(runtime.size_vram_bytes) &&
      runtime.size_vram_bytes > 0,
  );
  add(
    "CONTEXT_TOKENS_SUPPORTED",
    integer(r.context_tokens) &&
      r.context_tokens >= 2048 &&
      r.context_tokens <= 8192,
  );
  add(
    "EMBEDDING_MODEL_REVISION",
    r.embedding_model === modelConfig.embeddingModel &&
      r.embedding_revision === modelConfig.embeddingRevision,
  );
  add(
    "DEMO_EMBEDDING_4_BY_384",
    r.demo === true && equalIds(r.embedding_shape, [4, 384]),
  );
  add(
    "CONTRACT_TESTS_PASS",
    integer(r.contract_tests) &&
      r.contract_tests > 0 &&
      r.contract_failures === 0 &&
      r.contract_errors === 0 &&
      integer(r.contract_skipped) &&
      r.contract_skipped < r.contract_tests,
  );
  const expected = new Map([
    ["exact-title", "demo-sao-hoa"],
    ["series-year", "demo-hai-dang"],
    ["untrusted-instruction", "demo-bep-nho"],
  ]);
  const cases = Array.isArray(evaluation.cases) ? evaluation.cases : [];
  add(
    "DEMO_AGENT_3_CASES_GROUNDED",
    evaluation.status === "PASSED" &&
      evaluation.scope === "SYNTHETIC_DEMO_ONLY" &&
      evaluation.passedCases === 3 &&
      evaluation.totalCases === 3 &&
      cases.length === 3 &&
      new Set(cases.map((c) => c?.caseId)).size === 3 &&
      cases.every(
        (c) =>
          record(c) &&
          expected.has(c.caseId) &&
          c.passed === true &&
          c.grounded === true &&
          equalIds(c.expectedIds, [expected.get(c.caseId)]) &&
          equalIds(c.selectedIds, [expected.get(c.caseId)]) &&
          equalIds(c.retrievedIds, [expected.get(c.caseId)]) &&
          integer(c.toolCalls) &&
          c.toolCalls > 0 &&
          c.toolCalls <= 6 &&
          typeof c.seconds === "number" &&
          Number.isFinite(c.seconds) &&
          c.seconds >= 0 &&
          !c.errorCode,
      ),
  );
  add("INITIAL_AGENT_ANSWER_FOUND", r.agent_result_status === "FOUND");
  add("LIVE_ELIGIBILITY_NOT_CLAIMED", r.catalog_live_check === false);
  const passed = checks.every((c) => c.passed);
  return {
    status: passed
      ? "REPORTED_DEMO_CHECKS_PASSED"
      : "REPORTED_DEMO_CHECKS_FAILED",
    scope: "SELF_REPORTED_SYNTHETIC_DEMO_ONLY",
    independentColabObservation: false,
    finalAcceptance: "PENDING_MANUAL_REVIEW",
    checks,
    contractSkipped: integer(r.contract_skipped) ? r.contract_skipped : null,
    pending: [
      "CONFIRM_REPORT_FROM_OWN_COLAB_RUN",
      "REVIEW_VIETNAMESE_AND_SEMANTIC_ANSWERS",
      "RESET_CHECKPOINT_RESTORE",
    ],
    excluded: [
      "PRODUCTION_READINESS",
      "REAL_CATALOG_RELEVANCE",
      "LIVE_OMDB_TMDB",
      "LOAD_AND_LATENCY_SLO",
    ],
  };
}

export async function inspectColabReport(filename) {
  try {
    const metadata = await stat(filename);
    if (!metadata.isFile() || metadata.size > 256000)
      throw Error("INVALID_REPORT");
    const raw = await readFile(filename, "utf8");
    return checkColabReport(JSON.parse(raw.replace(/^\uFEFF/, "")));
  } catch {
    return {
      status: "REPORT_INPUT_INVALID",
      finalAcceptance: "PENDING_MANUAL_REVIEW",
      errorCode: "COLAB_REPORT_UNREADABLE_OR_INVALID",
      independentColabObservation: false,
    };
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 3) {
    console.log(
      JSON.stringify({
        status: "REPORT_PATH_REQUIRED",
        usage: "npm.cmd run agent:acceptance -- <runtime-report.json>",
      }),
    );
    process.exitCode = 2;
  } else {
    const result = await inspectColabReport(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "REPORTED_DEMO_CHECKS_PASSED" ? 0 : 1;
  }
}
