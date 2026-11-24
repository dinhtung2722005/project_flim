"""Notebook cell flow with scripted Qwen and encoder, real agent/FAISS/validators."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from langchain_core.messages import AIMessage, ToolMessage

from pjflim_agent.retrieval import HybridSearch


class ScriptedQwen:
    def bind_tools(self, tools):
        self.tools = [t.name for t in tools]
        return self

    def invoke(self, messages):
        if isinstance(messages, str):
            if "lookup_demo_title" in getattr(self, "tools", []):
                return AIMessage(content="", tool_calls=[{"id": "probe", "name": "lookup_demo_title",
                                                         "args": {"title_id": "demo-sao-hoa"}}])
            return AIMessage(content="Tôi là trợ lý tìm phim.")
        observations = [m for m in messages if isinstance(m, ToolMessage)]
        if not observations:
            return AIMessage(content="", tool_calls=[{"id": "search", "name": "search_catalog",
                                                     "args": {"query": "khoa học viễn tưởng", "limit": 1}}])
        title = json.loads(observations[-1].content)["data"][0]
        return AIMessage(content="", tool_calls=[{"id": "finish", "name": "finish_answer", "args": {
            "status": "FOUND", "picks": [{"title_id": title["title_id"],
                                        "evidence_ids": [title["evidence"][0]["id"]]}]}}])

    def with_structured_output(self, schema, **kwargs):
        class Response:
            def invoke(self, message):
                return schema(ok=True)
        return Response()


class ColabFlowChecks(unittest.TestCase):
    def test_cells_with_fixture_model_encoder_and_actual_validators(self):
        source = Path(__file__).resolve().parents[1]
        cells = source / "colab_cells"
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state = {"WORKSPACE": root, "SOURCE": source, "USE_DEMO": True, "CONTEXT_TOKENS": 8192,
                     "MODEL_CONFIG": {"embeddingModel": "intfloat/multilingual-e5-small",
                                      "embeddingRevision": "fixture"},
                     "REQUIRE_GPU": False, "HARDWARE": {"gpus": ["fixture"]}, "versions": {"fixture": True},
                     "INPUT_NAME": "", "NOTEBOOK_SECRETS": {}, "OMDB_MAPPINGS": {}, "TMDB_MAPPINGS": {},
                     "ENABLE_WEB_DISCOVERY": False, "QUESTION": "Tìm phim", "MODE": "CATALOG",
                     "STOP_OLLAMA": False, "RUN_AGENT_EVALUATION": False, "display": lambda *args: None}
            manifest = {"model": "qwen2.5:7b", "digest": "a"*64, "size": 123, "ollama_version": "fixture"}
            (root / "model-manifest.json").write_text(json.dumps(manifest))
            def encoder(values):
                return np.ones((len(values), 384), dtype="float32")
            def retrieval(catalog, **kwargs):
                return HybridSearch(catalog, encode=encoder, **kwargs)
            with patch("pjflim_agent.runtime.start_ollama", return_value={"version": "fixture"}), \
                    patch("pjflim_agent.runtime.pull_model", return_value=manifest), \
                    patch("pjflim_agent.runtime.make_model", return_value=ScriptedQwen()), \
                    patch("pjflim_agent.runtime.model_runtime", return_value={"gpu_offload": False, "fixture": True}), \
                    patch("pjflim_agent.retrieval.HybridSearch", side_effect=retrieval):
                for number in (4, 5, 6, 7, 8):
                    path = next(cells.glob(f"{number:02d}_*.py"))
                    exec(compile(path.read_text(), str(path), "exec"), state)
                self.assertEqual(state["result"]["status"], "FOUND")
                self.assertTrue(state["result"]["cards"][0]["evidence"])
                first_client = state["_omdb_client"]
                state["NOTEBOOK_SECRETS"] = {}
                exec((cells / "08_agent.py").read_text(), state)
                self.assertIs(first_client, state["_omdb_client"])
                suite = unittest.TestSuite([unittest.FunctionTestCase(lambda: None)])
                with patch.object(unittest.defaultTestLoader, "discover", return_value=suite):
                    exec((cells / "09_checks.py").read_text(), state)
                exec((cells / "10_checkpoint.py").read_text(), state)
            self.assertTrue((root / "pj-flim-agent-checkpoint.zip").exists())
            report = json.loads((root / "runtime-report.json").read_text())
            self.assertTrue(report["model_smoke"]["tool_call"])
            self.assertEqual(report["embedding_shape"], [4, 384])
            self.assertFalse(report["catalog_live_check"])
            self.assertFalse(report["omdb_live_test"])

    def test_failed_gpu_smoke_does_not_keep_previous_success(self):
        from pjflim_agent.catalog import AgentError
        state = {"CONTEXT_TOKENS": 8192, "REQUIRE_GPU": True, "MODEL_MANIFEST": {"digest": "fixture"},
                 "MODEL_SMOKE": {"tool_call": True}, "MODEL_RUNTIME": {"gpu_offload": True}, "display": lambda *args: None}
        with patch("pjflim_agent.runtime.make_model", return_value=ScriptedQwen()), \
                patch("pjflim_agent.runtime.model_runtime", side_effect=AgentError("MODEL_GPU_NOT_USED")):
            with self.assertRaisesRegex(AgentError, "MODEL_GPU_NOT_USED"):
                exec((Path(__file__).resolve().parents[1] / "colab_cells/05_model_smoke.py").read_text(), state)
        self.assertNotIn("MODEL_SMOKE", state)
        self.assertNotIn("MODEL_RUNTIME", state)
