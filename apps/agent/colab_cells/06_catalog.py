from pjflim_agent.catalog import Catalog, create_demo
from pjflim_agent.checkpoint import restore_checkpoint
CHECKPOINT_RESTORED = False
if USE_DEMO:
    catalog = create_demo(WORKSPACE / "catalog.snapshot.json")
else:
    from google.colab import files
    uploaded = files.upload()  # Chọn duy nhất catalog.snapshot.json hoặc checkpoint.zip trên PC.
    if len(uploaded) != 1:
        raise RuntimeError("SELECT_ONE_SNAPSHOT_OR_CHECKPOINT")
    name, content = next(iter(uploaded.items()))
    if name.lower().endswith(".zip"):
        if len(content) > 8_000_000:
            raise RuntimeError("CHECKPOINT_TOO_LARGE")
        archive_path = WORKSPACE / "input-checkpoint.zip"
        archive_path.write_bytes(content)
        restore_checkpoint(archive_path, WORKSPACE, expected_model_digest=MODEL_MANIFEST["digest"])
        CHECKPOINT_RESTORED = True
    elif name.lower().endswith(".json"):
        if len(content) > 5_000_000:
            raise RuntimeError("SNAPSHOT_TOO_LARGE")
        (WORKSPACE / "catalog.snapshot.json").write_bytes(content)
    else:
        raise RuntimeError("JSON_OR_ZIP_REQUIRED")
    catalog = Catalog.load(WORKSPACE / "catalog.snapshot.json")
display({"titles": len(catalog.by_id), "demo": catalog.snapshot.demo,
         "snapshot_at": catalog.snapshot.generated_at, "expires_at": catalog.snapshot.expires_at,
         "truncated": catalog.snapshot.truncated, "live_eligibility_checked": False})
if catalog.snapshot.demo:
    print("Đây là phim giả để thử agent; không phải phim đang có trên website.")
