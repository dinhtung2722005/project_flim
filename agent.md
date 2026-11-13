# Ngữ cảnh và quy tắc dự án pj-Flim

Cập nhật nền: 11/11/2026, múi giờ Asia/Saigon. Tiến trình thay đổi theo từng phiên được lưu trong [memory.md](memory.md).

## Dự án và phạm vi thư mục

- Dự án web xem phim VOD sử dụng backend Node.js, trải nghiệm xem quen thuộc như Netflix và các web phim phổ biến.
- Git remote: https://github.com/dinhtung2722005/project_flim, nhánh main; Git được khởi tạo và source được push theo yêu cầu ngày 11/11/2026. Chỉ commit source/cấu hình mẫu, không commit local credential hoặc dữ liệu runtime.
- GitHub source update 13/11/2026: source commit 4d45989 pushed to origin/main and verified. Includes viewer/admin UI, live search, streaming/security/pagination fixes and research docs. Local secrets/runtime data and unrelated personal documents remain excluded.
- Gốc dự án bắt buộc: E:\pj-Flim. Người dùng đã nhiều lần yêu cầu không viết công việc phim vào DocPrep/Docrep hoặc thư mục mặc định của công cụ.
- Khi cwd của công cụ khác gốc dự án, đặt workdir rõ ràng cho mọi lệnh. Tuân thủ quyền filesystem của phiên; dùng cơ chế cấp quyền của môi trường khi cần ghi ngoài writable root.
- Source, tài liệu và cấu hình dự án đều nằm dưới gốc này. Không sửa các file .docx hoặc dự án khác khi không được yêu cầu.
- Plan đang dùng: [docs/plans/movie-streaming-platform-plan.md](docs/plans/movie-streaming-platform-plan.md). File trùng tên tại gốc là bản cũ; không dùng nó làm nguồn hiện hành.

## Cách cộng tác

- Giao tiếp với người dùng bằng tiếng Việt, nêu kết quả và giới hạn thực tế.
- Với công việc đã được yêu cầu/ủy quyền, tiếp tục thực hiện đến kết quả chạy và kiểm tra được. Chỉ hỏi khi thiếu thông tin thực sự cần thiết.
- Đọc source và hướng dẫn liên quan trước khi sửa; không kết luận một tính năng đã có chỉ vì xuất hiện trong plan.
- Tôn trọng cấu trúc DTO/controller/service đã được người dùng yêu cầu tách riêng.
- Không mở rộng sang xây frontend, triển khai public, thay hạ tầng hoặc xử lý ticket khác khi nhiệm vụ hiện tại không bao gồm.
- Không coi bản local, test mock hoặc một lệnh build thành bằng chứng đã sẵn sàng production.

## Kiến trúc và cấu trúc source

Stack hiện hành: Node.js/TypeScript, NestJS, Prisma với pg adapter, PostgreSQL; Cloudinary cho nguồn/HLS/CDN; RabbitMQ cho xử lý nền. Frontend hiện dùng React/Vite/React Router và hls.js; đã có UI người xem/admin, build vào dist/web và phục vụ cùng API. Next.js/SSR chưa triển khai.

```text
apps/api/src/
  controllers/       HTTP controllers, Swagger, DTO binding
  services/          nghiệp vụ và transaction
  dto/               DTO đầu vào chia theo nghiệp vụ
  filters/           GlobalExceptionFilter
  exceptions/        mapper lỗi HTTP/database/parser
  app.module.ts      đăng ký controller/provider/APP_GUARD/APP_FILTER
  application.ts     bootstrap HTTP, parser, Swagger, middleware
apps/web/src/        UI public/admin, auth/API client, player/telemetry
apps/worker/src/     outbox, broker, HLS, backup và webhook relay
packages/
  database/          Prisma schema/client và truy vấn
  media/             adapter Cloudinary, HLS verifier, backup
  backend-core/      ApiError và helper lỗi dùng chung
  contracts/         registry mã lỗi
  config/            đọc biến môi trường
docs/api/            hợp đồng API và cách vận hành
docs/design/         thiết kế backend/database, SQL baseline
docs/plans/          plan hiện hành
tests/               integration HTTP/client/worker
```

