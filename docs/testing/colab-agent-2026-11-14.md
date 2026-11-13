# Kiểm tra notebook/installer — 14/11/2026

Phạm vi [agent/runbook](../../apps/agent/README.md) và [notebook](../../notebooks/movie-agent-colab.ipynb). Tiếp nối [báo cáo13/11](colab-agent-2026-11-13.md).

- 52 Python contract tests đạt trên Linux Docker: 44 cũ và 8 tests installer, gồm có/thiếu công cụ, apt quyền root/không apt, lỗi/timeout tải/cài, payload rỗng/quá lớn, pin version và chặn Windows. Mỗi test có thể gồm nhiều subcase.
- Package manager, download và installer subprocess là mock trong contract tests. Không dùng kết quả này để khẳng định cài Ollama thành công trên Colab.
- Runtime kiểm/cài curl/zstd thiếu trước script chính thức, phân biệt lỗi theo giai đoạn; installer timeout900s. Cell4 chỉ xuất mã/hint/tên công cụ thiếu.
- RESTART_KERNEL_REQUIRED là guard NumPy đang nạp khác phiên bản vừa cài. Thay notebook/source cần restart session để bỏ module cached.
- GPU passthrough Docker thấy RTX3050 laptop6GB. Full dependency/inference audit bị ngắt trong pip install trước khi hoàn thành; không có kết quả Qwen/E5/GPU-Colab thật. Container kiểm thử không còn chạy, không thay runtime API/media.
- Chưa có quyền/công cụ điều khiển phiên Chrome hoặc Colab của người dùng; TinyFish được gợi ý, chưa kết nối. Không đăng nhập Google hoặc dùng token/cookie của người dùng.

Giới hạn: chưa chạy các cell Colab từ phiên sạch, smoke tool/JSON bằng Qwen thật, E5 thật, agent/query/reset/checkpoint thật, live OMDb/IMDb/Metacritic. Không cam kết notebook không có lỗi trên mọi phiên Colab; cần log/mã lỗi cụ thể và nghiệm thu runtime thật.
