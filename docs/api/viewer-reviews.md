# Đánh giá của người xem pj-Flim

Cập nhật25/11/2026. Đây là đánh giá do tài khoản pj-Flim đăng trực tiếp, độc lập với điểm IMDb/Metacritic qua OMDb và review TMDB.

## Trải nghiệm

Trang chi tiết phim và trang xem video có mục **Đánh giá của người xem**. Khách đọc được danh sách, điểm trung bình và số người đánh giá. Đăng nhập để chấm điểm1–10, viết nhận xét tùy chọn tối đa2000ký tự, sửa hoặc xóa đánh giá của mình.

Mỗi tài khoản chỉ có một đánh giá cho mỗi phim. Form viết mới yêu cầu người xem chủ động chọn điểm, không chấm sẵn. Sửa điểm cập nhật trung bình, không tạo phiếu mới. Không có đánh giá thì average=null, giao diện hiện dấu —. Nhận xét có cờ tiết lộ nội dung được thu gọn sau thao tác mở của người đọc; cờ do tác giả chọn, không bảo đảm phát hiện mọi spoiler.

Điểm chung là trung bình cộng của các rating VISIBLE từ tài khoản ACTIVE, làm tròn1chữ số thập phân. Tài khoản SUSPENDED/DELETED không xuất hiện trong danh sách hoặc trung bình. Không gắn nhãn “đã xem” khi chưa có xác minh playback.

## API

Prefix /api/v1. GET public dùng no-store; các route /me dùng private,no-store và Bearer/session hiện hành.

| Method | Path | Đầu ra |
| --- | --- | --- |
| GET | /titles/:id/viewer-reviews?limit=5&cursor=… | data/page/summary; chỉ phim public đủ điều kiện phát |
| GET | /me/title-reviews/:id | review hoặc null; ETag cho trạng thái hiện tại |
| PUT | /me/title-reviews/:id | Tạo/sửa đánh giá của phiên hiện hành; If-Match bắt buộc |
| DELETE | /me/title-reviews/:id |204, ETag trạng thái rỗng; xóa riêng đánh giá của phiên |

:id là UUID title, không phải userId hoặc reviewId. Client không truyền owner/userId/role/status/version. Body:

~~~json
{"rating":8,"content":"Phim có nhịp kể tốt.","containsSpoilers":false}
~~~

rating là số nguyên1–10, không nhận chuỗi. content mặc định rỗng, trim đầu/cuối, giới hạn2000ký tự, chặn ký tự điều khiển không phù hợp. containsSpoilers mặc định false, phải boolean. DTO whitelist chặn trường lạ. UUID/page/cursor dùng validation chung.

Tạo mới cũng phải GET review=null để lấy ETag trước. ETag có user/title/review UUID/version, nên phiên cũ không ghi đè bản đã xóa/tạo lại. Per-user/title advisory transaction lock xử lý hai PUT cùng ETag: chỉ một lần commit. Sửa không thay created_at; cursor latest-created giữ thứ tự ổn định và timestamp microsecond PostgreSQL đầy đủ.

## Phân quyền và lỗi

- Owner từ Principal, không lấy từ request body. Current session/auth version/account được kiểm lại trong transaction bằng checkViewer; staff theo chính sách MFA hiện hành.
- GET own và PUT yêu cầu title public/playable. DELETE vẫn cho owner xóa đánh giá sau unpublish khi có ETag hiện hành; không trả metadata title ẩn. Chưa có trang quản lý tất cả đánh giá của mình.
- Mỗi account tối đa10PUT/phút bằng PostgreSQL security-event budget; không phải Redis. DELETE không dùng chung quota viết để vẫn xóa được sau khi chạm giới hạn.
- Public chỉ trả author=display_name, review UUID, rating/content/spoiler và timestamps. Không trả email/userId/session/version của chủ bài.
- Nội dung được render dạng React text, giữ xuống dòng, không chạy HTML/Markdown hoặc fetch URL trong bài.
- UI giữ bản nháp khi412; chỉ tải/thay bản nháp khi người dùng bấm nút Tải lại. Chuyển tài khoản/logout/title sẽ unmount form, hủy request và xóa state riêng.

