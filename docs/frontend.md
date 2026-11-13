# Giao diện người dùng và quản trị

Cập nhật 13/11/2026. Source tại [apps/web](../apps/web), sử dụng React, TypeScript, React Router, Vite, hls.js và Lucide. Giao diện tiếng Việt, nền tối, responsive; dữ liệu lấy từ API NestJS hiện có.

Chọn React/Vite để chạy cùng backend local với ít bước cấu hình. Next.js trong các bản thiết kế cũ chưa được triển khai; SSR/SEO public chưa nằm trong bản này.

## Live search — 13/11/2026

Ô tìm phim công khai có gợi ý từ 2 ký tự, debounce 300 ms, tối đa 6 phim, giữ loại/thể loại/sort. Dùng phím lên/xuống và Enter để mở phim, Escape/Tab/nhấn ngoài để đóng; bấm lại input mở gợi ý. Nút Tìm kiếm/Xem tất cả kết quả vẫn đưa về danh mục có URL/bộ lọc, Xóa từ khóa và Back/Forward giữ hành vi hiện có. Có loading/rỗng/lỗi/thử lại, abort request và bỏ response cũ, hỗ trợ composition. Component riêng [LiveSearch.tsx](../apps/web/src/components/LiveSearch.tsx), dùng API catalog công khai hiện có.

[Báo cáo](testing/live-search-2026-11-13.md): frontend-only 202 kiểm tra đạt, gồm54 live search; 4 mẫu responsive và6 kiểm tra runtime localhost:3000 read-only. Không đổi backend/schema, chưa thêm fuzzy/ranking/cache hoặc audit WCAG/IME hệ điều hành.

## Admin mở rộng — 13/11/2026

Đã bổ sung hồ sơ diễn viên/đạo diễn, banner, cấu hình website và danh sách báo lỗi; menu/lối tắt/route theo permission. Biểu mẫu lưu qua API, giữ ETag/If-Match và bản nháp khi xung đột; settings dùng step-up hiện có. Báo lỗi chỉ đọc, giữ redaction AUDITOR. Xem [báo cáo nghiệm thu](testing/admin-ui-2026-11-13.md): 148 kiểm tra frontend đạt, 24 mẫu responsive; hồi quy API riêng đạt 1.998, gồm 64 kiểm tra timestamp pagination.

## Giao diện và thao tác — cập nhật 13/11/2026

- Chữ nội dung chính 14–16px, chữ phụ 12–13px; các nút chính tối thiểu 44px, trường nhập liệu và trạng thái có độ tương phản rõ hơn. Giữ nền tối/màu nhận diện mint, tăng khoảng cách giữa các nhóm nội dung.
- Trang chủ dùng khu vực giới thiệu gọn hơn, thẻ phim thực thay phần trang trí, tìm kiếm riêng ngay trên danh mục, nút xóa từ khóa và thông báo số phim đang hiển thị. Nút tìm kiếm trên thanh đầu trang chuyển về và đưa focus vào ô tìm phim; loại phim đang chọn có trạng thái rõ ràng.
- Tên phim trên thẻ hiển thị tối đa hai dòng; poster thiếu hoặc lỗi dùng placeholder. Không thêm phim/ảnh/dữ liệu giả vào kho.
- Trang xem bố trí video và tập phim cạnh nhau từ màn hình rộng; trên màn hình nhỏ danh sách xuống dưới. Có nhãn Đang xem, số tập đã tải và Tập tiếp theo khi tập đó có trong danh sách. Điều khiển chất lượng/tốc độ và cơ chế HLS/MP4 giữ nguyên.
- Admin có chữ/bảng/form lớn hơn, menu Danh mục mở/đóng trên màn hình nhỏ và tự đóng sau khi chuyển trang. Bảng cuộn ngang trong vùng riêng, có hỗ trợ bàn phím. Trang sửa phim có lối tắt tới Thông tin phim và Tập phim & video.
- Menu tài khoản đóng bằng Escape hoặc nhấn bên ngoài, trả focus về nút mở khi dùng Escape. Giữ focus-visible, nhãn trường nhập và reduced-motion.

