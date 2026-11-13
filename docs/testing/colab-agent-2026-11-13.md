# Kiểm thử PoC agent Colab — 13/11/2026

Phạm vi: [notebook](../../notebooks/movie-agent-colab.ipynb), [Python agent/runbook](../../apps/agent/README.md), exporter public catalog. Không thay API/backend schema, không triển khai chatbot trên web.

## Kết quả

| Kiểm tra đã thực hiện | Kết quả | Giới hạn bằng chứng |
| --- | --- | --- |
| Python unittest trên Linux Python 3.12 qua Docker | 44/44 đạt | FAISS và LangChain/ChatOllama thật; encoder, LLM và HTTP dùng fixture/mock |
| Node public snapshot exporter | 7/7 đạt | Whitelist/private fields, canonical Unicode, paging/limit, origin/output guard, failure không ghi dở |
| Notebook static validation | 10 code cell và 8 file Python nhúng parse được | Chưa thực thi các cell trong Colab |
| Embedded bundle/source consistency | SHA-256 và source đồng nhất, outputs rỗng | Checksum không thay chữ ký/nguồn đáng tin cậy |
| Xuất dữ liệu từ API public local đang chạy | 1 title, Python nhập/schema/hash hợp lệ | Chỉ phản ánh catalog ở thời điểm xuất; chưa xác nhận eligibility live từ Colab |
| git diff --check, kiểm tài liệu/link và scan secret của phần agent | Đạt theo lượt hoàn tất | Không phải audit toàn repository hoặc full-stack regression |

Contract tests kiểm TTL sau khi nạp, snapshot hỏng/thiếu quyền/extra fields/ID lẫn demo, lọc trước top-K, vector/checkpoint tamper, TMDB scope/mapping/null votes/429/budget, URL allowlist và discovery tắt mặc định, tool loop/ID/evidence/repair/budget, không shell, ZIP traversal, restore lỗi không ghi đè snapshot tốt, và guard PID reuse.

Dependencies test thực: langchain-core 1.8.0, langchain-ollama 1.1.0, pydantic 2.14.3, httpx 0.28.1, numpy 2.2.6, faiss-cpu 1.16.0. Test container cô lập, không network khi chạy lại; source read-only, không thay Application Control Windows hoặc container hạ tầng đang chạy. Báo cáo local riêng tại `.local/agent-build/python-test-result.json`.

## Chưa thực hiện, không được coi là đạt

- Chưa chạy Google Colab hoặc dùng GPU/quota tài khoản người dùng.
- Chưa tải/chạy Qwen hoặc multilingual E5; chưa đo VRAM, cold/warm latency, retrieval quality hay tiếng Việt.
- Chưa cài/kiểm toàn bộ stack Sentence-Transformers/Torch/Colab; direct pins chưa phải transitive lock.
- Chưa gọi TMDB/DDGS thật; không dùng credential hoặc nhập review.
- Chưa E2E chatbot website, auth/ownership/cancel/queue/load; AG03/06/09/11 và các phần còn lại vẫn theo plan.
- Không chạy lại bộ API/worker/frontend trước đó: đây là thay đổi PoC tách biệt. Các số kiểm tra ở báo cáo tính năng khác không phải bằng chứng của lượt này.

## Nghiệm thu trong Colab

1. Cell 2 ghi loại runtime/GPU khả dụng; cell 4 ghi Ollama version và model digest/size.
2. Cell 5 phải trả nonempty text, đúng tool call và structured JSON. Người dùng đọc câu tiếng Việt; notebook không tự chứng nhận chất lượng ngôn ngữ.
3. Cell 7 tải E5 revision đã pin, tạo vectors384 và FAISS; thử câu hỏi rõ tên/thể loại/loại/năm.
4. Cell 8 phải xuất cards/evidence cùng nhãn demo hoặc snapshot, không bịa điểm; thử EMPTY và câu hỏi mơ hồ.
5. Cell 9 chạy contract tests trong runtime thật và tạo `runtime-report.json`. Live TMDB/web không tự được đánh dấu đạt.
6. Cell 10 tải checkpoint, dừng process thuộc notebook; thử lại phiên mới bằng ZIP còn hạn. Không gia hạn TTL bằng chỉnh file.
7. Trước khi dùng catalog thật, xác nhận quyền cloud/embedding; trước tích hợp website, kiểm lại publication/ownership tại backend.

Không đánh dấu ticket AG hoàn tất chỉ vì notebook đã được tạo hoặc contract tests đạt.
