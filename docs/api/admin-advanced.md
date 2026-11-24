# Các công cụ quản trị nâng cao

Cập nhật 25/11/2026. Đã có kiểm duyệt đánh giá người xem, kiểm tra chất lượng kho phim và xuất CSV lượt xem. Mở /admin sau khi cập nhật database và build.

## Kiểm duyệt đánh giá

Trang /admin/viewer-reviews dành cho tài khoản có reviews.moderate. Mặc định chỉ ADMIN và SUPER_ADMIN có quyền này; EDITOR, AUDITOR và MEMBER bị từ chối ở API.

Có thể lọc VISIBLE/HIDDEN và chọn “Chỉ xem phim này”. Mỗi thẻ hiển thị điểm, nội dung dạng văn bản, tác giả, trạng thái và lý do xử lý gần nhất. Spoiler vẫn cần mở để đọc. Không trả email hoặc userId.

Ẩn/khôi phục yêu cầu lý do3–500ký tự sau trim. Lý do hiển thị cho tác giả ở phần đánh giá của họ; chưa có email/push notification. Trạng thái HIDDEN bị loại khỏi cả danh sách và điểm trung bình công khai. Người viết vẫn được sửa/xóa đánh giá của mình; sửa không tự khôi phục hiển thị.

PATCH dùng If-Match của phiên bản người quản trị đã đọc. Moderator và tác giả dùng cùng advisory lock theo user/title; version tăng khi đổi nội dung hoặc trạng thái. Xung đột trả412, UI giữ lý do đã nhập và yêu cầu đọc bản mới trước khi quyết định. UUID cũ không thể tác động đánh giá mới sau xóa/tạo lại. Gửi lại cùng trạng thái với ETag hiện hành là no-op, không đổi lý do/version hoặc thêm nhật ký.

Thay đổi trạng thái và audit viewer-review.moderated cùng transaction; ghi audit lỗi sẽ rollback. Audit lưu beforeStatus/afterStatus/lý do/actor/requestId, không sao chép toàn bộ nội dung review. Người quản trị không sửa điểm hoặc nội dung thay tác giả và không có API xóa review của người khác.

## Kiểm tra chất lượng kho phim

Trang /admin/catalog-health dùng catalog.read_drafts: EDITOR, ADMIN, SUPER_ADMIN. Tìm tên phim, lọc vấn đề, phân trang cursor và xem tổng số phim theo bộ lọc. Bảng chỉ ra thiếu poster, tóm tắt, thể loại, năm, ngôn ngữ, đoàn phim hoặc tập đã xuất bản có asset sẵn sàng. Cảnh báo riêng cho phim PUBLISHED không còn tập phát được.

videoReady dựa trên trạng thái asset/HLS/backup đã lưu, cùng điều kiện assetReady của hệ thống; không gọi CDN hoặc xác nhận chất lượng giải mã. Cảnh báo metadata không tự tạo quy định chặn xuất bản mới. Đây là công cụ đọc; mọi thao tác xuất bản vẫn kiểm tra lại điều kiện, quyền và ETag tại API hiện có.

Summary phản ánh toàn bộ kết quả theo q/issue trước phân trang. Query được giới hạn120ký tự, page tối đa100; cursor ràng buộc bộ lọc và giữ độ chính xác timestamp. Không đưa draft ra API public, không tự sửa/xuất bản phim.

## Xuất CSV lượt xem

Nút “Xuất CSV” trên /admin dùng metrics.read: ADMIN, SUPER_ADMIN, AUDITOR. Chọn7/30/90ngày. API ghi audit metrics.views.exported trước khi trả file; nếu audit lỗi thì không xuất file.

CSV dùng UTF-8 BOM, CRLF,10cột cố định: row_type,day_utc,title_id,title,qualified_views,playback_starts,definition_version,measurement_started_at,range_days,timezone. Các dòng TOTAL/DAILY/TOP_TITLE lần lượt là tổng, ngày và top10 phim công khai đang phát được. Phần daily bao gồm ngày không có lượt; timezone UTC và định nghĩa2 giữ nguyên.

