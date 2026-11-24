# Kiểm thử chatbot website — 14/11/2026

Phạm vi: [runbook](../api/assistant.md), engine **CATALOG**, catalog/FAQ live. Chưa có endpoint Ollama; theo lựa chọn người dùng, giữ chế độ tra cứu website và thử Qwen trong notebook Colab riêng.

| Bộ kiểm tra | Kết quả | Phạm vi |
| --- | --- | --- |
| Build API/web và web typecheck | Đạt | Route lazy, DTO/controller/service/worker, Python tách riêng |
| Backend/worker hồi quy | 2.309 kiểm tra | PostgreSQL tạm, workerIncluded=true; không gộp với browser riêng |
| Frontend hồi quy | 227 kiểm tra | Chrome, DB tạm; Help có nguồn FAQ |
| Assistant | 160 kiểm tra | 135 backend +25 E2E queue/Python/Chrome |
| Python hiện hành | 103 tests | 74 PoC +17 website +11 bridge +1 notebook flow; model/provider/encoder fixtures |
| Node exporter | 7 tests | Snapshot allowlist/hash/TTL |
| Database smoke local | 39 SQL assertions +8 permission denials | Fixture rollback; 52 bảng, 5role/18permission/44links |
| Runtime local | 3 run SUCCEEDED | FAQ chất lượng, catalog và2tập công khai; logout204/health200 |

Assistant E2E dùng RabbitMQ quorum queue thật với prefix/container riêng, Python CATALOG thật, Node worker và Chrome ở390/1440px. Kiểm search→tập→FAQ, nguồn, cancel khi create response đến trễ và logout/đổi tài khoản. Không gọi Qwen hoặc đánh giá chất lượng suy luận. Checkbox tránh spoiler bổ sung sau E2E, đã qua build; backend projection được kiểm trong suite.

Backend kiểm auth/owner kể cả SUPER_ADMIN, FK phiên/parent, DTO nghiêm, rate limit/concurrency/idempotency, outbox, private grants, lease/heartbeat/fencing/revocation, tool budget, evidence giả/cũ, cancel/timeout/retention và OpenAPI. Test dùng database pj_flim_test_<random>, không dùng phim thật làm fixture.

Đã áp dụng migration additive assistant_runs/assistant_run_steps, Prisma introspect/generate, OpenAPI97operation/73path với49admin, registry81code. Timer/publisher assistant tách media; message chỉ có version/run/event ID.

Local runtime đã bật API, Node assistant worker và Docker Python8010 loopback, engineCATALOG; không tải model trên PC. Ba lượt smoke là các câu hỏi demo thông thường, lưu theo retention7ngày. Credential/key/JWT và log/request nội bộ chỉ ở .local, không nằm trong tài liệu.

Giới hạn: chưa model Qwen/E5 thật, semantic index live, OMDb website, private personalization, load/HA, SSE, migration rollback production hoặc nghiệm thu production. Website vẫn dùng keyword baseline; notebook E5/FAISS không đồng nghĩa đã đồng bộ index website.
