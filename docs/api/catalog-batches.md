# Quản lý phim hàng loạt

Cập nhật 25/11/2026, Asia/Saigon. Đã triển khai trong E:\pj-Flim. API hiện có 125 operation/97 path, gồm 66 operation admin; 90 mã lỗi, 19 permission/46 liên kết role.

## Sử dụng trên giao diện

Mở /admin/titles, chọn từng phim hoặc tối đa 20 phim đang hiển thị. Chọn thao tác, thể loại nếu cần và nhập lý do 3–500 ký tự. Bấm **Xem trước thay đổi** để xem trạng thái trước/sau và kết quả dự kiến từng phim. Chỉ khi bấm **Xác nhận thực hiện** mới thay đổi phim.

Có bốn thao tác:

- Gắn thêm thể loại: hợp với danh sách hiện tại, không trùng.
- Thay toàn bộ thể loại: thay bằng danh sách đã chọn, ít nhất một thể loại.
- Xuất bản phim: phải có tập đã xuất bản với HLS và backup đủ điều kiện.
- Ẩn phim: thay trạng thái của phim, không tự thay trạng thái các tập.

Tối đa 30 thể loại cho một phim. Đổi bộ lọc hoặc danh sách chọn sẽ bỏ bản xem trước đang hiển thị. Đợt đã tạo vẫn có thể đọc trong /admin/catalog-batches. Trang lịch sử chỉ hiện đợt do chính tài khoản hiện tại tạo.

## Quyền và hợp đồng REST

Tất cả endpoint yêu cầu đăng nhập và catalog.read_drafts. Tạo/xác nhận/tiếp tục còn kiểm tra quyền hiện hành theo thao tác: catalog.publish cho xuất bản/ẩn; catalog.write cho thể loại. Với role mặc định, EDITOR chỉ thao tác thể loại; ADMIN/SUPER_ADMIN có cả hai; MEMBER/AUDITOR không vào cụm này.

| Method | Endpoint | Kết quả |
| --- | --- | --- |
| POST | /api/v1/admin/catalog-batches/previews | 201, body bản xem trước, ETag và Location |
| GET | /api/v1/admin/catalog-batches?limit=20&state=RUNNING | 200, lịch sử riêng và cursor |
| GET | /api/v1/admin/catalog-batches/{id} | 200, chi tiết/kết quả và ETag |
| POST | /api/v1/admin/catalog-batches/{id}/execution | 200, kết quả hiện tại; body confirm=true, bắt buộc If-Match |

Ví dụ body xem trước:

```json
{
  "action": "ADD_GENRES",
  "titleIds": ["<UUID phim>"],
  "genreIds": ["<UUID thể loại>"],
  "reason": "Bổ sung thể loại sau khi kiểm tra nội dung"
}
```

Publication không nhận genreIds. DTO từ chối trường lạ, action lạ, UUID lỗi, danh sách trùng kể cả khác chữ hoa/thường, hơn 20 phim và hơn 30 thể loại. Response private, no-store; không trả owner/session ID. sameSession cho biết phiên hiện tại có thể thực hiện hay cần tạo bản xem trước mới.

401/403 cho xác thực/quyền, 404 cho đợt không thuộc tài khoản hoặc không tồn tại, 400 cho cursor không hợp lệ, 422 cho DTO, 428 thiếu If-Match, 412 sai ETag, 409 hết hạn/khác phiên/không có phim sẵn sàng, 503 lỗi ghi audit. Lỗi nghiệp vụ từng phim nằm trong items khi request trả 200; client phải đọc counts/items để phân biệt áp dụng thành công và thất bại. Dùng application/problem+json qua global handler cho lỗi cấp request.

## Cơ chế xử lý và tiếp tục

