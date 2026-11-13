"""Run only in a disposable Linux test container; no project credentials mounted."""
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

requirements = Path("/work/requirements-test.txt").read_text()
stamp = Path("/reports/deps.stamp")
if not stamp.exists() or stamp.read_text() != requirements:
    with Path("/reports/dependency-install.log").open("w") as log:
        subprocess.run([sys.executable,"-m","pip","install","--disable-pip-version-check","--no-cache-dir",
                        "--target","/reports/deps","-r","/work/requirements-test.txt"],stdout=log,stderr=log,check=True)
    stamp.write_text(requirements)
sys.path[:0] = ["/reports/deps","/work"]
# Offline tests: providers use httpx.MockTransport; model output is a fixture.
suite = unittest.defaultTestLoader.discover("/work/tests", pattern="test_*.py")
result = unittest.TextTestRunner(verbosity=2).run(suite)
report = {"passed": result.wasSuccessful(), "tests": result.testsRun,
          "failures": len(result.failures), "errors": len(result.errors),
          "python": sys.version.split()[0], "modelInference": False, "e5Inference": False,
          "faiss": True, "chatOllamaAdapter": "real library, mocked HTTP",
          "dependencies": {n: importlib.metadata.version(n) for n in ("langchain-ollama","langchain-core","pydantic","numpy","faiss-cpu")}}
if Path("/reports/catalog.snapshot.json").exists():
    from pjflim_agent.catalog import Catalog
    report["publicExportTitles"] = len(Catalog.load("/reports/catalog.snapshot.json").by_id)
Path("/reports/python-test-result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
raise SystemExit(0 if result.wasSuccessful() else 1)
