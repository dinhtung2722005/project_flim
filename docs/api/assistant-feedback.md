# Chatbot đọc điểm và review — 24/11/2026

Chatbot website dùng engine CATALOG; Qwen/Ollama vẫn là nhánh tùy chọn chưa nghiệm thu inference thật. Mở /assistant sau đăng nhập.

## Cách dùng

- Hỏi “Điểm IMDb và review của phim [tên phim]?” hoặc chọn **Điểm và review** trên thẻ phim trong cuộc trò chuyện.
- Sau khi chọn phim, hỏi “Điểm Metacritic phim này?” hoặc “Đọc review phim này”.
- Nếu trùng tên hoặc chưa chọn phim, chatbot yêu cầu chọn; không tự gán điểm cho một kết quả mơ hồ.
- Mặc định chỉ hiện tác giả, điểm review, link và trạng thái cache. Để đọc đoạn trích, bỏ chọn **Tránh tiết lộ nội dung phim** rồi hỏi lại.
- Review TMDB là ý kiến người dùng; điểm IMDb khán giả và Metacritic Metascore giới phê bình đến từ OMDb. Không gọi review TMDB là bài phê bình IMDb/Metacritic.

## Luồng dữ liệu và grounding

React → run API → RabbitMQ/Node worker → Python website agent → get_title_feedback({titleId}) → NestJS RatingsService/ReviewsService → TITLE + FEEDBACK evidence → lựa chọn ID → backend tái kiểm → answer/feedback UI.

Tool mới chỉ đọc một UUID phim public đủ điều kiện; không nhận URL, API key, SQL, role hoặc nội dung model để hiển thị. Dùng DTO AssistantTitleDto hiện có và allowlist chung. Selection vẫn giữ cấu trúc cũ; FEEDBACK được chọn bằng evidenceIds và phải thuộc titleIds có TITLE evidence. Ngân sách vẫn 6tool calls/lượt.

CATALOG tìm phim trước; tra tối đa hai ứng viên để phát hiện mơ hồ, chỉ lấy feedback khi có đúng một kết quả. Khi đã có contextTitleId, lấy trực tiếp đúng phim đó và kiểm bộ lọc ở backend. OLLAMA có cùng schema/tool và validator; không chuyển tiếp văn bản tự do do model sinh.

- OMDb tái dùng lookup khớp tên/năm/loại và cache/quota hiện có. Chỉ tool lookup được gọi provider; render/poll dùng RatingsService.peek, không khởi tạo lookup mới.
- Review chỉ đọc tối đa3 bản ghi đầu của cache TMDB đã mapping/verified. Chatbot không đồng bộ/scrape nguồn hoặc thay mapping.
- Evidence giữ provider, trạng thái, thang điểm, link, fetchedAt, expiry, revision/generation, cache timestamp nguyên độ chính xác và hash nội dung review.
- Body review không vào step evidence, prompt, embeddings hoặc Colab. Renderer phía server chỉ lấy đoạn trích tối đa600ký tự khi avoidSpoilers=false; không tóm tắt/dịch/suy diễn bằng AI.
- Re-render kiểm publication, filter, title/evidence version, cache expiry, generation và hash. Đổi/thu hồi review hoặc hết cache làm kết quả cũ NEEDS_INPUT/AGENT_CONTEXT_CHANGED; không trả lại đoạn trích đã lưu trong run.
- Điểm0 khác null; NOT_CONFIGURED/UNAVAILABLE/STALE không được diễn giải thành điểm0 hoặc “không ai đánh giá”.
- UI render text qua React, không HTML/Markdown tùy ý. Link ngoài chỉ HTTPS đúng đường dẫn IMDb/TMDB cho phép và rel=noopener noreferrer; nguồn nội bộ giữ đường dẫn phim.
- Thời gian 7ngày/owner-session/quota/idempotency/cancel/lease và quyền catalog giữ nguyên. Không thêm quyền đọc tài khoản/lịch sử/admin hoặc signed media URLs.

## Cài đặt

Không tạo key thay người dùng. Cần OMDB_API_KEY và TMDB_API_READ_TOKEN server-side trong .env.api.local; không dùng key TMDB cho OMDb. Review còn cần admin liên kết đúng phim và đồng bộ cache theo [runbook review](reviews.md). Nếu thiếu nguồn, chatbot vẫn trả phim với trạng thái chưa có dữ liệu.

Migration additive docs/design/sql/movie-assistant-feedback-v1.sql chỉ mở CHECK allowlist tool; giữ54bảng và grants. Cài mới/chạy lại cùng entry point:

~~~powershell
Set-Location -LiteralPath 'E:\pj-Flim'
$env:PJ_FLIM_APPLY_ASSISTANT='true'
npm.cmd run db:assistant
Remove-Item Env:PJ_FLIM_APPLY_ASSISTANT
npm.cmd run build:all
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/Start-AssistantLocal.ps1 -SkipBuild
~~~

Không dùng Prisma db push. Không coi cache OMDb trong memory là Redis/distributed store. Nếu API restart hoặc cache hết hạn, cần hỏi lại để tra nguồn mới.

## Kiểm thử

Xem [báo cáo kiểm thử](../testing/assistant-feedback-2026-11-24.md). Dữ liệu điểm/review trong tests là fixtures; chưa phải xác minh OMDb/TMDB/Qwen thật. Notebook Colab được rebuild vì bundle chứa source website agent, nhưng nhánh snapshot Colab không tự có quyền đọc database/private reviews của website.
