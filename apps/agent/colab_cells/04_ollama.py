import shutil
from pjflim_agent.catalog import AgentError
from pjflim_agent.runtime import start_ollama, pull_model
# Chỉ cài trong Colab. Kiểm/cài curl + zstd trước installer; không cần restart NumPy ở đây.
print("Đang kiểm tra/cài Ollama trong runtime Colab; có thể mất vài phút.")
try:
    display(start_ollama(WORKSPACE))
except AgentError as error:
    hints = {
        "OLLAMA_INSTALL_TOOLS_MISSING": "Thiếu curl/zstd và không tự cài được bằng apt-get quyền root.",
        "OLLAMA_DEPENDENCY_TIMEOUT": "apt-get quá thời gian; kiểm network runtime rồi chạy lại cell.",
        "OLLAMA_DEPENDENCY_INSTALL_FAILED": "apt-get lỗi; log riêng tại install-dependencies.log.",
        "OLLAMA_INSTALL_DOWNLOAD_FAILED": "Không tải được script HTTPS từ ollama.com; kiểm network/SSL.",
        "OLLAMA_INSTALL_DOWNLOAD_TIMEOUT": "Tải script quá thời gian; kiểm network rồi chạy lại cell.",
        "OLLAMA_INSTALL_DOWNLOAD_INVALID": "Script trả về rỗng hoặc quá giới hạn kích thước.",
        "OLLAMA_INSTALL_SCRIPT_FAILED": "Installer thoát lỗi; log riêng tại install.log.",
        "OLLAMA_INSTALL_TIMEOUT": "Installer vượt 15 phút; kiểm network/dung lượng runtime.",
        "OLLAMA_NOT_INSTALLED": "Installer kết thúc nhưng chưa tìm thấy executable ollama.",
    }
    display({"code": error.code, "hint": hints.get(error.code, "Xem hướng dẫn lỗi trong README agent."),
             "missing_install_tools": [t for t in ("curl", "zstd") if not shutil.which(t)]})
    raise RuntimeError(error.code) from None
print("Ollama đã khởi động; đang tải/kiểm model Qwen (nhiều GB).")
MODEL_MANIFEST = pull_model(WORKSPACE)
display(MODEL_MANIFEST)
