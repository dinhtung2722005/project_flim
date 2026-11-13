"""Installer contract tests: never downloads or installs an actual system package."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from pjflim_agent.catalog import AgentError
from pjflim_agent import runtime


class RuntimeInstallChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def code(self, expected, action):
        with self.assertRaises(AgentError) as raised:
            action()
        self.assertEqual(str(raised.exception), expected)
        self.assertNotIn("private-fixture", str(raised.exception))

    def response(self, raw=b"#!/bin/sh\nexit 0\n"):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = raw
        return response

    def test_existing_tools_do_not_run_package_manager(self):
        with patch.object(runtime.shutil, "which", return_value="/usr/bin/tool"), patch.object(runtime.subprocess, "run") as run:
            runtime._ensure_install_tools(self.folder)
            run.assert_not_called()

    def test_missing_zstd_installed_before_recheck(self):
        installed = False

        def which(tool):
            return None if tool == "zstd" and not installed else "/usr/bin/" + tool

        def execute(command, **kwargs):
            nonlocal installed
            self.assertTrue(kwargs["check"])
            self.assertEqual(kwargs["env"]["DEBIAN_FRONTEND"], "noninteractive")
            if command[1] == "install":
                self.assertIn("zstd", command)
                self.assertNotIn("curl", command)
                installed = True

        with patch.object(runtime.shutil, "which", side_effect=which), patch.object(runtime.os, "geteuid", return_value=0), patch.object(runtime.subprocess, "run", side_effect=execute) as run:
            runtime._ensure_install_tools(self.folder)
            self.assertEqual(run.call_count, 2)
        self.assertTrue((self.folder / "install-dependencies.log").is_file())

    def test_no_root_or_no_apt_never_attempts_install(self):
        for uid, apt in [(1000, True), (0, False)]:
            with self.subTest(uid=uid, apt=apt), patch.object(runtime.shutil, "which", side_effect=lambda t: "/usr/bin/" + t if t == "curl" or (t == "apt-get" and apt) else None), patch.object(runtime.os, "geteuid", return_value=uid), patch.object(runtime.subprocess, "run") as run:
                self.code("OLLAMA_INSTALL_TOOLS_MISSING", lambda: runtime._ensure_install_tools(self.folder))
                run.assert_not_called()

    def test_package_failure_timeout_and_missing_after_install(self):
        for failure, expected in [
            (subprocess.TimeoutExpired("private-fixture", 120), "OLLAMA_DEPENDENCY_TIMEOUT"),
            (subprocess.CalledProcessError(1, "private-fixture"), "OLLAMA_DEPENDENCY_INSTALL_FAILED"),
            (None, "OLLAMA_INSTALL_TOOLS_MISSING"),
        ]:
            with self.subTest(expected=expected), patch.object(runtime.shutil, "which", side_effect=lambda t: None if t == "zstd" else "/usr/bin/" + t), patch.object(runtime.os, "geteuid", return_value=0), patch.object(runtime.subprocess, "run", side_effect=failure):
                self.code(expected, lambda: runtime._ensure_install_tools(self.folder))

    def test_download_errors_and_invalid_payload_are_safe(self):
        for response, failure, expected in [
            (None, URLError("private-fixture"), "OLLAMA_INSTALL_DOWNLOAD_FAILED"),
            (None, TimeoutError("private-fixture"), "OLLAMA_INSTALL_DOWNLOAD_TIMEOUT"),
            (self.response(b""), None, "OLLAMA_INSTALL_DOWNLOAD_INVALID"),
            (self.response(b"x" * 2_000_001), None, "OLLAMA_INSTALL_DOWNLOAD_INVALID"),
        ]:
            with self.subTest(expected=expected), patch.object(runtime, "_ensure_install_tools"), patch.object(runtime.urllib.request, "urlopen", return_value=response, side_effect=failure), patch.object(runtime.subprocess, "run") as run:
                self.code(expected, lambda: runtime._install_ollama(self.folder))
                run.assert_not_called()

    def test_script_failures_are_distinct_from_download_errors(self):
        for failure, expected in [
            (subprocess.TimeoutExpired("private-fixture", 900), "OLLAMA_INSTALL_TIMEOUT"),
            (subprocess.CalledProcessError(1, "private-fixture"), "OLLAMA_INSTALL_SCRIPT_FAILED"),
            (OSError("private-fixture"), "OLLAMA_INSTALL_SCRIPT_FAILED"),
            (None, "OLLAMA_NOT_INSTALLED"),
        ]:
            with self.subTest(expected=expected), patch.object(runtime, "_ensure_install_tools"), patch.object(runtime.urllib.request, "urlopen", return_value=self.response()), patch.object(runtime.subprocess, "run", side_effect=failure), patch.object(runtime.shutil, "which", return_value=None):
                self.code(expected, lambda: runtime._install_ollama(self.folder))

    def test_success_uses_official_script_and_pinned_version(self):
        with patch.object(runtime, "_ensure_install_tools") as tools, patch.object(runtime.urllib.request, "urlopen", return_value=self.response()) as download, patch.object(runtime.subprocess, "run") as run, patch.object(runtime.shutil, "which", return_value="/usr/local/bin/ollama"):
            self.assertEqual(runtime._install_ollama(self.folder), "/usr/local/bin/ollama")
            tools.assert_called_once_with(self.folder)
            download.assert_called_once_with("https://ollama.com/install.sh", timeout=30)
            args, kwargs = run.call_args
            self.assertEqual(args[0], ["sh", str(self.folder / "ollama-install.sh")])
            self.assertEqual(kwargs["env"]["OLLAMA_VERSION"], runtime.OLLAMA_VERSION)
            self.assertEqual(kwargs["timeout"], 900)
            self.assertTrue(kwargs["check"])

    def test_non_colab_platform_does_not_install(self):
        with patch.object(runtime.platform, "system", return_value="Windows"), patch.object(runtime, "_install_ollama") as installer:
            self.code("COLAB_LINUX_REQUIRED", lambda: runtime.start_ollama(self.folder))
            installer.assert_not_called()
