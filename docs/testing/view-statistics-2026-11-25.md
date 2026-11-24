# Kiểm thử thống kê lượt xem — 25/11/2026

Thuật toán đạt **32 kiểm tra**. Integration đạt **150 kiểm tra**, gồm **11 kiểm tra Chrome**, trên PostgreSQL tạm có58bảng và queue quorum RabbitMQ riêng. Test dùng login API/worker thật bị giới hạn; metadata/media fixture, không gọi Cloudinary hoặc nguồn đánh giá thật. Báo cáo: .local/view-stats/integration-result.json.

Đã kiểm ngưỡng video ngắn/dài; mở hoặc tải lại trang không tăng lượt; pause, buffering, seek, thiếu sự kiện, sự kiện đến chậm, đoạn xem lặp và thời gian sự kiện bị lùi. Kiểm khóa HMAC ổn định, từ chối sai khóa; user và guest; nhiều phiên cùng ngày khử trùng, ngày UTC khác có thể thêm lượt; PREVIEW và phiên trước policy bị loại; token sai bị chặn.

Luồng thật: HTTP collector → outbox → publisher confirm → RabbitMQ consumer → transaction PostgreSQL. Đã thử lỗi publish, lease cũ, gửi lại message và hòa giải lô ACCEPTED đã publish. Tất cả giữ kết quả không cộng trùng. Reconciliation giới hạn100lô/phút, không chạy lại toàn bộ ở mỗi publication.

API đã kiểm401/403,400 cho UUID,422 cho DTO, draft404, bigint chính xác, báo cáo đủ7/30/90ngày, ranh giới7ngày UTC và tách definition1. API không UPDATE counter hoặc SELECT private keys; worker prune daily hashes hơn90ngày mà aggregate giữ nguyên.

Chrome đã kiểm thẻ phim, detail, watch, reload, số lớn, admin đổi7/30/90ngày, bảng ngày, viewport390px không tràn ngang và không pageerror. Bundle hls vẫn có cảnh báo kích thước trên500kB hiện có.

Hồi quy chung đạt **2.640 kiểm tra** trong80.371ms:275frontend,957security,40Swagger,341viewer và64pagination là các nhóm con, không cộng lại vào tổng. Suite chung không bao gồm media worker; RabbitMQ analytics được kiểm riêng ở150kiểm tra phía trên. Sau chỉnh sửa cuối về clock rollback, lịch hòa giải và mobile, đã chạy lại32kiểm tra thuật toán,150kiểm tra tính năng cùng build frontend/backend thành công.

Migration local đã áp dụng và chạy lại an toàn; Prisma introspect/generate58models. Database smoke đạt53assertion rollback và8expected permission denials. OpenAPI export116operation/88path/57admin, giữ90errorcodes.

Đã khởi động lại API và analytics bằng script quản lý process của dự án. Smoke cuối trên localhost:3000: public200, admin anonymous401, workerInitialized=true,58bảng, pending0, views0 và không lỗi JavaScript Chrome. Không tạo lượt giả hoặc thay account/catalog/video thật. Evidence .local/view-stats/local-smoke.json và local-detail.png; báo cáo hồi quy .local/api/integration-result.json.

Chưa nghiệm thu CDN/chất lượng video, Qwen/Colab, tải p95, HA, chống bot hoặc raw/facts/outbox retention đầy đủ. ST04/REC02 vẫn IN_PROGRESS.
