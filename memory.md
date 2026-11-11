# Tiến trình dự án pj-Flim

Snapshot cập nhật ngày 11/11/2026, Asia/Saigon. Đọc cùng [agent.md](agent.md); kiểm tra source/bằng chứng trước khi dựa vào snapshot để thực hiện bước mới.

## Yêu cầu và quyết định đã chốt

- Mọi công việc phim phải ở E:\pj-Flim; không ghi sang DocPrep/Docrep.
- Backend Node.js/NestJS; frontend dự kiến Next.js, chưa triển khai.
- PostgreSQL là dữ liệu chính. Cloudinary lưu nguồn, tạo HLS và phân phối CDN. RabbitMQ xử lý nền.
- Người dùng chọn cấu hình kiểm thử local vì chưa có URL webhook cố định hoặc S3: backup riêng tư trên ổ đĩa, tunnel webhook HTTPS tạm.
- Người dùng yêu cầu tách DTO, service và controller thành các thư mục riêng; đã thực hiện.
- Người dùng yêu cầu global exception handler; đã chuẩn hóa và kiểm thử.
- Ngày 11/11/2026: theo yêu cầu bỏ mã MFA, local dùng AUTH_MFA_REQUIRED=false. API local chỉ cần email và mật khẩu; không xóa factor/recovery. Yêu cầu sau đó đã bỏ hoàn toàn đăng nhập Swagger, UI/spec local mở trực tiếp. Production luôn yêu cầu MFA; mặc định cờ true.
- Yêu cầu mới: giữ ngữ cảnh trong agent.md, tiến trình trong memory.md và cập nhật khi có thay đổi quan trọng. AGENTS.md là điểm đọc đầu tiên cho agent trong project.

## Snapshot đã xác minh gần nhất

| Hạng mục          | Trạng thái                                                          |
| ----------------- | ------------------------------------------------------------------- |
| Plan đang dùng    | [Phiên bản 2.7](docs/plans/movie-streaming-platform-plan.md)        |
| Backend design    | [Thiết kế backend](docs/design/movie-backend-design.md)             |
| Database          | pj_flim, schema movie, PostgreSQL local, 47 bảng                    |
| RBAC              | 5 role, 18 permission, 44 liên kết; API/worker dùng login giới hạn  |
| OpenAPI           | 87 operation trên 67 path, gồm 49 operation admin                   |
| Error registry    | 73 code                                                             |
| DTO               | 40 class, 11 nhóm trong apps/api/src/dto                            |
| Service           | 10 service trong apps/api/src/services                              |
| Controller        | 12 controller trong 6 file tại apps/api/src/controllers             |
| Exception handler | GlobalExceptionFilter qua APP_FILTER, mapper riêng trong exceptions |
| Frontend/player   | Chưa triển khai                                                     |

Không có migration/schema mới trong các lượt API người xem, tách source và global exception. SQL baseline/Prisma client đang được dùng; chưa có Prisma Migrate.

## Những phần đã code

### API, tài khoản và quản trị

- JWT access, refresh rotation, server session, MFA/recovery, step-up, RBAC và kiểm quyền hiện hành.
- Admin phim/mùa/tập, publication guard, thể loại/people/banner/settings, quản trị user/role và audit append-only.
- Signed upload intent, direct/chunked upload helper, xác minh nguồn theo owner/episode/file và API retry xử lý media.
- Public catalog: danh sách/tìm/lọc, chi tiết, thể loại, mùa/tập và phim liên quan cùng thể loại.
- Đăng ký MEMBER, thông tin chính tài khoản, email xác minh/reset với token một lần và outbox mã hóa. Email local đã thử; SMTP adapter chưa gửi thật.
- Phiên phát cho khách/tài khoản: tạo/đọc/gia hạn/đóng, idempotency và pin asset version.
- Telemetry ghi batch/event/outbox bền, chống trùng và phân quyền token riêng. Chưa tổng hợp analytics.
- Yêu thích, lịch sử, xem tiếp, progress generation/sequence/coverage và báo lỗi có ownership.

Hợp đồng chi tiết: [API người xem](docs/api/viewer-api.md), [endpoint](docs/api/endpoints.md), [OpenAPI](docs/api/openapi.json).