Lớp trình bày mới nằm ở [ux.css](../apps/web/src/ux.css), được import sau styles.css để điều chỉnh bố cục và trạng thái responsive. Điều hướng và xử lý tương tác vẫn ở component tương ứng.

Kiểm tra ngày 13/11/2026: web build đạt, 73 kiểm tra browser/API trong database PostgreSQL tạm đạt; đã xem ảnh 28 trường hợp tại chiều rộng 320/390/768/1440px (trang chủ, chi tiết, đăng nhập, player, admin, danh mục admin và editor), không tràn ngang toàn trang, không có pageerror. Có kiểm giải mã hình ảnh video thật trên Chrome headless (muted), đóng phiên khi rời player và đăng xuất admin sau kiểm tra. Ảnh/kết quả riêng ở .local/web/ux. Đây là kiểm tra responsive trên Chrome, chưa thay nghiệm thu thiết bị hoặc audit WCAG đầy đủ.

## Mở và chạy

Bản build được API phục vụ cùng origin, không cần mở process frontend riêng:

```powershell
Set-Location E:\pj-Flim
npm.cmd install
npm.cmd run build:all
npm.cmd start
```

- Người xem: http://localhost:3000
- Quản trị: http://localhost:3000/admin
- Swagger: http://localhost:3000/api/docs
- Tài khoản admin được bootstrap bằng lệnh có sẵn; thông tin riêng tư nằm trong .local/api/bootstrap-admin.json.
- Nếu API đang chạy, dừng/khởi động lại đúng process của dự án; không mở API thứ hai trên cổng 3000.
- Để xử lý upload mới cần RabbitMQ, worker, relay và webhook local. Dùng [media runbook](api/media-worker.md) và scripts/Start-MediaLocal.ps1; script này đã build cả API lẫn web.

Để lập trình với hot reload, chạy API cổng 3000 và mở terminal thứ hai:

```powershell
npm.cmd run web:dev
```

Truy cập http://localhost:3002. Vite proxy /api sang API. WEB_API_ORIGIN chỉ dùng tại dev/preview server, không chèn vào JavaScript client. Cả hai origin dùng dữ liệu browser riêng; dùng nhất quán localhost hoặc 127.0.0.1 trong một phiên.

## Cấu hình public

Sao chép [.env.web.example](../.env.web.example) thành .env.web.local, chỉ điền:

```dotenv
VITE_CLOUDINARY_CLOUD_NAME=YOUR_CLOUD_NAME
WEB_API_ORIGIN=http://127.0.0.1:3000
```

Cloud name dùng tạo URL ảnh từ provider ID. Không đặt Cloudinary API secret, mật khẩu DB hoặc JWT signing key trong biến VITE_. File này được Git bỏ qua; build lại khi thay đổi. Video dùng URL API cấp; không suy diễn URL phim từ cloud name.

## Màn hình người xem

| Đường dẫn   | Chức năng                                                                    |
| ----------- | ---------------------------------------------------------------------------- |
| /           | Tìm theo tên, lọc phim lẻ/phim bộ/thể loại, sắp xếp và tải thêm              |
| /titles/:id | Giới thiệu, poster, thể loại, mùa/tập, lưu/bỏ yêu thích, phim liên quan      |
| /watch/:id  | Phiên xem HLS, điều khiển video, tốc độ, chất lượng khi dùng hls.js, báo lỗi |
| /login      | Đăng nhập; chuyển về trang đang cần truy cập                                 |
| /register   | Tạo MEMBER rồi đăng nhập                                                     |
| /library    | Yêu thích, lịch sử và xem tiếp, phân trang                                   |
| /help       | Hướng dẫn thao tác cơ bản                                                    |

Kho phim chỉ hiển thị nội dung đã xuất bản và đủ điều kiện của API. Khi chưa có phim, trang hiển thị thông báo trống; không tạo phim mẫu trong database thật. Phim thử dài hiện có vẫn giữ nguyên trạng thái.

## Màn hình admin

