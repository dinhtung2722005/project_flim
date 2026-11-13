# API dành cho người xem

Đã triển khai local trong E:\pj-Flim ngày 10/11/2026, Asia/Saigon. Có 27 operation mới; tổng OpenAPI 87 operation/67 path, gồm 49 operation admin. Registry có 73 mã lỗi. Build và 1.070 kiểm tra HTTP/client/worker trên PostgreSQL tạm riêng đã đạt, gồm 194 kiểm tra cho người xem và 509 assertion cho global exception handler.

Bổ sung 13/11/2026: [5 operation gợi ý cá nhân hóa](recommendations.md), nâng tổng hiện hành lên 92 operation/70 path, registry 74 code và 50 bảng. Số 27 operation/47 bảng dưới đây là baseline người xem ngày 10/11; các route cũ giữ nguyên.

Source: [controllers](../../apps/api/src/controllers/viewer.controllers.ts), [DTO](../../apps/api/src/dto/README.md), [schema Swagger](../../apps/api/src/viewer.openapi.ts), [kiểm thử](../../tests/viewer.integration.ts). Không cần thay schema, migration hoặc grant: dùng 47 bảng hiện có và runtime pj_flim_api.

## Hợp đồng chung

Prefix /api/v1. Body JSON, từ chối field lạ và dữ liệu sai kiểu bằng 422. Lỗi trả application/problem+json với code/requestId/retryable theo [global exception handler](exception-handling.md). Bigint trả chuỗi, số decimal PostgreSQL trả JSON number. Collection trả data/page; limit mặc định 20, tối đa 100. Cursor có HMAC, gắn route/filter/sort và user khi là dữ liệu cá nhân. Response hiện dùng Cache-Control: no-store; chưa có Redis/CDN cache catalog.

Swagger: http://127.0.0.1:3000/api/docs-login. Swagger vẫn yêu cầu tài khoản staff có MFA và docs.read; các API public bên dưới gọi trực tiếp không cần đăng nhập Swagger. Production tắt Swagger như trước.

## Tài khoản

| Method | Path                              | Kết quả                   | Quyền                                                    |
| ------ | --------------------------------- | ------------------------- | -------------------------------------------------------- |
| POST   | /users                            | 201, Location /users/{id} | Public; tạo MEMBER và email xác minh                     |
| GET    | /users/{id}                       | 200                       | Bearer của chính tài khoản; người khác 404               |
| POST   | /auth/sessions                    | 201                       | Đã có; MEMBER đăng nhập bằng mật khẩu, staff vẫn cần MFA |
| GET    | /me                               | 200                       | Đã có; Bearer                                            |
| POST   | /auth/token-renewals              | 200                       | Đã có; refresh token + Idempotency-Key                   |
| DELETE | /auth/sessions/current            | 204                       | Đã có; đăng xuất                                         |
| POST   | /auth/password-reset-requests     | 202                       | Public; body email                                       |
| POST   | /auth/password-resets             | 200                       | Public; body token/password                              |
| POST   | /auth/email-verification-requests | 202                       | Public; body email                                       |
| POST   | /auth/email-verifications         | 200                       | Public; body token                                       |

Body đăng ký:

```json
{
  "email": "member@example.com",
  "password": "REPLACE_WITH_A_PRIVATE_PASSWORD",
  "displayName": "Nguoi xem"
}
```

Email trim/lowercase; displayName trim; mật khẩu 12–128 ký tự, Argon2id. Không nhận roles/status/verifiedAt từ client. Email trùng trả ACCOUNT_CONFLICT/409; đăng ký giới hạn 5 lần/IP/giờ.

MVP cho phép MEMBER chưa xác minh email đăng nhập và xem nội dung miễn phí; xác minh email không tự cấp quyền admin. Nếu sau này bắt buộc email verified cho một quyền lợi, thêm policy riêng.

Email request trả cùng thông báo cho tài khoản không tồn tại, đã xác minh hoặc không đủ điều kiện. Giới hạn 20 request/IP/giờ và 5 request/email/giờ. Token ngẫu nhiên 48 byte, DB chỉ lưu hash; verification hạn 24 giờ, reset hạn 30 phút. Confirmation có quota IP riêng, dùng token một lần. Reset tăng auth_version, thu hồi mọi auth/playback session và vô hiệu các reset token còn lại; không tắt hoặc bỏ qua MFA của staff.

## Danh mục công khai

