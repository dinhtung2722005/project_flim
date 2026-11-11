# Services

Thư mục xử lý nghiệp vụ, transaction, quyền trên tài nguyên và truy cập database. Có 10 service.

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