| Đường dẫn         | Chức năng                                                      | Quyền chính                                    |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| /admin            | Số liệu tổng quan thực tế, nội dung gần đây, hướng dẫn ba bước | metrics.read / catalog.read_drafts             |
| /admin/titles     | Tìm/lọc trạng thái và quản lý phim                             | catalog.read_drafts                            |
| /admin/titles/new | Tạo phim lẻ hoặc phim bộ                                       | catalog.write                                  |
| /admin/titles/:id | Sửa thông tin/thể loại, thêm mùa/tập, upload và xuất bản       | catalog.write / media.upload / catalog.publish |
| /admin/genres     | Danh sách, tạo thể loại                                        | catalog.read_drafts / catalog.write            |
| /admin/users      | Tìm user, khóa/mở khóa, gán vai trò có lý do                   | users.read / users.suspend / rbac.assign       |
| /admin/roles      | Đọc vai trò và permission                                      | rbac.read                                      |
| /admin/audit-logs | Đọc/lọc nhật ký 7 ngày gần nhất, xem safe diff                 | audit.read                                     |
| /admin/people | Tìm trong hồ sơ đã tải, tạo/sửa tên, tiểu sử, mã ảnh | catalog.read_drafts / catalog.write |
| /admin/banners | Chọn phim, ảnh, tiêu đề, thứ tự, bật/tắt và lịch | catalog.read_drafts / catalog.write |
| /admin/settings | Lưu tên, mô tả, email hỗ trợ và xem bản nháp | settings.write, step-up theo policy |
| /admin/reports | Đọc/lọc báo lỗi, redaction với AUDITOR | reports.read |

Menu/nút dựa trên permissions từ /me. API vẫn kiểm quyền, session, ownership, ETag và audit; ẩn nút không thay bảo vệ backend. MEMBER không vào giao diện admin; EDITOR không được tự xuất bản hoặc gán role.

Phim lẻ tự có tập đầy đủ theo backend. Phim bộ: tạo mùa, thêm tập rồi chọn tập để tải video. Metadata sửa bằng If-Match; xung đột yêu cầu tải lại. Không ghi đè thay đổi của người khác bằng retry tự động.

## Quy trình upload và xuất bản

1. Tạo phim, mở mục Tập phim & video và chọn tập.
2. Chọn video. API tạo upload intent có owner/episode/expectedBytes/sourceFormat.
3. Browser dùng chữ ký upload trực tiếp Cloudinary, chia chunk theo hợp đồng; không gửi JWT/cookie API sang Cloudinary.
4. API verification dùng idempotency key được giữ lại. Nếu mất phản hồi, bấm Kiểm tra video đã tải; không tự upload đè file.
5. UI theo dõi asset/operation, hiển thị trạng thái HLS và backup. READY và VERIFIED đến từ worker/API, không được frontend tự gán.
6. Người có catalog.publish chọn Sử dụng video này. Xuất bản tập rồi xuất bản phim.
7. Backend chặn khi thiếu active asset, HLS, backup hoặc quyền. Worker không tự xuất bản.

Dữ liệu khôi phục trong sessionStorage chỉ gồm ID intent/asset/operation và verification key theo user/episode; không lưu chữ ký upload. Hủy hoặc rời trang abort lượt tải đang diễn ra. Chưa hỗ trợ resume chunk xuyên reload; xác minh lại trước khi tạo lượt tải mới.

Poster/ảnh nền nhận provider ID của ảnh đã có trong Cloudinary. API upload ảnh riêng chưa được triển khai; không dùng trường này để nhập URL hoặc tải video.

## Trình phát và tài nguyên

