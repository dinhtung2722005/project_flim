# Agent phim pj-Flim

Cập nhật 25/11/2026, notebook v0.4. [Nghiệm thu Colab và kiểm report](../../docs/testing/colab-acceptance-2026-11-25.md). Theo lựa chọn mới nhất, **hoàn thiện notebook Google Colab để thử Qwen**; website giữ chế độ **CATALOG** vì chưa có endpoint model. Hai luồng độc lập:

| Luồng | Đã có | Chưa xác nhận |
| --- | --- | --- |
| Notebook Colab | Qwen2.5:7b/Ollama, LangChain, E5/FAISS, snapshot, OMDb tùy chọn, checkpoint | GPU Colab, inference Qwen/E5, chất lượng và nguồn ngoài thật |
| Website /assistant | Catalog/FAQ, tập public, điểm OMDb/cache review TMDB, nguồn, run API, RabbitMQ/Python CATALOG, UI | Qwen thật, semantic index live, nguồn ngoài live, cá nhân hóa private context |

Website chạy local tại http://localhost:3000/assistant sau đăng nhập; xem [runbook backend](../../docs/api/assistant.md). Không cài/tải Qwen trên máy Windows hoặc dùng Colab làm API website thường trực.

## Chạy notebook

1. Mở [movie-agent-colab.ipynb](../../notebooks/movie-agent-colab.ipynb) bằng **Google Colab → File → Upload notebook**. Notebook nhúng source và SHA-256, không cần clone hoặc chờ push GitHub.
2. Chọn **Runtime → Change runtime type → GPU**. GPU/quota phụ thuộc phiên Colab.
3. Giữ **USE_DEMO=True** ở cell1 cho lần chạy đầu. Demo là bốn phim giả, không có link xem hoặc điểm thật.
4. Chạy lần lượt cell1–9. Cell3 cài môi trường riêng, cell4 tải binary Ollama/Qwen nhiều GB trong VM Google, cell7 tải E5.
5. Cell5 phải qua kiểm tra văn bản, tool calling và JSON schema trước khi thử hỏi.
6. Cell8 có **ô chat → Hỏi agent → Xóa hiển thị**, chọn CATALOG/HYBRID. Tối đa10 lượt hiển thị trong RAM; mỗi câu hỏi độc lập, model/search/client cache giữ trong tiến trình riêng. Nếu không thấy widget, đặt SHOW_CHAT_PANEL=False ở cell1 và chạy lại; sửa QUESTION rồi chạy cell8 vẫn dùng được.
7. Cell9 chạy contract tests và tạo **runtime-report.json** schema2. RUN_AGENT_EVALUATION=True thử thêm3câu demo qua model/encoder hiện tại; có thể mất vài phút. PASSED chỉ cho bộ demo nhỏ, NEEDS_REVIEW cần xem lại; catalog thật báo SKIPPED/DEMO_ONLY. Cell10 có lựa chọn tải report/checkpoint và dừng Ollama.

Ví dụ ở cell8:

~~~python
QUESTION = "Tìm phim khoa học viễn tưởng nhẹ nhàng."
MODE = "CATALOG"
~~~

Kết quả hiển thị tên/năm/thể loại/nguồn/điểm có căn cứ, cảnh báo và số tool calls. Không sinh review tự do, điểm số hoặc khả năng phát phim từ trí nhớ model. Các trạng thái/model smoke đều phải được đánh giá thực tế; notebook chưa được tác giả chạy nghiệm thu trên Colab của bạn.

## Môi trường riêng để tránh lỗi NumPy

Cell3 tạo **/content/pj-flim-agent/venv**, không cài đè package của kernel Colab. Thư viện ML chỉ được import trong tiến trình Python mới qua **NotebookSession**. Kết nối bằng stdin/stdout pipe, không mở cổng mạng.