### Media worker và streaming

- RabbitMQ durable/quorum queue, publisher confirm, manual ACK, retry/backoff, DLQ, outbox recovery và job lease/fencing.
- HLS asynchronous qua Cloudinary; webhook kiểm raw signature/timestamp/context và inbox dedup.
- Backup nguồn dạng stream, byte count, SHA-256, manifest và full read-back trước VERIFIED.
- Asset/attempt/operation chỉ thành công khi HLS và backup đủ điều kiện; admin vẫn phải chọn active asset/xuất bản.
- Video thật 20 phút 11 giây đã có 5 mức 180p/270p/360p/540p/720p; backup khớp nguồn và webhook thật đã nhận.
- Playback adapter mới đã kiểm manifest/segment của cả 5 mức; video thật vẫn DRAFT. Không có bài test tự xuất bản phim thật.
- Node cấp thông tin phát; client tải video trực tiếp từ Cloudinary CDN.

Xem [worker runbook](docs/api/media-worker.md) và [Cloudinary runbook](docs/api/cloudinary-upload.md).

### Tổ chức source và xử lý lỗi

- DTO đã tách theo nhóm, giữ tên/decorators/validation. Controller/service đã chuyển thư mục, HealthController tách khỏi AppModule.
- Hai lượt tách source đã đối chiếu AST, OpenAPI và chạy 561 kiểm tra thành công tại thời điểm đó.
- GlobalExceptionFilter hiện thay phần ProblemFilter cũ trong common.ts; dùng chung một instance cho NestJS, parser và Express/Swagger.
- Problem Details có code/status/detail/instance/requestId/retryable; field errors được lọc, không trả raw value/stack.
- Mapper xử lý ApiError, HttpException, parser, nested Prisma/PostgreSQL; unique không xác định trả RESOURCE_CONFLICT.
- HTTP exception giữ ngữ nghĩa trước nested cause. Lỗi 5xx có log JSON an toàn; response đã gửi header không bị ghi lại.
- Không có endpoint thử lỗi trong production.

Chi tiết: [DTO](apps/api/src/dto/README.md), [services](apps/api/src/services/README.md), [controllers](apps/api/src/controllers/README.md), [exception handler](docs/api/exception-handling.md).

## Kết quả kiểm tra gần nhất

Bộ kiểm tra backend gần nhất chạy ngày 11/11/2026 sau bỏ đăng nhập Swagger:

- Build và định dạng source đạt.
- 1.142 kiểm tra/assertion integration đạt trên PostgreSQL tạm riêng; có worker RabbitMQ. Gồm 41 kiểm tra policy MFA/local và 40 kiểm tra Swagger công khai local. Các assertion form/cookie/CSRF Swagger cũ được thay theo hành vi mới.
- Trong đó 509 assertion cho exception handler và 194 kiểm tra người xem.
- Có kiểm lỗi unique constraint thật từ Prisma/PostgreSQL, JSON sai/body quá lớn/charset, requestId, redaction và response đã gửi header.
- Sau restart API: health 200; lỗi 400/401/403/404/413/415 trả Problem Details đúng.
- Lần kiểm cuối trước đó không phát hiện credential trong tài liệu/source công khai hoặc link tương đối bị hỏng.

Bằng chứng riêng tư, không chép raw token/credential từ các file này:

| File                                     | Nội dung                                            |
| ---------------------------------------- | --------------------------------------------------- |
| .local/api/integration-result.json       | Kết quả integration và số assertion                 |
| .local/api/global-exception-result.json  | Runtime/error contract và quét tài liệu sau handler |
| .local/api/dto-refactor-result.json      | Đối chiếu DTO/OpenAPI                               |
| .local/api/layers-refactor-result.json   | Đối chiếu controller/service/OpenAPI                |
| .local/api/playback-smoke-result.json    | Adapter phát với CDN/video thật                     |
| .local/worker/pipeline-smoke-result.json | HLS, webhook, backup và trạng thái pipeline         |

Đây là kết quả kiểm thử local, không chứng minh tải production, playback trên browser hoặc restore đã đạt.