| Method | Path                         | Nội dung                                    |
| ------ | ---------------------------- | ------------------------------------------- |
| GET    | /titles                      | Tìm kiếm/lọc/sắp xếp/phân trang             |
| GET    | /titles/{id}                 | Chi tiết, thể loại và credits               |
| GET    | /genres                      | Thể loại                                    |
| GET    | /titles/{id}/seasons         | Các mùa có tập phát được                    |
| GET    | /seasons/{id}/episodes       | Tập theo thứ tự number                      |
| GET    | /episodes/{id}               | Metadata tập, thời lượng, mốc intro/credits |
| GET    | /titles/{id}/recommendations | Phim cùng thể loại, mới nhất trước          |

/titles nhận q, slug, kind=MOVIE|SERIES, genre=slug, year, country=VN, sort=newest|oldest, limit, cursor. q chuẩn hóa chữ thường/bỏ dấu và tìm literal substring theo tên, aliases, tên người trong credits; không diễn giải ký tự tìm kiếm thành SQL/wildcard. Đây là tìm kiếm MVP, chưa có fuzzy/trigram hay xếp hạng hành vi.

Danh mục chỉ hiển thị title PUBLISHED với tập PUBLISHED và active asset ACTIVE/READY, current attempt SUCCEEDED, output HLS READY đúng profile/config và backup VERIFIED khớp bytes/có hash/manifest. Production còn yêu cầu receipt S3 có object version. Tài nguyên ẩn hoặc không sẵn sàng đều 404, không lộ trạng thái xử lý cho khách. Không trả source URL, expected policy, metadata nội bộ hoặc credential trong DTO catalog.

## Phiên xem và HLS

| Method | Path                             | Kết quả                 |
| ------ | -------------------------------- | ----------------------- |
| POST   | /episodes/{id}/playback-sessions | 201, Location phiên     |
| GET    | /playback-sessions/{id}          | 200                     |
| POST   | /playback-sessions/{id}/renewals | 200                     |
| DELETE | /playback-sessions/{id}          | 204, gọi lặp thành công |
| POST   | /playback-sessions/{id}/events   | 202 sau ghi bền         |

Tạo/gia hạn nhận body {} hoặc {"format":"HLS"} và Idempotency-Key 8–128 ký tự ASCII an toàn. Cùng ý định dùng cùng key. Advisory lock và receipt mã hóa giúp retry không tạo session/generation mới. Trước replay vẫn kiểm quyền, thời hạn phiên và publication/readiness hiện hành. Receipt không lưu URL/token dạng rõ.

Tài khoản gửi Authorization: Bearer accessToken. Khách tạo phiên phải gửi X-Guest-Id: định danh ngẫu nhiên ổn định 43–128 ký tự URL-safe, ví dụ 32 byte random mã hóa base64url. Server chỉ lưu HMAC. Đây là định danh thiết bị, không phải bằng chứng xác thực; giới hạn theo guest có thể bị đổi định danh nên còn quota IP. ALLOW_GUEST_PLAYBACK=false chặn tạo phiên khách.

Response phiên gồm id, episodeId, assetId/assetVersion, expiresAt, maxExpiresAt, deliveryGeneration, resumeGeneration, durationSeconds, telemetryToken và delivery.url. Khách còn nhận managementToken. Không trả managementToken cho phiên tài khoản.

- Khách đọc/gia hạn/đóng phiên bằng X-Playback-Management.
- Gửi events bằng X-Playback-Telemetry cho cả khách và tài khoản.
- Hai token tách biệt, DB lưu hash; không hoán đổi quyền và không gửi token trong query URL.
- API chỉ nhận credential qua header; cookie Swagger không xác thực API nghiệp vụ.
- Phiên 30 phút, gia hạn khi còn hiệu lực, tối đa 6 giờ. Phiên đã hết hạn phải tạo mới.
- Tối đa 3 phiên còn hiệu lực/tài khoản hoặc 2/guest; tạo phiên có quota 60 request/IP/10 phút.
- Tạo/gia hạn đọc primary và kiểm policy trong transaction. Phiên pin phiên bản asset ban đầu; đổi active asset không đổi timeline của phiên cũ nếu bản cũ vẫn đủ điều kiện phát.

Node ký manifest URL từ metadata đã verified; player tải HLS trực tiếp từ Cloudinary CDN. Không gọi Admin API provider hoặc tạo eager transformation khi bấm Play.

Khi nguồn gốc đã xác minh có định dạng MP4, response phiên cấp thêm delivery.fallback={url,format:"MP4",adaptiveBitrate:false}. URL ký trỏ đúng nguồn authenticated và provider version của asset đã pin; không tạo transformation mới hoặc mở URL qua catalog. Nguồn khác trả fallback:null. MP4 tải trực tiếp từ Cloudinary, không proxy qua Node; không có ABR và có thể tốn băng thông hơn HLS. Cùng giới hạn chữ ký không tự hết hạn như HLS.

