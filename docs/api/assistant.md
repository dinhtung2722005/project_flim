# Chatbot tra cứu pj-Flim

Triển khai 14/11/2026 tại E:\pj-Flim. UI: http://localhost:3000/assistant (đăng nhập). Có hai engine: CATALOG chạy tra cứu xác định trên dữ liệu website; OLLAMA dùng Qwen qua LangChain tool calling. Inference Qwen thật chưa được nghiệm thu; không gọi CATALOG là LLM đã chạy.

## Phạm vi đang có

- Tìm phim từ metadata public, tên/alias/thể loại/người tham gia; bộ lọc loại/năm/quốc gia/thể loại.
- Đọc thông tin phim và tối đa 20 tập đang xem được; hỗ trợ ngữ cảnh từ trang chi tiết và câu hỏi tiếp theo.
- FAQ được biên tập tại packages/assistant/src/help.ts và hiển thị ở /help với anchor nguồn.
- Cards, nguồn, trạng thái chờ, hủy, lỗi và giao diện desktop/mobile. Không render HTML do model trả.
- Backend giữ owner, session, quota, idempotency, lease/generation, evidence và kiểm lại dữ liệu khi trả kết quả.
- Không đọc tài khoản khác/admin/audit/lịch sử riêng tư, không tạo URL phát. Đọc điểm IMDb/Metascore và cache review TMDB qua get_title_feedback; [quy tắc spoiler/nguồn](assistant-feedback.md). PoC snapshot notebook vẫn độc lập.

CATALOG dùng keyword trên tối đa 1.000 phim public sau lọc, có cờ candidateTruncated ở tool. Đây là baseline có giới hạn; chưa semantic E5/FAISS live index hoặc benchmark relevance. Quyền xem vẫn do API/player hiện có quyết định.

## Kiến trúc

React → POST run → transaction PostgreSQL (run + outbox) → publisher confirm → RabbitMQ queue riêng → Node assistant worker → Python private service → tool gateway NestJS → evidence → backend kiểm lại nguồn → GET run → UI.

Python chỉ nhận câu hỏi, bộ lọc/context public và capability gắn run/generation/lease. Không nhận DB credential, JWT browser hoặc worker master key. Container chỉ mount source agent và dependency, không mount toàn bộ thư mục project/env database.

Message broker chỉ có v/runId/eventId. Queue mặc định pjflim.assistant.jobs và DLQ riêng, quorum/durable, prefetch 1, delivery limit 8, max-length 1.000. Không dùng queue media để chạy inference. Publisher chỉ đánh dấu outbox published sau confirm; consumer ACK sau kết quả đã ghi bền hoặc nhận trạng thái terminal/stale phù hợp.

## REST API

Prefix /api/v1; Bearer/session hiện hành, owner lấy từ phiên. Cache-Control: private, no-store.

| Method | Path | Hành vi |
| --- | --- | --- |
| GET | /assistant/capabilities | enabled/engine/scope/retention, cần đăng nhập |
| POST | /assistant/runs | 202 + Location; Idempotency-Key bắt buộc |
| GET | /assistant/runs | Lịch sử của owner, cursor ký |
| GET | /assistant/runs/:id | Status/result của owner; kiểm lại nguồn hiện tại |
| DELETE | /assistant/runs/:id | 204, hủy idempotent; không phải xóa lịch sử |

Body tạo run:

~~~json
{
  "message": "Tìm phim hành động",
  "filters": {"kind": "MOVIE", "country": "VN"},
  "limit": 5,
  "avoidSpoilers": true
}
~~~

contextTitleId và parentRunId là UUID tùy chọn. Backend kiểm phim public và parent của cùng owner, SUCCEEDED, dưới 24 giờ; tối đa 5 lượt ngữ cảnh. Browser không gửi role/userId/model/key/SQL/history roles. Field lạ, null sai kiểu hoặc filter không hợp lệ bị chặn.