File giữ nguyên chuỗi số bigint, escape dấu nháy/comma/xuống dòng và thêm dấu nháy đơn trước nội dung có thể thành công thức spreadsheet. Không chứa user/session/guest identifiers hoặc URL ký. Khi nhập Excel, chọn kiểu Text cho cột số rất lớn để tránh Excel tự làm tròn; kiểm thử xác nhận byte CSV, chưa điều khiển Excel.

Frontend tải Blob qua API client chung, giữ luồng refresh token, lỗi Problem Details và hủy request khi rời trang. Không đưa Bearer vào link tải hoặc lưu URL tải công khai.

## API và lỗi

| Endpoint | Quyền |
| --- | --- |
| GET /api/v1/admin/viewer-reviews?status=HIDDEN&titleId=... | reviews.moderate |
| GET /api/v1/admin/viewer-reviews/:id | reviews.moderate |
| PATCH /api/v1/admin/viewer-reviews/:id/moderation | reviews.moderate |
| GET /api/v1/admin/catalog-health?q=...&issue=NO_POSTER | catalog.read_drafts |
| GET /api/v1/admin/metrics/views/export?days=7 | metrics.read |

Giữ GlobalExceptionFilter và90errorcodes:401/403 cho auth/quyền,400UUID/cursor,422DTO,404review không tồn tại,428thiếu If-Match,412phiên bản cũ,503AUDIT_WRITE_UNAVAILABLE. No-store cho dữ liệu riêng; CSV có Content-Disposition attachment. Swagger hiện121operation/93path,62admin. [OpenAPI](openapi.json).

## Migration và vận hành

[SQL additive](../design/sql/movie-admin-advanced-v1.sql) thêm4cột vào viewer_reviews: moderation_status,moderation_reason,moderated_at,moderated_by;2index phục vụ danh sách, CHECK bảo đảm HIDDEN có lý do/thời điểm. Không thêm bảng: tổng58. Thêm permission reviews.moderate và2liên kết role; tổng19permission/46liên kết.

API vẫn dùng login runtime giới hạn; worker/auditor PostgreSQL không đọc viewer_reviews. Quyền AUDITOR ứng dụng xuất CSV không đồng nghĩa quyền đọc bảng review bằng SQL. Không tự đổi role của tài khoản hoặc ẩn dữ liệu có sẵn khi migrate; review mặc định VISIBLE.

```powershell
Set-Location E:\pj-Flim
$env:PJ_FLIM_APPLY_ADMIN_ADVANCED='true'
npm.cmd run db:admin-advanced
npm.cmd run db:introspect
npm.cmd run db:generate
npm.cmd run build:all
npm.cmd run openapi:export
powershell.exe -NoProfile -File scripts/Start-LocalProcess.ps1 -Service api
```

Migration từ chối database hệ thống, khóa advisory, DDL trong transaction và xác minh cột/index/grants; chạy lại an toàn. db:viewer-reviews cũ chấp nhận các cột mở rộng mới. F5/Ctrl+F5 để frontend đọc lại /me và menu quyền hiện hành.

Kiểm thử: npm.cmd run test:admin-advanced dùng credential test theo runner hiện có, tạo/xóa database pj_flim_test_<random>, không dùng review/tài khoản thật làm fixture. Xem [báo cáo](../testing/admin-advanced-2026-11-25.md).

Các phần chưa có: báo cáo vi phạm review từ người xem, kháng nghị, kiểm duyệt AI, kiểm duyệt review hàng loạt, lịch xuất bản, email thông báo và export theo job dài. Giữ các hạng mục này trong backlog.


Quản lý phim hàng loạt đã triển khai riêng: [catalog-batches](catalog-batches.md). Snapshot mới125ops/97paths/66admin và59bảng; số121/93/62/58 ở trên mô tả bản admin-advanced ban đầu.