- Thanh tìm phim public dùng components/LiveSearch.tsx trong Catalog: debounce 300 ms/từ 2 ký tự/limit 6, public API auth:false cùng kind/genre/sort, abort+query key+clear state khi đóng, IME và combobox keyboard. Submit/full results giữ URL/history; không tự sửa ranking/cache backend. Regression tests/live-search.browser.ts nối frontend suite, chỉ DB tạm; xem docs/testing/live-search-2026-11-13.md.
- UX/UI hiện dùng styles.css cho nền tảng và ux.css import sau cho lớp dễ đọc/responsive; màn hình rộng có video cạnh danh sách tập, admin mobile dùng menu đóng/mở. Mức chất lượng vẫn phải phản ánh rendition/videoHeight thật; giữ trạng thái focus và nhãn trường khi sửa UI.
- Admin mở rộng ở apps/web/src/features/admin/{People,Banners,Settings,Reports}.tsx, dùng resource-ui.tsx và admin.css. Route/menu dựa permission, PATCH/PUT giữ ETag; xung đột giữ bản nháp, không tự lấy ETag mới để ghi đè. Báo lỗi chỉ đọc và giữ redaction; chưa có report moderation API, public banner/settings integration hoặc UI gán credits.
- Web: đọc [docs/frontend.md](docs/frontend.md). Chỉ import browser-upload helper từ packages/media vào client, không import adapter/SDK/config Node. Public env chỉ cloud name; API secret/DB/signing key không được vào VITE_.
- Token browser ở sessionStorage theo tab; không log token/URL ký. Static server chỉ dist/web, /api không rơi vào SPA. Local auth policy áp dụng cả viewer check cho staff, production vẫn MFA.
- Controller chuyển request sang service; transaction/ownership/invariant đặt tại service. Giữ adapter provider ngoài frontend.
- DTO giữ validation và metadata Swagger. Khi di chuyển file, cập nhật import, dependency injection, test và link tài liệu.
- Dùng GlobalExceptionFilter qua APP_FILTER; không thêm một ApiError hoặc handler song song với hợp đồng khác.
- Lỗi API dùng application/problem+json, registry code, requestId, retryable và field errors an toàn.
- Bigint trả chuỗi; decimal PostgreSQL trả JSON number. Collection dùng data/page và cursor có ràng buộc query/scope.

## Invariant cần giữ

- Staff dùng permission hiện hành; dữ liệu cá nhân phải kiểm ownership. Theo yêu cầu ngày 11/11/2026, local dùng AUTH_MFA_REQUIRED=false để bỏ MFA/step-up ở đăng nhập API và thao tác quản trị; không xóa factor hoặc ghi timestamp MFA giả. Mặc định/production vẫn bắt buộc MFA. Giữ mật khẩu, session/revocation, RBAC, audit và SUPER_ADMIN cuối. JWT còn hạn không tự bảo đảm phiên còn quyền.
- Theo yêu cầu mới ngày 11/11/2026, Swagger local mở trực tiếp /api/docs và /api/openapi.json không cần đăng nhập. Đã bỏ form/cookie/CSRF/docs-session và tự chèn Bearer; GET docs-login cũ chỉ redirect. API admin vẫn kiểm JWT/session/RBAC; dùng Authorize với token từ API login. Production hoặc SWAGGER_ENABLED=false không mount docs.
- Mutation admin có audit cùng transaction; audit ghi lỗi phải rollback. Không thêm API sửa/xóa audit.
- Không nhận trạng thái xử lý, role hoặc owner tùy ý qua DTO metadata.
- Public catalog/playback chỉ cấp nội dung đã xuất bản và đủ điều kiện; draft không được lộ qua list/search/detail.
- Asset chỉ READY khi HLS đúng attempt/profile/config và backup đã xác minh. Worker không tự xuất bản phim.
- Playback ưu tiên HLS; source_format=mp4 đã verified có delivery.fallback URL ký tới nguồn authenticated cùng asset/version. Player recovery hữu hạn, hỗ trợ Đổi cách phát và nút Phát video khi autoplay bị chặn; MP4 không ABR, không tạo eager/transformation mới, vẫn chịu giới hạn URL ký không tự hết hạn.
- Độ phân giải UI chỉ dùng level HLS thực và videoHeight của khung hình; MP4/native không giả chọn rendition. Thử lại HLS từ MP4 phải lưu tiến trình và đóng phiên cũ trước khi tạo phiên mới.
- Video truyền trực tiếp Cloudinary CDN tới client. Node không proxy toàn bộ segment hoặc tạo transformation mỗi lần Play.
- Encoding/nén đa độ phân giải nghiên cứu tại plan 6.7/14.6, ENC01–ENC09 đều NOT_STARTED. Eager hiện dùng profile trong policy (config mặc định hd), không có encoder FFmpeg/per-title/VMAF nội bộ; bằng chứng hiện tại 5 mức 180/270/360/540/720, không gọi là đã hỗ trợ 1080p/HDR/đa codec. Profile mới phải có định nghĩa/version bất biến và gate attempt/backup/preview; AV1/VP9 preset Cloudinary hiện là DASH, cần adapter/gate riêng, không chỉ đổi env. Không chạy transcode/catalog benchmark chỉ để sửa docs.
- Player cleanup được theo dõi ở apps/web/src/lib/playback-cleanup.ts, giữ Promise dispose single flight cả sau unmount. Logout phải dừng player và chờ dọn phiên trước khi thu hồi auth (timeout5giây/best effort khi offline), tránh bỏ lại phiên và chạm quota.
- Phiên phát pin asset version. Progress dùng generation/sequence, chống phiên cũ ghi đè và không cộng trùng khoảng xem.
- Nguồn điểm/review bên ngoài nghiên cứu tại docs/design/external-ratings-reviews-research.md, plan 9.6/14.7 và EXT01–EXT08 NOT_STARTED; chưa có IDs/schema/importer/API/UI nguồn ngoài. IMDb TSV không có review text; Metacritic có paid/approved Origin API, quote khác toàn bài. TMDB là ưu tiên thử theo quyền; policy nguồn phải kiểm display/storage/AI/region/purge. Runtime agent chưa có: chỉ dùng để hỗ trợ có bằng chứng, không vượt điều kiện API/bot/paywall hoặc tự publish dữ liệu.
- Gợi ý hiện chỉ cùng thể loại ở PublicCatalogService.recommendations. Nghiên cứu tại plan 9.2/14.5 (REC01–REC09) là thiết kế chưa triển khai: không có personalized feed, impression pipeline, model hoặc schema recommendation. Khi code, giữ eligibility/ownership/opt-out và analytics queue riêng; không dùng media publisher hiện tại như thể đã xử lý playback.events.accepted.
- Redis trong plan hiện chưa tích hợp: không client/cấu hình/container; không mô tả cache/rate limit hiện có là Redis phân tán. Chỉ triển khai khi có công việc tương ứng.
- Outbox/inbox/job state phải ghi bền và có idempotency/lease; không đưa video hoặc credential rõ vào RabbitMQ.
- Với cursor thời gian, query phải cấp timestamp PostgreSQL nguyên độ chính xác qua __cursor_time; paginated dùng giá trị này và bỏ khỏi data JSON. Không chuyển khóa cursor qua Date JavaScript làm mất microsecond và bỏ sót bản ghi cùng thời điểm. Có tests/pagination.integration.ts và trường paginationChecks trong báo cáo.
- Baseline database hiện được quản lý bằng SQL và Prisma client; chưa có Prisma Migrate. Không tự chạy db push hoặc thay constraint/grant chỉ để khớp ORM.

