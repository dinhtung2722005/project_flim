# Kế hoạch hoàn chỉnh: Web xem phim với Node.js và Cloudinary

Ngày lập: 08/11/2026. Cập nhật: 11/11/2026, múi giờ Asia/Saigon. Phiên bản: 2.7.

Phiên bản 2.7: theo yêu cầu mới, bỏ đăng nhập Swagger local: UI/spec mở trực tiếp, bỏ form/cookie/CSRF/docs-session và tự chèn token. Bookmark docs-login redirect sang docs. API nghiệp vụ vẫn giữ Bearer/session/RBAC; production hoặc SWAGGER_ENABLED=false không mount docs. Build/export và 1.142 kiểm tra đạt, gồm 40 kiểm tra Swagger và 41 MFA/local; Chrome thật chạy headless đã render 87 operation không có form. Không đổi schema hoặc xử lý ST01–ST06.

Phiên bản 2.6: sửa lỗi CSRF khi mở nhiều tab Swagger: giữ token cookie ổn định trong 30 phút, tái hiện form khi cookie hết hạn/thiếu hoặc token không khớp. Trình duyệt nhận HTML 403 có thông báo, client JSON vẫn nhận AUTH_CSRF_INVALID; giữ Origin/Fetch Metadata, CSRF và password/RBAC. Build và 1.167 kiểm tra đạt, gồm 45 kiểm tra mới; API đã restart và 13 kiểm tra runtime đạt. Không đổi schema/endpoint hoặc hoàn tất ST01–ST06.

Phiên bản 2.5: theo yêu cầu bỏ mã MFA khi dùng local, thêm AUTH_MFA_REQUIRED=false cho API/Swagger và thao tác quản trị. Mặc định vẫn yêu cầu MFA; production luôn bật. Giữ mật khẩu, session/revocation, RBAC, audit và SUPER_ADMIN cuối; không giả thời điểm MFA/step-up. Build và 1.122 kiểm tra đạt trên DB tạm riêng, có RabbitMQ; 52 kiểm tra policy MFA/local mới. Không đổi schema hoặc hoàn tất ST01–ST06.

Phiên bản 2.4: đã chuẩn hóa [global exception handler](../api/exception-handling.md) riêng trong filters/, đăng ký APP_FILTER và dùng chung cho lỗi NestJS/Express/parser/Swagger. Có Problem Details với requestId/retryable, lọc field errors, ánh xạ lỗi HTTP/Prisma/PostgreSQL và bảo vệ response đã gửi header. Registry runtime 73 code; build và 1.070 kiểm tra đạt, gồm 509 assertion mới cho handler. Endpoint vẫn 87 operation/67 path; không thay schema hoặc hoàn tất các ticket streaming ST01–ST06.

Phiên bản 2.3: bổ sung backlog streaming ST01–ST06 tại mục 11.1: giới hạn URL CDN tĩnh, quota phiên theo IP/proxy, chống spam telemetry trước xác thực, analytics/retention, kiểm thử player/tải và backup/webhook production. Mỗi mục có ưu tiên, phạm vi code, phụ thuộc và tiêu chí nghiệm thu. Đây là cập nhật kế hoạch, chưa sửa source hoặc ghi nhận các vấn đề đã được khắc phục.

Phiên bản 2.2: [API người xem](../api/viewer-api.md) đã chạy local: thêm 27 operation cho catalog công khai, playback HLS/session/renewal/telemetry, đăng ký/email xác minh/reset, watchlist/history/resume và report. Tổng OpenAPI 87 operation/67 path, gồm 49 admin; 68 error code và 561 kiểm tra HTTP/client/worker đạt. Dùng 47 bảng hiện có, không migration mới. C08 core API và C11 backend đã có; frontend/player, admin preview, subtitle delivery, analytics consumer và production CDN protection còn thiếu. Email local đã kiểm thử, SMTP chưa nghiệm thu thật. Signed CDN URL không tự hết hạn; production mặc định chặn cấp URL nếu chưa chấp nhận rõ giới hạn. Video thật trước đó vẫn DRAFT.

Phiên bản 2.1: [RabbitMQ worker/HLS/webhook/backup](../api/media-worker.md) đã chạy tự động local; video thật 20 phút 11 giây có 5 rendition 180p–720p, backup khớp SHA-256 và đủ điều kiện READY. Phim vẫn DRAFT. Đã có API processing retry, 49 endpoint admin/60 operation tổng, 65 error code và 367 kiểm tra HTTP/client/worker. Backup local/tunnel là cấu hình dev; production yêu cầu S3 versioning/private bucket, webhook cố định, AMQPS và nghiệm thu restore/HA. C06 còn UI admin; C07 core đã nghiệm thu local, chưa coi hoàn tất production.

Phiên bản 2.0: đã có [Cloudinary signed upload và xác minh nguồn](../api/cloudinary-upload.md), 48 endpoint admin/59 operation tổng và 312 kiểm tra HTTP/client. C06 có adapter, cấu hình, intent, direct/chunked upload helper và metadata verification; đã nghiệm thu video thật 20 phút 11 giây, HLS có 5 mức 180p–720p; worker/webhook/backup/playback/frontend còn thiếu. Verification thực tế trả 200 đồng bộ sau kiểm tra provider, rồi ghi operation/outbox xử lý HLS bền; không đánh dấu READY.

Phiên bản 1.9: [API admin/Swagger](../api/README.md) đã chạy local với Prisma, JWT session/MFA, 45 endpoint admin (56 operation tổng), RBAC/publication guards, audit transaction và 212 kiểm tra HTTP trên PostgreSQL tạm riêng. C01/C03/C04/C05 có phần source API; C02 có bootstrap SQL và Prisma client. Chưa đánh dấu công đoạn hoàn tất khi migration, public API, worker hoặc frontend còn thiếu.

Phiên bản 1.8: database local `pj_flim` đã được tạo trên PostgreSQL 17.11 tại `127.0.0.1:5432`, schema `movie`, đủ 47 bảng và seed RBAC. [Hướng dẫn/script database thực tế](../../database/README.md) có kiểm tra constraint, runtime grants và chạy lại bootstrap. C02 hoàn thành một phần (bootstrap SQL); chưa có Prisma migration, API, worker hoặc frontend.

Phiên bản 1.7 bổ sung [thiết kế database PostgreSQL](../design/movie-database-design.md): 47 bảng, 4 ERD, DDL, seed 5 role/18 permission, grants và script kiểm tra SQL. Baseline đã kiểm tra trên PostgreSQL nhúng; chưa có Prisma migration, kiểm thử nhiều connection hoặc database web phim triển khai thực tế.

Phiên bản 1.6 liên kết [thiết kế backend chi tiết](../design/movie-backend-design.md): module, source tree, bảng/constraint, transaction, auth/refresh race, media pipeline, job lease và playback/resume. Mục 7/10 của plan vẫn là nguồn hợp đồng API/quyền/lỗi; phần triển khai được cụ thể hóa trong tài liệu backend, chưa có code web phim chạy thật.

Phiên bản 1.5 bổ sung xác thực JWT/refresh và MFA, ma trận role/permission, audit log admin có kiểm soát, Swagger UI được bảo vệ và các API/mã lỗi/kiểm thử tương ứng. Đây là yêu cầu code ở C02–C05/C09/C12; chưa phải tính năng đã triển khai.

Phiên bản 1.4 thay mục 14.3 bằng thứ tự viết code C01–C12: project, database, REST/error handling, auth, catalog, Cloudinary, worker, playback, UI, player, tính năng cá nhân và hoàn thiện kiểm thử. Mỗi bước chỉ rõ module/file và kết quả chạy được. Mọi bước vẫn NOT_STARTED.

Phiên bản 1.2 chuẩn hóa RESTful API, HTTP status, Problem Details RFC 9457, mã lỗi nghiệp vụ, ETag/If-Match, idempotency và hợp đồng OpenAPI. Danh sách endpoint bên dưới thay thế các tên thao tác cũ; chưa có API web phim đang chạy cần giữ tương thích.

Phiên bản 1.1 bổ sung xuất bản từng tập, API sự kiện cho khách/tài khoản, gia hạn nhiều vòng có kiểm soát, player theo khả năng thiết bị, điều kiện thử Cloudinary, dự toán/backup cụ thể và các mốc bàn giao MVP. Các thay đổi được tích hợp vào nghiệp vụ, dữ liệu, API và nghiệm thu bên dưới.

Đây là kế hoạch triển khai sản phẩm mới, tổng hợp các quyết định và phương án khắc phục đã thống nhất trong trao đổi. Những biện pháp dưới đây là yêu cầu thiết kế và nghiệm thu; chưa phải báo cáo đã sửa hoặc kiểm thử ứng dụng. Tài liệu và các bước triển khai dự án web phim được đặt trong thư mục `pj-Flim`; các đường dẫn dự án lấy thư mục này làm gốc.

## 1. Mục tiêu và phạm vi

Xây web xem phim theo yêu cầu (VOD) có trải nghiệm quen thuộc: trang chủ nền tối, poster, banner, danh mục, tìm kiếm, chi tiết phim, chọn tập, phát HD và xem tiếp. Hỗ trợ phim lẻ và phim bộ, responsive trên điện thoại và máy tính. Nội dung sử dụng nguồn được phép phân phối.

Quyết định sản phẩm:

- MVP cho khách duyệt, tìm kiếm và xem nội dung miễn phí đã xuất bản; tài khoản dùng để đồng bộ lịch sử và yêu thích. Khách lưu vị trí xem trên thiết bị; cả khách và tài khoản có phiên phát để đo chất lượng dịch vụ.
- Khu vực quản trị quản lý phim, mùa/tập, video, phụ đề, banner, publication, tài khoản/quyền theo ma trận; có audit log và Swagger phục vụ phát triển được kiểm soát truy cập.
- Cloudinary lưu video, poster, trailer; xử lý các bản phát và phân phối bằng CDN.
- Backend Node.js/NestJS quản lý nghiệp vụ; RabbitMQ điều phối tác vụ nền; Redis phục vụ cache và giới hạn request.
- Phim chính phát HLS nhiều chất lượng đến tối đa 1080p khi nguồn và gói Cloudinary đáp ứng. Player mặc định Auto; lựa chọn chất lượng thủ công chỉ xuất hiện khi adapter/thiết bị đã được kiểm thử hỗ trợ.
- Bổ sung đánh giá, gợi ý nâng cao, VIP, thanh toán, nhiều hồ sơ và gợi ý hành vi sau MVP. MVP dùng danh sách biên tập và phim cùng thể loại cho các hàng liên quan. Không cần microservices, 4K, live stream hoặc DRM cho phiên bản đầu.
- Giao diện tham khảo cách bố trí quen thuộc của các nền tảng xem phim; thiết kế thương hiệu và tài sản giao diện riêng.

Luồng sản phẩm phải hoàn chỉnh: tạo tập → upload → xử lý → xem thử → xuất bản → tìm phim → xem → tiếp tục xem.

## 2. Công nghệ và trách nhiệm

| Thành phần     | Lựa chọn                                    | Trách nhiệm                                                         |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Frontend       | Next.js App Router, React, TypeScript       | Trang công khai render phía server; player và tương tác phía client |
| Giao diện      | Tailwind CSS, shadcn/ui                     | Responsive, dark mode, bàn phím và trạng thái loading/error         |
| Dữ liệu client | TanStack Query                              | Cache dữ liệu tương tác, mutation, hủy request cũ                   |
| Backend        | Node.js bản LTS còn hỗ trợ, NestJS          | REST API, quyền truy cập, upload intent, phiên phát                 |
| Database       | PostgreSQL, Prisma                          | Nguồn dữ liệu chính, migration, transaction và index                |
| Tìm kiếm       | PostgreSQL pg_trgm, tên chuẩn hóa           | Tìm tên gần đúng và không dấu cho MVP                               |
| Cache          | Redis                                       | Cache danh mục, rate limit, lease phiên phát nếu cần                |
| Hàng đợi       | RabbitMQ, Node client hỗ trợ confirms       | Tác vụ media, tìm kiếm, thông báo và đối soát                       |
| Media          | Cloudinary Node.js SDK và CDN               | Upload, eager processing, HLS, poster, trailer                      |
| Player         | HTML5 video, hls.js; HLS native khi phù hợp | ABR, buffer, tua, phụ đề, sự kiện chất lượng phát                   |
| Quan sát       | Log JSON, OpenTelemetry, hệ thống thu lỗi   | Theo dõi API, job, webhook và phiên phát                            |
| Kiểm thử       | Jest, Supertest, Playwright, Postman CLI    | Nghiệp vụ, hợp đồng API, hồi quy và end-to-end                      |
| Triển khai     | Docker, reverse proxy, GitHub Actions       | Build, CI, HTTPS, triển khai và rollback                            |

Khóa phiên bản thực tế trong lockfile sau khi thử tương thích. Tách Next.js, API và worker thành tiến trình có thể tăng số bản chạy độc lập. Redis có thể bị xóa cache mà không làm mất lịch sử, trạng thái xử lý hoặc công việc cần thực hiện.