## Việc còn mở và thứ tự đề xuất

Backlog ở mục 11.1 của plan; chưa ticket ST01–ST06 nào được coi là đã sửa chỉ vì có handler/refactor:

| Ticket | Việc cần làm                                                                                        | Trạng thái |
| ------ | --------------------------------------------------------------------------------------------------- | ---------- |
| ST01   | Chốt quyền phát CDN; signed URL hiện không tự hết hạn theo phiên                                    | OPEN       |
| ST02   | Quota tạo phiên theo user/guest/IP và proxy tin cậy; tránh gom người dùng sau proxy vào quota chung | OPEN       |
| ST03   | Chống spam telemetry trước xác thực; tránh tạo quota/security log bền cho từng token giả            | OPEN       |
| ST04   | Analytics consumer riêng, thống kê và cleanup/retention                                             | OPEN       |
| ST05   | Frontend/player, browser/device/network matrix và load test                                         | OPEN       |
| ST06   | Backup độc lập, restore thật và webhook cố định cho production                                      | OPEN       |

- Ưu tiên ST02–ST03 trước khi mở API cho người ngoài; chốt ST01 trước cấp URL production.
- C09/C10 frontend/admin/player là bước sản phẩm tiếp theo theo trao đổi; vẫn chưa bắt đầu.
- Admin preview, subtitle delivery adapter, cache Redis, audit export/download, MFA enrollment qua HTTP, restore/HA/CI đầy đủ còn thiếu.
- Rating/bình luận/gợi ý hành vi/VIP/DRM là phạm vi sau MVP hoặc cần xác minh thêm; không tự đưa vào nhiệm vụ hiện tại.
- Tiếp tục theo yêu cầu mới nhất của người dùng; không tự coi toàn bộ backlog là đã được giao thực hiện trong một lượt.

## Giới hạn quan trọng phải giữ rõ

1. Phiên API có expiry nhưng delivery URL hiện là signed URL tĩnh: delivery.expiresAt=null, revocation=SESSION_ONLY.
2. Production mặc định chặn cấp URL khi chưa chấp nhận rõ giới hạn; PLAYBACK_ALLOW_NON_EXPIRING_URLS=true không tạo bảo vệ CDN có TTL.
3. Chưa có player nên kiểm manifest/segment chưa thay cho xem thật, ABR, tua, buffering hoặc renewal trên browser.
4. Backup local cùng máy và tunnel tạm phục vụ development; S3/restore và SMTP chưa nghiệm thu với tài khoản thật.
5. Telemetry đã ghi bền nhưng consumer analytics/cleanup chưa có; không tuyên bố view/QoE aggregation đã hoạt động.

## Vận hành và vị trí cấu hình

- API: http://127.0.0.1:3000/api/v1/health; Swagger không cần đăng nhập: http://127.0.0.1:3000/api/docs.
- PostgreSQL: localhost:5432; RabbitMQ: localhost:5672, management localhost:15672; webhook relay localhost:3001.
- Credential nằm trong .env.database.local, .env.api.local, .env.worker.local và các file riêng tư dưới .local. Không ghi giá trị vào memory.
- Email local: .local/mail; backup local: .local/backups.
- Process record: .local/api/server-process.json và .local/worker/{process,relay-process,tunnel-process}.json. Đọc lại record/health khi cần, không dùng PID ghi nhớ cũ.
- Lần kiểm runtime gần nhất API/worker/relay/tunnel đều chạy. Không coi trạng thái đó còn đúng ở mọi phiên sau.

```powershell
Set-Location E:\pj-Flim
npm.cmd run build
powershell -ExecutionPolicy Bypass -File scripts/Start-LocalProcess.ps1 -Service api
# Khởi động toàn bộ media local khi cần:
powershell -ExecutionPolicy Bypass -File scripts/Start-MediaLocal.ps1
```

Chạy integration cần PJ_FLIM_TEST_ADMIN_PASSWORD trong môi trường tiến trình; bật PJ_FLIM_TEST_WORKER=true để gồm worker. Không chạy fixture trong pj_flim và không tự dọn volume/dữ liệu dự án để khắc phục lỗi.

