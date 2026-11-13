# Kiểm thử toàn luồng frontend–backend

Ngày: **13/11/2026**, Asia/Saigon. Dự án: E:\pj-Flim. Kết quả cuối: **ĐẠT** trong phạm vi local được mô tả dưới đây.

## Kết quả

| Phần kiểm tra | Kết quả cuối | Phạm vi/bằng chứng |
| --- | --- | --- |
| Build API và web | Đạt | TypeScript API/web và Vite; npm run build:all |
| Bộ tích hợp đầy đủ | **1.227 kiểm tra đạt**, khoảng 30 giây | PostgreSQL tạm, RabbitMQ thật, HTTP API thật và Chrome |
| Frontend | **76 kiểm tra đạt** | Tạo/sửa phim, upload boundary, publication, đăng ký, thư viện, RBAC, tìm kiếm, menu, player, đóng phiên/đăng xuất |
| API người xem | 200 kiểm tra đạt | Catalog, xác thực, phiên phát, tiến trình, thư viện và báo lỗi |
| Global exception | 509 kiểm tra đạt | Hợp đồng lỗi và validation |
| MFA/chính sách local | 42 kiểm tra đạt | Cả chính sách mặc định và local |
| Swagger | 40 kiểm tra đạt | Docs/spec và các đường dẫn liên quan |
| RabbitMQ/worker | Được bật và đạt trong bộ đầy đủ | Broker thật; xử lý HLS/backup/webhook tại ranh giới provider giả lập |
| Video Cloudinary thật | **17 kiểm tra đạt** | Chrome giải mã hình, 720p/360p/Auto, tua, tốc độ, xem tiếp, offline/reconnect, đổi tập, completion/history |
| Media/backup đang có | **2 asset đạt** | Mỗi asset có 5 mức HLS, job thành công, biên nhận webhook đã xác minh và đọc lại toàn bộ backup khớp SHA-256 với nguồn local |
| Dọn phiên phát | Đạt | Không còn phiên phát hoạt động của tài khoản nghiệm thu sau khi hoàn tất |
| HTTP cuối lượt | 200 | Trang chủ, Swagger, OpenAPI JSON và catalog API |

1.227 là tổng số kiểm tra/assertion theo runner hiện tại; các nhóm con ở bảng nằm trong tổng này, không cộng thêm lần nữa. 17 bước Cloudinary thật và kiểm 2 asset là các bài độc lập.

Bài video ghi nhận 110 phản hồi CDN, 3 HLS worker và không có pageerror. Tập ngắn 45 giây hoàn tất với khoảng 44,817 giây coverage. Startup một lần khoảng 1,219 giây được đo tới currentTime > 1 giây; đây không phải TTFP hoặc p95.

## Lỗi phát hiện và đã sửa

### Đăng xuất trước khi phiên phát đóng

Khi rời player rồi đăng xuất ngay, tác vụ lưu progress/events/đóng phiên còn chạy trong nền. Token bị thu hồi trước DELETE playback-session, để lại phiên hoạt động và có thể gây PLAYBACK_CONCURRENCY_LIMIT khi đăng nhập lại.

Đã thêm registry dọn player tại apps/web/src/lib/playback-cleanup.ts. PlaybackTracker.dispose dùng chung một Promise cho các lời gọi đồng thời và giữ tác vụ trong registry tới khi hoàn tất. Logout dừng player và chờ tác vụ dọn phiên trước khi thu hồi xác thực, tối đa 5 giây để không giữ đăng xuất vô thời hạn khi mất mạng.

Hồi quy cố tình trì hoãn telemetry, rời player rồi đăng xuất: xác minh response đóng phiên 204 xảy ra trước request thu hồi auth, đồng thời closed_at đã được lưu trong PostgreSQL. Bài video thật đã xem tiếp sau đăng nhập và kết thúc với 0 phiên phát hoạt động của user thử.

Các phiên bị bỏ lại bởi lần test lỗi được đóng qua API bằng chính tài khoản nghiệm thu; không sửa trạng thái database hoặc đóng phiên của tài khoản khác.

### Script RabbitMQ dừng khi Docker chưa chạy

Windows PowerShell xử lý stderr của docker info thành lỗi kết thúc do ErrorActionPreference=Stop, khiến nhánh tự mở Docker Desktop không chạy.

Đã giới hạn chế độ Continue trong hàm probe, lấy exit code và khôi phục preference. Đã thử từ trạng thái Docker chưa chạy: Desktop khởi động, đúng container dự án được mở và rabbitmq-diagnostics ping đạt. Parser PowerShell cũng đạt.

### Bài live gọi play quá sớm

Sau khi mở lại player có truy vấn resume bất đồng bộ, video đã hiện trên DOM nhưng nguồn chưa gắn xong. play bị AbortError khi loadSource tiếp tục chạy.

Helper nghiệm thu hiện chờ metadata, chỉ thử lại AbortError tối đa 3 lần và giữ timeout hữu hạn. Lỗi decode/network khác vẫn làm bài test thất bại. Sau sửa và sau khi khắc phục lỗi đăng xuất, cả 17 bước đạt.

## Chạy lại

Chạy trong E:\pj-Flim. PostgreSQL, RabbitMQ và API local phải sẵn sàng. Cấp PJ_FLIM_TEST_ADMIN_PASSWORD trong môi trường tiến trình bằng mật khẩu PostgreSQL local; không ghi vào source.

```powershell
npm.cmd run build:all
$env:PJ_FLIM_TEST_WEB_ONLY = 'false'
$env:PJ_FLIM_TEST_WEB = 'true'
$env:PJ_FLIM_TEST_WORKER = 'true'
npm.cmd run test:integration

# Dùng đúng phim/tài khoản nghiệm thu riêng đã có:
$env:PJ_FLIM_LIVE_MEDIA = 'true'
npm.cmd run streaming:smoke -- playback
```

Runner tích hợp tạo database pj_flim_test_<random> và topology broker thử riêng rồi dọn. Không chạy fixture trên pj_flim. Playback live dùng state riêng ở .local/web/live-streaming; có thể đặt PJ_FLIM_LIVE_FRESH_VIEWER=true khi cần coverage sạch cho một lượt mới.

Bằng chứng riêng tư, không commit:

- .local/api/integration-result.json
- .local/web/full-build.log và full-integration.log
- .local/web/live-streaming/playback-result.json và full-live-playback.log
- .local/web/full-media-pipeline-result.json
- .local/web/full-final-state.json

## Giới hạn của lượt kiểm tra

- Không upload hoặc chuyển mã video Cloudinary mới trong lượt này. Upload/webhook mới được kiểm bằng provider giả lập trong bộ tích hợp; Cloudinary/CDN/backup thật kiểm trên hai asset đã có.
- Bài Chrome headless dùng muted và cờ cho phép autoplay để đo giải mã/playback; chưa xác minh âm thanh hoặc chính sách autoplay trên mọi trình duyệt.
- Chưa test tải đồng thời, soak test, Safari/iPhone/Android thật, kho S3 độc lập/restore hoặc giới hạn phiên 30 phút/6 giờ.
- Logout chờ dọn phiên tối đa 5 giây; khi mất mạng vẫn đăng xuất và việc dọn cuối là best effort. Giới hạn CDN signed URL không tự hết hạn vẫn giữ.
- Vite có cảnh báo chunk hls.js lớn hơn 500 kB; build thành công, chunk được lazy-load.
- Các mục ST01–ST06 giữ trạng thái theo plan; lượt kiểm tra này không tự đánh dấu production-ready.
