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
repository_source = Path(__file__).resolve().parents[1]
bundle_files = 0
for cell in cells:
    assert cell["outputs"] == [] and cell["execution_count"] is None
    code = "".join(cell["source"])
    tree = ast.parse(code, filename=cell["id"])
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "execute":
            if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                ast.parse(node.args[0].value, filename=cell["id"] + "-isolated")
    if cell["id"] == "step-1":
        encoded = next(n.value.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "encoded" for t in n.targets))
        raw = base64.b64decode(encoded)
        assert hashlib.sha256(raw).hexdigest() == book["metadata"]["pj_flim"]["bundle_sha256"]
        for name, value in json.loads(raw).items():
            target = (repository_source / name).resolve()
            assert target.is_relative_to(repository_source), 'BUNDLE_PATH_INVALID'
            assert target.read_text(encoding='utf-8') == value, 'STALE_NOTEBOOK_SOURCE: ' + name
            bundle_files += 1
            if name.endswith(".py"):
                ast.parse(value, filename=name)
                source_count += 1
print(json.dumps({"passed": True, "codeCells": len(cells), "pythonSourcesParsed": source_count,
                  "outputsClean": True, "bundleHashVerified": True, "bundleFiles": bundle_files,
                  "bundleSourcesMatchRepository": True, "cellsExecuted": False}))
