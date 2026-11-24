# Services

Thư mục xử lý nghiệp vụ, transaction, quyền trên tài nguyên và truy cập database. Có 21 service.

| File | Phạm vi |
| --- | --- |
| [auth.service.ts](auth.service.ts) | Đăng nhập, session, MFA, refresh và thu hồi xác thực |
| [accounts.service.ts](accounts.service.ts) | Đăng ký, xác minh email và khôi phục mật khẩu |
| [catalog.service.ts](catalog.service.ts) | Quản trị phim/mùa/tập và publication |
| [public-catalog.service.ts](public-catalog.service.ts) | Danh mục công khai, tìm/lọc và phim liên quan |
| [users.service.ts](users.service.ts) | Quản trị tài khoản và phân quyền |
| [resources.service.ts](resources.service.ts) | Thể loại, người tham gia, banner, cấu hình, audit và báo cáo |
| [media.service.ts](media.service.ts) | Upload intent, xác minh nguồn và retry xử lý video |
| [playback.service.ts](playback.service.ts) | Phiên phát HLS, gia hạn, quyền quản lý và telemetry |
| [library.service.ts](library.service.ts) | Yêu thích, lịch sử, tiến độ và báo lỗi |
| [notifications.service.ts](notifications.service.ts) | Outbox email, hộp thư local và adapter SMTP |

AppModule đăng ký các provider từ thư mục này. Controller ở [controllers](../controllers/README.md); DTO ở [dto](../dto/README.md). Cloudinary/database adapter dùng chung vẫn nằm trong packages.


AssistantService quản lý run/owner/lease/evidence; AssistantCatalogService đọc facts public/FAQ; AssistantDispatcherService xử lý outbox/queue/retention riêng. Tổng15serviceclasses. Không dùng media worker cho inference.


ReviewsService ở reviews.service.ts quản lý mapping, current permission/audit/ETag/lease/cache và public eligibility; adapter packages/reviews/src/tmdb.ts chỉ gọi fixed HTTPS TMDB. Tổng15serviceclasses.


RatingsService tại ratings.service.ts đọc eligibility và cache OMDb có giới hạn; provider tại packages/ratings/src/omdb.ts. Tổng hiện16serviceclasses. Không ghi database hoặc cấp quyền mới.

## MFA enrollment — 24/11/2026

MfaEnrollmentService là service thứ17: password reauthentication, own session-bound TOTP enrollment, encrypted factor, durable OTP attempts và one-time recovery hashes. ResourcesService thêm report triage current permission/ETag/audit; PublicCatalogService.site chỉ whitelist settings và public-playable scheduled banners. Không thêm bảng hoặc API credits trùng.


AssistantCatalogService có get_title_feedback qua RatingsService/ReviewsService. RatingsService.peek chỉ đọc cache để render/poll; ReviewsService.list internal evidence=true thêm fingerprint version/generation/cache timestamp, public list mặc định giữ contract cũ. Không thêm service class; tổng17. Quy tắc body/spoiler/nguồn: docs/api/assistant-feedback.md.


ViewerReviewsService là service18: ownership/checkViewer, public eligibility, PG quota10PUT/phút, advisory lock+ETag, aggregate ACTIVE accounts và cursor đầy đủ timestamp. Không gọi provider.

## View statistics — 25/11/2026

[view-stats.service.ts](view-stats.service.ts): public playable count và admin metrics7/30/90 UTC, current permissions, zero-filled daily/top10/lag và policy. API đọc aggregate, analytics worker riêng ghi thông qua durable telemetry. Tổng19services. Xem [runbook](../../../../docs/api/view-statistics.md).

Admin25/11: AdminAdvancedService xử lý moderation/audit/ETag/lock chung với owner, public VISIBLE filter tại ViewerReviewsService, catalog-health chỉ đọc. ViewStatsService hỗ trợ export audit trước trả CSV. Tổng20services; [runbook](../../../../docs/api/admin-advanced.md).


[catalog-batch.service.ts](catalog-batch.service.ts) quản lý preview/execute/history riêng; CatalogService nhận transaction tùy chọn để giữ thay đổi phim và receipt/audit/outbox nguyên tử. [Hợp đồng](../../../../docs/api/catalog-batches.md).