- Dùng native khi có ManagedMediaSource hoặc không có MSE và có native. Chrome/MSE ưu tiên hls.js vì canPlayType có thể trả maybe dù không phát được đầy đủ. Nếu hls.js không hỗ trợ thì fallback native khi có.
- hls.js quản lý ABR và segment; worker cùng phiên bản được bundle và cấp workerPath để chạy transmux ngoài main thread. Mục Độ phân giải lấy từ level HLS thực, bỏ height không hợp lệ/trùng và sắp từ cao xuống thấp; có Tự động, không tự thêm 1080p/4K. Chọn mức dùng currentLevel, giữ vị trí/tốc độ và phiên hiện tại. Hiện tại: Np đọc videoHeight qua loadedmetadata/loadeddata/resize để báo khung hình thực, có trạng thái đang chuyển. UI còn có tốc độ 0.5–2×, native seek/fullscreen.
- MP4 dự phòng hiển thị độ phân giải gốc và khóa lựa chọn; nút Thử lại HLS để đổi độ phân giải sẽ pause/lưu tiến trình, chờ dispose/đóng phiên cũ rồi tạo phiên HLS mới. Đây là thao tác do người xem yêu cầu, không tự lặp chuyển nguồn. Native HLS dùng mục Tự động (trình duyệt) và không giả điều khiển mức qua API video element.
- Cấu hình hiện tại: maxBufferLength 30 giây, maxMaxBufferLength 60 giây, backBufferLength 30 giây. Đây là cấu hình, chưa phải số đo tối ưu trên mọi thiết bị.
- Phiên tạo một lần theo episode/identity. Gia hạn một luồng trước expiry 60 giây; retry lỗi tạm thời tối đa 3 lần với cùng key của lần gia hạn.
- Recovery lỗi fatal của player tối đa 2 lần; lỗi codec/attach không gọi recoverMediaError rồi chờ vô hạn. Lỗi media chưa phục hồi sau 4 giây hoặc startup chưa có metadata sau 25 giây chuyển sang MP4 nếu phiên có fallback. MP4 cũng timeout 25 giây; lỗi cuối hiện mã ổn định, không hiện URL ký. Teardown hủy listener/timer, destroy hls.js, gỡ nguồn video; đồng bộ best effort rồi đóng phiên.
- Với nguồn MP4 đã xác minh, có nút Đổi cách phát và tự chuyển sau lỗi HLS không phục hồi. Giữ vị trí hiện tại và tốc độ, bỏ chọn chất lượng vì MP4 không ABR. Nếu autoplay bị chặn, nút Phát video cho phép người dùng chủ động phát. Không tự chuyển qua lại gây vòng lặp.
- Events gửi mỗi 5 giây, batch tối đa 50, hàng đợi tối đa 150; retry giữ batch ID/payload. Progress mỗi 15 giây và pause/seek/end, sequence tăng, interval không bao gồm đoạn tua qua.
- Tiến trình tài khoản theo API và phiên bản asset; khách lưu ở browser theo episode/asset. Ended chỉ yêu cầu ghi hoàn tất sau khi gửi được sự kiện ended; server vẫn quyết định completed.
- Rời ứng dụng/đóng tab đột ngột có thể mất lần đồng bộ cuối; không hứa đảm bảo dữ liệu như khi người xem điều hướng trong ứng dụng.

Chi tiết thuật toán và giới hạn CDN tại [streaming-algorithms.md](design/streaming-algorithms.md). Signed URL hiện không tự hết hạn trên CDN. ST01–ST06 vẫn cần nghiệm thu riêng.

## Đóng phiên và đăng xuất

Player đăng ký tác vụ dọn phiên ở lib/playback-cleanup.ts. Tracker.dispose là single flight, giữ tác vụ sau khi component unmount; logout dừng player rồi chờ progress/events/DELETE playback trước khi thu hồi auth, tối đa5giây. Timeout hoặc đóng tab đột ngột vẫn là best effort. Xem [kết quả full-stack 13/11/2026](testing/full-stack-2026-11-13.md): 1.227 kiểm tra tích hợp (76 browser), 17 bước video Cloudinary thật và 2 asset/backup được kiểm lại.

## Bảo mật và cách phục vụ

