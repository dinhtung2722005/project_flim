# Luồng lấy review TMDB

Cập nhật 23/11/2026. Đã triển khai backend, PostgreSQL, Swagger, màn hình quản trị và trang chi tiết phim. Đã kiểm thử với HTTP provider giả lập; **chưa xác nhận gọi TMDB thật vì token chưa được cấu hình và xác thực tại máy**.

OMDb vẫn phục vụ điểm IMDb/Metascore của notebook. Tính năng này lấy **review do người dùng TMDB viết**, gồm tác giả, điểm cá nhân thang 10, nội dung, ngôn ngữ, thời điểm và liên kết gốc. Không gọi đó là review IMDb/Metacritic hoặc điểm tổng hợp của phim.

## Cấu hình và chạy

1. Đăng nhập tài khoản TMDB và đăng ký API tại [TMDB API](https://developer.themoviedb.org/docs/getting-started). Lấy **API Read Access Token**, không phải tự đặt chuỗi bất kỳ.
2. Thêm hai biến trong [.env.reviews.example](../../.env.reviews.example) vào **E:\pj-Flim\.env.api.local**. Điền token thật tại máy; không gửi qua chat, không đưa vào Git hoặc VITE_.
Bạn cũng có thể nhập token bằng lệnh sau từ E:\pj-Flim. Lệnh nhập ẩn giá trị ở ô **Mã truy cập đọc API**, xác thực với TMDB trước khi lưu vào .env.api.local, rồi khởi động lại API. Không dùng giá trị ở ô Khóa API:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "E:\pj-Flim\scripts\Configure-TmdbLocal.ps1" -RestartApi
~~~

Lỗi xác thực, mất kết nối hoặc token sai định dạng không thay đổi file môi trường. RemoteSigned ở lệnh này chỉ áp dụng cho tiến trình đang chạy; không sửa chính sách CurrentUser/LocalMachine. Máy đang có effective policy Restricted, có thể chặn lệnh cũ trước khi hỏi nhập token. [Giải thích của Microsoft](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies/).

Nếu còn lỗi, gửi mã lỗi và HTTP status, không gửi token: TMDB_TOKEN_FORMAT_INVALID là sai định dạng; TMDB_AUTH_REJECTED là HTTP401/403; TMDB_RATE_LIMITED là429; TMDB_UNAVAILABLE là5xx; TMDB_CONNECTION_FAILED là mạng/DNS/proxy/TLS. Lỗi đường dẫn script dùng đường dẫn tuyệt đối ở lệnh trên. Nếu chỉ muốn lưu cấu hình mà chưa restart, bỏ -RestartApi.

3. Chạy migration bổ sung bằng PowerShell:

~~~powershell
$env:PJ_FLIM_APPLY_REVIEWS='true'
npm.cmd run db:reviews
npm.cmd run db:introspect
npm.cmd run db:generate
npm.cmd run build:all
~~~

Migration có advisory lock, từ chối database hệ thống, lưu danh sách schema trước thay đổi tại .local/reviews/pre-migration-schema.json. Chạy lại chỉ kiểm tra schema/grants; không xóa dữ liệu. Database hiện hành có 54 bảng, thêm review_sources và external_reviews; baseline 47 bảng giữ nguyên. Không dùng db push.

4. Khởi động lại API bằng quy trình hiện có; khi đang chạy local bằng script dự án:

~~~powershell
powershell.exe -NoProfile -File scripts/Start-LocalProcess.ps1 -Service api
~~~

5. Mở **/admin/titles/{UUID}**, tìm mục **Review từ TMDB**. Bấm **Tìm phim trên TMDB**, đối chiếu tên/năm/loại, chọn ID rồi **Kiểm tra và lưu liên kết**. Bấm **Tải review**.
6. Người xem đọc ở **/titles/{UUID}#reviews**. Phim phải PUBLISHED và có media đủ điều kiện; phim nháp chỉ được xem review trong quản trị.

Khi thiếu token, API vẫn khởi động; trả danh sách rỗng với meta.status=NOT_CONFIGURED. Quản trị giải thích thiếu cấu hình và khóa nút gọi nguồn. Không sinh review hoặc điểm giả. Không có quyền catalog.write thì không thể tìm/liên kết/tải/xóa nguồn.

## Các API

Prefix /api/v1. GET công khai không gọi TMDB; chỉ đọc cache PostgreSQL.

| Method | Path | Quyền / hành vi |
| --- | --- | --- |
| GET | /titles/:id/reviews | Public, chỉ phim đủ điều kiện; limit/cursor |
| GET | /admin/titles/:id/review-source | catalog.read_drafts; cấu hình an toàn, trạng thái, ETag |
| GET | /admin/titles/:id/reviews | catalog.read_drafts; preview kể cả phim nháp |
| GET | /admin/titles/:id/review-candidates | catalog.write; tìm tối đa 10 ứng viên từ tên/năm trong DB |
| PUT | /admin/titles/:id/review-source | catalog.write + If-Match; body externalId kiểu số nguyên |
| POST | /admin/titles/:id/review-sync | catalog.write; tải và cập nhật cache |
| DELETE | /admin/titles/:id/review-source | catalog.write + If-Match; xóa mapping và cache, 204 |

ETag là giá trị opaque gồm version và generation UUID của mapping. Dùng nguyên header có dấu ngoặc kép từ GET; không tự dựng từ version. Mapping chưa tồn tại cũng có ETag. Việc xóa rồi tạo lại không cho phép ETag của bản đã xóa ghi đè mapping mới. 412 yêu cầu đọc lại; giao diện không tự lấy ETag mới để ghi đè.

Payload PUT chỉ nhận:

~~~json
{"externalId": 155}
~~~

ID là ID TMDB movie hoặc TV theo loại phim trong DB, không phải IMDb ID. Không nhận URL tùy ý, verified, title name hay loại nguồn từ client. Search trả verified=false; server đối chiếu lại detail trước khi ghi. Bắt buộc có năm, tên local/original khớp sau chuẩn hóa và năm chênh tối đa một năm; khác loại hoặc không khớp bị từ chối. Trường hợp tên bản dịch không khớp cần sửa original_title đúng phim rồi thử lại, không bỏ kiểm tra.

GET trả data/page/meta; meta có status, provider, scope=TMDB_USER_REVIEWS, ratingScale=10, attribution, sourceUrl, refreshedAt/expiresAt. Review có author/content/rating nullable/language/sourceUrl/sourceCreatedAt/sourceUpdatedAt/fetchedAt. NULL không chuyển thành 0.

| status | Ý nghĩa |
| --- | --- |
| DISABLED | Nguồn bị tắt qua REVIEWS_ENABLED=false |
| NOT_CONFIGURED | Thiếu token |
| UNMAPPED | Chưa liên kết ID |
| NOT_FETCHED | Đã liên kết, chưa tải |
| STALE | Cache hết 24 giờ hoặc metadata phim đổi version; trả rỗng |
| READY | Cache còn hạn, kể cả nguồn trả đúng 0 bài |

Lỗi nguồn lần cập nhật sau không xóa cache hợp lệ trước đó. lastError có mã an toàn ở API quản trị; cache vẫn hết hạn đúng TTL. Danh sách rỗng READY khác với lỗi nguồn và khác với chưa cấu hình.

## Thuật toán đồng bộ và an toàn

1. Guard xác thực session/RBAC hiện hành; service kiểm lại catalog.write trong transaction. Budget 10 thao tác gọi nguồn/phút/người quản trị.
2. Khóa title/mapping, đặt lease UUID 45 giây; từ chối lượt đang chạy và yêu cầu cách nhau ít nhất 60 giây mỗi phim. Ghi audit started cùng transaction.
3. Đối chiếu lại detail TMDB, gọi /movie/:id/reviews hoặc /tv/:id/reviews với vi-VN, page=1. Chỉ khi vi-VN trả 0 bài mới thử en-US; lỗi vi-VN không bị coi là rỗng.
4. HTTPS cố định api.themoviedb.org, Bearer trong header, không theo redirect; mỗi request tối đa 8 giây, hai lần gọi review có chung hạn 20 giây. Response tối đa 1.024.000 byte.
5. Kiểm schema, ID phim/page/review ID, URL bài gốc, tên tác giả và thang điểm; tối đa 20 bài, mỗi nội dung tối đa 12.000 ký tự. Loại script/style/tag HTML, không render HTML/Markdown. Nội dung dài là phần giới hạn; link gốc cho bài đầy đủ. Không tải avatar, không theo liên kết trong bài.
6. Transaction cuối kiểm lại quyền/session, version title/mapping, đúng lease và chưa hết hạn. Thay toàn bộ cache, đặt TTL 24 giờ và audit completed cùng transaction. Thiếu quyền ghi audit thì rollback.
7. Khi lỗi chỉ giải phóng lease của chính lượt đó; không ghi đè mapping đã đổi. Mapping bị xóa/thay hoặc title đổi trong lúc tải dẫn tới REVIEW_CONTEXT_CHANGED.
8. Đọc public kiểm lại publication/media; cursor ký HMAC và bind title, scope admin/public, generation/version và lần refresh. Cursor cũ sau refresh/mapping đổi bị từ chối.

Không tự xuất bản phim hoặc tạo video. Không đưa review chưa tin cậy vào system prompt. Đồng bộ hiện do quản trị chủ động; chưa có lịch RabbitMQ tự refresh. Cache quá hạn không được hiển thị, nhưng hàng cũ chỉ bị thay/xóa ở lần sync hoặc gỡ mapping tiếp theo.

## Mã lỗi

Lỗi giữ application/problem+json và requestId của global exception handler; không lộ token/body lỗi nguồn.

| Code | HTTP |
| --- | --- |
| REVIEW_PROVIDER_NOT_CONFIGURED | 503 |
| REVIEW_PROVIDER_AUTH_FAILED | 503 |
| REVIEW_PROVIDER_RATE_LIMITED | 429 |
| REVIEW_PROVIDER_UNAVAILABLE | 503 |
| REVIEW_PROVIDER_INVALID_RESPONSE | 502 |
| REVIEW_MAPPING_MISMATCH | 422 |
| REVIEW_SOURCE_NOT_MAPPED | 409 |
| REVIEW_SYNC_IN_PROGRESS | 409 |
| REVIEW_CONTEXT_CHANGED | 409 |

Các lỗi chuẩn khác: VALIDATION_FAILED=422, AUTHENTICATION_REQUIRED=401, AUTH_FORBIDDEN=403, PRECONDITION_REQUIRED=428, RESOURCE_VERSION_MISMATCH=412, RATE_LIMITED=429, REQUEST_INVALID_CURSOR=400 và RESOURCE_NOT_FOUND=404. Swagger /api/docs có nhóm Viewer / Reviews và Admin / Reviews cùng schema response.

## Notebook và agent

Đã sửa ba điểm ở notebook Colab: hiển thị URL review, giữ review_refs khi model chỉ trích dẫn catalog, coi đúng DDGSException("No results found.") là kết quả rỗng. Timeout/lỗi nguồn vẫn báo lỗi.

Notebook search_web hiện **chỉ tìm URL**, có read_verified=false/da_doc_bai=false; không đọc hoặc copy bài từ Moveek/VnExpress/Guardian. Website chatbot CATALOG chưa có tool đọc external_reviews hay tổng hợp nội dung TMDB; người xem đọc ở trang chi tiết. Không coi phần này là đã nghiệm thu inference Qwen/Colab thật.

## Nguồn và attribution

[TMDB movie reviews](https://developer.themoviedb.org/reference/movie-reviews), [TV reviews](https://developer.themoviedb.org/reference/tv-series-reviews), [FAQ/cấp phép và attribution](https://developer.themoviedb.org/docs/faq). API miễn phí cho mục đích phi thương mại theo điều kiện TMDB; dùng thương mại cần kiểm tra giấy phép tương ứng.

UI có link bài gốc, tên TMDB, logo từ URL asset chính thức và thông báo: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Trang /help#credits có mục nguồn. Logo tải từ host TMDB; CSP chỉ cho phép đường dẫn asset logo, không mở kết nối API TMDB từ trình duyệt.

## Kiểm thử

~~~powershell
npm.cmd run test:reviews:provider
# Thiết lập PJ_FLIM_TEST_ADMIN_PASSWORD riêng trong môi trường, không ghi vào source.
npm.cmd run test:reviews
~~~

test:reviews tạo database pj_flim_test_<random>, migration đầy đủ, HTTP thật qua NestJS, frontend Chrome và provider HTTP giả lập; xóa đúng database thử ở cuối. Cần Chrome ở đường dẫn Windows hiện hành và build:all trước khi chạy. Không dùng dữ liệu mẫu video READY trong database thật. Báo cáo: [kiểm thử review](../testing/reviews-2026-11-23.md).