Idempotency-Key: 8–128 ký tự chữ/số/dấu gạch; retry cùng ý định giữ key và body. Body khác cùng key trả409. Tạo mới tối đa10/phút/owner và2run đang chờ/chạy. Limit1–5, message tối đa2.000ký tự.

Status run: QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED, TIMED_OUT. GET run xử lý lỗi vẫn200 với errorCode; không coi request tạo còn mở để trả504 sau nhiều giây. Kết quả có kind FOUND/EMPTY/HELP/NEEDS_INPUT, answer, cards, episodes, feedback, sources và warnings.

## Tool gateway và grounding

Các endpoint internal được loại khỏi OpenAPI public. Claim dùng worker secret riêng; tools/heartbeat/results/failures dùng capability HMAC ngắn hạn gắn run/generation/lease. Biết run UUID hoặc có Bearer user không đủ quyền gọi gateway.

Tool allowlist: search_catalog, get_title_details, get_published_episodes, search_help, get_title_feedback. Args có schema; không có fetch_url/raw SQL/shell/admin. Run tối đa6tool calls được ghi bền; retry cùng callId/body trả cùng evidence, không cộng bước; callId tái dùng cho args khác bị từ chối.

LLM chỉ chọn entity IDs/evidence IDs. Final validator chặn ID ngoài evidence/cross-entity, engine mismatch, số lượng quá limit hoặc nội dung vừa thay đổi. Backend dựng câu từ facts, không chuyển tiếp prose model. GET kết quả tiếp tục kiểm lại publication/metadata/FAQ/cache điểm/review; dữ liệu cũ trả NEEDS_INPUT + AGENT_CONTEXT_CHANGED, không nhắc lại tên phim đã ẩn trong result.

Bộ lọc người dùng được giữ ở search và trước render; avoidSpoilers=true không đưa synopsis vào facts trả model/cards. Episodes trả tên tập public và duration có thật; chưa tổng hợp toàn bộ series lớn.

## Thời gian, phục hồi và riêng tư

- Run chờ tối đa5phút; sau claim deadline tối đa120giây.
- Lease30giây, Node heartbeat10giây, generation tăng khi claim lại.
- Worker cũ/đã hủy không thể ghi kết quả. Hết lease được đối soát và phát event lại, tối đa3attempt.
- Giữ run/steps tối đa7ngày; parent context tối đa24giờ. Prune theo lô100; không quảng bá cancel là purge.
- Website giữ tối đa10turn hiển thị trong phiên trang và reset private state khi logout/đổi user. API list lưu lịch sử theo retention; UI chưa có trình quản lý/xóa lịch sử server.
- Dừng khi create response đến chậm được xử lý bằng bỏ kết quả cũ và gửi cancel khi đã nhận run ID. Mất kết nối trước khi nhận ID vẫn là best effort; run còn có deadline/session checks.
- Model HTTP timeout90giây; hủy được kiểm ở boundary/gateway và fencing. Không cam kết hard-kill inference đang chạy trong Ollama.
- Log mặc định chỉ method/path/requestId/status hoặc event; không log prompt, capability, raw model prose hay chain-of-thought.

## Cài mới và chạy local

Giữ .env.database.local/.env.api.local/.env.worker.local sẵn có. SQL additive không thay baseline47bảng và không dùng Prisma db push.

~~~powershell
Set-Location -LiteralPath 'E:\pj-Flim'
$env:PJ_FLIM_APPLY_ASSISTANT='true'
npm.cmd run db:assistant
Remove-Item Env:PJ_FLIM_APPLY_ASSISTANT
npm.cmd run db:introspect
npm.cmd run db:generate
npm.cmd run assistant:configure
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-AssistantLocal.ps1
~~~

Migration assistant-v1 tạo assistant_runs và assistant_run_steps; feedback-v1 mở allowlist tool cho cài mới/lần chạy lại. Hiện tổng54bảng sau reviews. API cóCRUD, media worker/auditor không có quyền trên câu hỏi/evidence riêng tư. Python và Node assistant consumer dùng gateway, không có kết nối DB riêng.

