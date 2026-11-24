import importlib.util
import json
import unittest
from unittest.mock import patch

from pjflim_agent.notebook_ui import NotebookChat, answer_html, build_chat_panel, safe_error

def answer():
    return {"answer": "Tìm thấy phim.", "demo": True, "warnings": [],
            "cards": [{"name": "<script>alert(1)</script>", "year": 2024, "genres": ["Hài"],
                       "synopsis": "<img src=x onerror=alert(1)>", "evidence": [{"source": {"provider": "CATALOG"}}],
                       "review_refs": [{"url": "javascript:alert(1)"}],
                       "external_ratings": [{"field": "imdb_rating", "value": {"value": 0, "scale_max": 10},
                                             "source": {"provider": "OMDB"}}]}]}

class NotebookUiTests(unittest.TestCase):
    def test_renderer_escapes_and_has_no_untrusted_links(self):
        html = answer_html(answer())
        self.assertNotIn("<script>", html)
        self.assertNotIn("<img", html)
        self.assertNotIn("href=", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("IMDb: 0/10", html)
        self.assertIn("chưa đọc bài", html)
        self.assertIn("Dữ liệu demo", html)

    def test_missing_score_not_invented(self):
        data = answer()
        data["cards"][0]["external_ratings"][0]["value"]["value"] = None
        self.assertIn("Chưa có điểm/10", answer_html(data))

    def test_modes_question_validation_and_whitespace(self):
        calls = []
        chat = NotebookChat(lambda q, m: calls.append((q, m)) or answer())
        chat.submit("  tìm phim  ", "HYBRID")
        self.assertEqual(calls, [("tìm phim", "HYBRID")])
        for q, mode in [("", "CATALOG"), ("x", "CATALOG"), ("x"*1001, "CATALOG"), ("hỏi phim", "WEB")]:
            with self.assertRaisesRegex(RuntimeError, "AGENT_INPUT_INVALID"):
                chat.submit(q, mode)
        self.assertEqual(len(calls), 1)

    def test_busy_guard_and_reset_after_failure(self):
        def fail(q, mode):
            self.assertTrue(chat.busy)
            with self.assertRaisesRegex(RuntimeError, "AGENT_BUSY"):
                chat.submit("tìm tiếp")
            raise RuntimeError("SNAPSHOT_EXPIRED")
        chat = NotebookChat(fail)
        with self.assertRaisesRegex(RuntimeError, "SNAPSHOT_EXPIRED"):
            chat.submit("tìm phim")
        self.assertFalse(chat.busy)
        self.assertEqual(chat.turns, [])

    def test_memory_bounded_and_clear_without_file_output(self):
        chat = NotebookChat(lambda q, m: answer(), max_turns=2)
        for i in range(3):
            chat.submit("phim " + str(i))
        self.assertEqual([t["question"] for t in chat.turns], ["phim 1", "phim 2"])
        chat.clear()
        self.assertEqual(chat.turns, [])

    def test_safe_errors_do_not_reflect_arbitrary_secrets(self):
        for error in [RuntimeError("PRIVATE_KEY_FIXTURE"), ValueError("token=private"), RuntimeError("untrusted html<script>")]:
            self.assertNotIn("PRIVATE_KEY", safe_error(error))
            self.assertNotIn("token=", safe_error(error))
            self.assertNotIn("<script>", safe_error(error))
        self.assertTrue(safe_error(RuntimeError("MODEL_UNAVAILABLE (file.py:42)")).startswith("MODEL_UNAVAILABLE:"))

    def test_no_widgets_falls_back(self):
        import builtins
        original = builtins.__import__
        def importing(name, *args, **kwargs):
            if name == "ipywidgets":
                raise ImportError("optional")
            return original(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=importing):
            self.assertIsNone(build_chat_panel(lambda q, m: answer()))

    @unittest.skipUnless(importlib.util.find_spec("ipywidgets"), "Optional widget package not installed")
    def test_real_widget_callback_sends_and_closes_old_panel(self):
        calls = []
        panel = build_chat_panel(lambda q, m: calls.append((q, m)) or answer())
        question, buttons, status, output = panel.children
        mode, send, clear = buttons.children
        question.value = "Tìm phim hài"
        send.click()
        self.assertEqual(calls, [("Tìm phim hài", "CATALOG")])
        self.assertFalse(send.disabled)
        self.assertIn("Đã trả lời", status.value)
        clear.click()
        self.assertIn("Đã xóa", status.value)
        panel.close()
        question.value = "Không được gọi tiếp"
        send.click()
        self.assertEqual(len(calls), 1)

    @unittest.skipUnless(importlib.util.find_spec("ipywidgets"), "Optional widget package not installed")
    def test_widget_error_restores_controls_and_redacts(self):
        def fail(*args):
            raise ValueError("private-token-fixture")
        panel = build_chat_panel(fail)
        question, buttons, status, output = panel.children
        question.value = "Tìm phim"
        buttons.children[1].click()
        self.assertNotIn("private-token-fixture", status.value)
        self.assertFalse(question.disabled)
        panel.close()
