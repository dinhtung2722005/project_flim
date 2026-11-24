import unittest
from unittest.mock import patch
from pjflim_agent import runtime
from pjflim_agent.catalog import AgentError

class ModelRuntimeTests(unittest.TestCase):
    def check(self, data, code=None, gpu=False):
        with patch.object(runtime, "_request", return_value=data) as request:
            if code:
                with self.assertRaises(AgentError) as raised:
                    runtime.model_runtime("sha256:fixture", require_gpu=gpu)
                self.assertEqual(raised.exception.code, code)
            else:
                result = runtime.model_runtime("sha256:fixture", require_gpu=gpu)
                self.assertEqual(result["gpu_offload"], data["models"][0]["size_vram"] > 0)
            request.assert_called_once_with("/api/ps")
    def model(self, **kw):
        return {"models": [{"name": runtime.MODEL, "digest": "sha256:fixture", "size_vram": 123, **kw}]}
    def test_gpu_offload_checked_from_loaded_model(self):
        self.check(self.model(), gpu=True)
    def test_cpu_allowed_when_explicit(self):
        self.check(self.model(size_vram=0), gpu=False)
    def test_gpu_required_but_not_used_is_error(self):
        self.check(self.model(size_vram=0), "MODEL_GPU_NOT_USED", gpu=True)
    def test_digest_change_rejected(self):
        self.check(self.model(digest="changed"), "MODEL_DIGEST_CHANGED")
    def test_missing_model_or_endpoint_rejected(self):
        self.check(None, "MODEL_RUNTIME_UNAVAILABLE")
        self.check({"models": []}, "MODEL_NOT_LOADED")
        self.check({"models": {}}, "MODEL_RUNTIME_UNAVAILABLE")
    def test_invalid_vram_rejected(self):
        for value in (None, True, -1, "123"):
            self.check(self.model(size_vram=value), "MODEL_RUNTIME_UNAVAILABLE")