1. PREVIEW: transaction đọc nhất quán quyền, phim, thể loại và readiness; lưu tham số bất biến cùng expectedVersion của từng phim. Chưa sửa phim. Hết hạn sau 5 phút.
2. Xác nhận: khóa dòng đợt, kiểm tra owner, đúng auth session, quyền hiện hành, ETag và thời hạn. Chuyển RUNNING; hạn thực hiện 15 phút kể từ lúc bắt đầu.
3. Mỗi phim READY được xử lý trong một transaction: khóa đợt, kiểm quyền lại, gọi CatalogService bằng transaction hiện có, kiểm phiên bản phim, kiểm HLS/backup nếu xuất bản, rồi ghi thay đổi + audit/outbox + biên nhận APPLIED. Tất cả cùng commit.
4. Xung đột phiên bản, phim bị xóa hoặc không còn phát được: rollback phim đó, lưu FAILED cùng mã lỗi và tiếp tục phim khác. BLOCKED/UNCHANGED trong bản xem trước được bỏ qua.
5. Lỗi auth, lỗi hạ tầng hoặc ghi audit: dừng request và giữ phần chưa commit ở READY. Phim đã commit vẫn APPLIED. Đọc lại đợt rồi bấm tiếp tục trong cùng phiên và trước hạn.
6. Không còn READY: chuyển COMPLETED. Gửi lại yêu cầu với ETag gốc của preview hoặc ETag biên nhận hiện tại không áp dụng trùng. Không tự lấy phiên bản mới của phim để ghi đè.

FAILED/BLOCKED không được tự thử lại với dữ liệu mới trong cùng đợt. Sửa nguyên nhân rồi tạo preview mới. Khi đổi phiên đăng nhập hoặc quá hạn cũng cần preview mới; các phim đã có trạng thái đích có thể trở thành UNCHANGED.

Đây là thực thi đồng bộ có giới hạn và biên nhận bền trong PostgreSQL. Chưa có scheduler hay worker tự tiếp tục. Đóng trang/hủy request phía trình duyệt không đảm bảo dừng phần server đã nhận; đọc lịch sử trước khi tạo thao tác khác. Hàng loạt không phải một transaction chung cho 20 phim, vì vậy có thể thành công một phần.

## Database và vận hành

[movie-catalog-batches-v1.sql](../design/sql/movie-catalog-batches-v1.sql) thêm catalog_batches, tổng 59 bảng. Owner user FK CASCADE, auth session FK SET NULL; lưu action/reason/genre IDs/items/version/state/deadline/timestamps. CHECK giới hạn trạng thái, kích thước items, lý do và thể loại; index owner/created_at/id cho cursor. Chỉ movie_api có CRUD, worker/auditor không được đọc. Audit vẫn append-only ở bảng riêng.

```powershell
Set-Location E:\pj-Flim
$env:PJ_FLIM_APPLY_CATALOG_BATCHES='true'
npm.cmd run db:catalog-batches
npm.cmd run db:introspect
npm.cmd run db:generate
npm.cmd run build:all
npm.cmd run openapi:export
powershell.exe -NoProfile -File scripts/Start-LocalProcess.ps1 -Service api
```

Migration additive có transaction/advisory lock và xác minh cấu trúc/grants; chạy lại không tạo thêm đợt hay thay phim. Không dùng db push. Các thay đổi quan trọng nằm ở CatalogBatchService/Controller/DTO; CatalogService dùng chung nghiệp vụ từng phim qua transaction truyền vào.

Kiểm thử: npm.cmd run test:catalog-batches dùng cấu hình test riêng như các suite hiện có; tạo và xóa database pj_flim_test_<random>, không dùng catalog thật làm fixture. [Bằng chứng](../testing/catalog-batches-2026-11-25.md).

Giới hạn còn mở: lưu trữ/dọn lịch sử theo retention policy riêng, hẹn giờ xuất bản, xử lý quy mô lớn bằng worker, hủy đợt phía server và kiểm duyệt review hàng loạt. Chưa nghiệm thu tải production hoặc nhiều instance.
