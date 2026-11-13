# Kiểm tra xác thực và phân quyền — 13/11/2026

Phạm vi: dự án E:\pj-Flim, giờ Asia/Saigon; rà source, kiểm thử HTTP/NestJS trên PostgreSQL tạm và đọc cấu hình/quyền database local. Đây là đánh giá trong phạm vi ứng dụng local, chưa phải chứng nhận an toàn production hay pentest độc lập.

## Kết luận và phát hiện

Chưa phát hiện trường hợp vượt quyền admin hoặc đọc chéo tài khoản trong các tình huống đã kiểm. Đã khắc phục một thiếu sót kiểm tra cấu hình khóa ký. Rủi ro URL CDN không hết hạn vẫn còn.

| Mức độ | Vấn đề | Trạng thái và xử lý |
| --- | --- | --- |
| Trung bình, phụ thuộc cấu hình | CURSOR_SECRET trước đây chỉ cần có giá trị; khóa một ký tự vẫn được chấp nhận dù được dùng ký cursor và token quản lý/telemetry playback | Đã tái hiện và sửa: từ chối khóa dưới 64 ký tự khi đọc cấu hình/khởi động. Hồi quy khóa 1/63/64 ký tự đạt. Khóa local hiện có đã đủ dài, không đổi khóa hoặc thu hồi phiên |
| Cao nếu yêu cầu thu hồi quyền xem nội dung | URL HLS/MP4 Cloudinary đã ký không tự hết hạn theo phiên API; đóng phiên, logout hoặc đổi quyền không đảm bảo chặn URL đã cấp ở CDN | Đã biết, còn mở ở ST01. Cần cơ chế truy cập có TTL/thu hồi thực tại CDN và kiểm manifest/segment/MP4 trực tiếp sau thu hồi. Production mặc định chặn cấp URL nếu chưa chấp nhận rõ giới hạn |
| Trung bình, rủi ro còn lại | Access/refresh token nằm trong sessionStorage, JavaScript cùng origin có thể đọc nếu xảy ra XSS | Chưa phát hiện XSS trong phạm vi rà source; đây là rủi ro kiến trúc, không phải bằng chứng có XSS. Giữ CSP/chống chèn HTML; cân nhắc BFF hoặc refresh cookie HttpOnly + Secure + SameSite và CSRF khi thiết kế lại auth browser |
| Cấu hình local đã được yêu cầu | Local AUTH_MFA_REQUIRED=false và Swagger mở công khai | Giữ nguyên yêu cầu trước đó. Production buộc MFA, bỏ Swagger ngay cả khi bật flag; đã kiểm hồi quy. Không coi local password-only là cấu hình triển khai public |

Mức độ ở trên là đánh giá định tính theo khả năng triển khai/ảnh hưởng; không phải CVSS đã tính hoặc bằng chứng khai thác từ Internet.

Sửa tại [config.ts](../../apps/api/src/config.ts), kiểm thử mới tại [auth-security.integration.ts](../../tests/auth-security.integration.ts). Validator kiểm độ dài tối thiểu, không chứng minh entropy; tạo khóa ngẫu nhiên bằng cấu hình dự án. Không thay API/DTO/error registry/schema hoặc tự bật lại MFA local.

## Kiểm thử mới

**840 assertion đạt**, 7 nhóm, 49 operation admin và 5 role. Ma trận kiểm sử dụng hợp đồng endpoint → permission riêng cùng ma trận role → permission; thay decorator sang quyền yếu hơn sẽ không tự làm thay đổi kết quả mong đợi.

| Nhóm | Đã kiểm |
| --- | --- |
| Cấu hình khóa | Khóa ký cursor/playback 1 và 63 ký tự bị từ chối; 64 ký tự được nhận |
| Metadata admin | Đủ 49 operation, không Public, đúng permission theo hợp đồng độc lập; đổi role/settings khai báo step-up |
| Ma trận RBAC | MEMBER/EDITOR/ADMIN/SUPER_ADMIN/AUDITOR: 159 request thiếu auth hoặc thiếu quyền bị từ chối; 83 GET có quyền đi qua lớp phân quyền |
| JWT | Sai chữ ký, sửa payload, alg=none, khóa khác, HS384, sai issuer/audience, token MFA dùng thay access, hết hạn và scheme Basic đều bị chặn |
| Không tin role từ token | Kể cả token được ký bằng khóa thử tin cậy nhưng chèn role SUPER_ADMIN/permission, MEMBER vẫn bị chặn bởi quyền hiện hành trong DB |
| Ownership và chống nâng quyền | Tài khoản khác, kể cả SUPER_ADMIN trên route self-service, không đọc được user/session của người khác; MEMBER không gán role; ADMIN không khóa staff |
| Hiệu lực phiên/quyền | Gỡ role trong DB có hiệu lực với JWT cũ; khóa user, hết idle/absolute TTL, PENDING_MFA, đổi auth_version và logout đều chặn truy cập |