Next.js hỗ trợ Server/Client Components cho cách chia trên. [Tài liệu Next.js](https://nextjs.org/docs/app/getting-started/server-and-client-components)

## 3. Kiến trúc

```mermaid
flowchart LR
    U[Người xem] --> FE[Next.js]
    FE --> API[NestJS API]
    A[Admin] --> API
    A -->|Signed direct upload| CL[Cloudinary]
    API --> PG[(PostgreSQL)]
    API --> R[(Redis)]
    PG --> O[Outbox publisher]
    O --> MQ[RabbitMQ]
    MQ --> W[Worker]
    W --> CL
    CL -->|Webhook có chữ ký| API
    U -->|Playlist và segment| CDN[Cloudinary CDN]
    CL --> CDN
```

Backend chia module: Auth, Users, Authorization, Audit, Catalog, Episodes, Media, Playback, Search, History, Watchlist, Admin, Jobs, Observability; cấu hình Swagger tách riêng. Ratings và gợi ý nâng cao bổ sung sau MVP. Dùng modular monolith cho nghiệp vụ và worker riêng cho công việc nền.

Video đi từ Cloudinary CDN đến trình duyệt. API chỉ trả metadata, kiểm tra quyền và quản lý phiên phát. RabbitMQ nhận thông điệp nhỏ chứa định danh và phiên bản; dữ liệu nhị phân video được lưu ở Cloudinary.

Cloudinary hỗ trợ tạo và phân phối adaptive streaming từ video nguồn. [Tài liệu HLS/DASH](https://cloudinary.com/documentation/adaptive_bitrate_streaming)

## 4. Tính năng và giao diện

| Màn hình      | Yêu cầu MVP                                                              | Nghiệm thu                                                                  |
| ------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Trang chủ     | Banner, phim mới, nổi bật, thể loại, tiếp tục xem                        | Không lẫn nội dung chưa xuất bản; poster tải theo vùng nhìn                 |
| Danh mục      | Phim lẻ/bộ; lọc thể loại, quốc gia, năm; sắp xếp                         | Bộ lọc nằm trong URL, quay lại giữ trạng thái                               |
| Tìm kiếm      | Tên Việt/Anh/tên khác, không dấu, gần đúng                               | Có loading, không kết quả, hủy kết quả request cũ                           |
| Chi tiết      | Poster, mô tả, trailer, diễn viên, mùa/tập                               | Nút xem trỏ đến tập hợp lệ; trailer chỉ tải khi cần                         |
| Player        | Auto; chất lượng thủ công theo khả năng; phụ đề, fullscreen, tốc độ, tua | Đổi chất lượng giữ vị trí; thiết bị chỉ hỗ trợ Auto không hiện lựa chọn giả |
| Danh sách tập | Tập hiện tại, trước/sau, tự chuyển                                       | Đếm ngược có hủy; bỏ qua tập chưa xuất bản                                  |
| Tài khoản     | Đăng ký, đăng nhập, xác minh/đặt lại mật khẩu                            | Thông báo rõ, token dùng một lần, phiên có thể thu hồi                      |
| Cá nhân       | Yêu thích, lịch sử, tiếp tục xem                                         | Unique theo tài khoản; khách có resume cục bộ; không lẫn dữ liệu người khác |
| Admin         | CRUD phim/tập, upload, tiến độ xử lý, xem thử, xuất bản phim và từng tập | Tập chưa sẵn sàng bị ẩn, các tập đã công khai vẫn xem được; có audit log    |
| Báo lỗi       | Báo video/phụ đề lỗi kèm tập và mã phiên                                 | Người dùng không cần cung cấp URL có token                                  |

Đường dẫn: `/`, `/movies`, `/series`, `/genres/[slug]`, `/search`, `/titles/[slug]`, `/watch/[episodeId]`, `/my-list`, `/history`, `/account`, `/admin`, `/admin/users`, `/admin/roles`, `/admin/audit-logs`. Màn hình quản trị chỉ hiển thị khi có permission tương ứng, API vẫn kiểm tra quyền độc lập.

Ảnh có kích thước đúng bố cục, placeholder và lazy loading; không autoplay hàng loạt trailer. Player có focus rõ, nhãn nút, phím tắt không chiếm phím khi đang nhập và phụ đề đọc được trên màn hình nhỏ.

## 5. Upload và xử lý Cloudinary

### 5.1. Upload intent và ràng buộc tài nguyên

1. Admin gọi API tạo upload intent cho tập, ghi owner, asset ID nội bộ và phiên bản dự kiến. Attempt/operation xử lý được tạo khi nguồn đã xác minh.
2. Backend kiểm tra quyền; tự chọn public ID duy nhất, preset, delivery type và tham số được phép; không cho client tự ký transformation tùy ý.
3. Trình duyệt upload trực tiếp bằng signed upload và cơ chế chunked được Cloudinary hỗ trợ. Hiển thị tiến độ, hủy và thử lại; không hứa khôi phục sau khi tải lại trang nếu SDK chưa hỗ trợ và chưa thử nghiệm.
4. API nhận thông báo hoàn tất nhưng kiểm tra tài nguyên phía provider trước khi gắn vào tập: định danh, resource type, intent, phiên bản, dung lượng và thời lượng thực tế.
5. Kiểm tra dung lượng trước cấp chữ ký, ở client và khi đọc metadata sau upload; cấu hình giới hạn theo gói provider. Cloudinary preset không có giới hạn byte riêng; chunked upload không vượt giới hạn mỗi file của tài khoản. Chữ ký không thay thế kiểm tra dung lượng và sở hữu tài nguyên. [Giới hạn preset](https://cloudinary.com/documentation/upload_presets).
6. Không tin URL hoặc MIME do trình duyệt gửi. Backend không tải tùy ý URL đầu vào. Từ chối tài nguyên không thuộc intent; đưa upload lỗi vào danh sách dọn có thời gian chờ.

Cloudinary hỗ trợ upload trực tiếp có chữ ký và chunked upload cho video lớn. [Tài liệu Node.js upload](https://cloudinary.com/documentation/node_image_and_video_upload)

### 5.2. Trạng thái và chuyển mã

```text
Asset: PENDING_UPLOAD → UPLOADING → UPLOADED → PROCESSING → READY
                              └→ FAILED          └→ FAILED
Lifecycle: ACTIVE → DELETING → DELETED
Title publication:   DRAFT → PUBLISHED → UNPUBLISHED → ARCHIVED
Episode publication: DRAFT → PUBLISHED → UNPUBLISHED → ARCHIVED
```

- Trạng thái upload phía UI mang tính tiến độ; backend xác nhận nguồn dữ liệu đáng tin trước khi chuyển `UPLOADED`.
- Ghi thay đổi asset và sự kiện `media.processing.requested` vào cùng transaction PostgreSQL/outbox.
- Worker yêu cầu profile HLS xác định trước, dùng eager asynchronous processing và URL webhook. Lưu cấu hình, request/attempt và danh tính đầu ra; không tạo lại vì người dùng bấm Play.
- Webhook upload thành công không được coi là webhook chuyển mã thành công. Chỉ đặt `READY` khi các đầu ra bắt buộc đã thành công và được kiểm tra khả năng truy cập theo chính sách phát.
- Đầu ra của attempt cũ hoặc asset đang xóa không được ghi đè attempt hiện tại. Thay trạng thái bằng điều kiện phiên bản trong transaction.
- Không tự công khai khi nhận webhook; admin xem thử rồi xuất bản. Có tác vụ phát hiện video xử lý lâu và kiểm tra lại provider.

Cloudinary hỗ trợ eager transformations chạy bất đồng bộ và thông báo khi đầu ra hoàn tất. [Tài liệu eager processing](https://cloudinary.com/documentation/eager_and_incoming_transformations)

### 5.3. Webhook bền vững

- Endpoint HTTPS giữ raw body để xác minh chữ ký bằng SDK, kiểm tra timestamp theo cửa sổ cấu hình và yêu cầu chống replay.
- Lưu event vào inbox bền vững trước khi trả `200`. Nếu chưa lưu được thì trả lỗi để provider có thể retry.
- Dùng ID sự kiện nếu có; nếu không, tạo khóa dedup từ thông báo đã xác minh, định danh asset/attempt và loại/kết quả sự kiện. Consumer kiểm tra trạng thái nghiệp vụ để chống xử lý trùng cả khi timestamp thay đổi.
- Inbox và outbox cho phép nhận webhook khi RabbitMQ tạm ngừng. Job xử lý inbox chỉ cập nhật đúng attempt hiện hành.
- Mỗi 5 phút quét attempt đang chờ quá lâu, giới hạn tốc độ gọi Admin API và tăng khoảng chờ khi provider báo giới hạn. Quá ngưỡng SLA xử lý đã đo cho kích thước tương ứng thì cảnh báo admin.
- Webhook lỗi nghiệp vụ được giữ để xử lý lại; không yêu cầu provider retry vô hạn cho payload đã lưu.

Cloudinary ký webhook và retry hữu hạn; job đối soát xử lý trường hợp thông báo không được nhận. [Tài liệu notifications](https://cloudinary.com/documentation/notifications)

### 5.4. Xuất bản độc lập ở cấp phim và tập

- `titles.publication_status` và `episodes.publication_status` là hai trường độc lập; `video_assets.processing_status` quản lý khả năng phát. Tài nguyên đang xóa không được dùng để xuất bản.
- Admin có thể chuẩn bị trạng thái tập khi phim còn draft. Xuất bản phim yêu cầu ít nhất một tập đã xuất bản có video `READY` và các điều kiện media/backup bắt buộc đạt. Không yêu cầu toàn bộ các tập dự kiến đều sẵn sàng.
- Xuất bản tập kiểm tra active asset và phiên bản trong transaction, dùng optimistic locking để tránh xung đột với thay/xóa video. Cho phép xuất bản lại từ `UNPUBLISHED` sau khi kiểm tra các điều kiện; tài nguyên `ARCHIVED` cần khôi phục bằng thao tác admin rõ ràng trước.
- Guard `canPlayEpisode` kiểm tra đồng thời: phim `PUBLISHED`, tập `PUBLISHED`, active asset `READY`, lifecycle `ACTIVE`, quyền xem hợp lệ nếu nội dung yêu cầu. Kiểm tra nguồn PostgreSQL khi tạo/gia hạn phiên; cache giao diện không quyết định quyền phát.
- Guard hiển thị tập dùng cùng quy tắc xuất bản và khả năng media. Danh mục chỉ hiển thị phim công khai có tập phát được; không trả tập draft qua danh sách tập, tìm kiếm, số đếm hoặc API tập tiếp theo.
- Ví dụ: tập 1–5 đã công khai vẫn xem được khi tập 6 đang xử lý. Tập 6 không xuất hiện hoặc được tự chuyển tới cho đến khi đủ điều kiện và được admin xuất bản.
- Gỡ tập chặn tạo phiên mới cho tập đó; gỡ phim chặn tất cả phiên mới bên dưới nhưng giữ nguyên trạng thái từng tập để có thể xuất bản lại có chủ đích. Độ trễ thu hồi phiên đã được cấp tuân theo mục 7.1.
- Sự kiện xuất bản/gỡ/thay media được ghi qua outbox, cập nhật catalog version và vô hiệu cache Redis/Next.js liên quan. Cache public còn sót có thể làm giao diện chậm cập nhật, nhưng API cấp quyền vẫn từ chối ngay theo trạng thái đã commit.

## 6. Phát video, HD và giảm dữ liệu truyền

### 6.1. Luồng phát

1. Player gọi `POST /episodes/{episodeId}/playback-sessions` theo hợp đồng mục 10; các đường dẫn API đều nằm dưới `/api/v1`.
2. Backend dùng guard `canPlayEpisode` ở mục 5.4 và kiểm tra giới hạn phiên nếu được bật; ghi viewer là user hoặc khách ẩn danh. Admin preview có quyền/loại phiên riêng, không đi qua luồng công khai.
3. Trả phiên phát, manifest đúng phiên bản, cách xác thực và thời hạn nếu áp dụng, cùng quyền gửi telemetry chỉ cho phiên đó; response cấp quyền dùng `Cache-Control: no-store`.
4. Player lấy master playlist, media playlist rồi segment trực tiếp từ Cloudinary CDN.
5. Trình duyệt giải mã; player tải trước trong giới hạn buffer, chọn chất lượng theo khả năng adapter và gửi sự kiện qua API ở mục 6.6.
6. Khi tua, tải segment của mốc cần xem; khi đổi tập, hủy request cũ và giải phóng player. Lưu tiến độ riêng qua API.

### 6.2. Cấu hình HD ban đầu

| Mức   | Bitrate video tham khảo cho H.264 | Quy tắc                       |
| ----- | --------------------------------- | ----------------------------- |
| 360p  | 0,6–0,9 Mbps                      | Mạng yếu                      |
| 480p  | 1–1,5 Mbps                        | Mức dự phòng                  |
| 720p  | 2–3 Mbps                          | HD phổ biến                   |
| 1080p | 4–6 Mbps                          | Khi nguồn và thiết bị phù hợp |

Đây là giá trị thử nghiệm, không phải bitrate cố định cho mọi phim hoặc cấu hình mặc định của Cloudinary. Bổ sung audio phù hợp, thường bắt đầu thử AAC stereo 128 kbps. Không nâng FPS hoặc upscale chỉ để có nhãn chất lượng cao.

- Bắt đầu H.264/AAC và profile HLS được tạo trước; kiểm tra manifest thực tế có đúng mức mong muốn.
- Với profile cho phép điều chỉnh, thử segment 4–6 giây và căn keyframe; xác minh khả năng cấu hình của Cloudinary thay vì coi mọi tham số FFmpeg đều có sẵn.
- Auto là mặc định. Ước lượng tốc độ tải có làm mượt; chọn bitrate với dư địa an toàn, hạ nhanh khi buffer thấp và tăng khi ổn định. Dùng ABR sẵn có của player, đo trước khi chỉnh thuật toán.
- Buffer phía trước thử 30 giây, back buffer 30 giây; kiểm soát cả dung lượng và giới hạn thiết bị. Đây là mục tiêu tải trước, không phải thời gian phải đợi để bắt đầu.
- Khi người xem khóa 1080p mà mạng không đủ, hiển thị gợi ý chuyển Auto; không âm thầm báo 1080p trong khi phát mức khác.
- Tua/đổi chất lượng giữ timeline; không tái tạo player cho mọi thay đổi giao diện. Retry có giới hạn, tránh vòng lặp reload toàn bộ video.

HLS có thể dùng native hoặc hls.js theo khả năng trình duyệt. [Tài liệu hls.js](https://github.com/video-dev/hls.js)

### 6.3. Tối ưu dung lượng

- Tạo bản mã hóa theo độ phức tạp từng phim trong khả năng profile provider; kiểm tra cảnh tối, chuyển động, grain và khuôn mặt. Không hứa giữ nguyên chất lượng ở mọi mức giảm bitrate.
- Dùng bộ mẫu và VMAF khi pipeline đo hỗ trợ; kết hợp xem bằng mắt. Các chỉ số chất lượng cần được so sánh trên cùng nguồn và cấu hình hiển thị.
- AV1/HEVC là bước sau: thử hỗ trợ thực tế của tài khoản Cloudinary, player và hardware decode; có H.264 dự phòng. Không bật codec mới toàn bộ catalog chỉ dựa vào khả năng parse codec của trình duyệt.
- Trailer MP4 có thể dùng `q_auto`/`f_auto` phù hợp. HLS dùng profile đã nghiệm thu; không ghép tham số tối ưu tùy tiện nếu chưa xác nhận provider hỗ trợ.
- Chỉ tải audio được chọn và phụ đề cần dùng; phụ đề WebVTT UTF-8, không tạo video riêng cho mỗi ngôn ngữ khi không cần.
- Tắt tải video ngoài màn hình, hạn chế prefetch tập tiếp theo và hủy tải khi rời trang.
- Brotli/gzip cho JS, CSS, JSON và playlist văn bản khi hệ thống phân phối hỗ trợ; không trông đợi nén HTTP thêm cho segment video đã nén.

`q_auto` và chọn kích thước phù hợp là các công cụ tối ưu Cloudinary cung cấp. [Tài liệu tối ưu video](https://cloudinary.com/documentation/video_optimization)

### 6.4. Chính sách lỗi player

| Loại lỗi                                  | Hành động                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Mất mạng/timeout                          | Giữ vị trí, retry backoff có giới hạn; khi mạng trở lại cho tiếp tục                                         |
| 401/403 đã xác định do hết hạn            | Một request gia hạn đang chạy trong mỗi đợt; nhiều vòng được phép khi còn quyền; retry hữu hạn và giữ vị trí |
| 403 do bị thu hồi/sai quyền hoặc cấu hình | Dừng gia hạn; hiển thị lý do phù hợp và gửi chẩn đoán, không thử cấp token vô hạn                            |
| 404 manifest/segment                      | Báo lỗi nội dung, gửi chẩn đoán; không tự chọn asset cũ khác phiên bản                                       |
| Codec/giải mã                             | Thử nguồn tương thích đã cấu hình hoặc thông báo thiết bị chưa hỗ trợ                                        |
| Buffer cạn liên tục                       | Auto hạ chất lượng; chế độ khóa chất lượng hiển thị gợi ý                                                    |
| Autoplay bị chặn                          | Bắt lỗi `play()`, hiện nút Phát/Phát tiếp                                                                    |

Trình duyệt có chính sách chặn autoplay có âm thanh; thao tác tự chuyển tập phải có phương án nút phát. [Tài liệu autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)

### 6.5. Player adapter và bảng khả năng

Giao diện điều khiển gọi một hợp đồng chung: `load`, `play`, `pause`, `seek`, `setQuality`, `setSubtitle`, `destroy`. Adapter hls.js và native HLS khai báo `canSelectQuality`, `canSelectSubtitle`, `canSetPlaybackRate` theo đường phát thực tế đã kiểm thử, không chỉ theo tên trình duyệt.

| Khả năng đã kiểm chứng         | Hành vi giao diện                                                      |
| ------------------------------ | ---------------------------------------------------------------------- |
| Điều khiển được rendition      | Hiển thị Auto và các mức thực có trong manifest; giữ vị trí khi đổi    |
| Đường phát chỉ hỗ trợ Auto     | Hiển thị Auto; ẩn lựa chọn chất lượng thủ công                         |
| Chọn phụ đề/tốc độ được hỗ trợ | Hiển thị các điều khiển tương ứng; không hiện track không tải được     |
| Không phát được codec/nguồn    | Dùng nguồn tương thích đã chuẩn bị hoặc thông báo thiết bị chưa hỗ trợ |

- Chốt thứ tự chọn adapter sau thử thiết bị ở G0; không mặc định hai adapter có cùng API hoặc tính năng. hls.js có API lựa chọn chất lượng riêng. [API currentLevel](https://hlsjs.video-dev.org/api-docs/hls.js.hls.currentlevel)
- Khi đổi tập/rời trang, hủy fetch, timer, listener và tác vụ gia hạn cũ; `destroy()` gọi lặp phải an toàn. Response về từ adapter/episode cũ không được cập nhật player mới.
- Trạng thái phát đang được báo cáo phải phản ánh nguồn thực tế. Nếu adapter không quan sát được rendition thì ghi `unknown`, không gán nhãn 1080p từ lựa chọn mong muốn.

### 6.6. API sự kiện phiên phát cho khách và tài khoản

Luồng resume và luồng telemetry được tách riêng. `PUT /me/watch-progress/{episodeId}` lưu tiến độ cá nhân; `POST /playback-sessions/{sessionId}/events` nhận dữ liệu đo từ cả khách và tài khoản. Lỗi gửi telemetry không được chặn phát video hoặc lưu resume.

- Tạo phiên cấp credential telemetry chỉ gắn với session/viewer và thời hạn, khác quyền CDN và quyền quản trị. Chỉ biết session ID không đủ để gửi dữ liệu vào phiên người khác; khách có định danh ẩn danh theo chính sách privacy.
- Credential telemetry chỉ dùng gửi events; guest đọc/gia hạn/đóng phiên cần management proof riêng, user có auth session và ownership tương ứng. Không dùng token analytics để lấy lại delivery credential hoặc quản lý phiên.
- Event chứa `eventId`, `sequence`, `type`, `elapsedMs`, `positionSeconds`, `assetVersion` và payload đúng schema. Khóa dedup là `(sessionId, eventId)`; sequence của luồng telemetry độc lập với sequence resume, event đến trễ vẫn có thể được nhận trong cửa sổ cho phép.
- Các loại sự kiện: `play_requested`, `first_frame`, `heartbeat`, `rebuffer_start`, `rebuffer_end`, `seek`, `quality_changed`, `error`, `ended`. Heartbeat mang thời gian thực xem và các khoảng đã phát phục vụ lượt xem cho cả khách; không ghi vào bảng resume cá nhân của khách.
- Batch thử mỗi 10 giây, tối đa 50 event/64 KB mỗi request; flush sớm khi có lỗi/kết thúc. Có buffer client hữu hạn và retry backoff theo ngân sách; drop dữ liệu đo cũ khi đầy thay vì gây tăng RAM hoặc cản player.
- API xác minh credential, session/asset, kiểu dữ liệu hữu hạn, kích thước, tốc độ gửi và thời hạn nhận; ghi bền batch rồi trả `202`. Event trùng trả thành công idempotent. Không nhận email, secret, full manifest URL có token hoặc thông điệp lỗi chưa được làm sạch.
- Batch hợp lệ ghi PostgreSQL/outbox; worker tổng hợp bất đồng bộ. Dùng RabbitMQ với routing/queue riêng cho analytics để không làm nghẽn lệnh xử lý media.
- Startup tính từ yêu cầu play tới khung hình đầu được quan sát; ưu tiên callback frame khi hỗ trợ, nếu dùng sự kiện dự phòng phải gắn nhãn phương pháp đo. Rebuffer tách khỏi pause, seek, startup và tab bị treo; ghép cặp theo session, event bị thiếu phải đánh dấu không đầy đủ thay vì tự điền bằng zero.
- Dashboard ghi tỷ lệ bao phủ telemetry, số phiên/lỗi thiếu dữ liệu và phương pháp đo. Thiết bị không quan sát được quality ghi `unknown`; không suy ra giữ HD chỉ từ độ phân giải màn hình.
- Mặc định raw event giữ 30 ngày, tổng hợp không định danh 90 ngày; đây là cấu hình sản phẩm, cần tính dung lượng và hỗ trợ xóa dữ liệu gắn với tài khoản theo chính sách mục 7.2.

## 7. Quyền xem và bảo mật

### 7.1. Chính sách media

| Loại nội dung              | Chính sách                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Poster/trailer công khai   | Delivery công khai, transformation được kiểm soát                                                                 |
| Video tập chưa xuất bản    | Dùng phương thức hạn chế truy cập đã thử nghiệm; chỉ cấp cho admin                                                |
| Video miễn phí đã xuất bản | API chỉ cấp thông tin phát cho bản đã xuất bản; chấp nhận khả năng chia sẻ link đã được cấp theo mô hình miễn phí |
| VIP sau MVP                | Token/cookie có hạn, phạm vi đúng tài nguyên, bảo vệ original/manifest/segment                                    |

- Thiết kế thử `authenticated` cho video tập từ khi upload và eager outputs tương ứng; kiểm chứng đầy đủ việc phát HLS trên các trình duyệt trước khi chốt cấu hình production.
- Signed upload xác thực thao tác upload; signed delivery URL xác thực URL; token/cookie có thời hạn giải quyết giới hạn thời gian. Không coi ba cơ chế là một.
- `private` có thể để bản biến đổi công khai; signed URL thông thường có thể được chia sẻ. Token/cookie phụ thuộc gói và cấu hình tài khoản Cloudinary. [Tài liệu access control](https://cloudinary.com/documentation/control_access_to_media)
- Khi triển khai quyền có hạn: cấu hình TTL ban đầu 15 phút và gia hạn trước khoảng 2 phút, thêm jitter và xử lý lệch đồng hồ; cho phép nhiều vòng gia hạn khi phiên còn quyền. Đây là tham số cần kiểm thử. Cơ chế token phải đi tới cả segment, không chỉ URL manifest.
- Mỗi session/credential generation chỉ có một request gia hạn đang chạy; timer và lỗi segment cùng chờ kết quả đó. Cập nhật generation tăng dần; response cũ không ghi đè credential mới. Đây là chống gọi trùng mỗi đợt, không phải giới hạn một lần trong cả phiên.
- Backend kiểm tra lại guard xuất bản, quyền, phiên và asset mỗi vòng gia hạn. Khi nhận 401/403, phân loại hết hạn với thu hồi/sai cấu hình trước khi cấp lại. Mỗi đợt thử tối đa 2 lần ở cấu hình đầu; lỗi chưa khôi phục thì hiện nút thử lại hoặc trạng thái hết quyền, không vòng lặp tự động vô hạn.
- Khi quay lại sau pause/tab nền hoặc mất mạng dài, kiểm tra thời hạn trước request mới; nếu cần thì gia hạn và tiếp tục ở vị trí đã lưu. Thử nghiệm phải bao gồm nhiều vòng TTL, pause qua hạn và trường hợp thu hồi trong lúc đang phát.
- Native HLS có hạn chế tùy biến request khác player JS; spike phải chứng minh URL/token/cookie hoạt động trên Safari, CORS và miền phân phối thực tế. Nếu gói chưa đáp ứng, chưa mở VIP.
- Gỡ xuất bản chặn phiên mới ngay; người đã có link/token có thể còn xem đến khi quyền/cache hết hiệu lực. Ghi rõ độ trễ thu hồi; trường hợp cần chặn gấp dùng cơ chế provider phù hợp và kiểm tra lại từ CDN.
- Token hết hạn không xóa dữ liệu đã buffer. Không cam kết ngăn ghi màn hình hoặc sao chép tuyệt đối; DRM là dự án riêng khi có yêu cầu.

### 7.2. Tài khoản và API

- Hash mật khẩu bằng Argon2id; admin bật MFA trước production. Session/refresh token có xoay vòng, thu hồi và phát hiện dùng lại theo thiết kế xác thực.
- Cookie dùng HttpOnly/Secure, SameSite và chống CSRF phù hợp; xác định allowlist CORS cụ thể. Không để API secret, khóa ký token hoặc URL có token trong log client.
- Kiểm tra role và quyền trên tài nguyên ở backend, gồm admin preview, sửa tập, xóa media và đọc lịch sử.
- Rate limit theo loại endpoint và tài khoản/IP; trả `429` rõ ràng. Không rate limit request segment bằng cơ chế API làm cản phát.
- Nội dung bình luận nếu bổ sung phải sanitize, có report/moderation. MVP dùng báo lỗi; đánh giá/bình luận là phạm vi sau MVP.
- Log và analytics dùng định danh tối thiểu, có thời hạn lưu; hỗ trợ xóa tài khoản/lịch sử theo chính sách sản phẩm.

### 7.3. Cơ chế xác thực, session và MFA

Lựa chọn triển khai: access JWT ngắn hạn và refresh token opaque xoay vòng, kết hợp auth_sessions phía server để thu hồi/đối chiếu quyền. Browser dùng cookie HttpOnly/Secure với CSRF phù hợp; bearer access token phục vụ client/API tooling được phép. JWT là thông tin xác thực API, không thay Cloudinary delivery token. NestJS có cơ chế guard/authentication để tích hợp cách này. [Tài liệu NestJS authentication](https://docs.nestjs.com/security/authentication)

- Access JWT có TTL thử 15 phút, sub/sid/jti/iss/aud/exp và authVersion; chỉ chấp nhận thuật toán/issuer/audience đã cấu hình. Không tin payload chỉ được decode hoặc role client gửi lên. Key ký có cách xoay và chỉ nằm ở server.
- Refresh token ngẫu nhiên đủ mạnh lưu trong cookie HttpOnly/Secure; database lưu hash, token family, generation, expiresAt, revokedAt và dấu vết xoay vòng. Thời hạn tối đa thử 7 ngày cho MEMBER, 8 giờ cho vai trò quản trị; admin idle timeout thử 30 phút. Đó là cấu hình khởi đầu cần kiểm tra UX và cập nhật.
- Renewal xoay refresh trong transaction; token cũ chỉ được nhận lại trong đúng luồng retry đã định nghĩa ở mục 10.6, cùng proof/operation context. Reuse ngoài luồng hợp lệ thu hồi token family và phát security event; không tạo cửa sổ cho phép mọi token cũ tùy ý dùng lại.
- API đọc auth_sessions và trạng thái user để kiểm revoked/suspended/authVersion. Thao tác quản trị đối chiếu nguồn PostgreSQL hiện hành, không chờ JWT tự hết hạn khi role bị gỡ. Cache nếu dùng phải có invalidation và không trở thành đường vượt qua thu hồi.
- Browser không lưu access/refresh token trong localStorage. Cookie access token và bearer token dùng cùng logic verify; nếu request gửi cả hai mà không khớp thì từ chối, không lấy cookie hợp lệ để che bearer không hợp lệ. Request cookie thay đổi dữ liệu cần CSRF/Origin checks, gồm login/renewal/logout theo luồng đã chọn.
- Ngoại lệ development hiện hành theo yêu cầu ngày 11/11/2026: AUTH_MFA_REQUIRED=false cho phép đăng nhập và thao tác quản trị bằng mật khẩu, bỏ MFA/step-up. Swagger chỉ hiển thị email/mật khẩu; API trả ACTIVE. Cờ mặc định true và không tắt được MFA ở production; bật lại MFA chặn phiên staff chưa xác minh và yêu cầu đăng nhập lại. RBAC, audit, quyền tài nguyên và bảo vệ SUPER_ADMIN cuối vẫn áp dụng.
- Khi policy MFA được bật, tất cả vai trò EDITOR/ADMIN/SUPER_ADMIN/AUDITOR phải hoàn tất MFA trước truy cập khu vực quản trị. Đăng nhập cần MFA tạo phiên PENDING_MFA và challenge có hạn, chưa cấp phiên/token đủ quyền admin. Credential tạm chỉ gọi endpoint challenge/enrollment được cho phép.
- MVP dùng TOTP và recovery codes một lần; TOTP secret mã hóa server-side, recovery codes lưu hash, giới hạn thử OTP và chặn dùng lại OTP trong cửa sổ đã tiêu thụ. Enrollment chỉ bật MFA sau kiểm tra mã xác minh; không ghi secret/OTP/recovery codes vào log. [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- Step-up gần đây, thử tối đa 10 phút, bắt buộc cho đổi role, khóa tài khoản quản trị, reset MFA, xóa media và xuất audit log. Step-up gắn session/actor, không truyền một cờ mfaVerified do client tự khai.
- Khóa tài khoản, đổi mật khẩu, reset MFA hoặc đổi role tăng authVersion, thu hồi phiên cần thiết và ghi audit. Luồng phục hồi MFA phải chứng minh danh tính, có reason/audit; không có endpoint bỏ MFA chỉ vì biết email.
- Public registration luôn cấp MEMBER. SUPER_ADMIN đầu tiên được tạo bằng bootstrap CLI có kiểm soát và audit actor SYSTEM; không seed mật khẩu production cố định và không có public API tự nhận quyền cao.
- Rate limit đăng nhập, OTP, reset/verification theo tài khoản đã băm và IP nguồn hợp lệ; phản hồi chung trước khi xác minh danh tính để hạn chế dò tài khoản. Phiên đăng nhập, refresh, logout và lỗi xác thực đều được quan sát mà không ghi token.

### 7.4. Phân quyền theo role, permission và tài nguyên

Role mặc định cố định cho MVP; permission là đơn vị kiểm tra trong controller/service, không dựa vào thứ tự số role. MEMBER là tài khoản thường; khách không có quyền quản trị. Một tài khoản có thể được gán nhiều role hợp lệ, quyền là hợp đã cấu hình, vẫn chịu điều kiện tài nguyên/MFA/step-up. Chưa mở UI tạo permission tùy ý trong MVP.

| Permission                          | MEMBER       | EDITOR | ADMIN            | SUPER_ADMIN      | AUDITOR        |
| ----------------------------------- | ------------ | ------ | ---------------- | ---------------- | -------------- |
| catalog.read_drafts / media.preview | Không        | Có     | Có               | Có               | Không          |
| catalog.write                       | Không        | Có     | Có               | Có               | Không          |
| catalog.publish                     | Không        | Không  | Có               | Có               | Không          |
| media.upload                        | Không        | Có     | Có               | Có               | Không          |
| media.retry                         | Không        | Không  | Có               | Có               | Không          |
| media.delete                        | Không        | Không  | Có, step-up      | Có, step-up      | Không          |
| reports.read                        | Không        | Có     | Có               | Có               | Có, DTO đã lọc |
| users.read                          | Chỉ bản thân | Không  | Có, DTO giới hạn | Có               | Không          |
| users.suspend                       | Không        | Không  | Chỉ MEMBER       | Có, có điều kiện | Không          |
| rbac.read                           | Không        | Không  | Có               | Có               | Có             |
| rbac.assign                         | Không        | Không  | Không            | Có, step-up      | Không          |
| mfa.reset_others                    | Không        | Không  | Không            | Có, step-up      | Không          |
| audit.read                          | Không        | Không  | Có               | Có               | Có             |
| audit.export                        | Không        | Không  | Không            | Có, step-up      | Có, step-up    |
| metrics.read                        | Không        | Không  | Có               | Có               | Có             |
| docs.read                           | Không        | Có     | Có               | Có               | Có             |
| settings.write                      | Không        | Không  | Không            | Có, step-up      | Không          |

- Dùng decorators `@Public()` cho route thật sự công khai và `@RequirePermissions(...)` cho route được bảo vệ; AuthenticationGuard → MfaGuard/StepUpGuard khi cần → PermissionsGuard → kiểm resource/scope trong service. Bỏ decorator không được mặc định thành route public.
- Quyền trên menu/nút frontend chỉ phục vụ UX. Việc sửa body, gọi URL trực tiếp, Swagger hoặc gửi lại request cũ vẫn phải bị backend kiểm tra.
- EDITOR tạo/sửa catalog và upload nhưng không publish/gỡ hoặc xóa media; ADMIN có quyền vận hành nội dung và khóa MEMBER, không tự gán role. SUPER_ADMIN mới gán role/reset MFA quản trị theo chính sách; AUDITOR chỉ đọc/xuất audit theo quyền, không sửa nội dung.
- Khóa hoặc gỡ role SUPER_ADMIN cuối cùng đang hoạt động bị chặn trong transaction có lock/constraint phù hợp; không chỉ SELECT COUNT rồi cập nhật rời rạc. Không cho tài khoản tự nâng quyền qua profile hoặc DTO đăng ký.
- Reset/disable MFA của SUPER_ADMIN cuối cùng cũng phải giữ đường phục hồi đã xác minh; không dùng API reset người khác để vô hiệu MFA rồi tự mở phiên đủ quyền. Quy trình bootstrap/recovery ngoài API nếu cần phải có audit riêng.
- Role assignment/status endpoint có If-Match, step-up ở trường hợp nhạy cảm, reason bắt buộc, cập nhật authVersion/thu hồi và audit trong cùng transaction. Gán role không tồn tại hoặc ngoài tập được phép bị từ chối.
- Playback, history/watchlist/report và session vẫn kiểm ownership; có docs.read hoặc audit.read không đồng nghĩa được xem dữ liệu cá nhân hay credential của mọi tài khoản.
- Worker không dùng JWT của admin trong queue. Message chỉ giữ actor/permission version/correlation metadata; trước side effect nhạy cảm worker kiểm lại publication, asset version và quyền/trạng thái hiện hành theo chính sách, hoặc hủy công việc đã mất quyền.
- Ma trận là nguồn cấu hình seed/permission constants và test. Role/quyền thay đổi có hiệu lực cho request quản trị tiếp theo dù access JWT còn hạn. Cơ chế guard và kiểm quyền server tham khảo [NestJS authorization](https://docs.nestjs.com/security/authorization).

### 7.5. Audit log admin và security events

Audit log trả lời ai làm gì, lúc nào, trên tài nguyên nào và kết quả; log kỹ thuật trả lời hệ thống lỗi ở đâu. Hai loại có thể liên kết requestId/traceId nhưng khác DTO, quyền đọc và retention. Việc log auth success/failure, từ chối quyền và loại bỏ dữ liệu nhạy cảm phù hợp hướng dẫn [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

- Các action tối thiểu: tạo/sửa phim/mùa/tập, đổi publication, intent upload, retry/delete/replace media, thay active asset, gán role, khóa/mở user, MFA/reset/thu hồi phiên, đọc/xuất audit và truy cập docs. Action dùng tên ổn định như `catalog.publication.changed`, `rbac.roles.changed`, `audit.export.requested`, khác error code API.
- `audit_logs` có id/eventId, occurredAt server UTC, actorId/actorType, actorRoleCodesSnapshot, action, resourceType/resourceId, outcome SUCCESS/DENIED/FAILED, requestId/traceId, reason, errorCode nếu có và allowlisted before/after diff. Actor snapshot chỉ mô tả lúc thực hiện, không được dùng để cấp quyền ở tương lai.
- IP/user-agent chỉ ghi khi cần, lấy IP từ cấu hình trusted proxy thay vì tin mọi X-Forwarded-For; mask/hạn chế quyền xem và giới hạn độ dài. Login thất bại dùng định danh tối thiểu đã băm, không lưu email nhập sai vô hạn.
- Diff chỉ nhận trường được duyệt, giới hạn kích thước và escape nội dung. Không lưu toàn bộ request/response, password/hash, bearer/refresh token, cookie, OTP/TOTP secret/recovery code, Cloudinary signature/API secret hoặc URL có credential. Audit UI render dữ liệu như text an toàn, không thực thi HTML từ log.
- Thao tác thay đổi nghiệp vụ ghi domain + audit + outbox cùng transaction; không thể trả thành công rồi đợi logger bất đồng bộ mới quyết định có dấu vết hay không. Audit append thất bại làm rollback mutation nhạy cảm và trả AUDIT_WRITE_UNAVAILABLE/503.
- Sự kiện DENIED/FAILED được ghi qua security_events/log pipeline độc lập với transaction nghiệp vụ đã rollback, có dedup/rate cap để không bị spam. Nếu pipeline log lỗi, cảnh báo và retry có giới hạn; không làm nghẽn luồng xem công khai chỉ vì logger bị chậm.
- Idempotency replay không tạo audit SUCCESS của một mutation lần thứ hai; có thể ghi access/replay event riêng. Worker ghi actorType SYSTEM/WORKER và initiatingActorId + operationId để nối từ yêu cầu admin đến side effect cuối.
- Tài khoản DB ứng dụng chỉ có quyền append/read audit theo nhiệm vụ, không có UPDATE/DELETE audit; cleanup/archive dùng service role chuyên trách. Không mở API sửa/xóa một dòng audit, kể cả SUPER_ADMIN. Quyền DB/backup vẫn cần bảo vệ; không tuyên bố bất biến tuyệt đối trước DBA.
- Mặc định lưu audit/security events 180 ngày, có index theo thời gian/actor/resource/action/outcome; archive/retention được cấu hình và dự toán riêng với telemetry 30 ngày. Không vô tình dùng job dọn watch_events để xóa audit.
- `/admin/audit-logs` có lọc thời gian, actor, action, resource, outcome và requestId, cursor ổn định; chỉ audit.read. Chi tiết hiển thị diff đã lọc và correlation; đọc log cũng có security access event nhưng không tạo vòng lặp log đọc chính nó.
- Export yêu cầu audit.export, step-up, reason và phạm vi thời gian hữu hạn; chạy nền, không export không giới hạn qua request đồng bộ. Artifact riêng tư có TTL thử 24 giờ, tải qua endpoint kiểm lại quyền; không phát link download công khai lâu dài. CSV nếu có phải xử lý formula injection.
- Thay role, khóa user, gỡ phim/xóa media và export yêu cầu reason được giới hạn độ dài. JSON body có trường reason khi phù hợp; DELETE nhạy cảm dùng header X-Change-Reason theo hợp đồng thay vì body DELETE không rõ ngữ nghĩa.

## 8. RabbitMQ, outbox và khôi phục lỗi

- Topic exchange `media.events.v1`; các queue riêng cho lệnh media, xử lý kết quả, cập nhật tìm kiếm và thông báo. Mỗi nhóm subscriber độc lập có queue riêng; worker cùng queue chia nhau công việc.
- Thông điệp gồm `eventId`, `schemaVersion`, `assetId`, `attemptId`, `occurredAt`, `traceId`; không chứa file hoặc secret.
- Dùng durable queue, persistent message, publisher confirms và xử lý unroutable message. Production cần chịu lỗi broker dùng quorum queues trên số node phù hợp, thông thường ba node; một node dev không có khả năng HA.
- Outbox publisher đọc event đã commit, gửi broker và chỉ đánh dấu sau confirm. Crash có thể gửi lặp nên consumer dùng inbox/idempotency key cùng transaction ghi kết quả.
- Consumer ACK sau khi lưu bền kết quả bước hiện tại. Với chuyển mã Cloudinary: ACK khi yêu cầu đã được tiếp nhận và ghi trạng thái, hoàn tất dựa vào webhook/đối soát; không giữ delivery chờ chuyển mã hàng giờ.
- Timeout khi gọi provider có thể là kết quả chưa biết: tra cứu asset/attempt/cấu hình trước khi gửi lại, tránh tạo transformation lặp hoặc gắn sai kết quả.
- Retry hữu hạn theo lớp lỗi: mạng/5xx theo lịch 30 giây, 2 phút, 10 phút; 429 theo hướng dẫn provider; sai file/quyền/cấu hình đưa vào failed/DLQ. Lịch là giá trị ban đầu để đo lại.
- Tránh `nack(requeue=true)` lặp nóng. Đưa tác vụ đến hạn vào outbox bằng lịch lưu trong PostgreSQL, rồi publish lại; trạng thái retry không chỉ nằm trong RAM.
- DLQ có màn hình lý do lỗi, thao tác retry có audit và bảo toàn idempotency. Giới hạn concurrency theo API quota và công việc thực tế.
- Chạy reconciler định kỳ để phục hồi outbox/inbox bị kẹt và processing không có kết quả.
- Telemetry được tổng hợp ở queue riêng, với giới hạn concurrency/batch; việc analytics chậm không được làm chậm cấp phiên phát hoặc xử lý video. Envelope media và envelope analytics có schema/version riêng, không ép event xem phim có trường `assetId` của job chuyển mã khi không phù hợp.

RabbitMQ phân biệt publisher confirms và consumer ACK; mất kết nối có thể làm thông điệp được giao lại. [Tài liệu RabbitMQ](https://www.rabbitmq.com/docs/confirms)

## 9. Thuật toán nghiệp vụ

### 9.1. Tìm kiếm tiếng Việt

- Lưu title gốc, title Việt và aliases; trường chuẩn hóa chữ thường, bỏ dấu, `đ` thành `d`, gom khoảng trắng.
- Ưu tiên exact match → prefix → khớp từ → trigram → diễn viên/mô tả. Không áp ngưỡng fuzzy quá thấp cho từ khóa rất ngắn.
- PostgreSQL pg_trgm với GIN/GiST phù hợp truy vấn; unique slug, index trạng thái và filter phổ biến. Dùng EXPLAIN trên dữ liệu kiểm thử.
- Debounce 300 ms, hủy request cũ và bỏ kết quả cũ; phân trang ổn định. Chỉ trả nội dung được phép hiển thị, gồm facets và số đếm.
- Cache từ khóa phổ biến, có TTL và version catalog. Nâng sang search engine riêng khi số đo cho thấy cần.

pg_trgm hỗ trợ độ tương tự chuỗi và index tìm gần đúng. [Tài liệu PostgreSQL](https://www.postgresql.org/docs/current/pgtrgm.html)

### 9.2. Phim tương tự và gợi ý

MVP dùng danh sách do admin biên tập hoặc cùng thể loại, lọc phim công khai có tập phát được và sort ổn định. Các bước chấm điểm/vector dưới đây là thiết kế sau MVP, không phải điều kiện mở bản đầu.

- Vector nội dung từ thể loại, quốc gia, diễn viên, đạo diễn và từ khóa; cosine similarity giữa các vector khác zero. Thiếu metadata dùng fallback biên tập/phổ biến.
- Tính trước top ứng viên khi metadata thay đổi hoặc qua job; lọc lại trạng thái xuất bản/quyền khi trả về.
- Gợi ý theo title, không liệt kê nhiều tập của cùng bộ. Giới hạn lặp thể loại và trộn nội dung mới.
- Sau khi có dữ liệu: `userVector = tổng(weight × movieVector)`; trọng số từ thời gian thực xem, thích và đánh giá. Không tính tua đến cuối thành hoàn tất.
- Thử score `0.65 × phù hợp + 0.20 × phổ biến + 0.15 × mới`, các thành phần chuẩn hóa cùng thang. Đây là cấu hình khởi đầu, cần đo và điều chỉnh.
- Cold start dùng nội dung biên tập, phổ biến và tùy chọn thể loại. Collaborative filtering để sau khi có dữ liệu đủ chất lượng.

### 9.3. Trending và lượt xem

MVP thu lượt xem hợp lệ từ sự kiện mục 6.6 và có thể dùng hàng nổi bật do admin chọn. Công thức suy giảm thời gian là bước tối ưu sau khi dữ liệu đủ; thu sự kiện bền và chống đếm trùng vẫn thuộc MVP.

`trending = tổng(eventWeight × exp(-ln(2) × ageHours / halfLifeHours))`.

- Thử half-life 48 giờ. Lượt xem hợp lệ cần thời gian thực xem tối thiểu, ví dụ 120 giây cho nội dung dài; trailer dùng quy tắc riêng.
- Khử lặp theo viewer/title/cửa sổ thời gian; không đếm lại khi refresh. Khách dùng ID phiên ẩn danh theo chính sách privacy, không coi IP là danh tính duy nhất.
- Giới hạn ảnh hưởng bất thường và tách admin preview/test khỏi thống kê. Counter Redis chỉ là tạm; tổng hợp bền từ event có dedup.

### 9.4. Tiến độ và nhiều thiết bị

- Client đăng nhập gửi progress khoảng 15 giây, khi pause, đổi tập và kết thúc qua API resume; telemetry có lịch riêng ở mục 6.6. Khách chỉ lưu resume cục bộ. `sendBeacon`/keepalive chỉ là bổ sung, không đảm bảo thông báo lúc đóng tab luôn đến.
- Payload có `sessionId`, `sequence`, `episodeId`, `assetVersion`, `positionSeconds`, `watchedDelta` và các khoảng đã phát kể từ heartbeat trước; timestamp server là mốc tin cậy. Tách khoảng tại sự kiện tua, không nối vị trí trước/sau tua thành thời gian đã xem. Giới hạn số khoảng và kích thước mỗi request.
- Unique `(sessionId, sequence)`; bỏ sequence cũ, kiểm tra vị trí/thời lượng hữu hạn và giới hạn watchedDelta theo thời gian thực có thể xảy ra. Analytics chỉ mang tính ước lượng, không dùng làm bằng chứng thanh toán.
- Mỗi lần bắt đầu xem cấp generation tăng dần cho tài khoản/hồ sơ và tập. Phiên mới nhận quyền cập nhật resume; heartbeat phiên cũ chỉ được lưu lịch sử phiên và không ghi đè resume của phiên mới.
- Trong cùng phiên cho phép vị trí giảm khi tua về. Không dùng MAX(position) và không dùng thời điểm request đến để chấp nhận heartbeat phiên cũ.
- Vị trí cuối và cờ hoàn tất tách riêng; hoàn tất thử khi có ended hợp lệ và hợp các khoảng thực xem đạt 90%, có xử lý timeline credits theo metadata. Server gộp các khoảng giao nhau và kiểm tra tiến độ phù hợp thời gian thực/tốc độ phát; không cộng trùng đoạn xem lại để vượt ngưỡng. Dữ liệu từ client không phải bằng chứng chống gian lận tuyệt đối.
- Khách lưu resume cục bộ; đăng nhập merge theo phiên bản/thời gian ghi đáng tin với quy tắc rõ. Media thay phiên bản thì đánh dấu progress cần xử lý, không áp vị trí cũ nếu timeline đã thay đổi.

### 9.5. Tập tiếp theo

Sắp theo season/episode number có unique constraint; lấy tập kế tiếp đã xuất bản và phát được. Đếm ngược thử 10 giây, có hủy. Không nhảy sang tập khác do retry; nếu autoplay bị chặn thì hiện nút phát. Bỏ qua intro/credits chỉ khi admin cung cấp mốc đã kiểm tra.

## 10. Dữ liệu và API

### 10.1. Bảng chính

| Nhóm         | Bảng                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Danh tính    | users, auth_sessions, refresh_tokens, password_reset_tokens, email_verification_tokens, mfa_factors, mfa_challenges, mfa_recovery_codes |
| Phân quyền   | roles, permissions, role_permissions, user_roles                                                                                        |
| Danh mục     | titles, title_aliases, genres, title_genres, people, credits                                                                            |
| Phim bộ      | seasons, episodes                                                                                                                       |
| Media        | video_assets, media_attempts, subtitle_tracks, upload_intents                                                                           |
| Phát/cá nhân | playback_sessions, watch_progress, watch_events, watchlist                                                                              |
| Độ tin cậy   | outbox_events, inbox_events, job_runs, audit_logs, security_events, audit_exports, content_reports                                      |
| Sau MVP      | ratings, profiles, plans, subscriptions, payments, entitlements                                                                         |

`video_assets` lưu provider, asset_id nội bộ/provider, public_id, version, delivery_type, resource_type, duration, width/height, bytes, profile_version, processing_status, lifecycle, backup_status, attempt và lỗi gần nhất. Metadata backup lưu reference đến kho độc lập, checksum, thời điểm xác minh và manifest nguồn/phụ đề; không lưu credential hoặc URL backup có token làm định danh bền vững. Phân biệt phiên bản nội bộ với version Cloudinary, không lấy URL làm khóa chính.

- Episode có `active_asset_id`; phim lẻ dùng một episode trong season kỹ thuật được ẩn khỏi UI. Phim bộ có mùa/tập hiện rõ.
- `titles` và `episodes` có `publication_status`, `published_at`, `version` cho optimistic lock; tập có thể chuẩn bị/xuất bản độc lập. Các điều kiện hiển thị/phát và cache invalidation theo mục 5.4.
- `playback_sessions` lưu viewer type, user ID nullable hoặc guest ID, episode/asset version, preview flag, thời hạn, credential generation và trạng thái thu hồi. Credential gửi event lưu dạng bảo vệ phù hợp, không ghi giá trị thô vào log.
- `watch_events` lưu session, eventId, sequence, loại, thời gian server nhận/elapsed client và payload có schema. Unique `(sessionId, eventId)`; không trộn event sequence với resume sequence hoặc coi một event đo là quyền xem.
- Unique email chuẩn hóa, slug, số mùa/tập, watchlist và progress theo user/episode; chỉ một asset active cho mỗi episode. Rating sau MVP có unique theo user/title.
- Role/permission codes và bảng nối có unique constraint; users giữ status/authVersion, phiên giữ MFA/step-up timestamps và token family. Secret MFA được mã hóa, token/recovery codes lưu hash; không đặt các trường này trong public/admin DTO mặc định.
- Các bảng hỗ trợ được cụ thể hóa trong thiết kế backend: auth_replay_receipts (receipt credential ngắn hạn có mã hóa), policy_locks (invariant quản trị cuối), media_outputs/source_backups, resume_heads/playback_event_batches và operations/idempotency_records/scheduled_jobs. Đây là phần schema của C02, không được bỏ qua chỉ vì bảng tổng quan rút gọn.
- Baseline database bổ sung homepage_banners, system_settings (chỉ cấu hình không chứa secret) và title_daily_stats (tổng hợp có version định nghĩa); tổng 47 bảng. Kiểu dữ liệu, FK ghép, partial unique và grants lấy từ database design/DDL; C02 cần chuyển thành migration Prisma kèm SQL thủ công và kiểm thử trên PostgreSQL server riêng.
- audit_logs có append-only policy, allowlisted diff và index mục 7.5; audit_exports giữ owner/scope/status/expiresAt và storage reference riêng tư. Security event failures không bị xóa do rollback transaction nghiệp vụ.
- Index khóa ngoại, publication/date, watch progress theo user/updated_at, outbox theo trạng thái/next_attempt_at; phân vùng watch_events khi dữ liệu đo được yêu cầu.
- Thay asset: tạo bản mới → kiểm tra → đổi active pointer bằng transaction → vô hiệu cache → giữ bản cũ trong thời gian rollback. Không overwrite cùng định danh rồi hy vọng cache cập nhật ngay.
- Xóa dùng tombstone và outbox, đối soát provider; không xóa dữ liệu DB trước rồi mất dấu file. Giữ bản gốc/backup ngoài provider theo chính sách khôi phục được kiểm thử.

### 10.2. Quy ước RESTful API v1

- Base path `/api/v1`, HTTPS; tên collection dùng danh từ số nhiều và kebab-case. UUID nội bộ đặt ở `{titleId}`, `{episodeId}`, `{sessionId}`; không dùng cùng một path parameter lúc là UUID, lúc là slug. Slug được tra bằng `GET /titles?slug=...`, trả collection có 0 hoặc 1 phần tử.
- GET/HEAD chỉ đọc, không phát sinh thao tác upload/chuyển mã/xuất bản. POST tạo tài nguyên hoặc nhận công việc. PUT thay toàn bộ trạng thái có thể ghi của tài nguyên được xác định; DELETE xóa/gỡ tài nguyên idempotent; PATCH chỉ sửa một phần theo format công bố.
- Body JSON dùng camelCase; ID là chuỗi, thời gian là RFC 3339 UTC, thời lượng giây và kích thước byte ghi rõ đơn vị. Enum wire dùng UPPER_SNAKE_CASE. Trường chỉ đọc như owner, row version và provider status không được mass-assign từ DTO client.
- `PATCH /admin/.../{id}` dùng `application/merge-patch+json`: trường bỏ qua không đổi, `null` xóa giá trị tùy chọn, array được thay toàn bộ; không cho null trường bắt buộc. Publication chỉ sửa qua tài nguyên `/publication`, không qua metadata PATCH. [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396.html)
- Mọi route có OpenAPI operationId duy nhất, schema request/response, phương thức xác thực, quyền, lỗi và ví dụ. Endpoint `/admin` vẫn phải kiểm tra role/resource ownership ở server.
- Path phía frontend như `/search` hoặc `/titles/[slug]` không quyết định tên API. API tìm phim dùng filter `q` trên collection `/titles`.

### 10.3. Danh mục endpoint và status thành công

Các path sau có tiền tố `/api/v1`. Status là hành vi của API ứng dụng; upload trực tiếp/CDN Cloudinary có giao thức riêng. `201` trả `Location` tới tài nguyên vừa tạo; `202` trả receipt/status URL sau khi công việc đã được ghi bền.

| Method và path                                         | Status   | Hành vi/quyền                                                                                                |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| POST /users                                            | 201      | Đăng ký, Location `/users/{userId}`; kiểm soát lạm dụng                                                      |
| GET /users/{userId}                                    | 200      | Chỉ chủ tài khoản/admin; DTO không lộ mật khẩu/token                                                         |
| POST /auth/sessions                                    | 201      | Đăng nhập và tạo phiên; Location `/auth/sessions/{authSessionId}`                                            |
| GET /auth/sessions/{authSessionId}                     | 200      | Chủ phiên đọc metadata; không trả refresh token đã lưu                                                       |
| POST /auth/token-renewals                              | 200      | Xoay thông tin xác thực; response no-store, không tự retry POST khi kết quả chưa rõ                          |
| DELETE /auth/sessions/current                          | 204      | Thu hồi phiên hiện tại và xóa cookie; gọi lại vẫn thành công                                                 |
| POST /auth/password-reset-requests                     | 202      | Cùng phản hồi chung dù tài khoản có tồn tại hay không                                                        |
| POST /auth/password-resets                             | 200      | Đổi mật khẩu với token một lần, thu hồi phiên theo chính sách                                                |
| POST /auth/email-verification-requests                 | 202      | Yêu cầu email xác minh, không lộ tài khoản tồn tại                                                           |
| POST /auth/email-verifications                         | 200      | Tiêu thụ token xác minh một lần                                                                              |
| GET /titles                                            | 200      | Danh sách/tìm kiếm/lọc, hỗ trợ q và slug                                                                     |
| GET /titles/{titleId}                                  | 200      | Phim công khai có nội dung phát được; tài nguyên ẩn trả 404                                                  |
| GET /genres                                            | 200      | Danh sách thể loại                                                                                           |
| GET /titles/{titleId}/seasons                          | 200      | Chỉ mùa có tập hiển thị hợp lệ                                                                               |
| GET /seasons/{seasonId}/episodes                       | 200      | Chỉ tập công khai và có thể phát                                                                             |
| GET /episodes/{episodeId}                              | 200      | Metadata tập theo guard, không phát tán credential                                                           |
| GET /titles/{titleId}/recommendations                  | 200      | Nhóm biên tập/cùng thể loại cho MVP                                                                          |
| POST /episodes/{episodeId}/playback-sessions           | 201      | Khách/tài khoản; Idempotency-Key; Location phiên mới                                                         |
| GET /playback-sessions/{sessionId}                     | 200      | Chủ phiên đọc trạng thái; quyền/cấp credential được kiểm tra lại                                             |
| DELETE /playback-sessions/{sessionId}                  | 204      | Chủ phiên đóng/thu hồi; credential đã cấp có độ trễ thu hồi như mục 7.1                                      |
| POST /playback-sessions/{sessionId}/renewals           | 200      | Gia hạn đồng bộ khi còn quyền; Idempotency-Key cho từng vòng                                                 |
| POST /playback-sessions/{sessionId}/events             | 202      | Credential telemetry theo phiên; batch atomic, dedup và ghi bền                                              |
| PUT /me/watch-progress/{episodeId}                     | 201/200  | Tạo mới/cập nhật resume của tài khoản; sequence/generation chống ghi cũ                                      |
| GET /me/watch-progress/{episodeId}                     | 200      | Đọc resume của tài khoản hiện tại                                                                            |
| GET /me/continue-watching                              | 200      | Danh sách xem tiếp của tài khoản                                                                             |
| GET /me/history                                        | 200      | Lịch sử phân trang của tài khoản                                                                             |
| GET /me/watchlist                                      | 200      | Danh sách yêu thích                                                                                          |
| PUT /me/watchlist/{titleId}                            | 201/204  | Thêm mới/trạng thái đã có; không tạo bản ghi lặp                                                             |
| DELETE /me/watchlist/{titleId}                         | 204      | Xóa mục thuộc tài khoản hiện tại; gọi lại vẫn 204                                                            |
| PUT /me/ratings/{titleId}                              | 201/200  | Sau MVP: tạo/cập nhật một đánh giá trên mỗi tài khoản                                                        |
| GET /me/ratings/{titleId}                              | 200      | Sau MVP: đọc đánh giá của chính tài khoản                                                                    |
| POST /reports                                          | 201      | Báo lỗi theo tài khoản/phiên khách, Location `/reports/{reportId}`                                           |
| GET /reports/{reportId}                                | 200      | Chủ báo cáo hoặc admin; không đọc được báo cáo người khác                                                    |
| GET /admin/titles; POST /admin/titles                  | 200; 201 | Admin đọc danh mục có draft/tạo phim                                                                         |
| GET/PATCH /admin/titles/{titleId}                      | 200      | Admin đọc/sửa metadata với ETag/If-Match                                                                     |
| GET /admin/titles/{titleId}/publication                | 200      | Đọc trạng thái singleton publication và ETag                                                                 |
| PUT /admin/titles/{titleId}/publication                | 200      | Đặt status PUBLISHED/UNPUBLISHED theo guard; If-Match                                                        |
| POST /admin/titles/{titleId}/seasons                   | 201      | Tạo mùa; trùng số mùa trả xung đột                                                                           |
| GET/PATCH /admin/seasons/{seasonId}                    | 200      | Đọc/sửa mùa, ghi có If-Match                                                                                 |
| POST /admin/seasons/{seasonId}/episodes                | 201      | Tạo tập, gồm mùa kỹ thuật của phim lẻ                                                                        |
| GET/PATCH /admin/episodes/{episodeId}                  | 200      | Đọc/sửa metadata tập; If-Match, không sửa provider status                                                    |
| GET /admin/episodes/{episodeId}/publication            | 200      | Đọc publication và ETag                                                                                      |
| PUT /admin/episodes/{episodeId}/publication            | 200      | Xuất bản/gỡ từng tập, kiểm tra video/backup; If-Match                                                        |
| POST /admin/episodes/{episodeId}/upload-intents        | 201      | Intent và tham số signed upload, Idempotency-Key                                                             |
| GET /admin/upload-intents/{intentId}                   | 200      | Trạng thái/metadata upload của admin có quyền                                                                |
| POST /admin/upload-intents/{intentId}/verifications    | 200      | Đọc/xác minh metadata provider có timeout; commit VERIFIED/UPLOADED và operation/outbox HLS; Idempotency-Key |
| POST /admin/episodes/{episodeId}/playback-sessions     | 201      | Preview admin, Idempotency-Key; session có preview flag                                                      |
| GET /admin/media-assets/{assetId}                      | 200      | Trạng thái xử lý/backup/lifecycle                                                                            |
| POST /admin/media-assets/{assetId}/processing-attempts | 202      | Tạo lần xử lý/retry mới có Idempotency-Key, trả operation; đang chạy trả 409                                 |
| GET /admin/processing-attempts/{attemptId}             | 200      | Tiến độ và lỗi đã chuẩn hóa, không lộ payload provider nhạy cảm                                              |
| DELETE /admin/media-assets/{assetId}                   | 202      | Tombstone và xóa nền có If-Match/Idempotency-Key; asset đang dùng trả 409                                    |
| GET /admin/operations/{operationId}                    | 200      | Theo dõi QUEUED/RUNNING/SUCCEEDED/FAILED; kết quả cuối có resource URL/lỗi                                   |
| POST /webhooks/cloudinary                              | 200      | Xác minh chữ ký và ghi inbox trước ACK; không yêu cầu cookie/CSRF của người dùng                             |

Publication là singleton tồn tại cùng title/episode, nên PUT publication trả 200 thay vì tạo một trạng thái mới mỗi lần gọi. Body ví dụ `{"status":"PUBLISHED"}`. DRAFT/ARCHIVED không được ghi tùy ý qua DTO; thao tác lưu trữ/khôi phục bổ sung phải có guard riêng trước khi mở API.

Verification hiện đọc metadata Cloudinary đồng bộ với timeout 10 giây, ngoài transaction; sau đó kiểm tra lại quyền/owner/episode và commit nguồn VERIFIED, asset UPLOADED, operation/attempt/output PENDING, outbox cùng audit. Trả 200 xác nhận nguồn đã hợp lệ, không phải HLS/backup đã sẵn sàng. Client đọc processing operation để theo dõi C07. Đây là thay đổi so với thiết kế 202 chờ worker xác minh nguồn trước đây; nếu chuyển bước này về worker sau này cần version hóa hợp đồng. Retry xử lý vẫn tạo processing attempt mới thay vì endpoint động từ.

Phản hồi 202 cho công việc quản trị có `Location: /api/v1/admin/operations/{operationId}` và `Retry-After` khởi điểm 3 giây. Operation FAILED vẫn được GET bằng 200 vì tài nguyên operation đã đọc thành công; trường `error` bên trong là JobFailure gồm code/message/retryable, không chứa HTTP status hoặc giả làm response Problem Details của lần GET đó.

Hai ngoại lệ bất đồng bộ: receipt batch telemetry dùng session/event IDs để dedup, không tạo tài nguyên poll cho từng heartbeat; yêu cầu email trả receipt chung để tránh dò tài khoản, không công khai trạng thái theo địa chỉ email. Không đưa nghiệp vụ chưa lưu bền vào 202 rồi chỉ giữ công việc trong RAM.

API bổ sung cho xác thực, quyền và audit, cùng tiền tố `/api/v1`:

| Method và path                                            | Status | Quyền/hành vi                                                                                    |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| GET /me                                                   | 200    | Tài khoản đọc profile và current permissions, không trả secrets                                  |
| GET /auth/csrf-token                                      | 200    | Bootstrap CSRF cùng origin/context cookie, no-store; không cấp quyền đăng nhập                   |
| POST /auth/mfa-challenges                                 | 201    | Tạo lại challenge trong context PENDING_MFA hợp lệ, không chỉ dựa vào email                      |
| GET /auth/mfa-challenges/{challengeId}                    | 200    | Metadata của đúng context, không trả secret/OTP                                                  |
| POST /auth/mfa-challenges/{challengeId}/verifications     | 200    | Kiểm OTP/recovery code, hoàn tất phiên MFA                                                       |
| POST /auth/step-up-challenges                             | 201    | Tạo yêu cầu xác minh lại cho phiên đã xác thực                                                   |
| GET /auth/step-up-challenges/{challengeId}                | 200    | Chủ phiên đọc trạng thái challenge                                                               |
| POST /auth/step-up-challenges/{challengeId}/verifications | 200    | Ghi step-up timestamp server-side sau kiểm tra                                                   |
| POST /me/mfa-enrollments                                  | 201    | Enrollment chính tài khoản; secret chỉ hiển thị lúc tạo, không log                               |
| GET /me/mfa-enrollments/{enrollmentId}                    | 200    | Metadata của chủ, không trả lại TOTP secret                                                      |
| POST /me/mfa-enrollments/{enrollmentId}/verifications     | 200    | Xác minh trước khi bật factor, trả recovery codes một lần                                        |
| DELETE /me/mfa/current                                    | 204    | Step-up và chính sách role; staff không giữ quyền admin khi thiếu MFA                            |
| GET /admin/users                                          | 200    | users.read; cursor/filter và DTO đã lọc                                                          |
| GET /admin/users/{userId}                                 | 200    | users.read, metadata/roles/status và ETag                                                        |
| GET /admin/users/{userId}/status                          | 200    | users.read; singleton trạng thái và ETag                                                         |
| PUT /admin/users/{userId}/status                          | 200    | users.suspend theo scope, If-Match/reason; staff target cần step-up                              |
| GET /admin/roles; GET /admin/permissions                  | 200    | rbac.read; registry cố định MVP                                                                  |
| GET /admin/users/{userId}/roles                           | 200    | rbac.read; role hiện tại và ETag                                                                 |
| PUT /admin/users/{userId}/roles                           | 200    | rbac.assign, step-up, If-Match/reason, cập nhật authVersion và audit                             |
| POST /admin/users/{userId}/mfa-reset-requests             | 202    | mfa.reset_others, step-up/reason, Idempotency-Key; quy trình phục hồi đã xác minh, trả operation |
| GET /admin/audit-logs                                     | 200    | audit.read; lọc/cursor/DTO đã redaction, chỉ đọc                                                 |
| GET /admin/audit-logs/{auditId}                           | 200    | audit.read; event/diff đã lọc                                                                    |
| POST /admin/audit-exports                                 | 202    | audit.export, step-up/reason, Idempotency-Key, trả operation                                     |
| GET /admin/audit-exports/{exportId}                       | 200    | audit.export và scope owner/permission; status/expiresAt                                         |
| GET /admin/audit-exports/{exportId}/download              | 200    | Kiểm lại audit.export/step-up/scope và ghi audit trước khi stream artifact riêng tư              |

POST /auth/sessions có thể trả phiên PENDING_MFA cùng challenge sau khi đúng mật khẩu; khi đó chưa cấp credential đủ quyền quản trị. Challenge/enrollment cần credential giới hạn theo actor/session/mục đích, không đánh dấu mọi route MFA là anonymous. GET /me phục vụ điều hướng frontend, không thay kiểm tra quyền server.

Các route user chỉ cho chủ hoặc users.read đúng scope; reports cho chủ hoặc reports.read. Từ admin trong bảng chỉ khu vực quản trị, không nghĩa là mọi staff có toàn bộ quyền. Export lỗi dùng Problem Details; download thành công dùng Content-Disposition/media type file được công bố, không bọc nhị phân trong JSON envelope.

### 10.4. HTTP status, header và response thành công

HTTP status phản ánh kết quả giao thức, không trả HTTP 200 kèm `success:false`. Mã lỗi nghiệp vụ là quy ước của sản phẩm, không phải mã được IETF tiêu chuẩn hóa. [HTTP Semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)

| Status | Quy tắc ứng dụng                                      |
| ------ | ----------------------------------------------------- |
| 200    | Đọc/cập nhật/xử lý đồng bộ thành công                 |
| 201    | Tài nguyên mới đã được tạo, có Location               |
| 202    | Đã nhận bền công việc, chưa hoàn tất                  |
| 204    | Thành công không body, không thêm envelope            |
| 304    | Conditional GET không đổi, không body                 |
| 400    | JSON/cursor/identifier sai cú pháp                    |
| 401    | Thiếu hoặc sai thông tin xác thực                     |
| 403    | Đã xác thực nhưng thiếu quyền, hoặc CSRF không hợp lệ |
| 404    | Không tồn tại hoặc được che theo chính sách truy cập  |
| 405    | Method không được hỗ trợ; có Allow                    |
| 406    | Không đáp ứng được media type yêu cầu                 |
| 409    | Xung đột trạng thái nghiệp vụ hoặc idempotency        |
| 412    | If-Match không còn khớp                               |
| 413    | HTTP request body vượt giới hạn                       |
| 415    | Content-Type request không được hỗ trợ                |
| 422    | Request đọc được nhưng vi phạm schema/quy tắc giá trị |
| 428    | Thiếu precondition bắt buộc                           |
| 429    | Client vượt giới hạn API ứng dụng                     |
| 500    | Lỗi nội bộ ngoài dự kiến                              |
| 502    | Phản hồi provider không hợp lệ                        |
| 503    | Dịch vụ/phụ thuộc tạm không sẵn sàng                  |
| 504    | Gateway/API hết thời gian chờ provider                |

428/429 theo [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html). Phản hồi 401 có WWW-Authenticate phù hợp phương thức endpoint thực sự hỗ trợ; không quảng cáo Bearer nếu endpoint chỉ hỗ trợ phương thức khác. 429 và 503 có thời gian thử lại biết được thì trả Retry-After, quy ước ứng dụng ưu tiên số giây.

- Body thành công dùng `application/json`; đơn lẻ có `data`, `meta.requestId`; collection có `data` là array và `page`. Ngày giờ sinh bởi server ở UTC.
- Mọi response của API có `X-Request-Id` do server sinh/kiểm tra, không phản chiếu giá trị header tùy ý. Response lỗi mang cùng ID trong body; không dùng ID client cung cấp làm quyền truy cập.
- Auth, phiên phát, credential, dữ liệu cá nhân và toàn bộ Problem Details dùng `Cache-Control: no-store`; proxy/CDN không cache chung. Public metadata có TTL thử 60 giây, ETag và invalidation theo catalog version.
- HEAD giữ status/header tương ứng GET nhưng không body; OPTIONS/CORS khai allowlist và preflight phù hợp. CORS expose các header client cần đọc như X-Request-Id, ETag, Location, Retry-After; không dùng wildcard origin cho credentialed request.
- Bản thân việc stream segment vẫn có thể dùng 200/206 theo Cloudinary/CDN. API JSON không tự bọc lại playlist, segment hoặc lỗi provider trả trực tiếp cho trình duyệt.

Ví dụ collection:

```json
{
  "data": [
    {
      "id": "1c19982a-bf17-441f-bab9-00e3e2ef45ad",
      "slug": "phim-mau",
      "title": "Phim mẫu"
    }
  ],
  "page": { "limit": 20, "hasNext": false, "nextCursor": null },
  "meta": { "requestId": "d3a99057-1e9d-4dde-8fe0-efea020c21b2" }
}
```

### 10.5. Pagination, validation và cạnh tranh cập nhật

- Collection lớn dùng `limit` mặc định 20/tối đa 100 và opaque cursor có kiểm tra tính toàn vẹn. Sort allowlist, luôn có ID làm tie-breaker. Cursor gắn với bộ filter/sort và phạm vi người dùng nếu có, không nhận cursor của query khác.
- `GET /titles?q=...&genre=...&country=...&year=2024&kind=SERIES&sort=-publishedAt,-id&limit=20`. `slug` là exact-match filter; nếu kết hợp q/filter thì áp dụng giao của điều kiện. Không nhận SQL/filter tùy ý; query sai phải báo lỗi thay vì im lặng bỏ qua.
- Collection rỗng trả 200 với `data:[]`; tài nguyên đơn không thấy trả 404. `nextCursor:null` khi hết trang. Không tính total trên mọi request; nếu hỗ trợ total phải công bố riêng chi phí/giới hạn. Cursor không cam kết snapshot trong khi dữ liệu đang thay đổi; client dedup theo ID.
- JSON sai cú pháp trả 400; body/query đúng cú pháp nhưng sai kiểu, trường lạ, enum hoặc khoảng giá trị trả 422. Identifier UUID sai định dạng trả 400; UUID hợp lệ nhưng không được thấy trả 404. Không tự trim/coerce mật khẩu hoặc nhận NaN/Infinity.
- Admin GET trả ETag mạnh của representation/version hiện tại. PATCH/PUT publication/DELETE admin tài nguyên hiện có cần If-Match; thiếu trả 428, cũ trả 412. Kiểm tra precondition và cập nhật trong cùng transaction, tăng row_version khi thực sự thay đổi.
- Business conflict như số tập trùng hoặc asset đang được dùng trả 409. Không dùng 409 cho phiên bản If-Match cũ. Frontend gặp 412 tải lại dữ liệu và cho người dùng quyết định, không tự ghi đè.
- Nếu dùng JSON Merge Patch, đối tượng trạng thái xử lý/publication/owner là read-only và bị từ chối bằng 422, không âm thầm nhận rồi bỏ qua. PUT watchlist idempotent theo user/title; resume dùng session/sequence/generation nên retry không cộng watchedDelta hai lần.
- Đổi `activeAssetId` qua PATCH episode dùng use case kiểm asset cùng episode, READY/backup VERIFIED, If-Match và quyền catalog.publish; không cho catalog.write đơn thuần mass-assign để thay video đang phát. Audit/pointer/invalidation cùng transaction, phiên đang xem pin bản cũ theo thiết kế backend.

### 10.6. Idempotency và công việc chưa rõ kết quả

- Idempotency-Key bắt buộc cho tạo playback session/preview, renewal phiên phát, upload intent, verification, processing attempt và xóa media nền. Đây là header của hợp đồng ứng dụng, không tự biến mọi POST thành idempotent.
- Key là chuỗi opaque do client tạo; cùng một ý định retry dùng lại key, ý định mới dùng key mới. Scope gồm method, route chuẩn hóa có resource ID, user/guest/admin identity; đối chiếu fingerprint của body đã chuẩn hóa. Thiếu key trả 400, dùng lại key với payload khác trả 409.
- Khóa unique/idempotency record và outbox/operation được ghi transactionally trước side effect. Hai request cùng key đang chạy không tạo hai operation; trả lại receipt nếu đã có, hoặc 409 IDEMPOTENCY_IN_PROGRESS với Retry-After nếu chưa có kết quả trả được.
- Giữ metadata key tối thiểu 24 giờ và gắn resource/operation ID. Response chứa credential được bảo vệ và chỉ replay trong thời hạn credential còn hợp lệ; nếu receipt nhạy cảm hết hạn thì trả IDEMPOTENCY_RESULT_EXPIRED, không tự tạo lại công việc cũ. Tra trạng thái resource trước khi bắt đầu ý định mới.
- Xác thực/kiểm tra quyền thực hiện trước khi trả kết quả replay; không trả credential của session đã thu hồi. Renewal dùng key riêng từng generation, nhiều request trong một đợt dùng chung key và single-flight ở mục 7.1.
- Timeout ở client không chứng minh thao tác thất bại; retry bằng key cũ hoặc GET status URL. Worker đối soát provider trước khi tạo side effect mới nếu lần trước chưa rõ kết quả.
- Auth token rotation có chính sách phục hồi retry riêng gắn proof phiên/refresh token và phát hiện reuse; frontend không tự áp retry POST chung cho đăng nhập, reset mật khẩu hoặc token renewal. Thiết kế/kiểm thử auth phải phân biệt retry hợp lệ với dùng lại token bị đánh cắp.
- Riêng POST /auth/token-renewals và MFA verification trả credential yêu cầu Idempotency-Key theo context/family/challenge. Receipt có mã hóa và TTL thử 30 giây cho retry đúng ý định; token cũ với key khác trong cửa sổ race trả AUTH_REFRESH_RETRY_CONFLICT/409, không cấp successor và không thu hồi family ngay. Sau cửa sổ áp chính sách reuse/expired receipt; thuật toán và kiểm thử ở mục 7 thiết kế backend.

### 10.7. Định dạng lỗi Problem Details

Lỗi JSON của API dùng `Content-Type: application/problem+json`, theo [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html). Không bọc Problem Details trong `data` hoặc `error`. Các trường chuẩn là type/title/status/detail/instance; extensions của sản phẩm là code/requestId/retryable/errors.

- `type` là URI ổn định cho loại lỗi, không đổi theo ngôn ngữ; URL tài liệu lỗi production phải thuộc domain dự án. `api.example.com` trong ví dụ là placeholder.
- `title` mô tả ngắn loại lỗi; `detail` giải thích lần lỗi cụ thể cho người dùng, không chứa stack trace, SQL, đường dẫn máy chủ hoặc secret. Có thể dịch hai trường này, không dịch code.
- `status` luôn khớp HTTP status ngoài response. `instance` định danh lần lỗi, có thể là `urn:uuid:...`, không đưa query có token vào đây.
- `code` dùng UPPER_SNAKE_CASE ổn định và có một default HTTP status trong registry bên dưới. Frontend xử lý theo code, không parse detail/title hoặc số status trong chuỗi thông báo.
- `retryable` chỉ cho phép cân nhắc retry khi thao tác vốn an toàn hoặc có idempotency; không có nghĩa cứ true là retry mọi POST. Lỗi trạng thái cần người dùng sửa/đợi pipeline không được retry vòng lặp.
- `errors` chỉ có khi cần lỗi field; mỗi mục có `location` (body/query/path/header), `pointer` và `code`, `message` an toàn. Pointer trỏ vào object request tương ứng theo [JSON Pointer, RFC 6901](https://www.rfc-editor.org/rfc/rfc6901.html), không trả giá trị password/token bị từ chối.

Ví dụ admin yêu cầu xuất bản khi video chưa sẵn sàng:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
Cache-Control: no-store
X-Request-Id: d3a99057-1e9d-4dde-8fe0-efea020c21b2
```

```json
{
  "type": "https://api.example.com/problems/media-not-ready",
  "title": "Video chưa sẵn sàng",
  "status": 409,
  "detail": "Tập phim đang được xử lý. Kiểm tra tiến độ trước khi xuất bản.",
  "instance": "urn:uuid:d3a99057-1e9d-4dde-8fe0-efea020c21b2",
  "code": "MEDIA_NOT_READY",
  "requestId": "d3a99057-1e9d-4dde-8fe0-efea020c21b2",
  "retryable": false
}
```

Validation trả 422, code VALIDATION_FAILED và danh sách errors, ví dụ `{"location":"body","pointer":"/episodeNumber","code":"FIELD_OUT_OF_RANGE","message":"Số tập phải lớn hơn hoặc bằng 1."}`. Field code ban đầu gồm FIELD_REQUIRED, FIELD_INVALID_TYPE, FIELD_INVALID_FORMAT, FIELD_OUT_OF_RANGE, FIELD_UNKNOWN, FIELD_READ_ONLY; không trộn field code với mã lỗi cấp response.

### 10.8. Registry mã lỗi nghiệp vụ

Registry là nguồn duy nhất cho enum/mapping khi triển khai. Cột retry là khả năng thử lại tự động theo ngân sách, không phải bảo đảm thành công. Client cần sửa state/precondition phải làm mới dữ liệu hoặc chờ operation thay vì gửi cùng request liên tục.

| Code                                   | HTTP | Retry          | Ý nghĩa/hành động                                                         |
| -------------------------------------- | ---- | -------------- | ------------------------------------------------------------------------- |
| REQUEST_MALFORMED_JSON                 | 400  | Không          | Body không parse được                                                     |
| REQUEST_INVALID_IDENTIFIER             | 400  | Không          | ID sai định dạng                                                          |
| REQUEST_INVALID_CURSOR                 | 400  | Không          | Cursor hỏng/khác bộ filter; bắt đầu lại trang đầu                         |
| REQUEST_METHOD_NOT_ALLOWED             | 405  | Không          | Xem Allow và dùng method đúng                                             |
| REQUEST_NOT_ACCEPTABLE                 | 406  | Không          | Accept không được hỗ trợ                                                  |
| REQUEST_TOO_LARGE                      | 413  | Không          | Body vượt giới hạn API                                                    |
| REQUEST_UNSUPPORTED_MEDIA_TYPE         | 415  | Không          | Content-Type không được hỗ trợ                                            |
| VALIDATION_FAILED                      | 422  | Không          | Sửa field theo errors                                                     |
| AUTHENTICATION_REQUIRED                | 401  | Không          | Đăng nhập/cung cấp credential đúng loại                                   |
| AUTH_INVALID_CREDENTIALS               | 401  | Không          | Sai thông tin đăng nhập, thông báo chung                                  |
| AUTH_TOKEN_EXPIRED                     | 401  | Có điều kiện   | Thực hiện đúng luồng renewal, không retry request bằng token cũ           |
| AUTH_SESSION_REVOKED                   | 401  | Không          | Đăng nhập lại, không cấp lại từ phiên đã thu hồi                          |
| AUTH_RESET_TOKEN_INVALID               | 422  | Không          | Token reset sai/hết hạn/đã dùng; yêu cầu link mới                         |
| AUTH_VERIFICATION_TOKEN_INVALID        | 422  | Không          | Token email sai/hết hạn/đã dùng                                           |
| AUTH_FORBIDDEN                         | 403  | Không          | Đã xác thực nhưng thiếu quyền                                             |
| AUTH_CSRF_INVALID                      | 403  | Không          | Khôi phục context CSRF đúng, không bỏ kiểm tra                            |
| RESOURCE_NOT_FOUND                     | 404  | Không          | Tài nguyên không có hoặc không được phép biết                             |
| ACCOUNT_CONFLICT                       | 409  | Không          | Không thể tạo tài khoản; thông báo không lộ thông tin riêng               |
| RESOURCE_VERSION_MISMATCH              | 412  | Không          | Đọc ETag mới và xử lý xung đột                                            |
| PRECONDITION_REQUIRED                  | 428  | Không          | Bổ sung If-Match từ lần GET mới                                           |
| CATALOG_EPISODE_NUMBER_CONFLICT        | 409  | Không          | Số tập đã có trong mùa                                                    |
| CATALOG_SEASON_NUMBER_CONFLICT         | 409  | Không          | Số mùa đã có trong phim                                                   |
| CATALOG_SLUG_CONFLICT                  | 409  | Không          | Chọn slug khác                                                            |
| CATALOG_NO_PLAYABLE_EPISODE            | 409  | Không          | Admin xuất bản phim chưa có tập hợp lệ                                    |
| CATALOG_INVALID_PUBLICATION_TRANSITION | 409  | Không          | Chuyển trạng thái không được phép                                         |
| MEDIA_NOT_READY                        | 409  | Không          | Admin preview/publish phải chờ output READY                               |
| MEDIA_BACKUP_NOT_VERIFIED              | 409  | Không          | Chờ xác minh backup trước khi xuất bản                                    |
| MEDIA_ASSET_IN_USE                     | 409  | Không          | Gỡ liên kết/thay asset trước khi xóa                                      |
| MEDIA_PROCESSING_ALREADY_ACTIVE        | 409  | Không          | Theo dõi attempt đang có thay vì tạo thêm                                 |
| MEDIA_UPLOAD_INTENT_EXPIRED            | 409  | Không          | Tạo intent mới theo ý định mới                                            |
| MEDIA_UPLOAD_MISMATCH                  | 422  | Không          | File/owner/version không khớp intent                                      |
| MEDIA_FILE_LIMIT_EXCEEDED              | 422  | Không          | Metadata file đã upload vượt chính sách; khác 413 của HTTP body           |
| MEDIA_FORMAT_UNSUPPORTED               | 422  | Không          | Định dạng/codec nguồn không xử lý được                                    |
| MEDIA_PROCESSING_FAILED                | 409  | Không          | Lỗi trạng thái đã biết; xem attempt, retry có chủ đích                    |
| PLAYBACK_ACCESS_DENIED                 | 403  | Không          | Nội dung hiển thị nhưng tài khoản chưa có quyền phát                      |
| PLAYBACK_SESSION_EXPIRED               | 401  | Có điều kiện   | Tạo/gia hạn đúng luồng sau khi kiểm tra lại quyền                         |
| PLAYBACK_SESSION_REVOKED               | 403  | Không          | Dừng phiên, không tự gia hạn                                              |
| PLAYBACK_CONCURRENCY_LIMIT             | 409  | Không          | Đóng phiên khác theo chính sách sau MVP                                   |
| TELEMETRY_SESSION_MISMATCH             | 403  | Không          | Credential event không thuộc phiên                                        |
| TELEMETRY_BATCH_INVALID                | 422  | Không          | Sửa batch; toàn batch chưa được chấp nhận                                 |
| IDEMPOTENCY_KEY_REQUIRED               | 400  | Không          | Thêm header bắt buộc                                                      |
| IDEMPOTENCY_KEY_REUSED                 | 409  | Không          | Cùng key nhưng payload khác                                               |
| IDEMPOTENCY_IN_PROGRESS                | 409  | Có             | Đợi Retry-After và dùng cùng key                                          |
| IDEMPOTENCY_RESULT_EXPIRED             | 409  | Không          | Tra tài nguyên/operation, không chạy lại mù quáng                         |
| RATE_LIMITED                           | 429  | Có             | Chờ Retry-After; giữ nguyên key nếu retry ý định cũ                       |
| WEBHOOK_SIGNATURE_INVALID              | 401  | Không          | Chữ ký raw body không hợp lệ; không ghi inbox                             |
| WEBHOOK_TIMESTAMP_INVALID              | 401  | Có điều kiện   | Timestamp thiếu/hết cửa sổ; đối soát bằng reconciler                      |
| WEBHOOK_PAYLOAD_INVALID                | 422  | Không          | Notification không khớp attempt/source/type/batch                         |
| MEDIA_PROVIDER_UNAVAILABLE             | 503  | Có             | Provider tạm ngừng/quota upstream; không coi là lỗi rate limit của client |
| MEDIA_PROVIDER_BAD_RESPONSE            | 502  | Có điều kiện   | Đối soát trước khi lặp thao tác có side effect                            |
| MEDIA_PROVIDER_TIMEOUT                 | 504  | Có điều kiện   | Kết quả có thể chưa rõ, tra operation/intent trước                        |
| SERVICE_UNAVAILABLE                    | 503  | Có             | Bảo trì hoặc phụ thuộc nội bộ chưa sẵn sàng                               |
| INTERNAL_ERROR                         | 500  | Không mặc định | Thông báo chung và requestId; không lộ exception gốc                      |

Mã bổ sung cho xác thực, quyền và audit:

| Code                         | HTTP | Retry        | Ý nghĩa/hành động                                                                                 |
| ---------------------------- | ---- | ------------ | ------------------------------------------------------------------------------------------------- |
| AUTH_MFA_REQUIRED            | 403  | Không        | Hoàn tất MFA của phiên trước khi vào quản trị                                                     |
| AUTH_MFA_ENROLLMENT_REQUIRED | 403  | Không        | Staff phải enrollment/xác minh factor trước khi nhận đủ quyền                                     |
| AUTH_MFA_INVALID             | 422  | Không        | OTP/recovery code sai hoặc đã dùng, giới hạn số thử                                               |
| AUTH_CHALLENGE_EXPIRED       | 401  | Không        | Tạo lại challenge qua context hợp lệ                                                              |
| AUTH_STEP_UP_REQUIRED        | 403  | Không        | Xác minh lại gần đây cho thao tác nhạy cảm                                                        |
| AUTH_REFRESH_REUSED          | 401  | Không        | Thu hồi token family, đăng nhập lại, ghi security event                                           |
| AUTH_REFRESH_RETRY_CONFLICT  | 409  | Có điều kiện | Race refresh khác key trong cửa sổ ngắn; đợi Retry-After, phối hợp cookie/tab, không retry vô hạn |
| AUTH_ACCOUNT_SUSPENDED       | 403  | Không        | Từ chối sau xác minh danh tính, không lộ ở login sai                                              |
| RBAC_LAST_SUPER_ADMIN        | 409  | Không        | Không khóa/gỡ SUPER_ADMIN hoạt động cuối cùng                                                     |
| RBAC_ROLE_NOT_ASSIGNABLE     | 403  | Không        | Actor không được gán tập role yêu cầu                                                             |
| AUDIT_WRITE_UNAVAILABLE      | 503  | Có điều kiện | Mutation nhạy cảm rollback; retry idempotent sau khôi phục                                        |
| AUDIT_EXPORT_NOT_READY       | 409  | Không        | Theo dõi operation/export, không gọi download vòng lặp                                            |

Public API che draft/asset chưa được thấy bằng RESOURCE_NOT_FOUND/404; không trả MEDIA_NOT_READY hoặc mã riêng làm lộ tập ẩn. Mã media chi tiết dành cho admin có quyền. Sai/mất chữ ký webhook được chuẩn hóa thành lỗi xác thực nhưng không ghi payload/secret vào log; webhook hợp lệ lặp vẫn ACK 200 sau kiểm tra inbox.

Cloudinary/CDN có thể trả lỗi ngoài schema này. Player adapter phân loại sang mã client riêng như PLAYER_NETWORK_TIMEOUT, PLAYER_SOURCE_UNAVAILABLE, PLAYER_DECODE_FAILED, PLAYER_AUTOPLAY_BLOCKED hoặc PLAYER_ACCESS_DENIED; không gán HTTP status giả cho lỗi mạng, không nhầm mã client với code do API sinh. 401/403 CDN chỉ kích hoạt luồng xác minh quyền, không tự kết luận cần renewal cho mọi lỗi.

### 10.8.1. Mã bổ sung cho global exception handler

Runtime bổ sung REQUEST_INVALID (400), RESOURCE_CONFLICT (409), REQUEST_TIMEOUT (408), UPSTREAM_BAD_RESPONSE (502) và UPSTREAM_TIMEOUT (504). Lỗi unique chưa xác định ngữ cảnh trả RESOURCE_CONFLICT; chỉ dùng mã slug/email/mùa/tập khi nhận diện được constraint hoặc service đã phân loại. Lỗi JSON parser khác BadRequestException thông thường. Registry source và OpenAPI hiện có 73 code; xem [hợp đồng exception](../api/exception-handling.md).

### 10.9. Triển khai hợp đồng và xử lý lỗi tập trung

- NestJS Global Exception Filter chuyển domain error/validation/framework exception sang Problem Details; không để response mặc định `{statusCode,message,error}` lọt qua. Middleware/proxy cho lỗi do ứng dụng quản lý giữ status, request ID và header cần thiết.
- Định nghĩa một registry typed chứa code, type URI, status, retry policy và public message; service không tự viết chuỗi code rải rác. Prisma unique violation chỉ map sang conflict khi biết constraint, lỗi DB lạ thành INTERNAL_ERROR; không xuất tên constraint/SQL.
- ValidationPipe/DTO whitelist, từ chối trường ngoài schema và đọc raw body webhook trước validate theo schema riêng. Không chuyển mọi Error thành 400 hoặc mọi exception thành 500 khi đã có loại lỗi cụ thể.
- Frontend có API client chung đọc success envelope/Problem Details, map code sang thông báo/hành động và giữ requestId cho hỗ trợ. Code mới chưa nhận biết dùng fallback theo HTTP status; không crash hoặc parse câu thông báo. Phân biệt lỗi API với network/abort/CDN.
- Auth/session, telemetry credential và admin RBAC khai security schemes theo cấu hình thực tế trong OpenAPI. Các endpoint khách có security tùy chọn hoặc credential phiên cụ thể; không khai mọi route là anonymous vì chưa đăng nhập tài khoản.
- Dùng OpenAPI 3.1.x nếu toolchain NestJS/generator được chọn hỗ trợ, khóa phiên bản sau thử nghiệm; schemas dùng chung cho ProblemDetails, FieldError, Pagination, Operation và endpoint-specific DTO. Không tuyên bố đã có spec máy đọc được khi mới có bảng trong kế hoạch. [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.1.html)
- Khi triển khai, xuất `openapi.json`, enum mã lỗi và client types từ cùng nguồn hợp đồng; sinh/cập nhật Postman collection. CI lint spec, kiểm response thực tế, required headers, status/schema và phát hiện breaking changes.
- Trong `/api/v1`, bổ sung field tùy chọn/code mới cần client fallback; đổi ý nghĩa field/code hoặc xóa endpoint là thay đổi phá vỡ hợp đồng, phải có version/migration. Ví dụ JSON ở mục này là contract mẫu, không phải báo cáo API đã triển khai.

### 10.10. Swagger UI và tài liệu API

- Dùng @nestjs/swagger và hợp đồng controller/DTO/error registry; không duy trì spec cạnh tranh.
- Theo yêu cầu hiện hành ngày 11/11/2026, local mở trực tiếp GET /api/docs và GET /api/openapi.json, không form đăng nhập, cookie docs hay CSRF. GET /api/docs-login chỉ redirect 302 để giữ bookmark; POST form cũ và GET /api/docs-session trả 404.
- UI không tự cấp hoặc chèn credential. Muốn Try it out trên API được bảo vệ, đăng nhập POST /api/v1/auth/sessions và nhập accessToken vào Authorize. API vẫn kiểm Bearer/session/RBAC/ownership/audit theo từng operation.
- SWAGGER_ENABLED=false hoặc NODE_ENV=production không mount UI/raw spec/assets/redirect/alias. Không coi tài liệu local công khai là đã triển khai tài liệu production.
- Tags/operationId, DTO/schema, Problem Details, pagination, If-Match/ETag, Idempotency-Key và security schemes theo hợp đồng thực tế; không đặt credential thật trong examples.
- persistAuthorization=false, validatorUrl=null; không lưu token qua reload hay gọi docs-session tự động.
- Kiểm thử UI/spec/assets local không login, đường dẫn cũ, API admin vẫn 401/403, và mọi route docs/alias trả 404 khi tắt Swagger hoặc production. Xuất OpenAPI từ cùng source trước bàn giao.

## 11. Ma trận lỗi, biện pháp và nghiệm thu

P0: bắt buộc trước mở công khai. P1: hoàn thành trước phát hành MVP đầy đủ. P2: mở rộng theo dữ liệu.

| ID  | Mức    | Lỗi/tình huống                                         | Biện pháp bắt buộc                                                       | Kiểm tra đạt                                                                                                               |
| --- | ------ | ------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| F01 | P0     | Upload xong, HLS chưa có                               | Tách upload/processing/READY và publication                              | Không xuất bản được asset đang processing/failed                                                                           |
| F02 | P0     | Upload gián đoạn hoặc file vượt giới hạn               | Chunked upload, giới hạn provider, intent/metadata verification          | Ngắt mạng, retry không gắn hai asset active; file quá giới hạn bị từ chối                                                  |
| F03 | P0     | Webhook mất, lặp hoặc đến sai thứ tự                   | Inbox, chữ ký, dedup, attempt/version guard, reconciler                  | Gửi lặp/out-of-order không lùi trạng thái; mất webhook vẫn đối soát được                                                   |
| F04 | P0     | RabbitMQ/API provider tạm ngừng                        | Outbox, confirms, retry hữu hạn, xử lý kết quả chưa biết                 | Khởi động lại không mất việc; không tạo hai active outputs                                                                 |
| F05 | P0     | Codec lỗi trên điện thoại                              | H.264/AAC dự phòng; adapter kiểm tra thật                                | Chrome/Android và Safari/iPhone phát, tua, phụ đề, đổi tập đạt; lựa chọn thủ công chỉ bắt buộc khi adapter hỗ trợ          |
| F06 | P0     | Lộ draft hoặc bypass quyền                             | Delivery hạn chế, role check, kiểm tra original/manifest/segment         | Link chưa được cấp bị chặn theo chính sách; client thường không preview được                                               |
| F07 | P0/VIP | Token hết giữa phim                                    | Gia hạn nhiều vòng, mỗi đợt một request, phân loại lỗi và kiểm tra quyền | Xem qua ít nhất 3 vòng TTL, pause qua hạn và nhiều segment lỗi đồng thời; không refresh storm, thu hồi không cấp lại quyền |
| F08 | P0     | Mạng yếu làm đứng hình/retry vô hạn                    | ABR, bounded retry, UI offline và Resume                                 | Throttle/disconnect phục hồi đúng vị trí, không vòng lặp request                                                           |
| F09 | P1     | Phụ đề sai mã/lệch/timeline                            | WebVTT UTF-8, chọn ngôn ngữ, offset UI giới hạn                          | Dấu tiếng Việt đúng, tua/chuyển quality vẫn đồng bộ                                                                        |
| F10 | P1     | Lịch sử bị heartbeat cũ ghi đè                         | Sequence và generation theo phiên                                        | Request trễ từ thiết bị cũ không thay resume phiên mới                                                                     |
| F11 | P0     | Đổi tập còn tiếng, tăng RAM                            | Destroy player/listener, abort request, back buffer giới hạn             | Chuyển 20 tập/tua 50 lần không phát chồng; bộ nhớ không tăng vô hạn                                                        |
| F12 | P1     | Autoplay bị chặn                                       | Bắt promise play, nút phát tiếp                                          | iPhone và trình duyệt chặn autoplay vẫn xem tiếp được                                                                      |
| F13 | P1     | Trang chủ nặng                                         | Ảnh đúng kích thước, lazy load, trailer theo yêu cầu                     | Kiểm tra waterfall không tải mọi video/ảnh gốc ngay                                                                        |
| F14 | P1     | Tìm không dấu/tên khác thất bại                        | Aliases, normalization, trigram/index                                    | Bộ query chuẩn gồm typo/không dấu trả đúng, không lộ draft                                                                 |
| F15 | P0     | Cache phát bản cũ sau khi thay video                   | Asset/version mới, active pointer, invalidation                          | Phiên mới lấy bản mới; rollback lấy bản được chọn                                                                          |
| F16 | P0     | DB và Cloudinary lệch/file mồ côi                      | Tombstone, outbox delete, inventory reconcile                            | Mô phỏng lỗi xóa và gắn file; dọn đúng, không xóa file đang dùng                                                           |
| F17 | P0     | Chi phí tăng do lạm dụng/prefetch                      | Transformation allowlist, rate limit, quota alerts                       | Không tạo biến thể tùy ý; thấy cảnh báo trước ngưỡng ngân sách                                                             |
| F18 | P0     | Không chẩn đoán được lỗi xem                           | Playback ID, lỗi phân lớp, log có che token                              | Báo lỗi truy được API/provider/player và không lộ secret                                                                   |
| F19 | P1     | View/trending bị refresh hoặc tua làm sai              | Watch interval validation, dedup, lọc preview                            | Refresh/gửi lại event không tăng view; tua cuối không tính xem đủ                                                          |
| F20 | P0     | Deploy/migration làm hỏng dữ liệu                      | Expand-contract, backup, rollback và restore drill                       | Rollback ứng dụng chạy với schema tương thích, restore mẫu thành công                                                      |
| F21 | P1     | Provider gặp sự cố                                     | Timeout, retry có ngân sách, thông báo và đối soát                       | API catalog vẫn dùng được; player có trạng thái lỗi rõ; không promise failover khi chưa có nguồn dự phòng                  |
| F22 | P0     | Hai admin sửa/xóa cùng tập                             | ETag/If-Match, optimistic locking, audit, transaction pointer            | Thiếu If-Match bị 428, bản cũ bị 412; job đến muộn không hồi sinh tài nguyên đã xóa                                        |
| F23 | P0     | Thiếu telemetry khách hoặc gửi vào phiên người khác    | API event riêng, credential theo phiên, dedup, batch/retention giới hạn  | Khách và tài khoản có startup/error metrics; token sai bị từ chối, replay không tăng view, lỗi analytics không cản resume  |
| F24 | P0     | Tập chưa sẵn sàng bị lộ hoặc chặn các tập cũ           | Publication riêng title/episode, guard chung và cache invalidation       | Tập 1–5 xem được khi tập 6 processing; gỡ tập 3 không chặn tập 4; phim draft không phát công khai                          |
| F25 | P0     | Menu chất lượng không hoạt động trên native HLS        | Adapter capability, UI theo khả năng thực đã đo                          | Thiết bị chỉ Auto không hiện nút thủ công; hls.js đổi mức giữ vị trí; quality không đo được báo unknown                    |
| F26 | P0     | Mất bản nguồn nên không khôi phục được media           | Backup nguồn độc lập, checksum, manifest mapping và diễn tập             | Xóa asset thử rồi phục hồi từ backup, tạo lại HLS và cập nhật pointer; ghi rõ thời gian phục hồi media riêng DB            |
| F27 | P0     | Response/status/error code không nhất quán             | Problem Details, registry và Global Exception Filter                     | Content-Type/status/code/schema đúng OpenAPI; 204/304 không body, lỗi không trả 200, không lộ exception                    |
| F28 | P0     | Retry tạo trùng phiên/job hoặc trả dữ liệu người khác  | Idempotency scope owner/route/body, outbox và quyền trước replay         | Cùng key không tạo trùng; đổi body trả 409; actor khác không nhận receipt/credential của actor cũ                          |
| F29 | P0     | Ghi đè hoặc sửa field hệ thống qua metadata API        | If-Match và DTO writable allowlist, endpoint publication riêng           | Hai admin cập nhật đồng thời chỉ một bản ghi hợp lệ; field read-only trả 422; không bypass guard qua PATCH                 |
| F30 | P1     | Cursor/filter và operation response gây hiểu sai       | Cursor bound query, stable sort, receipt/Operation/JobFailure rõ         | Query sai trả code đúng, list rỗng 200; operation FAILED đọc bằng 200 nhưng UI hiện thất bại; không coi 202 là READY       |
| F31 | P0     | Mutation admin thiếu audit hoặc lộ secret              | Ghi audit cùng transaction, redaction, append-only và export guard       | Audit append lỗi rollback mutation; diff/log không có token/OTP/password; không có API sửa/xóa audit                       |
| F32 | P0     | Vượt quyền hoặc gỡ quản trị cuối cùng                  | Permission/resource guard, authVersion và transaction có lock            | EDITOR không publish, ADMIN không gán role, AUDITOR không sửa phim; hai request đồng thời không gỡ hết SUPER_ADMIN         |
| F33 | P0     | Bỏ MFA, refresh reuse hoặc phiên còn quyền sau thu hồi | PENDING_MFA/step-up, refresh rotation và server session check            | Chưa MFA không gọi admin; OTP/recovery replay bị chặn; đổi role/khóa user chặn request admin tiếp theo dù JWT còn hạn      |
| F34 | P0     | Swagger/raw spec lộ ngoài ý muốn                       | DOCS_ENABLED, docs.read/MFA và bảo vệ raw/alias                          | Production mặc định không mount; bật có kiểm soát thì chưa login/thiếu quyền không đọc được UI/JSON/YAML qua URL trực tiếp |

### 11.1. Backlog streaming sau rà soát source ngày 10/11/2026

Các đầu việc dưới đây ghi nhận trạng thái thực tế sau C08 core API. Chưa có đầu việc ST01–ST06 nào được sửa hoặc nghiệm thu trong lần cập nhật plan này. 561 kiểm tra HTTP/client/worker và kiểm tra manifest/segment video thật vẫn là bằng chứng hiện có; chưa thay cho bài phát trên trình duyệt, kiểm thử tải hoặc nghiệm thu production.

| ID | Ưu tiên | Vấn đề đã xác nhận | Công việc cần làm | Tiêu chí nghiệm thu |
| --- | --- | --- | --- | --- |
| ST01 | P0: chốt chính sách trước công khai; quyền có hạn phải đạt trước phát hành | URL Cloudinary hiện là signed URL tĩnh, delivery.expiresAt=null; đóng/hết hạn phiên API không thu hồi URL CDN đã cấp | Giữ production guard; xác minh khả năng token/cookie tại tài khoản CDN, bảo vệ manifest và từng segment. Nếu MVP miễn phí chấp nhận chia sẻ link, ghi rõ quyết định và giới hạn; bật cờ cho phép không được coi là đã có URL hết hạn | Khi yêu cầu quyền có hạn: URL/segment bị từ chối sau TTL, thử tối thiểu 3 vòng gia hạn, pause qua hạn và thu hồi trên player JS/native; không cấp lại quyền đã thu hồi. Không hứa xóa byte đã buffer. Liên quan F06/F07 |
| ST02 | P0 trước thử nghiệm công khai | Tạo phiên đang dùng quota 60 request/10 phút theo req.ip cho cả tài khoản/guest; chưa cấu hình proxy tin cậy nên nhiều người qua một reverse proxy có thể bị chặn chung | Sửa quota theo endpoint + user/guest và lớp chống lạm dụng IP; cấu hình trust proxy theo topology/allowlist cụ thể, không tin mọi X-Forwarded-For. Dùng store chung khi có nhiều API instance | Nhiều tài khoản sau cùng proxy không bị chặn nhầm bởi quota phiên của nhau; một actor vượt ngưỡng nhận RATE_LIMITED/429; giả header IP không né được quota; kiểm tra direct/proxy và nhiều instance. Liên quan F17/F27 |
| ST03 | P0 trước thử nghiệm công khai | Events ghi quota theo token trước khi xác minh token/session; đổi token giả liên tục có thể tạo nhiều security_events và gây tải DB | Chặn theo IP/toàn cục trước truy vấn tốn tài nguyên; kiểm token/session rồi mới tính quota theo phiên. Không tạo khóa/bản ghi quota bền cho từng token giả; log từ chối phải có lấy mẫu/tổng hợp, giới hạn và retention | Gửi token giả thay đổi liên tục bị chặn, không ghi watch_events/outbox hoặc tăng DB theo từng token giả; token hợp lệ vẫn có quota riêng, response lỗi giữ đúng hợp đồng, không lộ token trong log. Đo DB write rate và latency khi bị spam. Liên quan F17/F18/F23 |
| ST04 | P1 trước nghiệm thu vận hành MVP | Telemetry đã ghi receipt/events/outbox nhưng chưa có consumer tổng hợp và cleanup; dữ liệu có thể tích lũy | Thêm consumer analytics qua queue riêng, dedup/checkpoint, tổng hợp QoE/lượt xem và cảnh báo lag/dung lượng. Viết retention có batch cho raw event 30 ngày, aggregate 90 ngày; xử lý receipt/outbox theo TTL và trạng thái, không xóa event chưa tổng hợp hoặc audit theo job telemetry | Redelivery không tăng view; kết quả tổng hợp đối chiếu dữ liệu mẫu; cleanup chạy lặp an toàn, không xóa dữ liệu đang xử lý; analytics hỏng không chặn phát/resume hoặc làm nghẽn media queue. Liên quan F19/F23 |
| ST05 | P0 cho ma trận phát và ngưỡng tải trước mở công khai | Chưa có player frontend; chưa kiểm chứng chuyển chất lượng, buffering, tua, gia hạn và tải đồng thời trong trình duyệt | Làm C09/C10, nối session/renewal/events/progress. Kiểm Chrome/Android và Safari/iPhone, hls.js/native theo capability; chạy ma trận mạng và tải ở mục 12.1, ghi giới hạn lưu lượng dựa trên số đo | Báo cáo khung hình đầu, rebuffer, seek, HD, API p95/error rate/DB pool; thử mất mạng, pause quá hạn, đổi tập và teardown. Có bằng chứng không phát chồng, retry vô hạn hoặc tăng bộ nhớ liên tục. Liên quan F05/F07/F08/F11/F25 |
| ST06 | P0 trước production | Backup đang cùng máy, webhook dùng tunnel HTTPS tạm theo cấu hình local đã chọn; chưa diễn tập kho backup độc lập/restore thật | Giữ cấu hình local cho phát triển; trước production dùng kho backup độc lập với versioning/private access, webhook HTTPS cố định và runbook backup/restore. Kiểm tra khả năng phục hồi khi máy hoặc tunnel local mất | Phục hồi một phim thử từ backup độc lập, tạo lại HLS, kiểm checksum/timeline và pointer; ghi thời gian/usage. Restart webhook/broker và callback lặp không mất việc hoặc tạo trùng. Liên quan F03/F04/F20/F26 |

Phạm vi code dự kiến:

- ST01: [Cloudinary delivery adapter](../../packages/media/src/cloudinary.provider.ts), [playback service](../../apps/api/src/services/playback.service.ts), schema Swagger và player/hook C08–C10. Không đưa API secret hoặc khóa CDN vào frontend.
- ST02–ST03: [playback service](../../apps/api/src/services/playback.service.ts), [quota/kiểm quyền người xem](../../apps/api/src/viewer-common.ts), [middleware/log HTTP](../../apps/api/src/application.ts), cấu hình reverse proxy và test HTTP qua proxy. Rà lại middleware ghi http.request.failed để chống spam không chuyển thành spam log/DB.
- ST04: consumer analytics và retention trong apps/worker, routing riêng cho playback.events.accepted, watch_events/playback_event_batches/title_daily_stats và outbox. Worker media hiện chỉ nhận event media, chưa tiêu thụ telemetry.
- ST05: apps/web, player adapters, API hooks, Playwright/thử thiết bị thật và công cụ load test; tải video tiếp tục đi thẳng Cloudinary CDN.
- ST06: backup adapter, cấu hình hạ tầng và script/runbook restore; không thử xóa hoặc thay phim thật để nghiệm thu. Mọi diễn tập dùng asset/dataset thử riêng.

Thứ tự thực hiện: sửa ST02 và ST03 trước khi mở API cho người ngoài; chốt ST01 trước cấp URL production; làm player ST05, analytics/retention ST04 và nghiệm thu ST06 theo các phụ thuộc tương ứng. Chỉ chuyển từng ticket sang VERIFIED khi có kết quả kiểm tra phù hợp; không dùng số lượng kiểm tra API hiện tại làm bằng chứng cho toàn bộ ST01–ST06.

## 12. Hiệu năng, quan sát và chi phí

### 12.1. Mục tiêu nghiệm thu có điều kiện

Mục tiêu dưới đây là tiêu chí cần đo, không phải cam kết đã đạt. Cố định dataset, cấu hình máy, vùng Cloudinary, codec và mạng trong báo cáo.

| Chỉ số                        | Mục tiêu thử nghiệm                                                      |
| ----------------------------- | ------------------------------------------------------------------------ |
| API đọc danh mục phổ biến     | p95 < 300 ms, 100 request/giây trên dataset 10.000 title/100.000 episode |
| Tạo phiên phát                | p95 < 500 ms, tách đo với tác vụ cấp token/provider                      |
| Click Play đến khung hình đầu | p95 < 3 giây trên máy thử và mạng 20 Mbps/RTT 50 ms, đầu ra đã sẵn sàng  |
| Tua ngoài buffer              | p95 < 2 giây trên cùng mạng thử; ghi riêng cold/warm CDN                 |
| Rebuffer ratio                | < 1% thời gian trong test mạng ổn định; báo riêng test mất mạng          |
| Playback start success        | ≥ 99% trên bộ test hỗ trợ, ghi mẫu và khoảng đo                          |
| Giữ HD                        | Báo tỷ lệ thời gian ≥720p; tránh đạt ít đứng hình bằng cách luôn hạ 360p |
| LCP trang chủ                 | Mục tiêu ≤2,5 giây tại p75 theo thiết bị/mạng đã công bố                 |

Thử mạng 2/5/20 Mbps, RTT 50/150 ms, mất mạng 10–30 giây; máy cấu hình thấp và iPhone/Android thật. Đo cold/warm cache riêng, không làm ấm mọi tài nguyên rồi gọi đó là trải nghiệm chung.

### 12.2. Dashboard và cảnh báo

- Player: startup, seek latency, rebuffer, quality switches, dropped frames, fatal errors theo thiết bị/ISP khi dữ liệu cho phép; tránh gắn user ID vào nhãn metric gây cardinality cao.
- Backend: latency/error rate, DB pool/slow query, cache hit, lỗi cấp quyền và rate limit.
- Jobs: tuổi job cũ nhất, pending outbox/inbox, DLQ, processing age theo kích thước, lỗi webhook/provider.
- Cloudinary: lưu trữ, transformation usage, bandwidth và GB/giờ xem. Đặt cảnh báo ví dụ ở 50/75/90% ngân sách được cấu hình, không tự tắt phim giữa chừng khi chạm ngưỡng mềm.
- Redact token, cookie, chữ ký và dữ liệu nhạy cảm khỏi log. Dùng traceId/playbackSessionId để nối chẩn đoán; hạn chế quyền dashboard.
- Nguồn player metrics là API sự kiện ở mục 6.6. Dashboard tách khách/tài khoản và preview; hiển thị tỷ lệ thiếu event/method đo, không coi phiên mất telemetry là phát thành công.

### 12.3. Công thức dự toán

`GB truyền ≈ giờ xem × bitrate tổng trung bình (Mbps) × 0,45` theo GB thập phân, chưa tính overhead/tải thừa.

Ví dụ 10.000 giờ xem ở tổng bitrate trung bình 3 Mbps ≈13.500 GB. 1.000 phiên cùng phát ở 5 Mbps ≈5 Gbps đến người xem; CDN phân phối lưu lượng này, chi phí vẫn cần dự toán.

Tổng chi phí gồm lưu nguồn/đầu ra, transformation, băng thông, API/DB/cache/broker, backup và giám sát. Dùng số usage và giá/gói thực tế trong Console khi chốt ngân sách; không mặc định free tier đủ cho phim dài hoặc lưu lượng production.

### 12.4. Bảng dự toán và giới hạn vận hành

G0 phải bàn giao bảng dự toán có nguồn giá, ngày lấy giá, đơn vị tính/credits của gói thực tế, ngân sách thử nghiệm và ngân sách tháng. Không suy ra giá tiền chỉ bằng số GB nếu gói còn có cách tính transformation hoặc credits riêng.

| Đầu vào bắt buộc                                         | Cách dùng                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Số phim/tập, thời lượng và dung lượng nguồn trung bình   | Tính dung lượng catalog và thời gian upload                        |
| Profile, số mức chất lượng, tổng dung lượng đầu ra đã đo | Tính storage/transformation, gồm cả asset thử và phiên bản giữ lại |
| Giờ xem/tháng và bitrate tổng trung bình                 | Tính bandwidth; thêm hệ số tải thừa/overhead từ thử nghiệm         |
| Phiên đồng thời và lưu lượng API/telemetry               | Chọn cấu hình API/DB/broker và retention event                     |
| Thời gian giữ nguồn, phiên bản cũ và backup              | Tính dung lượng backup và chi phí khôi phục/truyền lại             |
| Dev/staging/production, thử tải và kiểm thử media        | Phân bổ riêng usage, không chỉ tính người xem thật                 |

Ví dụ dung lượng truyền tại tổng bitrate trung bình 3 Mbps, chưa gồm overhead:

| Giờ xem/tháng | Dữ liệu ước tính |
| ------------- | ---------------- |
| 200           | 270 GB           |
| 1.000         | 1.350 GB         |
| 10.000        | 13.500 GB        |

- Chỉ cho phép các profile đã duyệt; trước khi yêu cầu chuyển mã kiểm tra output/attempt cùng cấu hình đã tồn tại. Không cho client tạo transformation tùy ý.
- Giới hạn upload theo admin, số processing đang chạy và API quota; cảnh báo trước khi mở thêm catalog lớn. Lệnh retry phải phân biệt failed và kết quả chưa biết để tránh tính usage lặp.
- Prefetch tập tiếp theo mặc định tắt; chỉ bật sau đo lợi ích và tải thừa. Trailer theo yêu cầu, không tải toàn bộ khi vào trang chủ.
- Ở 50% ngân sách: thông báo xu hướng; 75%: rà tải bất thường và hoãn biến thể không cần thiết; 90%: cảnh báo người vận hành, hạn chế job mới không thiết yếu theo cấu hình. Không cắt ngang phiên xem chỉ vì chạm ngưỡng mềm.
- Quyết định mở catalog/lưu lượng mục tiêu chỉ khi số usage đã đo phù hợp ngân sách được cấu hình. Các con số ví dụ là kịch bản tính toán, không phải ngân sách hay lưu lượng đã được người dùng xác nhận.

## 13. Kiểm thử và quy trình phát hành

### 13.1. Bộ kiểm thử bắt buộc

- Auth/RBAC/audit tests theo ma trận mục 7.4: JWT sai signature/issuer/audience/hết hạn, refresh rotation/reuse, PENDING_MFA, OTP/recovery code một lần, step-up, CSRF và thu hồi khi role/status đổi. Thử truy cập trực tiếp thay vì chỉ kiểm menu ẩn.
- Audit transaction/redaction/export tests: rollback khi append lỗi, thất bại/denied vẫn có security event phù hợp, idempotent replay không nhân SUCCESS, nội dung chứa HTML/CSV formula được xử lý an toàn; export hết hạn hoặc mất quyền không tải được.
- Kiểm role update đồng thời và SUPER_ADMIN cuối; kiểm audit UPDATE/DELETE bị DB role ứng dụng từ chối. Kiểm Swagger UI/raw spec/alias, bảo vệ tài liệu và Try it out đúng policy.
- Unit cho quyền xuất bản, state machine/attempt guard, resume conflict, view dedup và xếp hạng tìm kiếm.
- Unit/integration cho guard title/episode độc lập, telemetry guest/session credential và single-flight refresh nhiều vòng. Dùng clock giả cho timeout/expiry, thêm bài thực tế với TTL ngắn trước khi phát hành quyền có hạn.
- Integration với PostgreSQL/RabbitMQ cho transaction outbox/inbox, crash/restart và delivery lặp; không chỉ mock queue rồi kết luận bền vững.
- Postman collection và Postman CLI trong CI: auth, catalog, upload intent, replay webhook, playback, progress, phân quyền. Dùng environment thử, không ghi token thật vào repository.
- Contract tests kiểm từng operation theo OpenAPI: success/status/Location, 204/304 không body, 400 so với 422, Problem Details và field pointers, 401 challenge, 405 Allow, 428/412/409, Retry-After, no-store và X-Request-Id. Kiểm cả lỗi framework/proxy do hệ thống quản lý, không chỉ domain error trong service.
- Kiểm idempotency đồng thời, payload khác, key hết hạn/credential hết hạn, đổi actor và retry sau timeout. Cùng key phải trỏ cùng operation; không replay credential bị thu hồi. Phân biệt HTTP response lỗi với JobFailure trong operation đọc thành công.
- Sandbox Cloudinary: upload video mẫu, eager completion, mất/lặp webhook, manifest/segment authorization, thay version, xóa và đối soát; theo dõi quota phát sinh.
- Playwright cho luồng admin/người xem và lỗi UI; bổ sung thiết bị thật cho codec, HLS native, fullscreen và autoplay. Browser giả lập không thay thế giải mã trên thiết bị thật.
- Video mẫu gồm phim lẻ, phim bộ nhiều mùa, 24/30 FPS, audio khác nhau, phụ đề tiếng Việt, cảnh tối/chuyển động, file hỏng và nguồn thấp hơn 1080p.
- Kiểm thử tải API độc lập với CDN; test delivery/video có ngân sách và dataset rõ, không đánh tải vô hạn lên provider.
- Bài xem liên tục ít nhất một nội dung 90–120 phút và thử 20 lần chuyển tập/50 lần tua. Với VIP dùng TTL ngắn để buộc xảy ra nhiều vòng gia hạn.
- Telemetry test có khách/tài khoản, event lặp/đến trễ/thiếu, giả phiên khác, batch quá lớn và collector lỗi. Xác nhận phát/resume không phụ thuộc collector và thống kê ghi mức bao phủ dữ liệu.
- Kiểm thử native/hls.js theo capability matrix: đổi chất lượng thủ công khi hỗ trợ, Auto khi không hỗ trợ, nguồn dự phòng và unknown quality. Không kết luận thất bại vì thiếu một tính năng mà capability matrix đã loại khỏi đường phát đó.

### 13.2. CI/CD và vận hành

Pipeline: lint/typecheck → unit/integration/API → build → staging → E2E/media smoke → production có rollback.

- Dev/staging/production dùng cấu hình và tài nguyên Cloudinary riêng theo khả năng tài khoản; không dùng cùng asset ID/credentials cho test xóa và production.
- Cấp secret qua hệ thống quản lý môi trường. Webhook staging có endpoint HTTPS truy cập được, được xác minh như production.
- Migration expand-contract, triển khai backward-compatible với phiên bản đang chạy; rollback code không mặc định rollback migration phá dữ liệu.
- Worker shutdown ngừng nhận việc mới, xử lý ACK đúng trạng thái; outbox/inbox tiếp tục được sau restart.
- PostgreSQL production dùng backup/PITR đáp ứng mục tiêu RPO ≤15 phút, RTO ≤4 giờ sau diễn tập. Nếu hạ tầng không hỗ trợ thì cần đổi hạ tầng hoặc ghi mức mục tiêu thực tế trước mở production; không đánh dấu đạt chỉ bằng việc bật backup. Khôi phục media theo mục 13.3 và có thời gian riêng.
- Runbook cho: provider lỗi, webhook kẹt, DLQ tăng, phát 403, chi phí tăng, thay video, gỡ phim và khôi phục dữ liệu.

### 13.3. Backup và khôi phục media

- Cloudinary là nơi lưu và phát chính. Trước production, cấu hình kho backup nguồn độc lập với việc xóa asset ở Cloudinary; G0 chọn vị trí/nhà cung cấp và ghi chi phí, quyền truy cập, mã hóa và lifecycle trong bảng triển khai. Chưa cấu hình thì chưa coi yêu cầu phục hồi media đã đạt.
- Lưu bản nguồn cùng manifest metadata: episode/asset ID nội bộ, provider public ID/version, profile version, phụ đề, checksum và vị trí backup. Bảo vệ credentials riêng, không cấp quyền xóa backup cho client hoặc thao tác xóa media thông thường.
- Mặc định giữ nguồn của nội dung đang xuất bản; khi thay/gỡ, giữ bản cũ tối thiểu 7 ngày phục vụ rollback, sau đó dọn theo cấu hình được chốt cùng ngân sách. Phụ đề và metadata đi kèm phải phục hồi được với đúng bản nguồn. Yêu cầu xóa có chủ đích cần quy trình riêng, không bị lifecycle mặc định vô tình bỏ qua.
- Job backup chạy trước lần xuất bản đầu của asset; admin thấy `backup_status` độc lập với `processing_status`. Kiểm tra kích thước/checksum backup trước khi đặt `VERIFIED`. Xuất bản tập yêu cầu backup nguồn đã xác minh theo chính sách production; không cần giữ bản sao mọi rendition vì có thể tạo lại từ nguồn.
- Với nguồn rất lớn, việc sao chép/checksum dùng streaming và tài nguyên có giới hạn; timeout được retry idempotent. Không đọc toàn bộ phim vào RAM hoặc đưa file qua RabbitMQ.
- Quy trình phục hồi: xác minh backup → upload thành asset mới lên Cloudinary → tạo HLS trước → kiểm thử quyền/timeline/phụ đề → đổi active pointer bằng transaction → vô hiệu cache. Giữ audit/mapping cũ cho điều tra và rollback.
- Ghi media recovery time gồm cả upload/chuyển mã. Mục tiêu RTO database không được áp dụng mặc định cho toàn bộ catalog video; diễn tập ít nhất một phim đại diện và báo thời gian/usage thực tế.

## 14. Lộ trình và backlog

Ước lượng sơ bộ MVP 8–10 tuần cho hai lập trình viên có kinh nghiệm, thiết kế/QA hỗ trợ bán thời gian và nội dung mẫu sẵn có. Chỉ chốt baseline thời gian sau G0: kết quả Cloudinary, khả năng thiết bị, ngân sách và ước lượng từng đầu việc. Nếu thử nghiệm không đạt thì cập nhật cấu hình/profile/gói và lịch trước khi mở rộng triển khai, không coi 8–10 tuần là cam kết đã được xác minh.

| Mốc bàn giao            | Thời gian sơ bộ | Công việc và đầu ra                                                                                                                                                              | Điều kiện hoàn tất                                                                   |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| G0: thử kỹ thuật        | Tuần 1          | Phim dài đại diện, HLS 720p/1080p, direct upload/webhook, quyền truy cập, thiết bị thật, bảng usage/chi phí và backup                                                            | Có bằng chứng mục 14.1; biết gói/giới hạn thực tế và cập nhật lịch trước G1          |
| G1: luồng xem chính     | Tuần 2–6        | Monorepo mới, OpenAPI/REST/error registry, auth/admin, catalog/mùa/tập, pipeline media với RabbitMQ/outbox/inbox, publication riêng từng tập, player adapter và telemetry cơ bản | Đăng phim đến xem hoàn chỉnh; F01–F06, F11, F22–F25 và F27–F29 đạt trong phạm vi mốc |
| G2: trải nghiệm cá nhân | Tuần 6–8        | Tìm kiếm, phụ đề, lịch sử/resume khách và tài khoản, yêu thích, chuyển tập, báo lỗi                                                                                              | Luồng xem ổn định và F08–F14/F19 đạt; không phụ thuộc rating/gợi ý nâng cao          |
| G3: mở công khai        | Tuần 8–10       | Hoàn thiện HD, dashboard/usage alerts, thiết bị/tải, backup restore, đối soát/DLQ và runbook                                                                                     | Mọi P0/P1 thuộc MVP đạt, gồm F26; có báo cáo chi phí, giới hạn thực tế và rollback   |

### 14.1. Bằng chứng bắt buộc của G0

- Upload và xử lý ít nhất một phim đại diện dài 90–120 phút qua đúng luồng signed direct upload/eager async; nếu catalog mục tiêu có file lớn hơn thì bổ sung mẫu tương ứng.
- Ghi kích thước nguồn, thời gian upload/xử lý, đầu ra/profile thực có, dung lượng các rendition và usage phát sinh. Phân biệt cold/warm delivery, không ngoại suy chi phí cả catalog chỉ từ clip vài giây.
- Kiểm tra iPhone/Safari và Android/Chrome thật: phát, tua ngoài buffer, phụ đề, chuyển tập, Auto và chọn thủ công theo capability. Ghi phiên bản OS/browser và adapter.
- Kiểm tra draft, preview admin, phim đã xuất bản và original/manifest/segment theo cấu hình account; nếu dự kiến VIP thì thêm TTL ngắn/refresh nhiều vòng. Draft không được lộ khi VIP vẫn còn hoãn.
- Thử gián đoạn upload, webhook bị mất/lặp và file hỏng; có kết quả đối soát thay vì trạng thái processing vô hạn.
- Bàn giao bảng budget/limits có nguồn dữ liệu từ Console và nơi lưu backup; dùng kết quả để chốt profile, phạm vi thiết bị và lịch G1–G3. Không đạt thì ghi vấn đề cần điều chỉnh và thử lại trước triển khai phụ thuộc.

### 14.2. Phân công và backlog sau MVP

Các đầu việc có thể làm đồng thời sau khi hợp đồng API được chốt; vẫn cần gate trước khi phụ thuộc pipeline media. Phân công theo vai trò:

- Backend/media: schema, auth, upload, webhook, queue, playback authorization, đối soát.
- Frontend/player: giao diện, tìm kiếm, player lifecycle, resume và telemetry.
- QA/thiết kế hỗ trợ: wireframe, thiết bị thật, dữ liệu mẫu, kiểm tra chéo acceptance.
- Cả hai kỹ sư: review hợp đồng API, fault injection, runbook và nghiệm thu.

Backlog sau MVP, theo ưu tiên:

1. Đánh giá và gợi ý nâng cao: mở API ratings khi schema/UI/test đã sẵn sàng; bổ sung vector nội dung, trending suy giảm và cá nhân hóa khi có dữ liệu. Không dùng việc chưa có các tính năng này để chặn mở MVP đã đạt điều kiện vận hành.
2. VIP/thanh toán: entitlement server-side, webhook thanh toán có chữ ký/idempotency, hết hạn/gia hạn nhiều vòng, giới hạn xem đồng thời, kiểm thử quyền tới segment. F07 bắt buộc trước phát hành phần này.
3. Tối ưu AV1/HEVC và profile theo nội dung sau benchmark; phân tích chi phí mã hóa so với lưu lượng tiết kiệm.
4. Nhiều hồ sơ, hồ sơ trẻ em, cài đặt ngôn ngữ/audio; gợi ý hành vi, đánh giá offline và A/B test khi đủ dữ liệu.
5. Casting, nguồn media dự phòng hoặc DRM nếu nhu cầu đo được yêu cầu.

### 14.3. Thứ tự viết code C01–C12

Đây là thứ tự lập trình theo module/file và kết quả chạy được. Lịch G0–G3 ở trên là khung điều phối; công việc thử nghiệm, ngân sách và phát hành không thay thế các bước code bên dưới. Code nền độc lập có thể bắt đầu trước khi có credential Cloudinary; nghiệm thu media thật phải dựa trên G0.

Các đường dẫn dưới đây lấy `E:\pj-Flim` làm gốc dự án; source ứng dụng vẫn là phần dự kiến. Packages database/media chỉ chạy ở Node.js, không được import vào frontend bundle hoặc làm lộ secret.

```text
pj-Flim/
  apps/api/src/                # NestJS controllers, services, guards
  apps/web/src/                # Next.js pages, components, hooks, player
  apps/worker/src/             # RabbitMQ consumers và tác vụ nền
  packages/contracts/src/      # Error codes, job schemas, generated API types
  packages/database/prisma/    # Schema, migrations, seed
  packages/media/src/          # Cloudinary adapter chỉ dùng phía server
  packages/backend-core/src/   # Shared audit/job/media policies, chỉ server
  infra/                      # Docker và cấu hình môi trường
  tests/                      # Contract, integration, E2E
```

| Bước code | Phần cần viết                                                  | Kết quả chạy được                        |
| --------- | -------------------------------------------------------------- | ---------------------------------------- |
| C01       | Khung Next.js, NestJS, worker, cấu hình/Docker                 | Web gọi API health, dịch vụ kết nối được |
| C02       | Prisma schema, migration, seed và constraints                  | Database mới migrate/seed thành công     |
| C03       | REST/error registry, filter, validation, OpenAPI và API client | Status/response/code theo hợp đồng       |
| C04       | Auth/session/role và UI tài khoản                              | Đăng nhập và phân quyền thật             |
| C05       | Catalog, mùa/tập, publication và admin API                     | CRUD và guard xuất bản chạy đúng         |
| C06       | Cloudinary adapter, upload intent và webhook                   | File thật upload, webhook ghi inbox      |
| C07       | Outbox, worker, processing, backup và retry                    | Asset READY/VERIFIED, xử lý lặp an toàn  |
| C08       | Playback session, renewal và telemetry API                     | Cấp quyền xem và ghi sự kiện đúng phiên  |
| C09       | Admin pages và trang chủ/danh mục/chi tiết                     | Admin đăng phim, người xem mở đúng tập   |
| C10       | Video player, HLS/native adapters và controls                  | Phát HD, tua, phụ đề và đổi tập          |
| C11       | Search, yêu thích, lịch sử, xem tiếp và báo lỗi                | Trải nghiệm cá nhân hoàn chỉnh           |
| C12       | Metrics, cleanup/restore scripts, test và CI build             | Source kiểm thử được, sẵn sàng cho G3    |

#### C01. Code bộ khung dự án

- Tạo apps web/API/worker và packages dùng chung; scripts dev/build/typecheck/lint, `.env.example` không chứa secret, Docker dev cho PostgreSQL/Redis/RabbitMQ.
- Viết `apps/api/src/main.ts`, `app.module.ts`, `config/`, `modules/health/`; worker có entrypoint và graceful shutdown riêng.
- Viết `apps/web/src/app/layout.tsx`, providers và `lib/api/http-client.ts` nền; cấu hình URL API qua môi trường. Tạo CI kiểm tra build ban đầu.
- Kiểm tra: khởi động được từ bản clone sạch; web gọi API health thật, thiếu cấu hình thì báo rõ. Không chuyển đổi source DocPrep thành web phim trong lúc chỉ cập nhật kế hoạch.

#### C02. Code database

- Viết `packages/database/prisma/schema.prisma`, migrations và `seed.ts` cho tài khoản, catalog/mùa/tập, media/attempt/intent, playback/progress/events/watchlist, inbox/outbox/operations/idempotency, audit/reports theo mục 10.
- Bổ sung roles/permissions/joins, refresh token family, MFA/challenge/recovery code và audit export. Seed registry role/permission cố định; migration tách quyền append-only audit và role archive/retention, không seed SUPER_ADMIN production có mật khẩu cố định.
- Tạo enums, foreign keys, unique/index và row_version; tách publication_status, processing_status, lifecycle, backup_status. Chưa mở rating/VIP trong MVP.
- Viết package truy cập database dùng cho API/worker; seed phim lẻ, phim bộ nhiều mùa, draft và tài khoản dev an toàn.
- Kiểm tra: migrate từ database rỗng, seed lặp được; constraint chặn slug/số tập/bản ghi cá nhân trùng. Không đánh dấu asset production READY bằng seed để bỏ qua media pipeline.

#### C03. Code nền RESTful API và error handling

- Viết `packages/contracts/src/error-codes.ts`, `problem-details.ts`, `jobs.ts`; registry code/status/type/retry thống nhất với mục 10.8.
- Viết `apps/api/src/common/filters/problem-details.filter.ts`, request-ID middleware, validation và response interceptor; giữ 204/304 không body.
- Tạo helpers/modules cho ETag/If-Match, cursor, idempotency và Operation/JobFailure. Các controller nghiệp vụ sẽ nối logic cụ thể vào các bước sau.
- Viết `config/swagger.config.ts` cho Swagger UI/raw spec/security schemes và `modules/audit/` gồm `audit.service.ts`, `audit.repository.ts`, `redact-audit.util.ts`. Service append audit nhận transaction context; interceptor chỉ thu correlation, không tự thay atomic audit bằng log sau response.
- Xuất OpenAPI từ nguồn DTO/schema được chọn, sinh `packages/contracts/src/generated/api-types.ts` và Postman collection; frontend hoàn thiện `lib/api/http-client.ts` để đọc Problem Details, field errors và requestId.
- Kiểm tra: 400/422, 428/412/409, headers và JSON schema đúng; không parse detail để quyết định logic, không viết bộ DTO frontend khác bằng tay.

#### C04. Code auth và phân quyền

- Viết `apps/api/src/modules/auth/` và `users/` với controller/service/repository/DTO: đăng ký, tạo/thu hồi/renew phiên, reset một lần và xác minh email.
- Viết session guard, role guard, cookie/CSRF/CORS, rate limit và admin MFA trước production; không nhận role admin từ body đăng ký.
- Cụ thể hóa `jwt-access.strategy.ts`, `refresh-token.service.ts`, `mfa.service.ts`; `modules/authorization/authorization.service.ts`, `permissions.guard.ts`, `mfa.guard.ts`, `step-up.guard.ts` và `require-permissions.decorator.ts`. Code API users/status/roles/MFA và authVersion invalidation theo mục 7.3/7.4, luôn kiểm resource ở service.
- Viết trang đăng nhập/đăng ký/reset, session provider và điều hướng admin trong `apps/web/src/`; backend vẫn kiểm tra quyền ở mọi route được bảo vệ.
- Kiểm tra: đăng nhập/logout thật; người thường không gọi admin, phiên thu hồi không renewal được, reset token không dùng hai lần. Email dùng adapter môi trường phù hợp.

#### C05. Code catalog, mùa/tập và publication

- Viết `modules/catalog/`, `episodes/`, `genres/` cùng DTO/repository cho API public và CRUD admin; hỗ trợ aliases, thể loại, diễn viên, poster và mùa kỹ thuật của phim lẻ.
- Viết `publication.service.ts` và guard dùng chung: title/tập công khai độc lập, active asset READY/lifecycle ACTIVE, backup VERIFIED trước xuất bản theo chính sách.
- Áp dụng transaction/row_version/If-Match và invalidation events; tách public DTO khỏi trường quản trị. Chuẩn bị types/validation cho form admin.
- Mọi mutation catalog/publication gọi AuditService trong cùng transaction, ghi allowlisted before/after và reason khi cần; permission catalog.write không thay catalog.publish.
- Kiểm tra: CRUD đúng, draft không lộ, thiếu/cũ ETag trả 428/412. Phần xuất bản với video thật nghiệm thu lại sau C06–C07, không thay bằng mock READY.

#### C06. Code upload Cloudinary và webhook

Đã có adapter, signed preset/config CLI, 3 API intent/read/verification và helper browser upload chia chunk. Xem [hợp đồng triển khai](../api/cloudinary-upload.md). Webhook đã kiểm chữ ký raw body/timestamp và lưu inbox/outbox; UI admin còn thiếu. Worker C07 đã tiêu thụ công việc xử lý HLS/backup.

- Viết `packages/media/src/cloudinary.provider.ts`: signing, metadata lookup, eager request và delivery URL; API/worker dùng lại adapter Node-only, không gọi SDK rải rác.
- Viết `modules/media/upload-intents.controller.ts` và service: kiểm quyền, preset/public ID do server chọn, trả tham số signed upload; API secret chỉ ở server.
- Viết `cloudinary-webhook.controller.ts`: giữ raw body, kiểm chữ ký/timestamp, ghi inbox bền rồi ACK; không chạy toàn bộ xử lý trong request webhook.
- Viết `apps/web/src/components/admin/video-upload.tsx`: direct/chunked upload, progress/hủy/lỗi; upload xong gọi verification resource, không tự báo READY.
- Kiểm tra: file thật upload được với account đã thử ở G0; intent không gắn sai owner/asset, webhook giả bị chặn và sự kiện lặp không tạo dữ liệu nghiệp vụ trùng.

#### C07. Code RabbitMQ worker và media pipeline

Core đã triển khai và nghiệm thu local: outbox confirm, quorum queue/DLQ, ACK sau ghi bền, hai job HLS/backup, lease/fencing/heartbeat, webhook dedup, retry/reconcile, audit SYSTEM và publication guard. Xem [source/vận hành và bằng chứng nghiệm thu](../api/media-worker.md). S3 thật/restore, HA và cảnh báo production còn thuộc nghiệm thu vận hành.

- Viết `apps/worker/src/outbox-publisher.ts`, consumers/handlers cho verification, processing, webhook-result, backup và delete; dùng schema message từ contracts.
- Nối initiatingActorId/operationId và audit hoàn tất/thất bại của worker; không đưa JWT hoặc role snapshot làm nguồn quyền duy nhất trong message.
- Viết attempt/version guard, verification provider, eager HLS, inbox-result processing và operation status; thêm retry scheduler, DLQ và reconciler.
- Viết backup nguồn/checksum/manifest và cập nhật backup_status; đối soát trước khi lặp provider request có kết quả chưa rõ. Không đưa video nhị phân vào queue hoặc đọc cả phim vào RAM.
- Nối UI processing/backup status, operation polling và retry idempotent; guard publication chỉ cho phép trạng thái hợp lệ.
- Kiểm tra: upload → verify → process → READY/VERIFIED → xuất bản chạy thật; restart/webhook lặp/sai thứ tự không làm sai active asset hoặc tạo công việc trùng.

#### C08. Code backend phát video và sự kiện

Trạng thái hiện tại: core API đã chạy local. Trước thử nghiệm công khai phải sửa ST02–ST03; ST01 còn giới hạn CDN như mục 11.1. Admin preview và frontend hooks chưa triển khai.

- Viết `modules/playback/` với `playback-sessions.controller.ts`, service/repository và `can-play-episode` guard cho khách/tài khoản/preview admin.
- Viết tạo/đóng phiên, manifest đúng phiên bản, idempotency và renewal nhiều vòng khi credential có hạn; từ chối cấp lại sau thu hồi.
- Viết `playback-events.controller.ts` và ingestion service: batch/schema, credential theo phiên, dedup, outbox và ACK 202 sau ghi bền. Session ID không phải mật khẩu.
- Viết frontend hooks `use-playback-session.ts`, `use-playback-events.ts` với single-flight renewal và hàng đợi event hữu hạn.
- Kiểm tra: cấp quyền đúng, draft không xem công khai, không gửi event vào phiên người khác, lỗi collector không chặn phát. F07 chỉ ghi đạt khi đã thử quyền có hạn thực tế.

#### C09. Code giao diện admin và các trang public

- Viết `apps/web/src/app/admin/` cho titles/seasons/episodes, upload/processing, preview, publication và lỗi thao tác; nối API C05–C08.
- Thêm trang `/admin/users`, `/admin/roles`, `/admin/audit-logs`, chi tiết diff và audit export; `use-permissions.ts` đọc GET /me, UI ẩn/khóa theo quyền, xử lý MFA/step-up. EDITOR/AUDITOR không thấy nút vượt quyền, API vẫn là nơi quyết định.
- Viết layout/header/footer, trang chủ/danh mục/chi tiết/tập; components `movie-card.tsx`, `movie-row.tsx`, `episode-list.tsx` và loading/empty/error states.
- Render metadata công khai theo hợp đồng Next.js; dữ liệu cá nhân/credential không vào cache chung. Tối ưu poster và lazy load, không tải mọi trailer ngay.
- Kiểm tra: admin tạo phim/tập, upload và xuất bản thật; người xem thấy đúng tập và mở trang xem. Player đầy đủ được ghép ở C10. Public UI có thể làm song song với C06–C08 khi API catalog đã ổn định.

#### C10. Code video player

ST05 ở mục 11.1 là đầu việc nghiệm thu bắt buộc của bước này; kiểm tra manifest/segment hiện có chưa chứng minh trải nghiệm player trên thiết bị thật.

- Viết `apps/web/src/features/player/` với `player-controller.ts`, `adapters/hls.adapter.ts`, `adapters/native.adapter.ts`, `video-player.tsx`, `player-controls.tsx`.
- Nối session/credential C08, Auto/chất lượng theo capability, tua, fullscreen, tốc độ, audio/phụ đề và giữ timeline khi đổi mức.
- Viết bounded retry, autoplay fallback, offline/reconnect, renewal/telemetry integration và destroy fetch/timer/listener/adapter khi đổi tập hoặc unmount.
- Map Problem Details và lỗi CDN/hls.js/native thành hành động đúng; không coi mọi 403 là hết hạn hoặc gán HTTP status giả cho lỗi mạng.
- Kiểm tra: HD phát trên thiết bị mục tiêu, tua/phụ đề/đổi tập hoạt động, không phát chồng hoặc tăng RAM vô hạn; menu chỉ hiện tính năng capability đã kiểm chứng.

#### C11. Code tìm kiếm và tính năng cá nhân

- Viết `modules/search/`, `watchlist/`, `history/`, `reports/`: normalization/aliases/trigram, filter/cursor, lịch sử, xem tiếp, yêu thích và báo lỗi.
- Viết progress service với sequence/generation, gộp khoảng xem, kiểm asset version; query tập tiếp theo dùng guard publication chung.
- Viết UI search/filter/my-list/history/continue-watching, form báo lỗi và countdown chuyển tập; guest resume cục bộ, tài khoản đồng bộ qua API.
- Viết hàng liên quan biên tập/cùng thể loại và view dedup; chưa làm rating hoặc gợi ý nâng cao.
- Kiểm tra: tìm không dấu/typo hợp lệ, yêu thích không trùng, request trễ từ thiết bị cũ không ghi đè resume và tua cuối không tự tính xem đủ.

#### C12. Code hoàn thiện vận hành và kiểm thử tích hợp

Bổ sung ST04 và ST06 theo mục 11.1: analytics/retention chưa có consumer chạy thật, backup độc lập/restore và webhook cố định chưa nghiệm thu production. Chạy bộ kiểm thử API hiện có không tự hoàn tất các mục này.

- Viết metrics/tracing, retention/cleanup jobs, budget alerts và dashboard; hoàn thiện restore scripts/reconciler từ C07 và che secret trong log.
- Hoàn thiện unit/integration/contract/Postman CLI/Playwright tests, bài xem dài và fault injection F01–F34 theo phạm vi, gồm auth/RBAC/audit/Swagger; sửa code gây lỗi. Test từng module được viết cùng module, không chờ C12 mới bắt đầu.
- Viết Dockerfile/config cho web/API/worker, migration/seed commands và CI build/test; chuẩn bị staging smoke/rollback scripts.
- Kiểm tra: cài mới/migrate/build và luồng admin upload → người dùng xem → resume chạy thật; có kết quả kiểm thử và khôi phục, không chỉ test case hoặc file config.
- Kết quả là source sẵn sàng cho G3; mở production và bàn giao vận hành tuân mục 13/16, không được coi là đã triển khai khi mới hoàn tất code.

### 14.4. Cách chia ticket code và xác nhận hoàn tất

- Mỗi bước chia ticket theo lát cắt chạy được: schema/migration → service/repository → controller/DTO/OpenAPI → UI/hook → integration test. Ghi file/module, endpoint, error codes, acceptance và phụ thuộc.
- Không cần code toàn bộ backend rồi mới frontend: admin nối sau catalog API, upload nối sau intent API, player nối sau playback session. Việc độc lập làm cùng lúc khi hợp đồng đã chốt.
- Mỗi ticket chạy typecheck/lint, test có ý nghĩa, Postman CLI/UI khi phù hợp; cập nhật OpenAPI/error registry và bằng chứng liên quan. Không gọi file rỗng/mock UI là tính năng đã hoàn tất.
- Trạng thái NOT_STARTED → IN_PROGRESS → IN_REVIEW → VERIFIED áp dụng cho từng ticket có phạm vi rõ. Hiện C01/C03/C04/C05/C06/C07/C08/C11 đã có các phần backend theo hướng dẫn API; C02 có SQL baseline và Prisma client. Frontend C09/C10 chưa triển khai; C12 mới có một phần kiểm thử. Không coi công đoạn đầy đủ là VERIFIED khi UI, migration, production hoặc nghiệm thu tương ứng còn thiếu. ST01–ST06 mới được ghi nhận, chưa sửa/đạt trong lần cập nhật plan này.
- Lịch G0–G3 là khung điều phối; C01–C12 là thứ tự lập trình. Chốt lại effort theo code/test thực tế và kết quả G0; không tự đưa rating/VIP/gợi ý nâng cao vào MVP.

## 15. Các quyết định cần xác minh bằng thử nghiệm

Các mặc định sản phẩm đã được đặt để tiếp tục thiết kế. Những điểm dưới đây là đầu việc xác minh, không phải yêu cầu dừng để xin lại quyết định:

- Gói Cloudinary thực tế: dung lượng mỗi video, giới hạn xử lý phim dài, profile 1080p, quota Admin API, storage/bandwidth và khả năng codec bổ sung.
- Cách bảo vệ HLS hoạt động xuyên suốt trên player JS/native và các URL con. VIP chỉ phát hành sau khi kiểm thử hết hạn/gia hạn/thu hồi đạt.
- Custom domain/cookie/token nếu cần và chi phí tương ứng; MVP miễn phí dùng mô hình truy cập công khai sau xuất bản đã mô tả.
- Bitrate/profile, segment và buffer phù hợp các mạng người dùng mục tiêu. Các ngưỡng trong tài liệu là điểm khởi đầu, phải ghi kết quả benchmark.
- Chốt kho backup, budget/retention và thời gian khôi phục media theo mục 12.4/13.3; chính sách mặc định trong tài liệu là điểm khởi đầu cần đối chiếu usage thực tế.
- Chốt capability matrix của adapter, hợp đồng event/credential cho khách và schema publication riêng title/episode ở G0/G1. Gia hạn nhiều vòng là bắt buộc khi đưa quyền có hạn vào luồng xem.

## 16. Điều kiện bàn giao bản MVP

- Có source, migration, OpenAPI/Postman collection, hướng dẫn môi trường và pipeline CI/CD của dự án web phim.
- Admin đưa được phim dài lên Cloudinary, thấy lỗi/tiến độ, xem thử, xuất bản, thay video và gỡ phim.
- Khách tìm/xem được phim và lưu resume cục bộ; người dùng đăng nhập đồng bộ lịch sử/yêu thích chính xác. Đánh giá và gợi ý nâng cao thuộc bàn giao sau MVP.
- HD hoạt động trên ma trận thiết bị; báo cáo có startup, rebuffer, thời gian giữ HD và GB/giờ xem.
- Có bằng chứng kiểm tra ma trận F01–F34; F07 bắt buộc khi đưa quyền có hạn/VIP vào phạm vi phát hành. Bài kiểm tra chất lượng thủ công dựa vào capability đã công bố.
- Có dashboard, cảnh báo chi phí, đối soát, DLQ, backup/restore và runbook vận hành.
- Dashboard nhận telemetry cho khách/tài khoản qua hợp đồng event; có báo cáo độ bao phủ/method đo và số liệu không đầy đủ. Hoạt động analytics không được chặn phát/resume.
- Có bằng chứng tập 1–5 vẫn phát khi tập 6 xử lý, gỡ từng tập có hiệu lực ở API cấp quyền và không lộ draft qua cache/list/search.
- Có bảng ngân sách theo catalog/giờ xem thực tế, kho backup nguồn đã cấu hình và bài phục hồi media riêng với database. Lịch G1–G3 được cập nhật theo kết quả G0.
- Có OpenAPI máy đọc được và Postman collection khớp API thực tế, registry mã lỗi dùng chung frontend/backend, contract tests đạt và ví dụ Problem Details đã được kiểm chứng. HTTP status/ETag/idempotency tuân mục 10, không giữ endpoint động từ cũ làm nguồn hợp đồng thứ hai.
- Có ma trận permission áp dụng trong guard/service/UI, JWT/refresh/MFA/step-up đã kiểm, quản trị user/role không tự nâng quyền hoặc khóa quản trị cuối; audit admin append-only/redaction/atomic và export có kiểm soát. Swagger UI/raw spec đúng policy và không có credential thật trong tài liệu.
- Ghi rõ các giới hạn còn lại: codec/thiết bị, độ trễ thu hồi, phụ thuộc provider, ngưỡng tải đã đo. Tài liệu thiết kế không được dùng thay báo cáo kiểm thử thực tế.
