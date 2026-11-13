# API người xem, admin và Swagger

Cập nhật 11/11/2026, Asia/Saigon. Đã có **49 endpoint admin**, tổng **92 operation trên 70 path OpenAPI**, chạy NestJS + Prisma 7 với PostgreSQL bằng login pj_flim_api.

[Hướng dẫn cấu hình Cloudinary và API upload](cloudinary-upload.md): 3 endpoint mới, direct/chunked upload, xác minh owner/episode/file, audit và outbox HLS.

[RabbitMQ worker và backup](media-worker.md) đã chạy thật: webhook có chữ ký, HLS và source backup được kiểm tra trước READY; API retry có media.retry và idempotency. Bộ kiểm thử worker cần bật PJ_FLIM_TEST_WORKER=true.

[API người xem](viewer-api.md) đã triển khai thêm 27 operation: catalog công khai, phiên phát HLS, đăng ký/email xác minh/reset, yêu thích/lịch sử/xem tiếp/tiến độ và báo lỗi. Email development lưu riêng trong .local/mail. URL CDN hiện là signed URL không tự hết hạn; production mặc định chặn cấp URL nếu chưa chấp nhận rõ giới hạn này.

[Thuật toán stream chi tiết](../design/streaming-algorithms.md): đường media HLS/CDN, worker/backup, session/idempotency, renewal/progress/telemetry và player cơ bản hiện có cùng các phần cần nghiệm thu tiếp.

Giao diện người xem/admin đã nối API: [hướng dẫn frontend](../frontend.md). Build cả web/API rồi mở / hoặc /admin trên cổng 3000; Swagger vẫn mở trực tiếp.

[Gợi ý cá nhân hóa content-v1](recommendations.md): 5 operation private mới, mặc định opt-out, TF-IDF/cosine/MMR, preferences ETag, feedback/hoàn tác và snapshot cursor. [Thuật toán](../design/recommendation-algorithms.md).

## Mở Swagger

- UI mở trực tiếp, không cần đăng nhập: http://127.0.0.1:3000/api/docs
- OpenAPI JSON local: http://127.0.0.1:3000/api/openapi.json
- Health: http://127.0.0.1:3000/api/v1/health

Theo yêu cầu ngày 11/11/2026, đã bỏ form/cookie/CSRF đăng nhập Swagger và endpoint docs-session. GET /api/docs-login chuyển 302 sang /api/docs để bookmark cũ vẫn dùng được; POST vào form cũ trả 404. Không có cơ chế tự cấp hoặc chèn JWT vào Try it out.

Để thử API cần quyền: gọi POST /api/v1/auth/sessions, lấy accessToken rồi nhập vào Authorize của Swagger. API admin vẫn kiểm Bearer, session và permission; đọc tài liệu không cấp quyền gọi API. Tài khoản local admin@pj-flim.local có thông tin ở [file bootstrap](../../.local/api/bootstrap-admin.json), được Git bỏ qua.

AUTH_MFA_REQUIRED=false hiện áp dụng cho đăng nhập API local, chỉ cần email/mật khẩu. Cờ mặc định true; production luôn yêu cầu MFA. NODE_ENV=production hoặc SWAGGER_ENABLED=false không mount UI/spec/assets hay redirect đăng nhập cũ. Không cần thay cookie trình duyệt để mở Swagger.

## Phạm vi đã code

| Nhóm            | Nội dung                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------- |
| Auth            | Password login, session server, MFA/recovery, step-up, refresh rotation và logout lặp an toàn |
| RBAC            | Quyền hiện hành từ DB, MFA cho staff, revoke session khi đổi quyền/status                     |
| Phim            | Danh sách/tìm/lọc admin; tạo/đọc/sửa phim, aliases, genres và credits                         |
| Mùa/tập         | Tạo/đọc/sửa; phim lẻ tự có season kỹ thuật số 0 và episode 1                                  |
| Publication     | Xuất bản/gỡ phim/tập, kiểm asset/attempt/output HLS và backup verified                        |
| Lookup          | Tạo/đọc/sửa thể loại, diễn viên/đạo diễn                                                      |
| Trang chủ       | Tạo/đọc/sửa banner và lịch hiển thị; cấu hình site theo allowlist                             |
| Tài khoản       | Đọc user/role/permission; thay ACTIVE/SUSPENDED và roles                                      |
| Audit           | Ghi cùng transaction mutation; đọc/lọc/phân trang; không có API sửa/xóa log                   |
| Reports/metrics | Đọc báo lỗi theo scope, redaction AUDITOR, thống kê tổng quan                                 |
| Media           | Đọc metadata asset/attempt/operation; signed upload intent và xác minh nguồn Cloudinary       |
| Hợp đồng        | DTO validation, Problem Details, registry 74 code, ETag/If-Match, cursor HMAC, request ID     |

