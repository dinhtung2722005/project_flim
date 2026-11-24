"""Stdlib notebook bridge. Runs trusted bundled cells in a private venv over pipes.
No HTTP listener, serialization of Python objects, or dependencies in the Colab kernel.
This is a process boundary for dependency isolation, not a code security sandbox.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import traceback

TORCH_VERSION = "2.9.1+cpu"
DEPENDENCIES = ("langchain-core", "langchain-ollama", "pydantic", "httpx", "numpy",
                "faiss-cpu", "sentence-transformers", "ddgs", "torch")
PROBE = """
import importlib.metadata, json
import numpy, faiss, torch
from sentence_transformers import SentenceTransformer
from langchain_ollama import ChatOllama
import ddgs
versions = {n: importlib.metadata.version(n) for n in DEPENDENCIES}
assert numpy.__version__ == versions["numpy"]
assert torch.version.cuda is None, "Embedding environment must use CPU torch"
assert faiss.IndexFlatIP(384).d == 384
print(json.dumps({"versions": versions, "embedding_device": "cpu", "imports_ok": True}))
"""


def _environment():
    env = {k: v for k, v in os.environ.items()
           if k not in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "OMDB_API_KEY",
                        "TMDB_API_READ_TOKEN", "LANGCHAIN_API_KEY", "LANGSMITH_API_KEY")}
    env.update({"PYTHONNOUSERSITE": "1", "LANGCHAIN_TRACING_V2": "false",
                "LANGSMITH_TRACING": "false", "HF_HUB_DISABLE_TELEMETRY": "1",
                "TOKENIZERS_PARALLELISM": "false"})
    return env


def prepare_environment(workspace, source):
    """Never changes packages already loaded by the Colab kernel."""
    if platform.system() != "Linux" or not Path("/content").is_dir():
        raise RuntimeError("COLAB_LINUX_REQUIRED")
    if not (3, 11) <= sys.version_info[:2] <= (3, 13):
        raise RuntimeError("PYTHON_VERSION_UNSUPPORTED: use Python 3.11–3.13")
    workspace, source = Path(workspace).resolve(), Path(source).resolve()
    venv = workspace / "venv"
    python = venv / "bin/python"
    requirements = b"".join((source / n).read_bytes()
                            for n in ("requirements-test.txt", "requirements-colab.txt"))
    signature = hashlib.sha256(requirements + TORCH_VERSION.encode()
                               + str(sys.version_info[:2]).encode()).hexdigest()
    stamp = workspace / "dependency-stamp.json"
    env = _environment()

    def probe():
        command = "DEPENDENCIES=" + repr(DEPENDENCIES) + "\n" + PROBE
        result = subprocess.run([str(python), "-I", "-c", command], env=env,
                                capture_output=True, text=True, timeout=120)
        if result.returncode:
            with (workspace / "dependency-install.log").open("a") as log:
                log.write(result.stderr[-12000:])
            raise subprocess.CalledProcessError(result.returncode, "dependency-import-probe")
        return json.loads(result.stdout.strip().splitlines()[-1])

    try:
        if python.exists() and stamp.exists() and json.loads(stamp.read_text()).get("signature") == signature:
            report = probe()
            return {**report, "reused": True, "python": str(python)}
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    try:
        with (workspace / "dependency-install.log").open("w") as log:
            if not python.exists():
                subprocess.run([sys.executable, "-m", "venv", str(venv)], env=env,
                               stdout=log, stderr=subprocess.STDOUT, timeout=120, check=True)
            for arguments in (
                ["install", "--disable-pip-version-check", "pip==25.3"],
                ["install", "--disable-pip-version-check", "--index-url", "https://download.pytorch.org/whl/cpu",
                 "torch==" + TORCH_VERSION],
                ["install", "--disable-pip-version-check", "-r", str(source / "requirements-colab.txt")],
            ):
                subprocess.run([str(python), "-I", "-m", "pip", *arguments], env=env,
                               stdout=log, stderr=subprocess.STDOUT, timeout=1200, check=True)
            subprocess.run([str(python), "-I", "-m", "pip", "check"], env=env,
                           stdout=log, stderr=subprocess.STDOUT, timeout=60, check=True)
        report = probe()
        frozen = subprocess.run([str(python), "-I", "-m", "pip", "freeze"], env=env,
                                capture_output=True, text=True, timeout=60, check=True)
        (workspace / "dependency-freeze.txt").write_text(frozen.stdout, encoding="utf-8")
        stamp.write_text(json.dumps({"signature": signature, **report}), encoding="utf-8")
        return {**report, "reused": False, "python": str(python)}
    except subprocess.TimeoutExpired:
        raise RuntimeError("DEPENDENCY_TIMEOUT: retry cell 3; inspect dependency-install.log privately") from None
    except (OSError, ValueError, subprocess.SubprocessError):
        raise RuntimeError("DEPENDENCY_INSTALL_OR_IMPORT_FAILED: inspect dependency-install.log privately") from None


class NotebookSession:
    """One sequential child retains model/search/client state between notebook cells."""
    def __init__(self, python, source, workspace, output=None):
        self.source, self.workspace = Path(source).resolve(), Path(workspace).resolve()
        self.output = output or self._default_output
        self._log = (self.workspace / "agent-process.log").open("a", encoding="utf-8")
        self.process = subprocess.Popen(
            [str(python), "-I", "-u", str(Path(__file__).resolve()), "--worker"],
            cwd=str(self.workspace), env=_environment(), stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=self._log, text=True, bufsize=1)
        self.execute("import sys\nfrom pathlib import Path\n"
                     "sys.path.insert(0, SOURCE)\nWORKSPACE=Path(WORKSPACE)\nSOURCE=Path(SOURCE)",
                     {"SOURCE": str(self.source), "WORKSPACE": str(self.workspace)})

    @staticmethod
    def _default_output(event):
        if event["kind"] == "text":
            print(event["value"], end="")
        else:
            print(json.dumps(event["value"], ensure_ascii=False, indent=2))

    def execute(self, code, bindings=None):
        if self.process.poll() is not None:
            raise RuntimeError("AGENT_PROCESS_STOPPED: rerun cell 3, then cells 4–8")
        try:
            self.process.stdin.write(json.dumps({"code": code, "bindings": bindings or {}}, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
            for line in self.process.stdout:
                event = json.loads(line)
                if event["kind"] == "done":
                    if not event["ok"]:
                        where = event.get("where", "")
                        raise RuntimeError(event["code"] + (" (" + where + ")" if where else ""))
                    return event.get("value")
                self.output(event)
            raise RuntimeError("AGENT_PROCESS_STOPPED: rerun cell 3, then cells 4–8")
        except (KeyboardInterrupt, BrokenPipeError, json.JSONDecodeError):
            self.close()
            raise RuntimeError("AGENT_PROCESS_INTERRUPTED: rerun cell 3, then cells 4–8") from None

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self._log):
            if stream:
                stream.close()


def _worker():
    from contextlib import redirect_stdout
    output = sys.stdout

    def emit(value):
        output.write(json.dumps(value, ensure_ascii=False, default=str) + "\n")
        output.flush()

    class ForwardText:
        def write(self, text):
            if text:
                emit({"kind": "text", "value": text})
            return len(text)

        def flush(self):
            pass

    def display(*values):
        for value in values:
            emit({"kind": "display", "value": value})

    state = {"__name__": "__notebook__", "display": display}
    for raw in sys.stdin:
        state.pop("__reply__", None)
        try:
            request = json.loads(raw)
            state.update(request.get("bindings", {}))
            with redirect_stdout(ForwardText()):
                exec(compile(request["code"], "<colab-cell>", "exec"), state)
            emit({"kind": "done", "ok": True, "value": state.pop("__reply__", None)})
        except Exception as error:
            # No traceback source text, local variables, arbitrary exception message, or secrets.
            code = getattr(error, "code", "NOTEBOOK_CELL_FAILED")
            if isinstance(error, RuntimeError):
                match = re.match(r"^([A-Z][A-Z0-9_]{2,80})(?::|$)", str(error))
                if match:
                    code = match[1]
            frames = traceback.extract_tb(error.__traceback__)
            last = frames[-1] if frames else None
            emit({"kind": "done", "ok": False, "code": code,
                  "where": Path(last.filename).name + ":" + str(last.lineno) if last else ""})
        finally:
            state.pop("__reply__", None)
            request = None


if __name__ == "__main__":
    _worker()