## Nhật ký mốc chính

Các mốc dưới đây là tóm tắt từ công việc/bằng chứng đã có, không khẳng định đã chạy lại trong lần tạo memory.

| Ngày       | Mốc                                                         | Bằng chứng/giới hạn                                                             |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 10/11/2026 | Database local, Prisma và API admin/auth/RBAC/audit/Swagger | 47 bảng; API runtime riêng; chưa Prisma Migrate                                 |
| 10/11/2026 | Cloudinary upload/verification                              | Video dài đã thử; bản dùng thử nằm dưới giới hạn tài khoản; không sửa nguồn gốc |
| 10/11/2026 | RabbitMQ HLS/webhook/backup                                 | Pipeline thật READY/VERIFIED/SUCCEEDED, phim DRAFT; restart broker đã kiểm      |
| 10/11/2026 | 27 operation người xem mới                                  | Tổng 87 operation; kết quả 561 kiểm tra ở mốc đó                                |
| 10/11/2026 | Ghi nhận backlog streaming ST01–ST06                        | Plan 2.3; chưa triển khai các ticket                                            |
| 10/11/2026 | Tách DTO, rồi controller/service                            | AST/OpenAPI không đổi; 561 kiểm tra từng mốc đạt                                |
| 10/11/2026 | Global exception handler                                    | Plan 2.4; 73 error code; tổng 1.070 kiểm tra đạt                                |
| 10/11/2026 | Tạo agent.md, memory.md và AGENTS.md                        | Lưu ngữ cảnh/quy trình cập nhật; chỉ thay tài liệu, không chạy lại backend test |


Kiểm tra của lần cập nhật ngữ cảnh ngày 10/11/2026: đã xác minh 42 link tương đối, đối chiếu số liệu với OpenAPI/báo cáo integration hiện có và quét không thấy credential trong AGENTS.md/agent.md/memory.md/README.md. Không chạy lại backend test vì chỉ thay tài liệu. Bằng chứng: .local/api/context-files-result.json.

Mỗi thay đổi quan trọng tiếp theo: cập nhật snapshot/công việc còn mở, ghi kết quả kiểm tra và thêm một mục nhật ký ngắn. Chỉ chỉnh agent.md khi quy tắc hoặc quyết định lâu dài đổi.
## Vận hành local ngày 11/11/2026

- Theo yêu cầu chạy dự án: mở Docker Desktop trong nền, khởi động container RabbitMQ có sẵn và chạy scripts/Start-MediaLocal.ps1. Build TypeScript đạt; API, worker, webhook relay và tunnel chạy dưới cửa sổ ẩn. Không đổi source, schema hoặc xuất bản phim.
- Kiểm tra thực tế: GET /api/v1/health trả 200 với database=up; GET /api/v1/titles và /api/docs-login trả 200.
- RabbitMQ ping đạt; pjflim.media.jobs có 1 consumer, 0 message ready và 0 unacknowledged; DLQ không có message. Worker ghi worker.connected, backup driver filesystem.
- Đã kiểm đường webhook qua cả relay local và tunnel HTTPS: POST không có chữ ký bị từ chối 401; đường admin qua relay/tunnel bị chặn 404. Không ghi URL tunnel tạm vào tài liệu.
- Lưu ý vận hành: khi Docker chưa chạy, Start-RabbitMQ.ps1 có thể dừng ngay ở docker info do PowerShell xử lý stderr với ErrorActionPreference=Stop. Phiên này xử lý bằng cách mở Docker Desktop ẩn, chờ Engine sẵn sàng rồi chạy lại script; chưa sửa script.
- Không chạy lại bộ integration 1.070 assertion trong lượt khởi động này. Các kiểm tra ở trên là kiểm tra runtime sau startup, không thay nghiệm thu production hoặc player trình duyệt. Frontend vẫn chưa triển khai; ST01–ST06 còn mở.
- Bằng chứng: .local/api/startup-result.json; process record và log ở các đường dẫn vận hành đã nêu. Cần kiểm lại runtime ở phiên sau.


## Bỏ yêu cầu mã MFA local ngày 11/11/2026