Start script dùng Docker Python service ở 127.0.0.1:8010, RabbitMQ local, API3000 và Node assistant worker. Chỉ thay container/process có label/entry point của assistant/project. Dependency Python được cài trong Linux container nếu cache chưa có; không cài Ollama/model lên Windows.

Các file private:

| Tệp | Vai trò |
| --- | --- |
| .env.assistant.local | Feature flag, hai secret riêng, engine/origin/queue/model |
| .local/assistant/agent.env | Chỉ biến cần cho Python container, không DB/master worker secret |
| .local/assistant/worker-process.json | Process record của Node consumer |
| .local/assistant/worker.stdout.log; worker.stderr.log | Log riêng của consumer |
| .local/assistant/pre-migration-schema.json | Snapshot tên bảng trước additive migration |

api:configure không tạo secret assistant; chạy assistant:configure để đồng bộ agent.env khi đổi cấu hình. Script giữ secret đã có; không tự xoay khóa.

## Bật Qwen/Ollama khi có host riêng

Giữ Colab cho thử nghiệm notebook. Website cần Ollama endpoint riêng ổn định; không public Ollama hoặc biến Colab free thành API/consumer thường trực.

1. Trên host được chọn, chuẩn bị Ollama/Qwen2.5:7b và nghiệm thu tool/JSON smoke theo notebook/runbook model.
2. Trong .env.assistant.local, đặt ASSISTANT_ENGINE=OLLAMA và ASSISTANT_OLLAMA_ORIGIN tới endpoint mà Python container truy cập được.
3. Chạy assistant:configure để ghi agent.env, build/start lại dịch vụ.
4. Health Python kiểm model tag tồn tại; đây chưa phải smoke tool/JSON/quality. Chạy test inference thực, ghi digest/host/VRAM/timing trước khi đánh dấu đạt.
5. Nếu model lỗi, run trả AGENT_MODEL_UNAVAILABLE; không tự đổi sang CATALOG rồi nói Qwen đã trả lời. Có thể chủ động cấu hình lại CATALOG để giữ tra cứu cơ bản.

Runtime không có lệnh pull model hoặc installer Ollama tự động. LangChain bind_tools/tool_choice phụ thuộc adapter/model; không dựa vào tool_choice để ép model kết thúc. Tham khảo [ChatOllama bind_tools](https://reference.langchain.com/python/langchain-ollama/chat_models/ChatOllama/bind_tools), [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling).

## Mã lỗi mới

| Code | HTTP khi lỗi request/gateway |
| --- | --- |
| AGENT_DISABLED | 503 |
| AGENT_CONTEXT_CHANGED | 409 |
| AGENT_TOOL_BUDGET_EXCEEDED | 429 |
| AGENT_ANSWER_INVALID | 422 |
| AGENT_MODEL_UNAVAILABLE | 503 |
| AGENT_TIMEOUT | 504 |
| AGENT_WORKER_UNAVAILABLE | 503 |

Sau202, lỗi xử lý được ghi vào trạng thái run; GET vẫn200. Lỗi input/auth/ownership/quota dùng Problem Details hiện hành. Tổng registry81code.

## Kiểm thử

~~~powershell
# Secret PostgreSQL test được truyền qua môi trường tiến trình, không ghi source.
npm.cmd run test:assistant
$env:PJ_FLIM_TEST_ASSISTANT_E2E='true'
npm.cmd run test:assistant
Remove-Item Env:PJ_FLIM_TEST_ASSISTANT_E2E
~~~

Suite tự tạo/drop đúng database pj_flim_test_<random>, container/queue thử có prefix riêng. Không lấy phim thật/DB pj_flim làm fixture. E2E cần Docker, RabbitMQ, Chrome, build mới và Linux dependency cache theo script. Báo cáo [nghiệm thu 14/11](../testing/assistant-2026-11-14.md).

Chưa có model inference thật, semantic index live, OMDb website, cá nhân hóa private context, SSE, load/HA/retention quy mô lớn hoặc nghiệm thu production. Đây là chatbot catalog/FAQ chạy được với CATALOG và adapter Qwen có code/tests fixtures.
