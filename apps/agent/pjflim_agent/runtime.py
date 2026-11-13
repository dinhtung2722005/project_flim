"""Colab/Linux process lifecycle. Never starts a Windows Ollama installation."""
from __future__ import annotations

import json
import os
import platform
import shutil
import signal
import subprocess
import time
import urllib.request
from pathlib import Path

from .catalog import AgentError

OLLAMA_VERSION = "0.40.16"
MODEL = "qwen2.5:7b"
BASE_URL = "http://127.0.0.1:11434"
_CHILD = None


def hardware():
    report = {"python": platform.python_version(), "system": platform.system(),
              "free_disk_gb": round(shutil.disk_usage("/content" if Path("/content").exists() else ".").free / 10**9, 2)}
    try:
        command = ["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader"]
        response = subprocess.run(command, capture_output=True, text=True, timeout=10, check=True)
        report["gpus"] = response.stdout.strip().splitlines()
    except (OSError, subprocess.SubprocessError):
        report["gpus"] = []
    return report


def _request(path):
    try:
        with urllib.request.urlopen(BASE_URL + path, timeout=2) as response:
            return json.loads(response.read(1_000_000))
    except Exception:
        return None


def _identity(pid):
    try:
        stat = Path(f"/proc/{int(pid)}/stat").read_text()
        start = stat[stat.rfind(")") + 2:].split()[19]
        command = Path(f"/proc/{int(pid)}/cmdline").read_bytes().split(b"\0")
        return {"start": start, "command": [c.decode("utf-8", "replace") for c in command if c]}
    except (OSError, ValueError, IndexError):
        return None


def _owned(record):
    identity = _identity(record.get("pid", -1))
    return bool(identity and identity == record.get("identity")
                and len(identity["command"]) == 2 and identity["command"][1] == "serve"
                and Path(identity["command"][0]).name == "ollama")


def _ensure_install_tools(folder: Path):
    """Install only missing archive/download prerequisites, inside the guarded Colab path."""
    missing = [tool for tool in ("curl", "zstd") if not shutil.which(tool)]
    if not missing:
        return
    if not shutil.which("apt-get") or os.geteuid() != 0:
        raise AgentError("OLLAMA_INSTALL_TOOLS_MISSING")
    packages = missing + (["ca-certificates"] if "curl" in missing else [])
    try:
        with (folder / "install-dependencies.log").open("ab") as log:
            for command, timeout in [
                (["apt-get", "update", "-qq"], 120),
                (["apt-get", "install", "-y", "-qq", "--no-install-recommends", *packages], 180),
            ]:
                subprocess.run(command, env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"},
                               stdout=log, stderr=subprocess.STDOUT, timeout=timeout, check=True)
    except subprocess.TimeoutExpired:
        raise AgentError("OLLAMA_DEPENDENCY_TIMEOUT") from None
    except (OSError, subprocess.CalledProcessError):
        raise AgentError("OLLAMA_DEPENDENCY_INSTALL_FAILED") from None
    if any(not shutil.which(tool) for tool in missing):
        raise AgentError("OLLAMA_INSTALL_TOOLS_MISSING")


def _install_ollama(folder: Path):
    _ensure_install_tools(folder)
    script = folder / "ollama-install.sh"
    try:
        with urllib.request.urlopen("https://ollama.com/install.sh", timeout=30) as response:
            raw = response.read(2_000_001)
    except TimeoutError:
        raise AgentError("OLLAMA_INSTALL_DOWNLOAD_TIMEOUT") from None
    except Exception:
        raise AgentError("OLLAMA_INSTALL_DOWNLOAD_FAILED") from None
    if not raw or len(raw) > 2_000_000:
        raise AgentError("OLLAMA_INSTALL_DOWNLOAD_INVALID")
    try:
        script.write_bytes(raw)
        with (folder / "install.log").open("wb") as log:
            subprocess.run(["sh", str(script)], env={**os.environ, "OLLAMA_VERSION": OLLAMA_VERSION},
                           stdout=log, stderr=subprocess.STDOUT, timeout=900, check=True)
    except subprocess.TimeoutExpired:
        raise AgentError("OLLAMA_INSTALL_TIMEOUT") from None
    except (OSError, subprocess.CalledProcessError):
        raise AgentError("OLLAMA_INSTALL_SCRIPT_FAILED") from None
    executable = shutil.which("ollama")
    if not executable:
        raise AgentError("OLLAMA_NOT_INSTALLED")
    return executable


