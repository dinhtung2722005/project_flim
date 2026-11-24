# Kiểm tra notebook Colab — 14/11/2026

Phạm vi [runbook](../../apps/agent/README.md), [notebook](../../notebooks/movie-agent-colab.ipynb), tiếp nối [13/11](colab-agent-2026-11-13.md). Người dùng ưu tiên notebook, chưa có endpoint model; giữ website CATALOG.

## Thay đổi

- Tách dependency vào /content/pj-flim-agent/venv và tiến trình Python riêng. Kernel Colab không import/cài đè NumPy/FAISS/Torch; không còn guard RESTART_KERNEL_REQUIRED của notebook cũ.
- Bridge stdlib qua pipe, giữ model/index/client giữa cell; không HTTP server. Exception chỉ mã/vị trí, không raw exception/locals. Interrupt đóng đúng child, khôi phục bằng cell3→4–8.
- Pin pip25.3/Torch2.9.1+cpu cho E5, giữ direct pins khác; Qwen dùng Ollama/GPU độc lập. pip check/import probe, ghi exact versions/freeze, kiểm lại trước reuse.
- Cell8 trả tên/năm/thể loại/nguồn/điểm dễ đọc; Secrets đọc ở kernel, truyền qua pipe, không env/argv/checkpoint. Cell10 tải đúng checkpoint và runtime report.
- Installer Ollama kiểm/cài curl/zstd nếu thiếu, pin0.40.16, lỗi apt/download/script/start phân biệt và log riêng. Chưa xác nhận nguyên nhân ảnh lỗi cũ vì chưa có install.log.
- Notebook nhúng cả source/tests/cell source có SHA-256; không cần GitHub hoặc cài model Windows.

## Bằng chứng đã có

- **103 Python tests đạt trên Linux Docker**: 74PoC,17website,11bridge,1flow. Bridge chạy child thật, kiểm giữ state/Unicode, module isolation, safe errors, interrupt, PC guard và key không vào log.
- Flow thực thi source cell4–10 bằng model/encoder/runtime fixtures, dùng agent/FAISS/validator/checkpoint thật. Có kiểm smoke schema/tool, hỏi hai lần giữ client, report và ZIP. Không gọi model hoặc mạng thật.
- Static validator:10codecells,30bundlefiles/27Python sources, AST cả source nhúng trong session.execute, output sạch, hash/ID hợp lệ.
- Node exporter7tests, website160checks bao gồm25realCATALOG queue/Python/Chrome E2E; đây là các bộ khác nhau, không bằng chứng inference.
- Cài bộ dependency đầy đủ trên Linux riêng được ghi ở kết quả audit bổ sung bên dưới khi hoàn tất; không tải Qwen hoặc E5 weights.

## Chưa nghiệm thu

Không có công cụ truy cập phiên Chrome/Google Colab của người dùng. Chưa chạy notebook từ Colab sạch với GPU được cấp, Ollama installer thật trong Colab, pull Qwen, smoke tiếng Việt/tool/JSON thật, E5 embedding thật, chất lượng/latency, reset/checkpoint với model thật hoặc liveOMDb.

Notebook có guard và chẩn đoán, không cam kết không lỗi trên mọi runtime/network/quota/model. Để nghiệm thu, chạy cell1–9 trong Colab, kiểm câu hỏi và nguồn, tải runtime-report.json tại cell10; report không chứa prompt/key. Ghi rõ GPU/digest/dependency và kết quả, không thay nhãn fixtures bằng “model thật”.


## Audit đầy đủ Linux và notebook sinh ra — đã đạt

Linux Python3.12 cô lập: cài venv thật, pip check, imports NumPy2.2.6/FAISS1.16.0/SentenceTransformers6.3.0/Torch2.9.1+cpu/ChatOllama1.1.0/core1.8.0/Pydantic2.14.3/DDGS9.16.1 đều đạt. Không tải Qwen/E5 weights. Dependency freeze lưu riêng để đối chiếu.

Đã chạy chính notebook được sinh qua đủ10codecells,bao gồm bootstrap/checksum,venv reuse,pipe,catalog,agent,103contracttests,report vàcheckpoint. Audit tắtGPUguard và dùng Ollama/Qwen/E5fixtures; không phải Colab hoặc inference thật. Runtime report audit gắn FIXTURE_RUNTIME_NOT_LIVE_INFERENCE. Lần đầu fixture patch ảnh hưởng contracts; đã restore trước cell9, không nới/bỏ tests. Kết quả cuối passed=true/cellsExecuted1–10/checkpointExists=true.

Artifact private .local/agent-build/notebook-fixture-flow.json vàcolab-dependency-audit.json; container audit riêng đã được dọn. Các gate Colab/model/quality/nguồn live ở trên vẫn mở.
