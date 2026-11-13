# Kiểm thử gợi ý content-v1 — 13/11/2026

Phạm vi: thuật toán, API, migration/grants, giao diện và runtime local tại E:/pj-Flim. [Runbook](../api/recommendations.md), [thuật toán](../design/recommendation-algorithms.md). Đây là nghiệm thu chức năng của bản đầu; chưa phải benchmark chất lượng gợi ý hoặc sẵn sàng production.

## Kết quả cuối

| Nhóm | Kết quả | Bằng chứng riêng tư local |
| --- | --- | --- |
| Build API/web và typecheck | Đạt; Vite còn cảnh báo chunk hls.js trên 500 kB đã có trước | Lệnh build:all, typecheck/web:typecheck |
| Fixture thuật toán | 23 checks đạt | test:recommendations |
| Backend + worker | 2.309 checks đạt; workerIncluded=true, frontendChecks=0; 10.536 ms trên lượt này | .local/recommendations/backend-result.json |
| Gợi ý trong backend suite | 141 checks, gồm 23 thuật toán, nằm trong tổng 2.309 | backend-worker.log; tests/recommendations.integration.ts |
| Frontend-only | 227 checks đạt; 24 thuộc trang gợi ý; 67.642 ms trên lượt này | frontend-result.json; browser-result.json |
| PostgreSQL local | Migration 47→50 bảng, lần chạy lại applied=false; Prisma introspect/generate đạt | CLI db:recommendations |
| Smoke database local | 36 SQL assertions rollback, 8 permission denials của API/worker đạt | database/Test-Database.ps1 |
| OpenAPI/runtime | 92 operation/70 path; schema RecommendationFeed; anonymous GET feed trả 401 | runtime-result.json |
| Chrome runtime | /for-you chuyển login đúng; menu mới hiện ở 390 px, 0 pageerror | runtime-result.json |

Số check của từng nhóm là tập con, không cộng 141/23 lần nữa vào tổng backend; tương tự 24 browser checks thuộc tổng 227. Duration là thời gian một lượt trên máy phát triển, không phải p95 hoặc cam kết latency.

## Thuật toán

Kiểm cosine tính tay (vector 3–4–5), vector rỗng, metadata thiếu, tiếng Việt bỏ dấu, ngưỡng coverage cho clip/phim dài, half-life 30 ngày, thứ tự phim cùng nội dung, không tự lặp seed, seed không có feature, ID trùng và NaN weight. Fixture MMR có hai phim cùng thể loại và một phim khác loại chứng minh giảm lặp; không dùng kết quả này để khẳng định tăng tương tác.

## API và dữ liệu riêng tư

Kiểm mặc định opt-out dù đã có watchlist; bật lại mới cá nhân hóa. DTO chặn null/field lạ/userId/enum sai/limit quá mức. Thiếu If-Match trả 428, version cũ trả 412; hai mutation cùng ETag chỉ một thành công.

Cursor sai HMAC hoặc tài khoản khác trả 400. Snapshot hết hạn và preference đổi trả 409. Thay ngày xuất bản giữa các trang không làm trùng hoặc đổi thứ tự snapshot. Feedback hoặc gỡ publication của title ở trang sau tạo trang ngắn/rỗng, không lấp lại và không lộ title đã ẩn. Kiểm 5 snapshot/user, TTL do DB áp dụng và hàm pruneExpired dùng cùng logic với timer.

NOT_INTERESTED idempotent, DELETE chỉ tác động owner; title hidden không được tạo feedback. Opt-out xóa feedback/snapshot và vẫn giữ watchlist. Worker/auditor không có SELECT trên ba bảng riêng tư.

Dùng playback/progress HTTP thật trên DB tạm: tua đến cuối + ended không đủ làm seed; accepted coverage 20/100 giây tạo sở thích; coverage đủ nhưng thiếu ended event chưa đánh dấu complete. Sau event proof, completed_at được giữ làm tín hiệu tích cực; hideCompleted loại phim đó, tắt cờ cho phép xem lại. Phim không còn active asset/phát được không ảnh hưởng profile.

## Frontend Chrome

Đăng nhập từ /for-you, mặc định tắt, bật không có seed dùng fallback, Không quan tâm/Hoàn tác nối API và DB thật. Kiểm version bị sửa ở tab khác không bị ghi đè; người dùng tải lại rồi mới lưu. Ở 1440 và 390 px, không có tràn ngang hoặc pageerror. Screenshot tại .local/recommendations/screenshots/for-you-mobile.png đã được xem lại.

Giữ phản hồi feed tại tầng mạng, đăng xuất rồi trả phản hồi muộn và đăng nhập tài khoản khác: dữ liệu riêng tư/undo của tài khoản trước không xuất hiện. Client hủy request và xóa trạng thái; không dùng feed từ storage.

## Môi trường và những lần sửa fixture

Integration tự tạo/drop database pj_flim_test_<random>; fixture READY/HLS/backup chỉ ở DB tạm. Không seed phim giả, sửa progress hoặc tự bật cá nhân hóa trên database pj_flim thật. RabbitMQ test dùng topology riêng theo suite hiện hành; không purge queue ứng dụng.

Chạy backend/worker và frontend-only riêng vì suite cũ có giả định fixture people/banner rỗng. Các lần thất bại ban đầu không được tính đạt: fixture mới dùng sai enum HIDDEN và xóa active asset khi episode vẫn PUBLISHED, đều bị CHECK đúng; đã sửa fixture theo ràng buộc thật, không nới constraint. Test completion thiếu ended proof cũng đã được bổ sung đúng luồng API. Bài browser chuyển từ check() sang click() rồi đợi trạng thái đã lưu vì checkbox được điều khiển bởi response server. Lượt smoke ngay sau restart gặp startup race; lượt kiểm sau đạt health/schema/401/browser. Không che lỗi bằng giả READY hoặc bỏ kiểm tra ownership.

## Chưa kiểm

Chưa benchmark full-catalog/timeline, đo Recall/NDCG hoặc A/B/uplift, thử nhiều phiên cá nhân hóa ở quy mô lớn, memory/CPU/p95 dưới tải và backlog retention. Chưa reset có watermark, analytics queue/projector, exposure/click proof, offline feature artifact, collaborative model, Redis hoặc nhiều profile. Không có inference Qwen/Colab/LLM trong luồng này. REC01/03/04/05 vẫn IN_PROGRESS, các ticket REC còn lại NOT_STARTED.
