import json
import unittest
from datetime import datetime, timezone
suite = unittest.defaultTestLoader.discover(str(SOURCE / "tests"), pattern="test_*.py")
tests = unittest.TextTestRunner(verbosity=1).run(suite)
if not tests.wasSuccessful():
    raise RuntimeError("AGENT_CONTRACT_TESTS_FAILED")
REPORT = {"timestamp": datetime.now(timezone.utc).isoformat(), "hardware": HARDWARE,
          "dependencies": versions, "model": MODEL_MANIFEST, "model_smoke": MODEL_SMOKE, "context_tokens": CONTEXT_TOKENS,
          "embedding_model": MODEL_CONFIG["embeddingModel"], "embedding_revision": MODEL_CONFIG["embeddingRevision"],
          "embedding_shape": list(search.vectors.shape), "contract_tests": tests.testsRun,
          "demo": catalog.snapshot.demo, "agent_result_status": result["status"],
          "catalog_live_check": False, "omdb_live_test": False, "omdb_session_requests": _omdb_client.session_calls,
          "tmdb_live_test": False, "web_live_test": False}
(WORKSPACE / "runtime-report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding="utf-8")
display(JSON(REPORT))
print("Nếu dùng snapshot thật: luôn kiểm lại publication/quyền qua backend trước khi đưa kết quả lên website.")
