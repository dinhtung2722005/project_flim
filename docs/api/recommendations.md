# API gợi ý cá nhân hóa

Đã triển khai content-v1 ngày 13/11/2026 tại E:/pj-Flim. UI: http://localhost:3000/for-you. Swagger: http://localhost:3000/api/docs. [Thuật toán chi tiết](../design/recommendation-algorithms.md), [kiểm thử](../testing/recommendations-2026-11-13.md), [plan](../plans/movie-streaming-platform-plan.md).

## Endpoint đã có

Base /api/v1, Bearer access token. Tất cả owner lấy từ phiên đăng nhập.

| Method | Path | Đầu vào / kết quả |
| --- | --- | --- |
| GET | /me/recommendations | surface=home, limit 1–30 (mặc định 12), cursor tùy chọn; title card, reason, page, meta |
| GET | /me/recommendation-preferences | enabled mặc định false, hideCompleted mặc định true, version chuỗi, updatedAt; header ETag |
| PATCH | /me/recommendation-preferences | Cần If-Match; body chứa đầy đủ hai boolean enabled, hideCompleted; trả phiên bản và ETag mới |
| PUT | /me/recommendation-feedback/:titleId | kind=NOT_INTERESTED; idempotent, opt-in và phim đủ điều kiện, 204 |
| DELETE | /me/recommendation-feedback/:titleId | Hoàn tác phản hồi của chính mình; idempotent, 204; không cần phim còn public |

Null/field lạ/userId/surface không hỗ trợ bị từ chối. Không có API reset, nhận impression, click attribution hoặc route admin đọc lịch sử gợi ý của người khác.

Response feed minh họa, ID/timestamp là placeholder:

~~~json
{
  "data": [{
    "id": "TITLE_UUID",
    "localizedTitle": "Tên phim",
    "recommendation": {
      "reason": "SIMILAR_CONTENT",
      "text": "Gần với nội dung phim bạn lưu hoặc đã xem"
    }
  }],
  "page": {"limit": 12, "hasMore": false, "nextCursor": null},
  "meta": {
    "modelVersion": "content-v1",
    "personalized": true,
    "enabled": true,
    "candidateTruncated": false,
    "expiresAt": "2026-11-13T12:00:00.000Z"
  }
}
~~~

Các field catalog card theo schema PublicTitle; ví dụ đã lược field để dễ đọc. personalized=false nếu opt-out hoặc profile không có feature đủ dùng. reason thứ hai là RECENTLY_PUBLISHED; không diễn giải thành “phổ biến nhất”. Không trả vector, tên phim nguồn, owner hay signed URL media trong data.

## Tùy chọn và phản hồi

PATCH dùng optimistic concurrency, không tự retry với ETag mới khi 412. Đổi preference tăng version và xóa snapshot; tắt còn xóa feedback. Watchlist/lịch sử vẫn được giữ. Bật lại sẽ đọc dữ liệu thư viện hiện tại, không có reset watermark trong bản này.

hideCompleted áp dụng khi enabled=true; “hoàn thành” là đã xem hết các tập hiện đang phát được theo progress đúng active asset/version. Khi tắt hideCompleted có thể gợi ý xem lại phim đã hoàn thành. Các seed chưa hoàn thành được tránh lặp trong feed khám phá.

UI có lý do chung, Không quan tâm, hoàn tác phản hồi gần nhất, toggle và tải thêm. Muốn khôi phục feedback cũ có thể gọi DELETE với title ID; UI quản lý danh sách toàn bộ feedback chưa có. Opt-out xóa toàn bộ feedback có chủ đích.

## Cursor, lỗi và giới hạn

| Tình huống | HTTP/code |
| --- | --- |
| Thiếu/sai token, phiên bị thu hồi | 401 theo registry auth hiện hành |
| DTO không hợp lệ | 422 VALIDATION_FAILED |
| Cursor HMAC/owner/surface sai | 400 REQUEST_INVALID_CURSOR |
| Snapshot quá 10 phút, bị đẩy khỏi 5 bản lưu, preference version thay đổi | 409 RECOMMENDATION_FEED_EXPIRED |
| PUT feedback khi tắt | 409 RESOURCE_CONFLICT |
| Phim không public/phát được khi PUT | 404 RESOURCE_NOT_FOUND |
| PATCH thiếu If-Match / ETag cũ | 428 PRECONDITION_REQUIRED / 412 RESOURCE_VERSION_MISMATCH |
| Vượt ngân sách feed/feedback hoặc 1.000 feedback | 429 RATE_LIMITED |

Dùng application/problem+json và requestId toàn cục; không thêm handler lỗi riêng. Feed/preferences có Cache-Control: private, no-store. Cursor có thể trả trang rỗng mà hasMore=true khi nội dung trong lát đã bị gỡ/ẩn; tiếp tục nextCursor hoặc làm mới. Không tự sắp xếp lại các trang ở client.

Giới hạn: 1.000 candidate mới xuất bản, 100 saved + 100 qualified title, top 200 rerank → tối đa 100 kết quả, 5 snapshot/user, TTL 10 phút. Ngân sách bền: feed mới 30/phút/user; feedback mutation 60/phút/user. Không mô tả quota này là Redis.

## Database và triển khai

Ba bảng bổ sung: recommendation_preferences, recommendation_feedback, recommendation_snapshots; tổng hiện tại **50 bảng**. [Migration SQL](../design/sql/movie-recommendations-v1.sql) chạy sau baseline schema/seed/grants, bằng migration owner; cấp quyền ngay trong cùng migration. Không dùng db push hoặc Prisma Migrate.

Từ E:/pj-Flim sau khi đã có .env.database.local và .env.api.local:

~~~powershell
$env:PJ_FLIM_APPLY_RECOMMENDATIONS='true'
npm.cmd run db:recommendations
Remove-Item Env:PJ_FLIM_APPLY_RECOMMENDATIONS
npm.cmd run db:generate
npm.cmd run build:all
~~~

CLI từ chối database hệ thống và trạng thái chỉ có một phần ba bảng. Chạy lại khi đủ ba bảng chỉ kiểm tra schema/grants, không xóa dữ liệu hoặc bật consent. Nếu SQL đã áp dụng cần sửa, tạo migration tiếp theo, không sửa trạng thái production bằng db push. Bảng mới có FK RESTRICT; workflow xóa tài khoản tương lai phải xóa recommendation snapshot/feedback/preferences trước khi xóa vật lý users/titles.

Khởi động lại API bằng quy trình hiện hành. Timer API dọn 500 snapshot hết hạn/phút, hỗ trợ nhiều instance bằng SKIP LOCKED. Theo dõi recommendation.retention_failed và backlog expired; khi catalog/tải lớn cần nâng bộ tạo feature/retrieval/retention theo plan. Không cấu hình RabbitMQ analytics mới hoặc gửi lịch sử lên Colab trong bản này.

Rollback ứng dụng bằng bản trước vẫn đọc được 47 bảng cũ; giữ ba bảng thêm để bảo toàn lựa chọn người dùng. Không tự DROP bảng. Nếu khôi phục lại code mới, consent cũ vẫn còn; migration không tự thay auth/MFA/quyền staff hoặc dữ liệu phát phim.

## Kiểm tra

npm.cmd run test:recommendations chạy fixture thuật toán nhỏ. Suite test:integration có checks HTTP/private state/SQL/grants trên DB tạm; frontend-only có bài kiểm tra Chrome riêng. Xem cách cấp biến thử nghiệm an toàn trong [runbook kiểm thử hiện hành](../../README.md#kiểm-thử); không chạy fixture trên pj_flim thật.