def start_ollama(folder: str | Path, install=True):
    global _CHILD
    if platform.system() != "Linux" or not Path("/content").is_dir():
        raise AgentError("COLAB_LINUX_REQUIRED")
    folder = Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    record_path = folder / "ollama-process.json"
    existing = _request("/api/version")
    if existing:
        try:
            record = json.loads(record_path.read_text())
        except (OSError, ValueError):
            record = {}
        if not _owned(record) or existing.get("version") != OLLAMA_VERSION:
            raise AgentError("OLLAMA_PORT_OR_VERSION_CONFLICT")
        return {"version": OLLAMA_VERSION, "reused_owned_process": True}
    executable = shutil.which("ollama")
    if executable is None:
        if not install:
            raise AgentError("OLLAMA_NOT_INSTALLED")
        executable = _install_ollama(folder)
    if not executable:
        raise AgentError("OLLAMA_NOT_INSTALLED")
    log = (folder / "ollama.log").open("ab")
    _CHILD = subprocess.Popen([executable, "serve"], env={**os.environ, "OLLAMA_HOST": "127.0.0.1:11434",
                              "OLLAMA_MODELS": str(folder / "models"), "OLLAMA_NO_CLOUD": "1"},
                              stdout=log, stderr=subprocess.STDOUT)
    log.close()
    for _ in range(120):
        version = _request("/api/version")
        if version:
            identity = _identity(_CHILD.pid)
            if not identity or version.get("version") != OLLAMA_VERSION:
                if _CHILD.poll() is None:
                    _CHILD.terminate()
                raise AgentError("OLLAMA_VERSION_MISMATCH")
            record_path.write_text(json.dumps({"pid": _CHILD.pid, "identity": identity}), encoding="utf-8")
            return {"version": OLLAMA_VERSION, "reused_owned_process": False}
        if _CHILD.poll() is not None:
            raise AgentError("OLLAMA_START_FAILED")
        time.sleep(.5)
    _CHILD.terminate()
    raise AgentError("OLLAMA_START_TIMEOUT")


def pull_model(folder: str | Path):
    if (_request("/api/version") or {}).get("version") != OLLAMA_VERSION:
        raise AgentError("OLLAMA_NOT_READY")
    try:
        previous_path=Path(folder, "model-manifest.json")
        previous=json.loads(previous_path.read_text()) if previous_path.exists() else None
        import httpx
        # User runs this cell explicitly. Download remains in this Colab workspace.
        with httpx.Client(timeout=httpx.Timeout(1800, connect=10), trust_env=False) as client:
            response = client.post(BASE_URL + "/api/pull", json={"model": MODEL, "stream": False})
            response.raise_for_status()
        tags = _request("/api/tags") or {}
        selected = next(m for m in tags.get("models", []) if m.get("name") == MODEL)
        if previous and previous.get("digest") != selected["digest"]:
            raise AgentError("MODEL_DIGEST_CHANGED")
        record = {"model": MODEL, "digest": selected["digest"], "size": selected["size"], "ollama_version": OLLAMA_VERSION}
        Path(folder, "model-manifest.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
        return record
    except AgentError:
        raise
    except Exception:
        raise AgentError("MODEL_DOWNLOAD_FAILED") from None


def stop_ollama(folder: str | Path):
    path = Path(folder) / "ollama-process.json"
    try:
        record = json.loads(path.read_text())
    except (OSError, ValueError):
        return {"stopped": False}
    if not _owned(record):
        return {"stopped": False, "reason": "NO_MATCHING_OWNED_PROCESS"}
    os.kill(record["pid"], signal.SIGTERM)
    for _ in range(30):
        if not _owned(record):
            break
        time.sleep(.1)
    if _owned(record):
        os.kill(record["pid"], signal.SIGKILL)
    path.unlink(missing_ok=True)
    return {"stopped": True}


def make_model(context_tokens=8192):
    if type(context_tokens) is not int or not 2048 <= context_tokens <= 8192:
        raise AgentError("MODEL_CONTEXT_INVALID")
    import os
    from langchain_ollama import ChatOllama
    # Disable optional remote tracing, including when inherited from notebook environment.
    for name in ("LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING"):
        os.environ[name] = "false"
    return ChatOllama(model=MODEL, base_url=BASE_URL, temperature=0, num_ctx=context_tokens, num_predict=600,
                      keep_alive="5m", client_kwargs={"timeout": 90, "trust_env": False})
