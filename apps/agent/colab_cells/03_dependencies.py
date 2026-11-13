import importlib.metadata
import subprocess
import sys
import os
from pathlib import Path
for key in ("LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING"):
    os.environ[key] = "false"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
with (WORKSPACE / "dependency-install.log").open("w") as log:
    installed = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                                "-r", str(SOURCE / "requirements-colab.txt")], stdout=log, stderr=log)
if installed.returncode:
    raise RuntimeError("DEPENDENCY_INSTALL_FAILED: xem dependency-install.log, không chia sẻ key hoặc toàn bộ env.")
versions = {name: importlib.metadata.version(name) for name in
            ("langchain-core", "langchain-ollama", "pydantic", "numpy", "faiss-cpu", "sentence-transformers", "ddgs")}
display(versions)
import numpy
if numpy.__version__ != versions["numpy"]:
    raise RuntimeError("RESTART_KERNEL_REQUIRED: restart session rồi chạy notebook từ đầu để dùng đúng NumPy.")
# Model and RAG smoke tests below are required; do not infer compatibility from pip exit alone.