| HTTP/code | Ý nghĩa |
| --- | --- |
|401 AUTHENTICATION_REQUIRED / AUTH_SESSION_REVOKED | Thiếu hoặc mất phiên hợp lệ |
|404 RESOURCE_NOT_FOUND | Title nháp/ẩn/không có tập phát được |
|422 VALIDATION_FAILED | Body, UUID hoặc paging không hợp lệ |
|400 REQUEST_INVALID_CURSOR | Cursor sai hoặc dùng sang phim khác |
|428 PRECONDITION_REQUIRED | Thiếu If-Match |
|412 RESOURCE_VERSION_MISMATCH | Đánh giá vừa đổi hoặc ETag thuộc owner/resource khác |
|429 RATE_LIMITED | Vượt quota PUT |

Không thêm error code; dùng application/problem+json/requestId chuẩn hiện hành. Swagger khai báo request/response/ETag/security. Hiện121operation/93path/62admin,90errorcodes.

## Database và cài đặt

Migration additive [movie-viewer-reviews-v1.sql](../design/sql/movie-viewer-reviews-v1.sql) thêm viewer_reviews, tổng55bảng.

| Trường | Ràng buộc |
| --- | --- |
| id | UUID PK |
| title_id, user_id | FK title/user, CASCADE khi xóa vật lý |
| rating | smallint1..10 |
| content | text<=2000, mặc định rỗng |
| contains_spoilers | boolean mặc định false |
| version | bigint>0, tăng khi sửa |
| created_at, updated_at | timestamptz |

UNIQUE(user_id,title_id); index(title_id,created_at DESC,id DESC). API đượcCRUD; movie_worker/movie_auditor/PUBLIC không có quyền trực tiếp. Database constraint/quota không thay current-session/ownership ở service.

~~~powershell
Set-Location -LiteralPath 'E:\pj-Flim'
$env:PJ_FLIM_APPLY_VIEWER_REVIEWS='true'
npm.cmd run db:viewer-reviews
Remove-Item Env:PJ_FLIM_APPLY_VIEWER_REVIEWS
npm.cmd run db:introspect
npm.cmd run db:generate
npm.cmd run build:all
npm.cmd run openapi:export
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/Start-LocalProcess.ps1 -Service api
~~~

Không đổi baseline DDL hoặc dùng Prisma db push. Migration chạy lại kiểm table/columns/grants; không reset dữ liệu. Không cần key OMDb/TMDB cho đánh giá pj-Flim.

## Kiểm thử và phạm vi

[Integration](../../tests/viewer-reviews.integration.ts) chạy trên PostgreSQL tạm/Chrome: auth, DTO, owner isolation, aggregate, concurrent ETag, delete/recreate, cursor microsecond/query binding, author deactivation, quota và XSS/spoiler/form conflict/mobile/logout. Lệnh npm.cmd run test:viewer-reviews cần test database admin credential riêng, không dùng database thật làm fixture.

Xem [báo cáo25/11](../testing/viewer-reviews-2026-11-25.md). UI người xem có thể dùng ngay sau migration/restart. Đã có [kiểm duyệt admin](admin-advanced.md); chưa có report review chuyên biệt, hữu ích/vote, trả lời lồng nhau hoặc tích hợp đánh giá nội bộ vào chatbot; các phần đó cần yêu cầu riêng.

Cập nhật admin25/11: own GET/PUT có moderationStatus/moderationReason/moderatedAt; review HIDDEN không vào public summary/list. Tác giả được sửa/xóa nhưng không tự khôi phục; moderator đổi trạng thái làm ETag owner cũ bị412. Migration mới giữ58bảng.