- Python được hỗ trợ: Linux 3.11–3.13. Bootstrap từ chối Windows.
- Direct dependencies pin trong requirements; pip25.3, Torch2.9.1+cpu lấy từ kho CPU chính thức.
- Torch CPU dành cho E5. Qwen dùng Ollama và GPU riêng, không phụ thuộc CUDA của Torch.
- Kiểm pip check và import thật NumPy/FAISS/Torch/SentenceTransformer/ChatOllama/DDGS trước khi tiếp tục.
- Ghi phiên bản thực và dependency-freeze.txt trong workspace; đây là bản ghi môi trường, chưa phải lockfile đầy đủ được nghiệm thu trên mọi phiên Colab.
- Không còn yêu cầu restart do NumPy của kernel khác phiên bản vừa cài. Nếu đang mở notebook cũ, mở bản mới và chạy từ đầu.
- Bấm Interrupt làm đóng tiến trình agent. Chạy lại cell3 rồi cell4–8 để khôi phục; Ollama đúng process/version có thể tái sử dụng.
- Thay cấu hình ở cell1: chạy lại cell1–8. Thay riêng câu hỏi/mapping: sửa biến tương ứng và chạy cell8.

Bridge thực thi source notebook do người vận hành kiểm soát, không phải sandbox chạy code không tin cậy. Model chỉ dùng các tool được phép; không có tool thực thi Python/shell.

## Dùng dữ liệu thật từ website

API local phải đang chạy. Trên PowerShell của PC:

~~~powershell
Set-Location -LiteralPath 'E:\pj-Flim'
npm.cmd run agent:export-catalog
~~~

Exporter dùng public API loopback, không login/đọc DB. Kết quả **.local/agent/catalog.snapshot.json** không commit. Đặt USE_DEMO=False tại cell1, chạy các cell theo thứ tự, chọn đúng một JSON ở cell6.

Snapshot tối đa 1.000 phim/5MB/hạn24giờ; chỉ metadata công khai tối thiểu, không credential/lịch sử xem/media URL. Hash kiểm tính toàn vẹn, không xác thực người xuất. Chỉ upload dữ liệu bạn được phép đưa vào Google Colab và embedding; trường rights là khai báo, không tự chứng minh giấy phép.

Notebook đọc snapshot, không truy cập ngược PC và không xác nhận eligibility hiện tại. Luôn có **live_eligibility_checked=false**. Muốn dùng kết quả để phát phim phải kiểm lại qua backend.

## Cơ chế agent

~~~text
Câu hỏi → Qwen/LangChain → tool schema/allowlist
                         → lọc catalog → keyword + E5/FAISS + RRF
                         → evidence của lượt → Qwen chọn IDs
                         → validator → cards từ facts
~~~

E5 multilingual-small, query:/passage:, 384 chiều, normalize L2; FAISS exact inner product trên tập đã lọc, RRF k60. Revision embedding được pin trong model-versions.json. Chưa có benchmark recall/ngữ nghĩa thực.

Mỗi lượt tối đa4 lần model,6 tool calls,1 lần sửa schema; output600token, context8192 (có thể thử4096 khi OOM). HTTP model timeout90s, deadline120s kiểm giữa bước, không bảo đảm hard cancellation của request đang chạy. Không lưu chain-of-thought.

Nguồn/ID/evidence phải khớp phim trong snapshot và lượt hiện tại. Câu trả lời dựng từ facts, không chấp nhận văn bản tự do của model làm bằng chứng.

## OMDb cho IMDb/Metascore

Demo không gọi nguồn ngoài. Với catalog thật:

1. Thêm **OMDB_API_KEY** vào Colab Secrets và cấp quyền notebook.
2. Giữ ENABLE_OMDB=True, USE_DEMO=False; MODE=HYBRID ở cell8.
3. Đối chiếu IMDb ID theo tên gốc/năm/movie hoặc series rồi điền OMDB_MAPPINGS tại cell1:

~~~python
OMDB_MAPPINGS = {
    "UUID-phim-trong-snapshot": {"imdb_id": "tt1375666", "verified": True}
}
~~~

Ví dụ chỉ minh họa cú pháp; thay UUID/ID bằng mapping đã kiểm. Sau khi có client ở cell8, tìm candidate trong một cell riêng:

~~~python
session.execute(
    "_omdb_client.reset(); display(_omdb_client.search(catalog, TITLE_UUID))",
    {"TITLE_UUID": "UUID-phim-trong-snapshot"},
)
~~~

Candidate chưa được xác minh tự động. Cập nhật mapping trong kernel rồi chạy lại cell8. Hỏi:

~~~python
QUESTION = "Cho tôi điểm IMDb và Metascore của phim TÊN_PHIM."
MODE = "HYBRID"
~~~