159 request bị chặn và 83 GET có quyền là các tập request trong ma trận route, không phải số assertion. GET có quyền dùng ID thử không tồn tại nên có thể trả 404 hoặc lỗi nghiệp vụ; kết quả chỉ chứng minh đi qua lớp phân quyền. Ma trận không tự thực hiện mọi mutation được phép; các luồng mutation hợp lệ được kiểm bởi bộ integration hiện có.

Session ACTIVE của ma trận được seed trong database tạm để tách việc kiểm quyền khỏi đăng nhập. Luồng password/MFA/refresh/reset thực đi qua HTTP trong bộ integration chung. Không seed session, user hoặc quyền thử vào database phim thật.

## Hồi quy chung

`npm.cmd run build` và `npm.cmd run typecheck` đạt. Lần chạy integration cuối đạt **1.934 assertion** trong khoảng 6,6 giây, đã bao gồm 840 assertion mới:

| Nhóm có số liệu riêng | Assertion |
| --- | --- |
| Auth security mới | 840 |
| MFA/local/production policy | 42 |
| Swagger local/public và production/disabled | 40 |
| Viewer/account/playback/library | 200 |
| Global exception | 509 |

Các dòng trên là nhóm con, không phải toàn bộ tổng số. Phần còn lại gồm admin/media/client và các kiểm tra hiện có.

Bộ chung kiểm password/MFA, challenge đúng purpose, MFA retry/concurrency, recovery code, step-up, rotation/replay refresh, reset dùng một lần/thu hồi phiên, public signup không nhận role, catalog draft và token playback theo scope. Có kiểm audit rollback và bảo vệ SUPER_ADMIN cuối.

**Không bật frontend hoặc worker integration trong lần chạy này**: frontendChecks=0, workerIncluded=false. Không cộng số browser/RabbitMQ của lần trước. Cloudinary không được pentest hoặc upload mới; URL CDN là giới hạn còn mở.

## Xác minh runtime và database local

Bốn probe trên API đang chạy: health 200; admin titles không token 401; admin users và me với JWT hỏng 401. Chỉ probe đọc, không đăng nhập hoặc đổi quyền tài khoản thật.

Cấu hình local quan sát được: development, bind 127.0.0.1, MFA=false, Swagger=true; JWT/CURSOR có độ dài tối thiểu 64 và là hai khóa khác nhau. Không in giá trị khóa.

| Quyền database đã đọc | API login | Worker login |
| --- | --- | --- |
| Superuser / tạo DB / tạo role / bypass RLS | Không | Không |
| Sở hữu bảng movie | 0 | 0 |
| INSERT roles / UPDATE role_permissions | Không | Không |
| UPDATE/DELETE audit_logs | Không | Không |
| INSERT audit_logs | Có | Có |
| Đọc password_hash / refresh_tokens | Có, phục vụ auth | Không |

Ownership của user ở API được thực thi tại guard/service/query; không coi việc role database không có bypass RLS là bằng chứng dự án đã bật PostgreSQL RLS.

Đã build code mới nhưng không restart API đang phục vụ; khóa local cũ vốn đủ dài. Validator mới sẽ có hiệu lực khi tiến trình API đọc code mới ở lần khởi động tiếp theo. Kiểm thử HTTP cô lập đã chạy ứng dụng từ source mới.

## Chạy lại và bằng chứng

```powershell
Set-Location E:\pj-Flim
# Truyền PJ_FLIM_TEST_ADMIN_PASSWORD qua biến môi trường tiến trình.
$env:PJ_FLIM_TEST_WEB = "false"
$env:PJ_FLIM_TEST_WORKER = "false"
npm.cmd run test:integration
npm.cmd run typecheck
npm.cmd run build
```

Runner tạo và drop database pj_flim_test_<random> của chính lần chạy; không chạy fixture trong pj_flim. Không ghi mật khẩu vào source/command được commit.

Báo cáo riêng tư: .local/api/auth-security-result.json, auth-runtime-result.json, integration-result.json và auth-security-integration.log. Không commit log/credential. Tổng kết công khai này không chứa JWT, refresh token, mật khẩu hoặc URL video đã ký.

Cần kiểm tiếp khi triển khai production: TTL/thu hồi CDN, HTTPS/reverse proxy tin cậy, luồng MFA/reset/email thật và UI MFA cho staff, rate limit nhiều instance/chống spam telemetry, browser XSS/CSRF theo thiết kế session đã chọn và kiểm thử truy cập từ môi trường triển khai thật. Các mục đó chưa được nghiệm thu bởi lần chạy local này.

Căn cứ rà soát: [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) về mặc định từ chối và kiểm quyền mỗi request; [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) về khóa thuật toán và từ chối alg=none. Kết quả đạt/fail trong báo cáo dựa trên source và bài kiểm thử của dự án.
