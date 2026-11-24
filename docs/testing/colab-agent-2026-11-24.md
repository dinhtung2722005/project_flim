# Kiểm thử notebook agent Colab v0.4 — 24/11/2026

Phạm vi: notebook Google Colab thử Qwen theo lựa chọn của người dùng. Không thay chatbot website, API, database, RabbitMQ media hoặc credential.

## Thay đổi

- Cell8: panel ipywidgets tùy chọn, câu hỏi CATALOG/HYBRID, nút hỏi/xóa và tối đa10lượt hiển thị trong RAM. Không gửi lịch sử chat sang model; fallback sửa QUESTION rồi chạy cell8. Khóa gửi khi xử lý, đóng callback cũ khi rerun/đổi session/stop.
- Render tên/nội dung/nguồn bằng HTML escaping; link discovery chỉ là văn bản chưa đọc bài; null khác điểm0; lỗi UI chỉ hiện mã an toàn và hướng dẫn.
- Cell5: đối chiếu loaded model digest và size_vram qua /api/ps. REQUIRE_GPU=True bắt buộc có offload, không khẳng định model hoàn toàn nằm trên GPU. Chạy lại lỗi không giữ cờ smoke thành công.
- Cell9:3case demo có expected IDs, CATALOG-only, ghi retrieval/selection/evidence/timing và quality PASSED/NEEDS_REVIEW riêng với contracts. Catalog thật SKIPPED/DEMO_ONLY. Report schema2 ghi số contracts/skips/errors, không câu hỏi/hội thoại/raw model prose.
- Generator v0.4.0,10codecell/36bundlefiles/33Python sources. Validator kiểm source repo trùng bundle, SHA-256, AST, ID và output rỗng.

## Kết quả mới

| Kiểm tra | Kết quả | Giới hạn |
| --- | --- | --- |
| Python contracts |127 đạt,0skip,0fail/error | Model/encoder/providers/lifecycle dùng fixtures |
| Widget callbacks |Gửi/xóa/close, xử lý lỗi và khôi phục controls đạt | ipywidgets8.1.9/IPython9.19.1 thật, không phiên giao diện Colab |
| Static notebook |10cell,33Python sources,36files, hash/source/output hợp lệ | Không suy ra inference thành công |
| Generated notebook flow |Cả10cell đạt; callback hỏi lần hai, widget, report và checkpoint | Dependency prepare, installer, GPU state, Qwen và encoder là fixtures |
| Quality result trong flow |NEEDS_REVIEW đúng cho model fixture không qua toàn bộ case | Không sửa thành PASSED để làm xanh báo cáo |
| Backend/frontend |Không chạy lại | Không có thay đổi ở hai phần này |

FAISS/ChatOllama/Pydantic và bridge subprocess/validator/checkpoint chạy bằng thư viện thật trong Docker Linux Python3.12. Không tải model Qwen/E5 lên PC, gọi OMDb/TMDB/DDGS thật hoặc chạy GPU inference.

Private evidence: .local/agent-colab-v04/contracts-result.json, contracts.log, static-result.json, notebook-flow-result.json, notebook-flow.log. Harness flow restore fixture patch trước contract discovery để không ảnh hưởng các unit tests.

Lượt chạy đầu dùng harness cũ vướng optional snapshot mẫu hết hạn; đã dùng report/workspace cô lập mới, giữ nguyên TTL guard. Lỗi escape trong test mới và fixture contamination trong flow audit được sửa trước kết quả cuối.

## Nghiệm thu tiếp trên Colab

1. Upload notebooks/movie-agent-colab.ipynb bản mới vào Colab, dùng session mới để tránh module cũ.
2. Chọn GPU, giữ USE_DEMO=True, chạy cell1–8. Cell5 phải qua tool/JSON/digest/GPU smoke.
3. Hỏi trong panel; nếu widget không hiển thị, dùng QUESTION và chạy lại cell8.
4. Chạy cell9 với RUN_AGENT_EVALUATION=True; xem riêng contract_tests/contract_skipped và agent_evaluation. NEEDS_REVIEW cần xem case nào sai, không phải bằng chứng model đạt chất lượng.
5. Cell10 đặt DOWNLOAD_REPORT=True để tải runtime-report.json, có thể tải checkpoint và dừng process sở hữu. Không gửi API key/log riêng tư.
6. Với catalog website, dùng exporter và snapshot mới còn hạn; Colab không kiểm publication/khả năng phát trực tiếp.

Chưa nghiệm thu trên Google Colab/GPU/Qwen/E5 thật, không cam kết không lỗi với mọi runtime/network/quota. Bộ3case demo không thay benchmark tiếng Việt, spoiler, recall/precision, latency hoặc kiểm tra production.

Nguồn kỹ thuật đối chiếu: [Ollama loaded models API](https://docs.ollama.com/api/ps), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [Qwen2.5:7b](https://ollama.com/library/qwen2.5:7b). Xem [runbook agent](../../apps/agent/README.md).