IMDb thang10, Metascore critic thang100; N/A→null, không đồng nghĩa Metacritic User Score. Có intermediary/source/ID/time/scale/votes, không lấy toàn văn review. Chưa dùng key thật để nghiệm thu.

Cache RAM1giờ/LRU200,≤2HTTP calls/lượt,≤900/client. Client giữ qua lần hỏi, không lưu key/cache vào checkpoint. Đây không phải bộ đếm quota tài khoản/ngày; client/runtime mới vẫn dùng cùng quota provider. HTTP HTTPS cố định, timeout8s, không redirect, payload≤256KB, che key trong lỗi/log thông thường.

[OMDb docs](https://www.omdbapi.com/) và [điều kiện sử dụng](https://www.omdbapi.com/legal.htm) vẫn áp dụng; adapter không tự cấp quyền phân phối thương mại/embedding/review processing.

TMDB là tùy chọn ENABLE_TMDB/Secret TMDB_API_READ_TOKEN và TMDB_MAPPINGS verified; điểm TMDB không đổi thành IMDb. ENABLE_WEB_DISCOVERY mặc định false; DDGS chỉ tìm link HTTPS theo phim public trong allowlist, không fetch/copy/tóm tắt bài hoặc lưu snippet. Chưa có WEB/AUTO, review summary hay importer.

## Checkpoint và chẩn đoán

Cell10 tạo **pj-flim-agent-checkpoint.zip**: snapshot, vectors.npy, index/model manifest và runtime-report khi có. Không key/prompt/model weights. DOWNLOAD_CHECKPOINT=True để tải ZIP, DOWNLOAD_REPORT=True để tải report. STOP_OLLAMA=True chỉ dừng process notebook sở hữu và đóng tiến trình agent.

Sau reset: chạy từ đầu, USE_DEMO=False, nạp ZIP ở cell6. Snapshot phải còn hạn và cùng model digest/revision/hash/shape; không pickle/FAISS binary tùy ý. Không tự mount Drive.

| Lỗi | Xử lý |
| --- | --- |
| GPU_NOT_ASSIGNED | Chọn GPU rồi reconnect. CPU thử nghiệm REQUIRE_GPU=False có thể rất chậm với7B. |
| DEPENDENCY_INSTALL_OR_IMPORT_FAILED / DEPENDENCY_TIMEOUT | Xem riêng dependency-install.log; kiểm network/disk, chạy lại cell3. Không gửi toàn bộ env/key. |
| AGENT_PROCESS_STOPPED / AGENT_PROCESS_INTERRUPTED | Chạy lại cell3 rồi4–8, không bỏ qua state bị mất. |
| NOTEBOOK_CELL_FAILED | Có vị trí file/dòng an toàn; kiểm thứ tự cell, báo mã/vị trí, không có traceback chứa secret. |
| OLLAMA_* | Cell4 phân biệt lỗi apt/download/script/start/version; log riêng install-dependencies.log, install.log, ollama.log. |
| MODEL_DOWNLOAD_FAILED | Kiểm network/disk, chạy lại cell4. |
| MODEL_TOOL_SMOKE_FAILED / MODEL_JSON_SMOKE_FAILED | Dừng nghiệm thu, kiểm version/context/digest; không xóa smoke để coi thành công. |
| MODEL_UNAVAILABLE / OOM | Thử context4096, chạy lại smoke; Colab không bảo đảm tài nguyên. |
| SNAPSHOT_EXPIRED / SNAPSHOT_HASH_INVALID / INDEX_* | Xuất snapshot mới hoặc dựng lại index đúng revision, không sửa ngày/hash cho qua. |
| OMDB_NOT_CONFIGURED / EXTERNAL_MAPPING_NOT_VERIFIED | Thêm Secret/mapping đã kiểm hoặc dùng CATALOG. |
| AGENT_*_BUDGET_EXCEEDED / ANSWER_EVIDENCE_INVALID | Thử câu hỏi rõ hơn; lưu mã/report để đánh giá, không coi là câu trả lời đúng. |

Không public Ollama/tunnel hoặc dùng Colab free làm RabbitMQ worker thường trực. Nguồn chính thức: [Colab FAQ](https://research.google.com/colaboratory/faq.html), [Ollama Linux](https://docs.ollama.com/linux), [PyTorch CPU wheels](https://download.pytorch.org/whl/cpu/torch/).

## Phát triển và bằng chứng

~~~powershell
npm.cmd run agent:notebook
npm.cmd run test:agent:export
~~~

Sau thay module/cell/test/requirements phải build lại notebook. Validator kiểm AST cả code chạy trong subprocess, hash bundle, ID cell duy nhất và output/execution count sạch.

Bằng chứng: [Colab audit14/11](../../docs/testing/colab-agent-2026-11-14.md), [website audit](../../docs/testing/assistant-2026-11-14.md). 103 Python tests đạt trên Linux với child process thật, FAISS thật, model/encoder/provider fixtures. Flow cell4–10 được kiểm với fixtures, không phải inference Qwen/E5 hoặc Colab thật.

Trong Linux test environment đã cài requirements-test.txt:

~~~bash
PYTHONPATH=apps/agent python -m unittest discover -s apps/agent/tests -p 'test_*.py'
python apps/agent/tools/validate_notebook.py notebooks/movie-agent-colab.ipynb
~~~

Source: colab_bridge.py (venv/pipe), runtime.py (Ollama), catalog.py, retrieval.py, agent.py, omdb.py, checkpoint.py. website_agent.py/website_server.py phục vụ luồng website riêng. Xem [plan agent](../../docs/plans/movie-ai-agent-plan.md); chưa đánh dấu ticket AG hoàn tất chỉ vì build/tests đạt.


## Review discovery — 23/11/2026

Cell8 hiện URL trong review_refs với da_doc_bai=false; giữ URL ngay cả khi finish_answer chỉ trích dẫn catalog. DDGSException đúng thông báo No results found. trả rỗng; lỗi mạng/quota vẫn báo WEB_SEARCH_UNAVAILABLE. 107Python tests đạt offline với model/providers fixtures; notebook đã rebuild. Chưa đọc bài trên web hoặc chạy Qwen/Colab thật. Website có luồng TMDB review riêng tại [runbook](../../docs/api/reviews.md), chưa đưa nội dung này vào chatbot CATALOG.


## Notebook v0.4 — 24/11/2026

- Giao diện chat tùy chọn dùng ipywidgets đã có trong kernel; không pip install thư viện ML/UI vào kernel. Module notebook_ui chỉ import stdlib cho tới khi mở panel. Không có ipywidgets thì dùng QUESTION/chạy lại cell8. Nội dung/nguồn luôn escape trước khi render HTML; link discovery chỉ là văn bản, chưa đọc bài.
- Mỗi câu độc lập, không dùng lịch sử hiển thị làm memory gửi model. Nút xóa chỉ xóa10lượt hiển thị trong RAM. Không ghi transcript vào report/checkpoint do agent tạo; việc Colab lưu output của notebook phụ thuộc cài đặt Colab.
- Cell5 kiểm /api/ps sau inference: đúng digest và size_vram>0 khi REQUIRE_GPU=True; chỉ chứng minh có offload GPU, không khẳng định toàn bộ model nằm trên GPU. Lỗi không giữ MODEL_SMOKE thành công cũ. API tham khảo: [Ollama running models](https://docs.ollama.com/api/ps).
- Cell9 có3case: đúng tên, phim bộ/năm và yêu cầu bịa phim/điểm. Report ghi caseId/expectedIds/selectedIds/evidence/timing/code, không câu hỏi hoặc raw model prose. Bộ nhỏ không thay đánh giá tiếng Việt/recall/latency trên catalog thực. Contract tests và agent_evaluation là hai kết quả riêng; contract pass không tự biến quality NEEDS_REVIEW thành đạt.
- Notebook generator nhúng36files/33Python sources,10codecell; static validator kiểm source hiện hành khớp bundle, hash và output rỗng. Đổi source phải build lại. Phiên đang mở notebook cũ cần restart session và mở đúng bản mới trước khi chạy từ cell1.

Lượt kiểm mới:127Python tests đạt, không skip (có FAISS/ChatOllama và ipywidgets8.1.9 thật; Qwen/encoder/provider là fixtures). Generated notebook chạy cả10cell, hỏi lặp lại qua callback, tạo widget/report/checkpoint và báo NEEDS_REVIEW trung thực cho model fixture không đạt case. Không tải Qwen/E5 lên PC, không gọi nguồn ngoài, chưa chạy trên GPU Google Colab thật. [Báo cáo](../../docs/testing/colab-agent-2026-11-24.md).