Khi policy yêu cầu MFA, thay role cần target staff đã có MFA verified. ADMIN chỉ khóa/mở tài khoản thuần MEMBER; SUPER_ADMIN tác động staff sau step-up khi policy MFA được bật và không được làm mất SUPER_ADMIN usable cuối cùng. Role/status mutation tăng authVersion và thu hồi session trong transaction có roster lock.

Title/season/episode/banner dùng version bản ghi. Genre/person chưa có cột version nên ETag là hash snapshot và invalidation event dùng audit sequence. Các thay đổi catalog ghi audit/outbox cùng transaction; consumer/Redis invalidation thuộc giai đoạn worker.

## Chạy tại E:\pj-Flim

```powershell
npm.cmd install
npm.cmd run api:configure
npm.cmd run db:generate
npm.cmd run admin:bootstrap
npm.cmd run dev
```

Database tạo trước theo [hướng dẫn](../../database/README.md). Backend tự đọc .env.database.local và .env.api.local. api:configure không ghi đè key đang có; admin:bootstrap chạy lại không đổi password/MFA của tài khoản đã tồn tại.

```powershell
npm.cmd run build
npm.cmd start
```

Chỉ chạy một process ở cổng cấu hình. Process local đã khởi động được ghi ở .local/api/server-process.json; stdout/stderr log nằm cùng thư mục. Nếu chạy bằng terminal, dừng bằng Ctrl+C.

| Biến                   | Ý nghĩa                                                   |
| ---------------------- | --------------------------------------------------------- |
| DATABASE_URL           | API runtime, login giới hạn                               |
| MIGRATION_DATABASE_URL | Chỉ CLI introspection/bootstrap, không dùng cho API       |
| AUTH_MFA_REQUIRED      | false bỏ MFA/step-up ở local; production luôn yêu cầu MFA |
| JWT_SECRET             | Ký JWT, kiểm issuer/audience và purpose riêng             |
| MFA_ENCRYPTION_KEY     | AES-256-GCM cho TOTP secret và credential receipt         |
| CURSOR_SECRET          | HMAC cursor và định danh tối thiểu cho rate limit         |
| API_HOST / API_PORT    | Mặc định 127.0.0.1 / 3000                                 |
| SWAGGER_ENABLED        | Bật Swagger ở local; production vẫn tắt                   |

Pool Prisma tối đa 10 connection, connection timeout 5 giây và timezone UTC. Runtime không được sửa/xóa/truncate audit, sửa registry quyền hoặc tạo bảng.

## Cách gọi

Prefix nghiệp vụ: /api/v1. POST/PUT/PATCH dùng application/json; field không khai báo trả 422. Resource trả trực tiếp JSON; collection có data và page gồm limit/hasMore/nextCursor. Bigint serialize chuỗi.

```json
{
  "kind": "SERIES",
  "slug": "phim-thu-nghiem",
  "localizedTitle": "Phim thử nghiệm",
  "countryCodes": ["VN"],
  "genreIds": [],
  "aliases": [{ "alias": "Tên khác" }],
  "credits": []
}
```

Tạo resource trả 201, Location và ETag. PATCH hoặc PUT publication/status/roles/settings cần If-Match lấy từ GET resource tương ứng. Thiếu trả 428, ETag cũ trả 412; không dùng dấu * hoặc ETag của resource khác.

Media references là provider ID ổn định, không nhận signed URL. Có thể lưu draft trước khi có video. Publish trả 409 nếu thiếu video/output HLS/backup hợp lệ; không nhận processing_status từ client.

Auth:

Local AUTH_MFA_REQUIRED=false: POST /auth/sessions trả ACTIVE và token sau kiểm mật khẩu; bỏ bước challenge/verification. Khi MFA được yêu cầu:

1. POST /auth/sessions: staff nhận PENDING_MFA, challengeId/challengeToken, chưa có access JWT.
2. POST /auth/mfa-challenges/{id}/verifications: body challengeToken/code và Idempotency-Key ngẫu nhiên, nhận accessToken/refreshToken.
3. Gửi Authorization: Bearer accessToken cho admin.
4. Tạo /auth/step-up-challenges và verification bằng mã mới/recovery code trước mutation nhạy cảm.
5. POST /auth/token-renewals với refreshToken và một Idempotency-Key cho mỗi ý định; retry cùng ý định giữ key.

Refresh concurrent cùng key nhận cùng receipt trong khoảng 30 giây; khác key trong grace trả AUTH_REFRESH_RETRY_CONFLICT/409. Token cũ dùng lại sau grace làm revoke phiên. Receipt hết credential TTL trả lỗi, không tạo kết quả mới từ intent cũ.

GET challenge dùng Bearer challengeToken với scheme mfa-context, không dùng access JWT. GET /auth/sessions/{id} chỉ cho chủ phiên. Các verification nhận context/proof ở body.

## Global exception handler

