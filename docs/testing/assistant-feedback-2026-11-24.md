# Kiểm thử chatbot điểm/review — 24/11/2026

## Phạm vi và kết quả

- Build API/frontend TypeScript/Vite đạt; cảnh báo hls.js chunk >500KB có sẵn.
- Assistant integration **272 kiểm tra đạt**, gồm **46 kiểm tra feedback** và **35 E2E** (hai nhóm này đã nằm trong272, không cộng lần nữa).
- PostgreSQL tạm tạo/migrate/seed/drop; RabbitMQ quorum/Node consumer/Python CATALOG service thật; Chrome headless desktop1440 và mobile390. OMDb là HTTP fixture qua adapter thật; TMDB review được seed trong database tạm, không gọi nguồn live.
- Python **134 tests**, 0failures/0errors, 2skipped (widget dependency tùy chọn); fixtures model/providers. 24 website-agent tests gồm7case mới routing/grounding feedback. Không inference Qwen/E5 thật.
- Notebook build10codecells/36bundlefiles/33Python sources; AST/hash/source synchronization và outputs sạch đạt. Không chạy Colab thật.

Bằng chứng riêng tư: .local/assistant/tests/backend-result.json, e2e-result.json; .local/assistant/feedback/backend.log, python-result.json, python.log, notebook-result.json; screenshots .local/assistant/tests/e2e/desktop.png và mobile.png.

## Những trường hợp đã kiểm

- Cấu hình nguồn thiếu: không gọi provider, score=null và trạng thái rõ; đọc phim vẫn hoạt động.
- IMDb/Metascore đúng thang10/100, điểm0 giữ đúng, N/A khác0; provider outage không lộ lỗi/key.
- Tool/step evidence không chứa body review; ngay cả avoidSpoilers=false chỉ renderer server đọc body.
- Mặc định không có excerpt; tắt tránh spoiler cho đoạn trích<=600ký tự/cờ truncated, tối đa3review và hasMore.
- Poll/render không gọi provider mới; hết cache điểm trả context-changed.
- Đổi nội dung review, đổi generation dù payload nhìn giống, cache review hết hạn và phim unpublished đều bị kiểm lại.
- Không gắn FEEDBACK của phimA vào TITLE phimB; filter conflict/draft/ẩn bị chặn; kế thừa suite ownership/session/capability/lease/cancel/budget hiện có.
- Chrome thực thi chuỗi browser→API→queue→Python→tool→validated answer: hiện8.6/10 và82/100; review0/10 khác không chấm; body/author chứa HTML chỉ hiện text, không chèn img/svg/script. Link nguồn dùng rel an toàn.
- Regression cũ kiểm duplicate broker event không tăng generation, cancellation, logout và account switch vẫn đạt.

## Giới hạn

Không xem fixtures là điểm/review thật hoặc model quality. OMDB_API_KEY/TMDB_API_READ_TOKEN local chưa có giá trị; cần cấu hình và đồng bộ mapping/cache để nghiệm thu nguồn thật. Không xử lý tóm tắt/dịch/embedding review, không chuyển body sang Colab/LLM. Không test SMTP/CDN/load hay nghiệm thu các release gates khác trong lượt này.

Migration feedback-v1 đã được áp dụng bằng entry point db:assistant;54bảng/grants giữ nguyên. OpenAPI110operations/84paths/56admin,90errorcodes; internal tool vẫn ngoài Swagger public.


## Hồi quy và runtime local cuối lượt

Hồi quy toàn dự án2624checks đạt, gồm275frontend/941security/40Swagger/341viewer,89440ms, PostgreSQL tạm/Chrome; đây là suite riêng với272assistant, không cộng các nhóm con. Worker media không nằm trong lượt hồi quy này. Bằng chứng .local/api/integration-result.json và .local/reviews/regression.log.

Đã áp dụng db:assistant, restart API/Python CATALOG/Node assistant consumer bằng script sở hữu. Smoke2026-11-24T16:22:13Z: /assistant,/health,/api/openapi.json200; capabilities anonymous401; Python health200; ratings/reviews public200 NOT_CONFIGURED. Kiểm boolean cho thấy hai key nguồn vẫn trống; không có credential được log. .local/assistant/feedback/local-smoke.json. git diff --check đạt (cảnh báo CRLF có sẵn).
