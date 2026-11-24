# Tài khoản, đoàn phim và nội dung trang chủ — 24/11/2026

Đã triển khai trong E:\pj-Flim. Không migration hoặc thêm bảng; database giữ54bảng. OpenAPI hiện110operation/84path/56admin, registry90mã lỗi. Mọi đường dẫn API bên dưới có tiền tố /api/v1.

## Giao diện

| Trang | Chức năng |
| --- | --- |
| /account | Trạng thái email, gửi lại email xác minh, thiết lập TOTP và hiển thị8mã khôi phục một lần |
| /forgot-password | Gửi yêu cầu reset với thông báo giống nhau cho email tồn tại/không tồn tại |
| /reset-password | Nhập token dùng một lần và mật khẩu mới12–128ký tự, kiểm nhập lại trước gửi |
| /verify-email | Xác minh bằng token hoặc yêu cầu gửi lại email |
| /admin/titles/:id | Gán người/vai trò/nhân vật; bổ sung ngôn ngữ và mã quốc gia vào metadata |
| /admin/reports | EDITOR/ADMIN/SUPER_ADMIN có quyền phù hợp đổi trạng thái và ghi chú; AUDITOR vẫn chỉ đọc dữ liệu đã lọc |
| / | Hiển thị banner đang bật/đúng lịch/gắn phim public-playable, tên và mô tả website từ settings |

Menu tài khoản có link bảo mật; login có link quên mật khẩu. Header/footer dùng tên website đã cấu hình, tên dài được thu gọn ở màn hình nhỏ. Cập nhật banner/settings qua API quản trị làm dữ liệu trang chủ được đọc lại trong cùng tab.

## API bổ sung

| Method / path | Quyền và hợp đồng |
| --- | --- |
| GET /me/mfa | Own authenticated session; enabled/requiredForLogin, no-store |
| POST /me/mfa/enrollments | Mật khẩu hiện tại, giới hạn5lần/giờ/user; trả id/secret/otpauthUri/expiresAt, no-store |
| POST /me/mfa/enrollments/:id/verifications | Code6chữ số, enrollment đúng owner/session, hạn10phút, tối đa5lần sai và20request/giờ/user; trả8recoveryCodes một lần |
| GET /site | Public, chỉ name/description/supportEmail và tối đa10banner đủ điều kiện, không trả settings nội bộ hoặc draft |
| PATCH /admin/reports/:id | Đồng thời reports.read + catalog.write, If-Match bắt buộc, audit cùng transaction; response ETag mới |

Đoàn phim dùng PATCH /admin/titles/:id với credits và title ETag đang có; không tạo API trùng nghiệp vụ. Gửi412 giữ bản nháp, chỉ nút tải lại mới bỏ bản nháp. Lưu đoàn phim không tự nạp lại/ghi đè bản nháp metadata đang sửa ở khung trên; hai thao tác có thể xung đột ETag và phải được giải quyết chủ động.

Report dùng ETag dạng opaque do API quy định theo id/version; không tự tải version mới để ghi đè xung đột. Tác vụ đổi status kiểm lại quyền/phiên trong transaction và ghi audit; không mở quyền sửa cho AUDITOR.

## MFA

Secret TOTP được mã hóa AES-GCM bằng cấu hình khóa hiện hành; recovery codes chỉ lưu hash. Tạo/confirm khóa serialize theo user, kiểm lại session; mã sai tăng bộ đếm bền trước trả422. Xác nhận thành công ghi last_accepted_step và mfa_verified_at/step_up_at của chính phiên đã chứng minh mã. Chưa có màn hình tắt/reset factor.

Màn hình hiển thị khóa TOTP để nhập thủ công vào ứng dụng xác thực, không gửi khóa tới dịch vụ QR bên ngoài. Không ghi secret/recovery/password vào localStorage, URL, docs hoặc log. Chỉ hiển thị recovery codes trong bộ nhớ của trang ở lần confirm đầu; không cung cấp endpoint đọc lại codes.

Theo lựa chọn local trước đây, AUTH_MFA_REQUIRED=false vẫn được giữ nguyên: đã thiết lập factor nhưng đăng nhập local chưa đòi mã. UI hiển thị rõ requiredForLogin=false; production luôn giữ chính sách MFA hiện hành. Không tự thay policy hoặc vô hiệu hóa factor. Staff production chưa có factor vẫn dùng quy trình bootstrap/thiết lập được quản lý trước khi cấp quyền, không nới login guard để bỏ enrollment.

## Email

Đặt PUBLIC_WEB_ORIGIN trong .env.api.local để email có liên kết đúng host. Giá trị chỉ origin, không path/query/userinfo; HTTPS khi dùng domain public. Local mặc định http://localhost:3000. SMTP production vẫn phải cấu hình theo runbook mail đang có; thêm giao diện không chứng minh email thật đã được gửi.

Liên kết mới dùng /verify-email#token=... hoặc /reset-password#token=...; token không gửi trong request GET tới server. Trang lấy token vào bộ nhớ và xóa khỏi thanh địa chỉ bằng replaceState, giữ history state. Chỉ POST khi người dùng bấm nút; truy cập link không tự tiêu thụ token. Có ô nhập token cho email cũ. Reset thành công thu hồi auth/playback theo AccountsService hiện hành và xóa session phía trình duyệt.

Client không refresh/replay login token khi API báo AUTH_INVALID_CREDENTIALS do nhập sai mật khẩu hiện tại; refresh khi access token hết hạn vẫn hoạt động.

## Kiểm thử

Hồi quy API/security/viewer/frontend:2624kiểm tra đạt, gồm275frontend; matrix56admin operation,941securitychecks. Chrome và PostgreSQL tạm riêng; provider upload/video giả lập. Report .local/api/integration-result.json, log .local/reviews/regression.log. API/web build/typecheck đạt. Không phải kiểm SMTP thật, thiết bị Safari/Android hoặc inference model.
