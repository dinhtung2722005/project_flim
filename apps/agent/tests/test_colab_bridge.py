"""Real child process tests; no package installer, Qwen, E5 or external API calls."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from pjflim_agent.colab_bridge import NotebookSession, prepare_environment, _environment


class ColabBridgeChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.events = []
        self.session = NotebookSession(sys.executable, Path(__file__).resolve().parents[1],
                                       self.folder, self.events.append)

    def tearDown(self):
        self.session.close()
        self.temporary.cleanup()

    def test_state_and_unicode_survive_between_cells(self):
        self.session.execute("counter = 1\nprint('Xin chào')\ndisplay({'phim': 'Sao Hỏa'})")
        self.assertEqual(self.session.execute("counter += 1\n__reply__ = counter"), 2)
        self.assertTrue(any(e.get("value") == {"phim": "Sao Hỏa"} for e in self.events))

    def test_kernel_modules_not_shared_and_no_ports_opened(self):
        self.assertTrue(self.session.execute("import sys\n__reply__ = 'numpy' not in sys.modules"))
        self.assertEqual(self.session.execute("__reply__ = len(sys.argv)"), 2)

    def test_exception_message_secrets_not_reflected_and_worker_recovers(self):
        with self.assertRaisesRegex(RuntimeError, "NOTEBOOK_CELL_FAILED") as raised:
            self.session.execute("raise ValueError(secret)", {"secret": "PRIVATE_KEY_FIXTURE_123"})
        self.assertNotIn("PRIVATE_KEY_FIXTURE", str(raised.exception))
        self.assertEqual(self.session.execute("__reply__ = 4"), 4)

    def test_safe_error_code_and_clear_reply_after_failure(self):
        self.session.execute("__reply__ = 'old'")
        with self.assertRaisesRegex(RuntimeError, "SNAPSHOT_EXPIRED"):
            self.session.execute("raise RuntimeError('SNAPSHOT_EXPIRED: private detail')")
        self.assertIsNone(self.session.execute("pass"))

    def test_multiple_displays_and_binding_update(self):
        value = self.session.execute("display(name, {'ok': True})\n__reply__ = name", {"name": "phim"})
        self.assertEqual(value, "phim")
        self.assertEqual(len(self.events), 2)

    def test_process_closed_is_not_reused(self):
        self.session.close()
        with self.assertRaisesRegex(RuntimeError, "AGENT_PROCESS_STOPPED"):
            self.session.execute("pass")

    def test_interrupt_stops_child_without_hanging(self):
        def interrupted(event):
            raise KeyboardInterrupt()
        self.session.output = interrupted
        with self.assertRaisesRegex(RuntimeError, "AGENT_PROCESS_INTERRUPTED"):
            self.session.execute("print('progress')")
        self.assertIsNotNone(self.session.process.poll())

    def test_environment_does_not_forward_provider_secrets(self):
        with patch.dict(os.environ, {"OMDB_API_KEY": "private", "TMDB_API_READ_TOKEN": "private",
                                     "PYTHONPATH": "private", "LANGSMITH_TRACING": "true"}):
            env = _environment()
        self.assertNotIn("OMDB_API_KEY", env)
        self.assertNotIn("PYTHONPATH", env)
        self.assertEqual(env["LANGSMITH_TRACING"], "false")

    def test_prepare_blocks_pc_without_running_pip(self):
        with patch("pjflim_agent.colab_bridge.platform.system", return_value="Windows"), \
                patch("pjflim_agent.colab_bridge.subprocess.run") as run:
            with self.assertRaisesRegex(RuntimeError, "COLAB_LINUX_REQUIRED"):
                prepare_environment(self.folder, self.folder)
            run.assert_not_called()

    def test_missing_earlier_cell_fails_with_safe_location(self):
        with self.assertRaisesRegex(RuntimeError, "NOTEBOOK_CELL_FAILED") as raised:
            self.session.execute("display(missing_catalog)")
        self.assertIn("<colab-cell>:1", str(raised.exception))
        self.assertNotIn("missing_catalog", str(raised.exception))

    def test_secrets_remain_memory_only_and_not_in_process_log(self):
        self.session.execute("client_key = NOTEBOOK_SECRETS.pop('OMDB_API_KEY')",
                             {"NOTEBOOK_SECRETS": {"OMDB_API_KEY": "PRIVATE_KEY_FIXTURE"}})
        self.assertEqual(self.session.execute("__reply__ = len(NOTEBOOK_SECRETS)"), 0)
        self.assertNotIn("PRIVATE_KEY_FIXTURE", (self.folder / "agent-process.log").read_text())
