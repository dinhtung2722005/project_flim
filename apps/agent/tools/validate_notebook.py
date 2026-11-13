"""Static Python validation; no GPU, installer, network or notebook cell execution."""
import ast
import base64
import hashlib
import json
from pathlib import Path
import sys

notebook_path = Path(sys.argv[1])
book = json.loads(notebook_path.read_text(encoding="utf-8"))
assert book["nbformat"] == 4 and book["nbformat_minor"] == 5
assert len({c["id"] for c in book["cells"]}) == len(book["cells"])
cells = [c for c in book["cells"] if c["cell_type"] == "code"]
assert len(cells) == 10
source_count = 0
for cell in cells:
    assert cell["outputs"] == [] and cell["execution_count"] is None
    code = "".join(cell["source"])
    tree = ast.parse(code, filename=cell["id"])
    if cell["id"] == "step-1":
        encoded = next(n.value.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "encoded" for t in n.targets))
        raw = base64.b64decode(encoded)
        assert hashlib.sha256(raw).hexdigest() == book["metadata"]["pj_flim"]["bundle_sha256"]
        for name, value in json.loads(raw).items():
            if name.endswith(".py"):
                ast.parse(value, filename=name)
                source_count += 1
print(json.dumps({"passed": True, "codeCells": len(cells), "pythonSourcesParsed": source_count,
                  "outputsClean": True, "bundleHashVerified": True, "cellsExecuted": False}))
