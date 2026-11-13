import json
import tempfile
import zipfile
from pathlib import Path
from .catalog import AgentError, Catalog, utcnow

FILES = {"catalog.snapshot.json", "index-manifest.json", "vectors.npy", "model-manifest.json", "runtime-report.json"}


def save_checkpoint(workspace: str | Path, clock=utcnow):
    workspace = Path(workspace)
    Catalog.load(workspace / "catalog.snapshot.json", clock=clock)
    destination = workspace / "pj-flim-agent-checkpoint.zip"
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            source = workspace / name
            if source.is_file():
                archive.write(source, arcname=name)
    return destination


def restore_checkpoint(source: str | Path, workspace: str | Path, clock=utcnow, expected_model_digest=None):
    source, workspace = Path(source), Path(workspace)
    try:
        if source.stat().st_size > 8_000_000:
            raise ValueError()
        with zipfile.ZipFile(source) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or not set(names).issubset(FILES) or "catalog.snapshot.json" not in names:
                raise ValueError()
            if sum(i.file_size for i in archive.infolist()) > 8_000_000:
                raise ValueError()
            for name in names:
                info = archive.getinfo(name)
                if info.is_dir() or (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError()
            payloads = {name: archive.read(name) for name in names}
        with tempfile.TemporaryDirectory() as temporary:
            staged = Path(temporary) / "catalog.snapshot.json"
            staged.write_bytes(payloads["catalog.snapshot.json"])
            Catalog.load(staged, clock=clock)
        if expected_model_digest is not None:
            saved_model = json.loads(payloads.get("model-manifest.json", b"{}"))
            if not isinstance(saved_model, dict) or saved_model.get("digest") != expected_model_digest:
                raise AgentError("MODEL_DIGEST_CHANGED")
        workspace.mkdir(parents=True, exist_ok=True)
        for name, content in payloads.items():
            (workspace / name).write_bytes(content)
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError):
        raise AgentError("CHECKPOINT_INVALID") from None
    return workspace
