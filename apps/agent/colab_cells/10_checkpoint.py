from pjflim_agent.checkpoint import save_checkpoint
from pjflim_agent.runtime import stop_ollama
archive_path = save_checkpoint(WORKSPACE)
print("Checkpoint:", archive_path, "— tải về trước khi runtime reset; không có key/prompt/model weights.")
DOWNLOAD_CHECKPOINT = False
STOP_OLLAMA = False
if DOWNLOAD_CHECKPOINT:
    from google.colab import files
    files.download(str(archive_path))
if STOP_OLLAMA:
    display(stop_ollama(WORKSPACE))
else:
    print("Chạy lại cell 8 để hỏi tiếp. Đặt STOP_OLLAMA=True ở cell này khi kết thúc.")