[GlobalExceptionFilter và hợp đồng lỗi](exception-handling.md) được đăng ký APP_FILTER, dùng chung cho NestJS/parser/Express/Swagger. Response Problem Details có requestId/retryable; lỗi 5xx che thông tin nội bộ và ghi log JSON an toàn. Lỗi DB/Prisma được ánh xạ theo constraint, không quy đồng mọi lỗi unique thành trùng slug. Đã có thêm 509 assertion kiểm tra exception, gồm lỗi database thật và headers đã gửi.

## Kiểm tra và OpenAPI

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run openapi:export
```

Đã chạy **1.142 kiểm tra HTTP/client/worker**, gồm 41 kiểm tra policy MFA/local và 40 kiểm tra Swagger công khai local trên PostgreSQL tạm riêng: quan hệ catalog, validation, ETag race, publication guards, role scope, SUPER_ADMIN cuối cùng, session revoke, redaction, MFA concurrent retry, refresh grace/reuse/expiry, Swagger local không login nhưng API admin vẫn được bảo vệ, rate limit và production Swagger bị tắt. Thu hồi quyền INSERT audit trong test xác nhận mutation rollback và trả 503.

Để chạy lại, cung cấp mật khẩu quản trị PostgreSQL qua biến môi trường tiến trình PJ_FLIM_TEST_ADMIN_PASSWORD rồi chạy:

```powershell
npm.cmd run test:integration
```

Test chỉ tạo/xóa database pj_flim_test_<random> do chính nó tạo; không dùng pj_flim làm fixture. Kết quả/log ở .local/api; không hardcode password quản trị trong source.

[OpenAPI JSON](openapi.json) xuất từ controller/DTO, không chứa credential thực tế. [Danh sách endpoint](endpoints.md) tổng hợp từ cùng spec.

```powershell
npm.cmd run db:introspect
npm.cmd run db:generate
```

Introspection tự sửa năm inverse relation mà Prisma suy diễn one-to-one từ composite FK có PK. Chỉ chỉnh ánh xạ client, không thêm unique giả hoặc đổi PostgreSQL. CHECK/expression index/deferrable FK/grants vẫn nằm trong SQL baseline. Chưa dùng Prisma Migrate; không db push để thay baseline.

## Các phần chưa triển khai

S3/restore và HA production, admin preview, player/frontend, subtitle delivery adapter, CDN token/cookie hết hạn thật, consumer tổng hợp playback analytics, audit export/download, reset MFA người khác và enrollment MFA qua HTTP. SMTP adapter đã có nhưng chưa gửi email thật; local sink đã kiểm thử.

Cụm hiện tại có tạo/đọc/sửa và publication, không có API xóa vật lý phim/video hoặc sửa/xóa audit. Đã có [signed direct upload và xác minh nguồn Cloudinary](cloudinary-upload.md), với operation/outbox xử lý bền. Worker đã tự xử lý HLS/backup và chỉ chuyển READY sau khi xác minh cả hai; không dùng fake READY trên database phát triển để nghiệm thu video.

Các kiểm tra hiện có không thay kiểm thử tải, toàn bộ worker failure modes hoặc restore/PITR. Xem [plan](../plans/movie-streaming-platform-plan.md) và [backend design](../design/movie-backend-design.md).

Tham khảo: [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [validation](https://docs.nestjs.com/techniques/validation), [authorization](https://docs.nestjs.com/security/authorization), [Prisma PostgreSQL adapter](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).

## Kiểm tra xác thực và phân quyền 13/11/2026

[Đánh giá và bằng chứng](../testing/auth-authorization-2026-11-13.md): 840 assertion mới cho 49 operation admin/5 role, JWT và IDOR; tổng hồi quy API 1.934 đạt, không bật frontend/worker trong lần chạy. Đã từ chối CURSOR_SECRET dưới 64 ký tự khi đọc cấu hình, cùng yêu cầu tối thiểu 64 ký tự cho JWT_SECRET. Dùng khóa ngẫu nhiên, không dùng chuỗi dễ đoán. Khóa local hiện có giữ nguyên; cần khởi động code mới để áp dụng validator mới.

Local vẫn password-only/Swagger mở theo yêu cầu; production buộc MFA và không mount Swagger. URL Cloudinary đã cấp không tự hết hạn/thu hồi theo session API, ST01 còn mở. Token browser nằm trong sessionStorage nên cần kiểm soát XSS; chưa đổi sang cookie/BFF.

## Cursor và độ chính xác timestamp — 13/11/2026

Các danh sách dùng cursor thời gian giữ timestamp PostgreSQL đầy đủ trong cursor ký HMAC, không chuyển khóa so sánh qua Date JavaScript gây mất microsecond. Query dùng trường nội bộ __cursor_time; helper loại khỏi data JSON, các trường thời gian trả cho client vẫn theo hợp đồng cũ. Cursor cũ còn được nhận; tải lại danh sách từ đầu để lấy cursor mới. [Hồi quy 64 assertion và kiểm thử admin](../testing/admin-ui-2026-11-13.md) xác nhận không bỏ sót/trùng các bản ghi cùng thời điểm. Không thay schema/route/DTO.
