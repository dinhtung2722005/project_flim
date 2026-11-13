# Stdlib only: dependencies are installed in the next cell.
import platform, shutil, subprocess
HARDWARE = {"python": platform.python_version(), "system": platform.system(),
            "free_disk_gb": round(shutil.disk_usage("/content").free / 10**9, 2), "gpus": []}
try:
    report = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader"],
                            capture_output=True, text=True, timeout=10, check=True)
    HARDWARE["gpus"] = report.stdout.strip().splitlines()
except (OSError, subprocess.SubprocessError):
    pass
display(HARDWARE)
if REQUIRE_GPU and not HARDWARE["gpus"]:
    raise RuntimeError("GPU_NOT_ASSIGNED: chọn GPU trong Runtime và chạy lại. CPU thử nghiệm: REQUIRE_GPU=False.")
if HARDWARE["free_disk_gb"] < 10:
    raise RuntimeError("DISK_TOO_SMALL: cần khoảng trống cho Ollama/model/dependencies.")