- Static server chỉ đọc dist/web, không đọc project root, backup, email hay .local. /api luôn thuộc router API, không rơi vào SPA fallback.
- HTML no-store; CSP hạn chế script cùng origin, media/connect tới Cloudinary và worker blob. Không chèn secret vào HTML hoặc bundle.
- API client chỉ gọi cùng origin, có timeout/cancellation, đọc Problem Details và requestId. Access/refresh token giữ trong sessionStorage theo tab; logout xóa phiên browser và thu hồi phía server.
- sessionStorage vẫn có thể bị đọc nếu ứng dụng mắc XSS. Không coi đó là kho bí mật hay tự tuyên bố đạt production security. Không render HTML từ metadata bằng dangerouslySetInnerHTML.
- Refresh single flight, kiểm generation chống phản hồi cũ khôi phục phiên đã logout. Đổi role/status vẫn do backend thu hồi quyền.
- Local tuân AUTH_MFA_REQUIRED=false đã được yêu cầu. Mặc định/production giữ MFA và step-up; UI có nhập challenge/code, chưa có màn hình enrollment/reset MFA.
- Không public deploy trong lượt này.

## Kiểm tra

```powershell
npm.cmd run web:typecheck
npm.cmd run build:all
# Thiết lập PJ_FLIM_TEST_ADMIN_PASSWORD trong môi trường tiến trình trước:
npm.cmd run test:web
# Bao gồm frontend trong bộ integration đầy đủ:
$env:PJ_FLIM_TEST_WEB='true'
$env:PJ_FLIM_TEST_WORKER='true'
npm.cmd run test:integration
```

test:web dùng Chrome headless đã cài, API thật và PostgreSQL pj_flim_test_<random> do runner tạo rồi dọn; không chạy fixture trên pj_flim. Có thể đặt PJ_FLIM_CHROME_PATH nếu Chrome ở vị trí khác. Chrome không cần tải binary qua Playwright.

Kết quả local ngày 11/11/2026: build:all đạt; test:web có 53 kiểm tra; bộ integration đầy đủ có RabbitMQ và frontend đạt 1.198 kiểm tra.

Bộ browser kiểm tạo/sửa phim và tập, upload trực tiếp không gửi JWT sang provider, publication guard, chọn asset/xuất bản, trang user/role/audit, đăng ký, yêu thích sau reload, thư viện, chặn MEMBER, quyền EDITOR, control player và đóng phiên khi rời trang. Cloudinary upload/lookup được giả lập tại ranh giới ngoài; HLS/backup READY là fixture rõ ràng trong DB tạm. Chưa dùng bài này chứng minh giải mã/phát HD thực tế.

Ảnh desktop/mobile và kết quả nằm riêng dưới .local/web, được Git bỏ qua. Ma trận Android/Safari/iPhone, tua/chuyển 20 tập, mạng yếu, expiry dài, codec và tải đồng thời còn phải nghiệm thu; ST05 chưa VERIFIED.

Nghiệm thu provider/CDN/video thật có lệnh streaming:smoke riêng và cờ opt-in; xem [báo cáo/quy trình](testing/live-streaming.md). Không dùng test:web mock để thay bằng chứng đó.

## Phần chưa có giao diện

Email verification/reset password, MFA enrollment, subtitle/audio selection, admin preview phim nháp, gán credits, API/UI đổi trạng thái xử lý report và dashboard analytics nâng cao vẫn cần bổ sung. People/banner/settings/đọc report đã có màn hình quản trị. Trang người xem chưa đọc banner hoặc site settings để thay thương hiệu/header; ảnh vẫn nhập provider reference có sẵn. Bản này ưu tiên luồng xem và quản trị nội dung cơ bản; không coi mọi API hiện có đã có màn hình.

## Gợi ý cá nhân hóa — 13/11/2026

Trang /for-you cần đăng nhập, có link Dành cho bạn trên menu. Mặc định opt-out; người dùng bật để dùng phim đã lưu/coverage hợp lệ, chọn ẩn phim đã xem hết, xem lý do, Không quan tâm/hoàn tác phản hồi gần nhất và tải thêm. Preference dùng ETag, lỗi 412 yêu cầu tải lại; feed hết hạn có nút thử lại. Request hủy khi unmount/logout và state remount theo tài khoản. Không lưu feed xuống browser storage. [API và giới hạn](api/recommendations.md), [thuật toán](design/recommendation-algorithms.md).