## Cấu hình và dữ liệu riêng tư

- Biến DB: .env.database.local; API/auth/Cloudinary: .env.api.local; worker/broker/backup/callback: .env.worker.local.
- Các file .env.*.local, .local/, .tmp/, node_modules/ và dist/ được Git bỏ qua.
- JWT_SECRET và CURSOR_SECRET phải ít nhất 64 ký tự ngẫu nhiên; cấu hình API từ chối khóa ngắn. CURSOR_SECRET còn ký token quản lý/telemetry playback, không coi chỉ là khóa phân trang. Không tự xoay khóa khi kiểm thử; thay khóa sẽ ảnh hưởng cursor/token đã cấp.
- Chỉ lưu tên biến và đường dẫn cấu hình trong tài liệu. Không chép mật khẩu, API secret, JWT, refresh token, MFA secret/recovery code, URL có credential hoặc nội dung hộp thư local vào agent.md/memory.md/log công khai.
- Không in nguyên .env, Docker inspect, SDK error hoặc connection URL ra tool output.
- Email thử nghiệm ở .local/mail; backup dev ở .local/backups. Chúng không được phục vụ như static files.
- Cấu hình local đã được người dùng chấp nhận: backup riêng tư trên ổ đĩa và tunnel HTTPS tạm. S3/SMTP/URL cố định chưa được cung cấp hoặc nghiệm thu thật.

## Lệnh và kiểm tra

Dùng PowerShell và npm.cmd tại E:\pj-Flim. Đọc file tiếng Việt với UTF-8. Dùng rg trước khi tìm source.

```powershell
npm.cmd run build:all
npm.cmd run web:dev
npm.cmd run test:web
npm.cmd run typecheck
npm.cmd run openapi:export
npm.cmd run test:integration
npm.cmd run rabbitmq:smoke
npm.cmd run worker:smoke
npm.cmd run playback:smoke
```