- Theo yêu cầu người dùng: thêm AUTH_MFA_REQUIRED, mặc định true; .env.api.local đặt false. Production luôn yêu cầu MFA. Không xóa factor/recovery hoặc thay mật khẩu.
- API login và Swagger local chỉ cần email/mật khẩu; bỏ ô nhập OTP. Staff login trả ACTIVE và token; mfa_verified_at/step_up_at vẫn null. Staff idle timeout 30 phút, absolute timeout 8 giờ.
- Đồng bộ authenticate, mutation guard, step-up và policy role/last SUPER_ADMIN. Giữ password, permission, ownership, session expiry/revocation và transaction audit.
- Build và export OpenAPI đạt. Integration 1.122 assertion đạt trên database PostgreSQL tạm có RabbitMQ; gồm 52 assertion mới cho policy local/default/production, đăng nhập staff có/không factor, Swagger/CSRF, RBAC, mutation/audit, role update và session revocation.
- Đã restart API và xác minh runtime thật: 15 kiểm tra đạt, gồm Swagger/API đăng nhập bằng mật khẩu, UI/spec có bảo vệ, admin vẫn cần Bearer và health 200. Phiên smoke đã logout; không in token/credential.
- Đồng bộ plan 2.5, backend design, API runbook, README, agent.md và memory.md. Không đổi schema/endpoint/error code; vẫn 87 operation/67 path và 73 error code. ST01–ST06 chưa xử lý.
- Bằng chứng riêng tư: .local/api/integration-result.json, .local/api/mfa-policy-integration.log và .local/api/mfa-local-result.json. Frontend chưa có; không suy ra production/player đã nghiệm thu.

## Chạy lại dự án ngày 11/11/2026

- Theo yêu cầu chạy project: kiểm tra thấy PostgreSQL đang chạy, API/worker/relay/tunnel đã dừng và Docker Engine chưa sẵn sàng. Mở Docker Desktop ẩn rồi chạy scripts/Start-MediaLocal.ps1 thành công; build đạt, các process dự án chạy trong nền.
- Kiểm tra runtime mới: health 200 với database=up, danh sách phim 200, Swagger login 200 và không có ô MFA. RabbitMQ ping đạt, queue media có 1 consumer, 0 ready/unacknowledged và DLQ rỗng.
- Webhook qua tunnel trả 401 khi thiếu chữ ký; đường admin qua relay local và tunnel trả 404. Cả 4 process được đối chiếu với entry point trong record và đang chạy lúc kiểm tra.
- Không sửa source/schema, không đổi credential hay policy. Chỉ build và kiểm runtime; không chạy lại integration 1.122 assertion. Frontend vẫn chưa có.
- Bằng chứng lần này: .local/api/startup-latest-result.json, process record và log runtime. Không lưu PID hoặc URL tunnel tạm trong memory.


## Sửa lỗi CSRF Swagger ngày 11/11/2026

- Người dùng báo ảnh AUTH_CSRF_INVALID/403 tại POST /api/docs-login. Đã đối chiếu requestId trong log; tái hiện được lỗi cùng mã khi GET form ở tab khác xoay cookie, rồi gửi form của tab cũ.
- Sửa application.ts: reuse cookie CSRF hợp lệ thay vì xoay mỗi GET/lỗi mật khẩu; thời hạn cookie 30 phút. Giữ HttpOnly/SameSite=Strict, scope cookie, so khớp token, Origin và Fetch Metadata.
- Khi cookie thiếu/hết hạn hoặc token không khớp: request trình duyệt nhận HTML 403 có thông báo, form và cookie để nhập lại; không echo mật khẩu hoặc tự xác thực. Client JSON giữ Problem Details AUTH_CSRF_INVALID qua global filter.
- Thêm tests/docs-login.integration.ts: 45 assertion cho nhiều tab/lỗi mật khẩu, cookie thiếu/khôi phục, Origin/cross-site, JSON contract và cookie malformed. Build và toàn bộ 1.167 assertion đạt trên PostgreSQL tạm có RabbitMQ; gồm 509 exception, 194 viewer và 52 MFA/local.
- API đã restart; 13 kiểm tra runtime đạt với tài khoản local: form tab cũ login 303, Swagger 200, form hết hạn trả HTML 403, JSON contract giữ nguyên, health 200. Phiên smoke đã logout.
- Đồng bộ plan 2.6, README/API runbook, backend design và agent.md. Không đổi schema/route/error code, không bật lại MFA local. ST01–ST06 vẫn mở.
- Bằng chứng riêng tư: .local/api/docs-csrf-integration.log, .local/api/integration-result.json và .local/api/docs-csrf-result.json.