### Giới hạn quyền phát hiện tại

Response khai báo delivery.authorization=SIGNED_URL, delivery.expiresAt=null, delivery.revocation=SESSION_ONLY. Chữ ký URL Cloudinary hiện dùng không có thời hạn; hết hạn/đóng phiên API chặn API và telemetry nhưng không thu hồi ngay URL CDN đã cấp. Không quảng cáo expiry của phiên như expiry của video.

NODE_ENV=production mặc định trả SERVICE_UNAVAILABLE khi cấp URL. PLAYBACK_ALLOW_NON_EXPIRING_URLS=true là lựa chọn rõ ràng chấp nhận URL không hết hạn; không tạo bảo vệ CDN mới. Muốn URL/token/cookie hết hạn thật cần bật và nghiệm thu tính năng kiểm soát truy cập phù hợp ở Cloudinary/CDN, gồm cả segment HLS. Token-based access là tính năng premium theo [Cloudinary access control](https://cloudinary.com/documentation/control_access_to_media). Không proxy segment qua Node chỉ để che giới hạn này.

Chưa có admin preview session, DRM, subtitle delivery adapter hoặc giới hạn thiết bị cứng. Test API dùng asset fixture trong database tạm; video Cloudinary thật trước đó vẫn DRAFT, không tự xuất bản để chạy test.

## Telemetry

Body ví dụ:

```json
{
  "batchId": "7ccf84c8-70ab-4f48-9d62-f6d4b797d779",
  "events": [
    {
      "id": "5e0dd93f-ab76-426b-bc6d-e97efef791c9",
      "sequence": 1,
      "type": "play",
      "elapsedMs": 0,
      "positionSeconds": 0
    }
  ]
}
```

Nhận 1–50 event/batch, tối đa 64 KiB. Type allowlist: play, pause, seek, ended, buffering-start, buffering-end, error, quality-change, heartbeat. Optional errorCode chỉ mã A-Z/0-9/underscore, height là số; không nhận raw URL, stack trace hoặc payload tùy ý. Position không vượt duration; elapsedMs không vượt tuổi phiên cộng dung sai 10 giây. Quota 240 batch/phút/token.

Batch atomic: ID trùng cùng fingerprint trả receipt cũ; cùng ID nhưng nội dung khác bị từ chối. Event ID trùng giữa batch không ghi/cộng lần nữa. Ghi receipt/watch_events/outbox playback.events.accepted cùng transaction trước 202. Sai một event thì cả batch rollback. Chưa có consumer tổng hợp thống kê lượt xem/QoE; outbox telemetry được giữ bền, worker media không nhận nhầm loại event này. Analytics/retention thuộc C12.

## Yêu thích, lịch sử và tiến độ

| Method | Path                           | Hành vi                                     |
| ------ | ------------------------------ | ------------------------------------------- |
| GET    | /me/watchlist                  | Danh sách yêu thích có phân trang           |
| PUT    | /me/watchlist/{titleId}        | 201 khi thêm mới, 204 nếu đã có             |
| DELETE | /me/watchlist/{titleId}        | 204, gọi lặp an toàn                        |
| GET    | /me/history                    | Lịch sử có phân trang                       |
| GET    | /me/continue-watching          | Chưa hoàn tất, có vị trí, đúng active asset |
| GET    | /me/watch-progress/{episodeId} | Tiến độ của chính tài khoản                 |
| PUT    | /me/watch-progress/{episodeId} | 201 lần đầu, 200 khi cập nhật/replay        |

Tất cả cần Bearer. Không nhận userId từ client. Cursor thư viện gắn với user; không dùng cursor của tài khoản khác. Danh sách ẩn nội dung không còn phát công khai.

Body lưu tiến độ:

```json
{
  "sessionId": "7ccf84c8-70ab-4f48-9d62-f6d4b797d779",
  "sequence": 12,
  "positionSeconds": 125.5,
  "intervalStartSeconds": 115.5,
  "ended": false
}
```

Gửi định kỳ khoảng 10–15 giây và khi pause/chuyển tập; intervalStartSeconds chỉ dùng cho đoạn liên tục thực sự xem, bỏ trường này khi seek. Sequence tăng trong phiên; giữ nguyên body/sequence khi retry. Vị trí có thể giảm khi tua về.

Transaction khóa user/session/head và kiểm active resume generation. Phiên mới tăng generation; phiên cũ không ghi đè dù request đến sau. Cùng sequence khác body trả PROGRESS_SEQUENCE_CONFLICT/409; phiên cũ trả PROGRESS_SESSION_STALE/409.

Các khoảng xem được hợp giao nhau; không cộng trùng khi xem lại. Ngân sách thời gian mỗi request và tích lũy mỗi phiên giới hạn theo server elapsed time, tốc độ tối đa 2x và dung sai 2 giây. Completion cần coverage >=90%, vị trí gần cuối và event ended hợp lệ đã lưu. Client vẫn không phải bằng chứng chống gian lận tuyệt đối.

Sau thay video, GET progress trả resumeEligible=false/positionSeconds=0 cho dữ liệu phiên bản cũ; phiên mới bắt đầu coverage mới. Phiên cũ pin bản cũ không bị chuyển URL giữa chừng. Khách không có progress API tài khoản; frontend sau này lưu resume local.

## Báo lỗi

POST /reports nhận titleId, optional episodeId/playbackSessionId, category=PLAYBACK|SUBTITLE|METADATA|OTHER, message plain text 3–2000 ký tự. Trả 201 và Location /reports/{id}. GET /reports/{id} chỉ chủ báo cáo đọc được; không trả xử lý nội bộ, người xử lý hoặc dữ liệu tài khoản khác.

Tài khoản dùng Bearer. Khách phải có playbackSessionId đang hiệu lực và X-Playback-Management đúng phiên. Episode/title phải khớp và nội dung đang công khai; quota 10 báo cáo/tài khoản hoặc IP/giờ. Frontend phải hiển thị message như text, không render HTML từ người dùng.

## Email local và SMTP

Mặc định development dùng MAIL_TRANSPORT=local, lưu email vào .local/mail/{outboxId}.json; không gửi email ra ngoài. Đây là hộp thư thử nghiệm riêng, có token để nhập vào Swagger/API, không phải log và không được phục vụ static. MAIL_LOCAL_ROOT phải nằm dưới .local, không dùng symlink. Xóa email thử theo chính sách dữ liệu sau khi kiểm thử.

Token hash và outbox mã hóa AES-GCM được commit cùng transaction. Dispatcher API claim outbox bằng SKIP LOCKED/lease, retry lỗi tối đa mỗi 300 giây; bỏ qua thư quá hạn. Gửi xong xóa encrypted payload khỏi outbox, giữ metadata. Crash giữa SMTP send và đánh dấu published có thể gửi trùng; token một lần vẫn ngăn dùng lại. Local sink dùng tên outbox ID và kiểm nội dung để tránh tạo bản trùng khi retry.

Production dùng MAIL_TRANSPORT=smtp, SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD và MAIL_FROM. Port 465 dùng TLS, port khác yêu cầu STARTTLS; tắt logger/debug và không cho attachment từ file/URL. Thiếu cấu hình trả 503 trước khi phân biệt email có tồn tại. Adapter SMTP đã có nhưng chưa nghiệm thu gửi email thật vì chưa có tài khoản SMTP; chỉ local sink được kiểm thử. Tham khảo [Nodemailer SMTP](https://nodemailer.com/smtp).

## Nghiệm thu và phần tiếp theo

Bộ kiểm thử mới chạy HTTP thật qua NestJS với PostgreSQL tạm/runtime grant thật: public visibility/backup mismatch, cursor/filter, registration role injection, local mail/one-time token/reset/revocation, owner isolation, concurrency/idempotency, token scope, renewal/expiry, production guard, telemetry rollback/dedup, progress seek/fencing/coverage/completion, asset replacement, report ownership và Swagger response/security.

Chạy theo [hướng dẫn kiểm thử](README.md); bật PJ_FLIM_TEST_WORKER=true để bao gồm broker/worker. Kết quả ở .local/api/integration-result.json. Không seed READY giả hoặc xuất bản phim thật trong database pj_flim.

Chạy npm.cmd run playback:smoke để kiểm tra riêng adapter delivery với asset Cloudinary thật đã verified. Adapter mới tạo cùng URL với pipeline worker; đã đọc manifest và segment của cả 5 mức 180p–720p trên video 1211,803 giây. Báo cáo không chứa URL/token ở .local/api/playback-smoke-result.json; phim vẫn DRAFT. Đây là kiểm tra CDN/adapter, không thay kiểm thử HTTP ownership trên database tạm.

Phần tiếp theo là UI người xem/admin, player HLS/native, playback protection thật tại CDN nếu cần, mail template/link giao diện, analytics consumer, cache, tải/restore và CI. Rating/bình luận/gợi ý hành vi nằm sau MVP.