- test:web dùng Chrome cài sẵn và DB tạm qua runner chung; đặt PJ_FLIM_CHROME_PATH khi cần. PJ_FLIM_TEST_WEB=true bổ sung 53 browser checks vào integration. Mock provider chỉ trong test, không giả READY trên pj_flim.
- streaming:smoke là nghiệm thu live riêng, có PJ_FLIM_LIVE_MEDIA=true và API local; tạo đúng phim thử riêng, upload/backup/CDN thật, được xuất bản khi người dùng yêu cầu. Không giả READY, không dùng phim thật có sẵn làm fixture. Dữ liệu/credential thử ở .local/web/live-streaming, không commit. Xem docs/testing/live-streaming.md.
- Integration cần PJ_FLIM_TEST_ADMIN_PASSWORD qua biến môi trường tiến trình; bật PJ_FLIM_TEST_WORKER=true để bao gồm RabbitMQ. Không ghi giá trị mật khẩu vào source/tài liệu.
- rabbitmq:smoke chỉ chạy broker loopback với prefix pjflim.broker-test.<random>, không DB/Cloudinary. Test/dọn chỉ topology của lần chạy; không restart broker, purge queue phim hoặc redrive DLQ ứng dụng. Xem docs/testing/redis-rabbitmq-2026-11-13.md.
- Bộ integration gọi tests/auth-security.integration.ts: hợp đồng endpoint-permission độc lập cho 49 operation admin, ma trận 5 role, JWT/IDOR/revocation. Session ma trận là fixture trên DB tạm; password/MFA/refresh/reset nằm ở HTTP suite chung. Báo cáo có authSecurityChecks; không cộng số browser/worker khi chưa bật.
- Integration chỉ tạo/xóa database pj_flim_test_<random> do nó tạo và topology broker thử riêng. Không dùng database pj_flim hoặc phim thật làm fixture.
- Chạy kiểm tra phù hợp thay đổi. Không chạy lại bộ backend chỉ vì chỉnh tài liệu; xác minh link/nội dung là đủ.
- Khi đổi route/DTO/error contract, cập nhật OpenAPI và tài liệu liên quan. Ghi rõ bộ kiểm tra có worker hay không.
- Khởi động lại đúng dịch vụ của dự án bằng script, xác minh PID/entry point. Không dừng process hoặc container không thuộc dự án.
- Process nền trên Windows dùng cửa sổ ẩn. Không thực hiện recursive delete/move nếu chưa kiểm tra đường dẫn tuyệt đối.
- Tham khảo lệnh local trong [worker runbook](docs/api/media-worker.md), [API runbook](docs/api/README.md) và [database runbook](database/README.md).

## Quy trình duy trì ngữ cảnh và tiến trình

Bắt đầu phiên:

1. Đọc AGENTS.md, agent.md, memory.md và hướng dẫn gần source sẽ sửa.
2. Đối chiếu trạng thái ghi nhớ với source, plan và bằng chứng kiểm thử liên quan. File memory là snapshot, không phải trạng thái runtime trực tiếp.
3. Tiếp tục yêu cầu mới nhất của người dùng; giữ các quyết định trước đó nếu chưa bị thay thế.

Cập nhật ngay trong cùng lượt khi có thay đổi quan trọng:

- Hoàn thành/bắt đầu/thay đổi phạm vi tính năng hoặc sửa lỗi có ảnh hưởng hành vi.
- Đổi endpoint, DTO, schema/grant/migration, mã lỗi, cấu trúc thư mục hoặc dependency quan trọng.
- Đổi cấu hình runtime, policy bảo mật, cách vận hành, môi trường triển khai hoặc giới hạn đã biết.
- Có kết quả build/test/smoke mới, lỗi kiểm tra, blocker hoặc quyết định mới từ người dùng.

Cách ghi:

- memory.md: cập nhật snapshot hiện hành, trạng thái công việc, bằng chứng và việc còn mở; thêm một mục nhật ký ngắn có ngày, thay đổi, kiểm tra và giới hạn.
- agent.md: chỉ đổi khi ngữ cảnh lâu dài/quy tắc/cấu trúc đã thay đổi; không chép toàn bộ nhật ký vào đây.
- Đồng bộ plan, README/OpenAPI/runbook nếu thay đổi tác động tài liệu đó. Không sửa lịch sử cũ thành như thể tính năng mới đã tồn tại từ trước.
- Ghi rõ đã làm/đã kiểm tra/chưa làm. Nếu không chạy lại test, nói rõ; không sao chép số test cũ thành kết quả của lần sửa mới.
- Không lưu PID, tunnel URL tạm hoặc số đo chưa kiểm chứng như dữ liệu cố định. Trỏ tới file trạng thái riêng tư nếu cần tra cứu.
- Không tạo watcher/daemon để cập nhật memory; trách nhiệm cập nhật thuộc lượt làm việc có thay đổi.