## Bỏ đăng nhập Swagger ngày 11/11/2026

- Người dùng báo tiếp ảnh form CSRF rồi yêu cầu rõ bỏ đăng nhập Swagger. Yêu cầu này thay thế việc tiếp tục sửa cơ chế form cũ; không suy diễn đã tìm được nguyên nhân riêng trong trình duyệt của người dùng.
- Local /api/docs và /api/openapi.json mở trực tiếp. Đã bỏ form login, cookie/CSRF docs, middleware kiểm docs.read, endpoint docs-session và interceptor tự gắn JWT. GET docs-login cũ redirect 302 sang docs; POST form cũ trả 404.
- API nghiệp vụ giữ Bearer/session/RBAC, ownership, audit và MFA policy hiện hành. Try it out dùng token từ POST /api/v1/auth/sessions qua nút Authorize. Production hoặc SWAGGER_ENABLED=false tắt mọi route tài liệu/asset/alias/redirect.
- Thay tests/docs-login.integration.ts bằng tests/swagger.integration.ts; cập nhật assertion cũ trong integration admin/viewer/exception/MFA theo hành vi mới. Build và export OpenAPI đạt; 1.142 assertion đạt trên PostgreSQL tạm có RabbitMQ, gồm 509 exception, 194 viewer, 41 MFA/local và 40 Swagger.
- Đã restart API. 8 kiểm tra runtime đạt: docs/spec 200 không login, redirect cũ 302, docs-session 404, admin thiếu Bearer 401, health 200; Chrome headless dùng profile thử riêng render đủ 87 operation, không có form mật khẩu/CSRF.
- Đồng bộ plan 2.7, README/API runbook, thiết kế backend, exception docs, agent.md và memory.md. Không thay credential/schema/route nghiệp vụ hoặc error registry; ST01–ST06 vẫn mở.
- Bằng chứng riêng tư: .local/api/swagger-public-integration.log, .local/api/integration-result.json, .local/api/swagger-public-result.json và .local/api/swagger-browser.html. Các báo cáo docs-csrf cũ là lịch sử, không mô tả chính sách Swagger hiện tại.

## Chuẩn bị GitHub và README ngày 11/11/2026

- Người dùng yêu cầu push source lên https://github.com/dinhtung2722005/project_flim và viết README chi tiết. Repository đích được kiểm tra đang trống; khởi tạo Git tại đúng E:\pj-Flim, nhánh main và origin trỏ đúng URL được chỉ định.
- Viết lại README: tính năng thực tế, stack, sơ đồ kiến trúc, cấu trúc source, môi trường, bootstrap database/credential, cấu hình Cloudinary, API/worker, Swagger không login, xác thực Bearer, database, pipeline HLS/backup, lỗi API, test, troubleshooting và backlog ST01–ST06.
- Cập nhật .gitignore: chỉ cấu hình mẫu được commit; bỏ local env/runtime, dependencies/build, video/log/backup và tài liệu docx cá nhân không liên quan ở gốc. Không sửa/xóa tài liệu cá nhân.
- Rà soát 116 file dự kiến commit, khoảng 2 MB; không thấy credential đang dùng, private key/token GitHub hoặc file quá lớn. Link README tới file trong source đều hợp lệ. Bằng chứng riêng tư: .local/git/pre-push-review.json.
- Lượt này thay tài liệu/Git ignore và chuẩn bị xuất bản source; không sửa logic backend hoặc chạy lại integration. Kết quả backend gần nhất vẫn 1.142 assertion ở lượt bỏ đăng nhập Swagger. Việc push và remote commit được xác minh sau bước commit.
