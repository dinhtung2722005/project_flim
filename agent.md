# Ngữ cảnh và quy tắc dự án pj-Flim

Cập nhật ngữ cảnh: 25/11/2026, múi giờ Asia/Saigon. Tiến trình thay đổi theo từng phiên được lưu trong [memory.md](memory.md).

## Dự án và phạm vi thư mục

- GitHub cập nhật 25/11/2026: source commit [853f658](https://github.com/dinhtung2722005/project_flim/commit/853f6581f9de69b014d9fa11076f814b7c778505) đã push lên origin/main, kiểm tra refs/heads/main khớp. Gồm chatbot/catalog/Colab notebook, điểm/review, UI tài khoản/đoàn phim, lượt xem và admin moderation/health/CSV/bulk; migration/schema/API/README/plan/test đi cùng. Chỉ source, cấu hình mẫu, kiểm thử và tài liệu phim; không đưa credential, runtime, video, tài liệu cá nhân hay sơ đồ đánh giá năng lực lên repo. Đây là cập nhật source, không deploy hoặc nghiệm thu Colab/provider/production.


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
- Ngày 13/11/2026, yêu cầu mới “giúp tôi build agent” cho phép code PoC Colab sau giai đoạn plan-only. Đã có notebook/source/exporter/tests, agentplan1.7/mainplan2.30. **IN_PROGRESS:** AG01/02/03/04/05/06/08/09/11/12/13/15/16. **NOT_STARTED:** AG07/10/14. Chưa AGDONE hoặc model/Colab thật. Website CATALOG đã có run API/52bảng/queue/Python/UI theo mục cập nhật14/11; người dùng ưu tiên notebook khi chưa endpointmodel; không cài model Windows, public Ollama hoặc dùng Colab free làm API/queue worker thường trực.
- Không mở rộng sang xây frontend, triển khai public, thay hạ tầng hoặc xử lý ticket khác khi nhiệm vụ hiện tại không bao gồm.
- Không coi bản local, test mock hoặc một lệnh build thành bằng chứng đã sẵn sàng production.

## Quản lý phim hàng loạt — 25/11/2026

CatalogBatchService/Controller và catalog-batch.dto riêng; catalog_batches private owner-only. Bốn thao tác thể loại/xuất bản/ẩn, tối đa20phim; preview5phút, thực hiện15phút, cùng auth session/current permissions, If-Match và expectedVersion phim. Mỗi phim dùng CatalogService với transaction truyền vào để ghi dữ liệu/audit/outbox/receipt nguyên tử. Không gọi HTTP lặp từ service, không tự tăng expectedVersion sau412, không tự retry FAILED hoặc tự xuất bản tập. RUNNING có thể tiếp tục bằng ETag preview gốc hoặc receipt hiện tại; đã APPLIED không chạy lại. Lỗi auth/hạ tầng/audit giữ phần chưa commit READY. Lịch sử không lộ đợt của admin khác. Không có scheduler/retention riêng cho bảng mới. Xem [runbook](docs/api/catalog-batches.md). Snapshot hiện hành:59bảng,125ops/97paths/66admin,19permission/46liên kết,90codes,21services/26controllers trong15files/65DTO trong19nhóm.

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
- Encoding baseline H.264/AAC đã triển khai 13/11/2026: data-saver-v1/balanced-720p-v1/balanced-1080p-v1, mặc định upload mới balanced-720p-v1; intent cũ giữ profile như hd. Recipe source-aware ở packages/media/src/encoding-profiles.ts, browser-safe IDs tại packages/contracts/src/encoding.ts; verification pin snapshot/profile/version/hash vào expected_policy, worker provision profile hash chỉ tạo/kiểm không update tại chỗ, verifier kiểm rung/codec/kích thước/không upscale trước HLS+backup READY. Admin UploadPanel có preset và mức thực; retry giữ cấu hình. Cloudinary/Chrome đã thử clip 720p + fixture synthetic 1080p, 16 lần đổi mức; không suy ra chất lượng phim/HDR/đa codec đã đạt. ENC02 baseline DONE, ENC01/03/04/06 IN_PROGRESS, ENC05/07–09 NOT_STARTED. Chưa FFmpeg/per-title/VMAF/HEVC/AV1/DASH; xem docs/api/encoding.md và docs/testing/encoding-2026-11-13.md. Không tự chuyển mã catalog đang phát hoặc ghi đè preset đã phát hành.
- Player cleanup được theo dõi ở apps/web/src/lib/playback-cleanup.ts, giữ Promise dispose single flight cả sau unmount. Logout phải dừng player và chờ dọn phiên trước khi thu hồi auth (timeout5giây/best effort khi offline), tránh bỏ lại phiên và chạm quota.
- Phiên phát pin asset version. Progress dùng generation/sequence, chống phiên cũ ghi đè và không cộng trùng khoảng xem.
- Nguồn điểm/review nghiên cứu tại docs/design/external-ratings-reviews-research.md bản1.1. Rà soát24/11: TMDB review mapping/cache54bảng/API/UI và OMDb ratings lookup đã có; EXT02/03/05/07/08 IN_PROGRESS, EXT01/04/06 NOT_STARTED trong phạm vi đầy đủ. Chưa source-policy registry tổng quát/external worker hoặc live-source verification; xem mainplan2.36 mục14.7/17–19. IMDb TSV không có review text; Metacritic có paid/approved Origin API, quote khác toàn bài. TMDB là ưu tiên thử theo quyền; RT có tuyến Origin paid/approved, OMDb không có review-list và Terms có điều kiện indexing/derivatives; Letterboxd loại khỏi agent mặc định. Nguồn Việt Nam Moveek/Galaxy chưa xác minh public API/quyền, VnExpress RSS có điều kiện riêng. Policy nguồn tách fetch/store/display/translate/summarize/embed/train/cloudTransfer và kiểm region/purge; quyền display không tự mở raw review/embedding/LLM trên Colab. Agent plan1.5 có PoC catalog/search facts-first/OMDb; TMDB adapter notebook và DDGS URL-only tùy chọn, chưa importer/review summary/approval workflow. Không vượt điều kiện API/bot/paywall hoặc tự publish.
- Gợi ý content-v1 đã có 13/11/2026 tại packages/recommendations/src/content.ts và DTO/controller/service riêng: TF-IDF/multi-hot/cosine/MMR, opt-in mặc định false, watchlist/accepted coverage đúng active asset/version, title-level cap/decay. UI /for-you có lý do chung/dismiss/undo/toggle; feed private no-store/snapshot HMAC 10 phút, tối đa 5/user, 1.000 candidate, top 100, revalidate eligibility/feedback/completion mỗi trang. Preference ETag/version khóa cùng transaction với feed/feedback, opt-out xóa feedback/snapshots nhưng giữ thư viện; bật lại đọc dữ liệu hiện tại, không gọi là reset. Migration movie-recommendations-v1.sql thêm 3 bảng, tổng 50; OpenAPI 92/70, registry 74, DTO43/service11/controller13. API timer prune500 expired/min SKIP LOCKED; API CRUD, worker/auditor không đọc bảng private. Public related giữ cùng thể loại. REC01/03/04/05/06 IN_PROGRESS, REC02/07–09 NOT_STARTED; chưa reset/analytics/CF/feature worker/offline benchmark/A-B. Giữ queue analytics riêng khi bổ sung sau, không reuse media publisher như đã xử lý playback.events.accepted. Xem docs/api/recommendations.md và docs/design/recommendation-algorithms.md.
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
npm.cmd run test:recommendations
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


## Agent Colab: invariant PoC 13/11/2026

- Đọc apps/agent/README.md trước sửa. notebooks/movie-agent-colab.ipynb sinh bởi npm.cmd run agent:notebook; sửa Python/cell/requirements/tests phải build lại, giữ outputs rỗng/hash/source khớp.
- Demo4phim giả; catalog thật chỉ metadata public được phép cloud/embedding, exporter loopback, không account/history/token/signed URL. Snapshot≤1000/5MB/TTL24h; rights là khai báo, hash không xác thực nguồn; không sửa ngày để qua expiry.
- Facts/evidence theo lượt, CATALOG/HYBRID, không render free model prose/điểm tự nhớ. OMDb là nguồn điểm được chọn, IMDb/Metascore qua verified mapping; TMDB manual verified mapping; DDGS allowlisted HTTPS URL/read_verified:false, không article/summary.
- Ollama loopback trong Colab; reuse/stop đối chiếu PID identity/process sở hữu. Checkpoint whitelist, không key/prompt/weights/pickle; kiểm catalog/model/index version/TTL.
- Đã kiểm44Python qua Docker Linux (FAISS/ChatOllama thật, model/encoder/HTTP fixtures),7Node exporter, AST10cell/8source, public export1title đọc lại bằng Python. Chưa Qwen/E5/Colab/provider live. Xem docs/testing/colab-agent-2026-11-13.md, không dùng số API/web cũ như test PoC.
- Windows Python bị Application Control; không gỡ policy. Docker tests cô lập, không sửa service/media queues. Direct pins chưa transitive lock hoặc Colab stack validation.

## Bổ sung runtime agent — 14/11/2026

- Installer Colab tự kiểm/cài curl và zstd thiếu qua apt-get quyền root, giữ version Ollama đã pin; lỗi từng giai đoạn và cell4 chỉ hiện diagnostic an toàn. Timeout installer900s. Không diễn giải OLLAMA_INSTALL_FAILED cũ thành chắc chắn thiếu zstd khi chưa đọc log.
- Notebook cũ mở cùng kernel có thể giữ module cũ: khi thay bundle yêu cầu Restart session, chạy từ cell1. Giữ kiểm NumPy mismatch, không bỏ guard để che lỗi ABI.
- 52 Python contract tests đã đạt (44 cũ+8 installer). GPU passthrough Docker kiểm được; phiên full dependency/runtime audit bị ngắt trong pip install, chưa inference Qwen/E5 và chưa nghiệm thu Colab. Không khẳng định notebook không thể lỗi hoặc đã có quyền điều khiển Chrome/Google.

## OMDb được chọn — 14/11/2026

- Agent0.2.0/notebook đọc OMDB_API_KEY từ Colab Secrets; ENABLE_OMDB/OMDB_MAPPINGS, HYBRID trên catalog thật. Demo/CATALOG không gọi ngoài. Tools chỉ nhận title_id; candidate không tự verified, rating kiểm IMDb ID/tên/năm/loại. TMDB giữ riêng, chỉ lộ tools TMDB khi có token.
- Evidence/cards external_ratings tách IMDb/10 và Metascore critic/100; thiếu→null, không Metacritic User Score/review. Key query được che trong log httpx/httpcore, không request URL/raw error/payload trong output hoặc checkpoint.
- Cache RAM1giờ/200 entries, client cell8 giữ qua câu hỏi;2requests/run,900/client không phải quota account/day. Kiểm mapping/snapshot freshness trước cache. Không thêm backend/schema/API/queue/UI hoặc gọi OMDb live khi chưa key.
- create_demo(now=...) dùng clock fixture cố định, default vẫn live TTL; tránh contract tests hết hạn/phụ thuộc ngày Colab. Build lại notebook sau mọi sửa bundled source; restart session khi đổi source. 74 tests đạt (52 trước+20 OMDb+2clock), model/HTTP là fixture; chưa Colab/Qwen/E5/live API.

## Lộ trình chatbot website — 14/11/2026

- Yêu cầu xây dựng các bước được xử lý như lập kế hoạch; không suy thành ủy quyền code tích hợp mới trong lượt này. File docs/plans/website-chatbot-implementation-plan.md bản1.0, agentplan1.6/mainplan2.29.
- Website đọc dữ liệu qua NestJS tools/gateway chỉ đọc, tái sử dụng public catalog eligibility; không SQL/shell/browser hoặc account/admin data tùy ý. RAG cho catalog/FAQ public, source/version/evidence và live revalidation trước trả lời.
- Assistant/runs 202/polling,React chat/FAQ/bounded parentRun và private Python runtime/queue đã code/chạy CATALOG; Qwen/E5 live và OMDb website chưa nghiệm thu. Colab snapshot không thay service website; facts-first/template trước prose tự do. OMDb và opt-in cá nhân hóa là mốc mở rộng, không chặn MVP catalog/FAQ.

## GitHub source update — 14/11/2026

- Source commit 684b37c đã push và đối chiếu SHA bằng ls-remote với origin/main. Gồm encoding presets, recommendations content-v1, agent Colab/OMDb và kế hoạch chatbot web; schema50bảng/OpenAPI92operation/70path được mô tả theo code hiện có.
- Chỉ commit103file source/config mẫu/docs/tests/SQL của pj-Flim. Env local, credential/runtime/cache/model/video và tài liệu cá nhân không publish. Kiểm trước push tại docs/testing/publication-2026-11-14.md; không suy đã nghiệm thu model/Colab/OMDb live hoặc chatbot website.


## Tài liệu Word mô tả dự án — 14/11/2026

- Đã xuất tại gốc E:\pj-Flim: Mo_ta_du_an_pj-Flim.docx (bản nội bộ có email/mật khẩu admin và demo theo yêu cầu) và Mo_ta_du_an_pj-Flim_Ban_chia_se.docx (bỏ giá trị đăng nhập thực tế). Mỗi bản 37 trang theo PDF kiểm bố cục, 44 bảng trình bày, 2 sơ đồ và mục lục cập nhật.
- Nội dung bám source/runtime: backend/REST/RBAC, dictionary đủ 50 bảng, luồng media/HLS/backup/playback, tính năng đã có, PoC Colab/OMDb và lộ trình mở rộng. Không biến kế hoạch assistant/Redis/analytics thành tính năng đã hoàn tất.
- DOCX gốc được Git bỏ qua theo /*.docx; .local/docx-report chứa generator, dữ liệu kiểm và PDF/ảnh riêng tư. Bản nội bộ/PDF private không tự publish hoặc đính kèm lên GitHub. Không ghi password, MFA/recovery, provider/DB/JWT secret vào Markdown/source/memory.
- Khi cần xuất lại: đối chiếu source/schema/API và xác minh tài khoản theo quyền trước; generator riêng .local/docx-report/build_document.py, renderer UNO và qa_document.py. Báo cáo memory ghi rõ phạm vi kiểm, không coi tài liệu là bằng chứng production.


## Agent website/Colab hiện hành — 14/11/2026

- Lựa chọn mới nhất: hoàn thiện notebook Google Colab, chưa có Ollama endpoint; giữ website CATALOG lookup. Không tải Qwen trên PC, public Ollama/Colab hoặc dùng Colab free làm worker/API thường trực.
- CATALOG website: /assistant có auth/owner,5RESToperations,2 controller (1 internal) trong file assistant.controller.ts,3services,10DTO; backend run/steps/evidence,2bảng additive (52tổng),quorumqueue riêng,Node assistant-worker và Python service8010loopback. OpenAPI97operation/73path/49admin,81codes,53DTOclasses/13nhóm,14services,15controllers/8TSfiles.
- .env.assistant.local và .local/assistant/agent.env private; scripts configure-assistant.ts/assistant-migrate.ts/Start-AssistantLocal.ps1. Không in keys. Queue chỉv/runId/eventId; DBcredentials/browserJWT không tớiPython, worker/auditor không đọc2bảngprivate. Facts được revalidate trước trả; không coi keyword baseline là E5live.
- Notebook v0.3: colab_bridge.py stdlib dùng venv và pipe, không cài đè kernel NumPy. TorchCPU2.9.1+cpu cho E5; Ollama pin0.40.16/Qwen2.5:7b loopback cho model. Code/tests/cells nhúng checksum,10codecells/30bundlefiles. Key đọc ở kernelSecrets và truyền pipe,khôngenv/argv/log/checkpoint.
- Agent model/search/client sống trong child; cell8 hỏi độc lập,giữOMDbcache/quota. Interrupt đóngchild; chạy3→4–8 lại. Không dùng _omdb_client trực tiếp trong kernel: gọi session.execute theo runbook. Đây là dependency/process isolation cho source tin cậy, không sandbox code tùy ý.
- Kiểm thật: bộ dependency đầy đủ cài/import+pipcheck đạt Linux3.12; generated notebook cả10cell chạy qua với Qwen/E5/Ollama fixtures,103contracts thật trong venv. Chưa liveQwen/E5/Colab/OMDb. Website160checks gồm25realCATALOG E2E,backend/worker2309,frontend227,exporter7,DB39+8.
- [Runbook](apps/agent/README.md), [assistant](docs/api/assistant.md), [notebook audit](docs/testing/colab-agent-2026-11-14.md), [website audit](docs/testing/assistant-2026-11-14.md). Build lại notebook sau sửa source/cell/test. Gate tiếp theo GPUColab/Qwen tool+JSON/E5/query+sources/reset.
- Word documents hiện là snapshot50bảng/92operation tại24ee2e4 trước assistant; chưa cập nhật DOCX trong lượt này. Không tự publish bản có đăng nhập. Không commit/push khi chưa được yêu cầu mới.


## Nhập metadata catalog — 14/11/2026

- User yêu cầu lấy ảnh bìa, tóm tắt, số tập từ web, khôngvideo. Đã nhập20 tựa (10 MOVIE/10 SERIES),20 posterCloudinary,227 tậpDRAFT và14 genres từ API KKPhim. DB hiện23 titles/23 seasons/231 episodes,52 bảng; video_assets/upload_intents vẫn 4/4.
- scripts/import-catalog-metadata.mjs qua admin API có auth/RBAC/audit, không SQL ghi trực tiếp hoặc sửa phim cũ. PosterAssetRef vẫn là Cloudinarypublic_id, khôngURL; chỉ upload resource_type=image, khôngvideo/trailer/m3u8.
- Chạy catalog:metadata với --fetch/--prepare/--apply; plan/manual synopsis/state/report private ở .local/catalog-import/kkphim. Key/token không vào source/log. State cố định một batch để resume; không trộn plan mới vào state cũ.
- Số tập nhập là tổng nguồn công bố, có thể gồm tập chưa ra; không đồng nghĩa khả năng phát. Phim lẻ auto1 tập kỹ thuật, phim bộ217 tập metadata. Không bỏ publication guard để đưa dữ liệu này vào publiccatalog/chatbot.
- 10 Node tests, DB đối chiếu toàn bộ dữ liệu cũ/bộ đếm media,20/20 coverHTTP vàChrome, rerun0newrecords đều đạt. Source metadata chưa được xác minh độc lập toàn bộ; không tự nhận licensevideo hoặc dùng làm review/ratings ingest. [Báo cáo](docs/testing/catalog-metadata-2026-11-14.md), mainplan2.31; các backlog khác giữ trạng thái.


## Luồng review hiện hành — 23/11/2026

- Đã triển khai TMDB User Reviews ở packages/reviews, ReviewsService/controller/DTO/OpenAPI, UI admin/trang phim và SQL reviews-v1. DB local54bảng,104OpenAPIops/78paths/55admin/90errorcodes;54DTOclasses/14nhóm,15services,17controllers/9files. Không sửa baseline47 hoặc catalog/video để tạo dữ liệu review giả.
- User đã gửi ảnh credential TMDB ngày23/11; chưa cấu hình/xác thực giá trị từ ảnh. Auto-review chặn chép credential vào script vì chưa xác minh provenance/quyền lưu; không thử vòng qua. scripts/Configure-TmdbLocal.ps1 cho người dùng nhập token ẩn tại máy, xác thực trước khi lưu .env.api.local; tùy chọn -RestartApi. Không ghi key vào source/log/memory. Chưa liveimport; docs/api/reviews.md là runbook.
- Giữ current session/permission trong transaction, opaque ETag version+generation(UUID), lease/fencing/title_version, TTL24h, audit rollback, safe URL/plaintext, public eligibility. MEMBER/AUDITOR không đọc quản trị catalog. Tối đa20review, vi-VN→en-US khi rỗng; refresh chủ động, chưa scheduler.
- Notebook chỉ discovery URL, hiển thị review_refs và da_doc_bai=false; không nói đã đọc bài. Website chatbot CATALOG chưa có tool đọc review cache/tổng hợp; không coi AG/EXT DONE hoặc inference Qwen/Colab đã nghiệm thu. Cập nhật notebook bundle sau thay source và giữ output sạch.
- Test review có PostgreSQL tạm và provider HTTP giả lập/Chrome; không đồng nhất với TMDB thật. Không commit/push hoặc chạm các file diagram/personal ngoài phạm vi.

- Khi chạy Configure-TmdbLocal.ps1 trên máy này, dùng đường dẫn tuyệt đối và powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File để xử lý policy Restricted chỉ trong tiến trình; không đổi policy CurrentUser/LocalMachine. Script đã phân loại HTTP/network/auth lỗi theo mã TMDB_* an toàn,11fixture checks đạt; nhập token/live verification vẫn chờ người dùng.


## Điểm IMDb/Metacritic trên website — 23/11/2026

- MovieRatings/ratings.css ở trang chi tiết phim và trang xem video (trước player, dùng episode.titleId); MovieRatingBadges trong MovieCard dùng chung cho trang chủ/catalog/gợi ý/thư viện, lazy IntersectionObserver và request tuần tự, thiếu dữ liệu vẫn hiện nhãn/dấu —, không lồng link/button; IMDb thang10 (khán giả/votes/link), Metacritic Metascore thang100 (giới phê bình). Không dùng điểm TMDB, age_rating hoặc fixture làm điểm thật. N/A/null riêng với0.
- GET public /api/v1/titles/:id/ratings, RatingsService + packages/ratings/src/omdb.ts; tự đối chiếu tên/năm/loại từ metadata sở hữu trước trả điểm, không tạo/duyệt mapping admin. Kiểm public/media trước và sau fetch; cache không cấp eligibility.
- Cache memory24h/negative5phút/error1phút/LRU500, dedup/2lookup đồng thời/200lookup mỗi ngày UTC mỗi process; chưa durable/distributed. HTTPSfixed/bodybound/timeout/no redirect/no raw logs. Database54bảng không đổi;105OpenAPIops/79paths/55admin/90codes,16services/18controllers/10files, DTO không thêm.
- OMDB_API_KEY trong .env.api.local còn rỗng; đã có mẫu .env.ratings.example. Token TMDB không dùng cho OMDb. Chưa liveOMDb; chatbot CATALOG chưa có tool đọc/tổng hợp điểm. Runbook docs/api/ratings.md. Không commit/push hoặc sửa diagram.


## Bổ sung UI điểm — 24/11/2026

- Đã khắc phục phản ánh không thấy hai ô điểm: mở rộng từ detail sang thẻ phim và watch, thêm heading Điểm đánh giá. API local được khởi động lại; OMDB_API_KEY còn rỗng nên không có số điểm thật.
- Build đạt; tests/ratings.integration.ts đạt79 kiểm tra (fixture HTTP, Chrome), frontend hồi quy227 đạt. Bằng chứng .local/ratings/integration-result.json, .local/web/integration-result.json và .local/ratings/visibility-local-result.json. Probe local homepage/detail HTTP200, NOT_CONFIGURED/null, browserErrors0.
- Không đổi schema/backend/hợp đồng/quota hoặc trạng thái EXT/AG; chưa commit/push, không sửa diagram.


## Agent Colab hiện hành v0.4 — 24/11/2026

- User chọn hoàn thiện notebook thử Qwen trên Colab, không tích hợp nguồn điểm/review vào chatbot website trong lượt này. Website CATALOG giữ nguyên; không tải/chạy Qwen/E5 weights trên PC hoặc public Colab.
- notebook_ui.py: widget kernel tùy chọn, HTML escaped, nguồn chỉ text, bounded10lượt RAM/khóa gửi khi đang xử lý; mỗi câu độc lập. Không widget thì QUESTION/chạy lại cell8. Rerun/đổi session/stop đóng callback cũ; nút xóa bỏ lịch sử hiển thị, không ghi transcript vào report/checkpoint của agent.
- runtime.model_runtime kiểm digest loaded model và size_vram qua /api/ps sau inference, REQUIRE_GPU=True đòi có GPU offload. MODEL_SMOKE/MODEL_RUNTIME không giữ cờ thành công cũ khi chạy lại lỗi.
- evaluation.py:3case demo qua model/encoder hiện tại, CATALOG-only, catalog thật SKIPPED; report schema2 tách contract tests/skips/errors và quality PASSED/NEEDS_REVIEW, không prompt/raw prose.
- Generator v0.4.0,36bundlefiles/33Python sources/10codecells; validator thêm đối chiếu source repo, giữ hash/output sạch.127Python tests không skip +generated10cell flow đạt Linux/real widgets/FAISS/ChatOllama, model/encoder/install/GPU/dependency-prep fixtures. Không đồng nhất với Colab/Qwen/E5 inference thật. Runbook apps/agent/README.md; báo cáo docs/testing/colab-agent-2026-11-24.md.

## UI tài khoản và quality baseline — 24/11/2026

- Mục4/5 đã triển khai: pages/Account.tsx, features/admin/Credits.tsx, lib/site.tsx/HomeBanners, report triage và metadata language/countries. MFA UI hiển thị policy local đang bỏ mã; không tự bật AUTH_MFA_REQUIRED. Email proof dùng fragment, strip URL/explicit POST, password mismatch không gửi; sai password reauth không refresh/replay auth.
- MfaEnrollmentService + experience.controller.ts/experience.dto.ts;3controller/1service/3DTO mới. Totals:54tables,110ops/84paths/56admin,90codes,17services/21controllers11files,57DTO15groups. Existing title PATCH xử lý credits, report mutation cần reports.read+catalog.write+ETag/audit, public site whitelist/schedule/eligibility.
- Benchmark recommendation read-only local metadata, không account/history; private corpus códraft KHÔNG phải Colab/public snapshot. evaluation.ts có P/R/nDCG/HitRate/coverage/ILD/timing và temporal/seed/gain guards.23metadata/4labels PROPOSED chỉ diagnostic, không user uplift. REC06 IN_PROGRESS, chưa benchmark độc lập.
- Encoding-benchmark.mjs local FFmpeg9.1/libvmaf, no upscale, reference alignment,18phép đo thật (3clip×2CRF×3rung) VMAF/SSIM/PSNR. Không thay preset/Cloudinary asset/source; không coi một nguồn720p là corpus/GOP/device nghiệm thu.
- Hồi quy2624 gồm275frontend/941security đạt;11evaluator+4encoding safety đạt; build/OpenAPI đạt. Source runbooks docs/api/account-ui-and-site.md và docs/testing/quality-baseline-2026-11-24.md. Mainplan2.37; ST/AG/EXT chưa đổi DONE. Không commit/push hoặc sửa diagram/cá nhân.


## 24/11/2026 — Chatbot đọc ratings/reviews

Website assistant có5tool, thêm get_title_feedback. FEEDBACK gắn entityId=titleId, selection dùng evidenceIds/titleIds hiện có; không thêm selection IDs. Inject RatingsService/ReviewsService, render ratings bằng cache-only peek, không gọi provider khi poll. ReviewsService.list có internal evidence flag để fingerprint revision/generation và raw timestamp; public reviews API mặc định không đổi. Không gửi body review vào LLM/run evidence/Colab; renderer opt-in đoạn trích600ký tự/3review, safe React text và link allowlist. Thiếu key/cache trả trạng thái thật, không đoán0. SQL additive movie-assistant-feedback-v1 mở CHECK tool bằng db:assistant, không Prisma db push/grant mới. Scope capabilities PUBLIC_CATALOG_HELP_AND_FEEDBACK, OpenAPI feedback schema;54bảng/110ops/84paths/56admin không đổi. Mainplan2.38/agentplan1.10; xem docs/api/assistant-feedback.md.


## 25/11/2026 — Cổng kiểm báo cáo Colab

Có npm run agent:acceptance -- <runtime-report.json> và test:agent:acceptance. CLI Node chỉ đọc report<=256KB + repo model/dependency pins, không tải model/credentials/network;16checks cho demo schema2. REPORTED_DEMO_CHECKS_PASSED không chứng thực Colab/inference hoặc production; finalAcceptance=PENDING_MANUAL_REVIEW, cần xác nhận nguồn report, tiếng Việt/ngữ nghĩa và reset/checkpoint. Chưa có kết nối Colab/report thật, không dùng fixture để đóng AG tickets. Runbook docs/testing/colab-acceptance-2026-11-25.md; mainplan2.39/agentplan1.11.


## 25/11/2026 — Đánh giá người xem website

ViewerReviewsService/ViewerReviewsController/ViewerReviewDto riêng, ViewerReviews.tsx detail/watch. Mỗi account/title một rating1–10 và content tùy chọn2000/spoiler; public source PJ_FLIM_VIEWERS/average/count tách khỏi OMDb/TMDB. Current-session/owner+quota10PUT/phút/PG unique/advisory lock/ETag kể cảcreate và UUID chống delete-recreate. Public không userId/email/session; ACTIVE authors only; plainReacttext, collapsed declared spoilers, draft giữ khi412, reset/abort theo title/account. SQL additive viewer_reviews:55bảng, db:viewer-reviews flag, API CRUD/worker-auditor no grants.114ops/86paths/56admin/90codes,18services/22controllers12files/58DTO16groups. No agent/Colab/LLM review integration hoặc admin moderation mới. Runbook docs/api/viewer-reviews.md, mainplan2.40.

## Lượt xem — 25/11/2026

- Mốc hiện hành mainplan2.41:58bảng/116ops/88paths/57admin/90codes;19services/24controllers13files/59DTO17groups. apps/analytics-worker và packages/analytics là luồng analytics riêng, không đưa playback.events.accepted vào media/assistant queue.
- Definition2: min120giây hoặc50%video ngắn; prefix sequence liên tục, trạng thái playback/gap/timeline/coverage chống cộng pause/seek/lặp. Một định danh/phim/ngày UTC; HMAC day+loạiID+ID, khóa ANALYTICS_HASH_SECRET ổn định pin fingerprint trong policy. Không tuyên bố uniquepeople hoặc chống bot hoàn chỉnh. Không giả lịch sử trước measurementStartedAt, không sửa policycutoff trên database thật để tạoview.
- API SELECT-only aggregate/policy, không ghi counter hay đọc private fact/key. Worker session advisory lock, receipts/dailyunique+counter+batch PROCESSED chungTX, fenced outbox/confirm/quorum/prefetch1; boundedreconcile100lô/phút khi published>2phút chưaprocessed. Prune dailykey>90ngày tối đa1000/giờ; raw/facts/outbox retention và QoE đầy đủ vẫnST04/REC02IN_PROGRESS.
- Config riêng .env.analytics.local bằng analytics:configure; WORKER_DATABASE_URL/.env.worker.local broker, prefixpjflim.analytics. Start-LocalProcess -Service analytics; không log key hoặc dùng owner/runtime. Key khác policy bị từ chối, không tự rotation.
- UI cardcount projection, detail/watchpoll30s tabvisible; admin7/30/90 và bảngUTC/top10/lag theo metrics.read. Runbook docs/api/view-statistics.md. Local measurement mới bắt đầu0, không seedcount thật. Colab/AG, OMDb/TMDB và Redis không đổi.

## Admin nâng cao — 25/11/2026

- Mainplan2.42 hiện hành:58bảng/19permission/46role-permission links,121operation/93path/62admin/90codes;20services/25controllers14files/62DTO18groups.
- AdminAdvancedController/Service/DTO và packages/contracts/src/admin.ts: reviews.moderate chỉ ADMIN/SUPER_ADMIN; catalog-health dùng catalog.read_drafts; CSV metrics.read. UI lazy-load /admin/viewer-reviews và /admin/catalog-health, menu/routeguard theo quyền.
- Moderation4cột trong viewer_reviews; public chỉ VISIBLE+ACTIVE; owner đọc trạng thái/lý do, vẫn sửa/xóa nhưng không tự bỏ ẩn. Moderator dùng cùng advisory lock owner/title và version/ETag, audit status+reason cùng transaction; không chỉnh score/body thay tác giả. No-op cùng trạng thái không thêm audit. Không tự lấy ETag mới để ghi đè; giữ draft khi412.
- CSV export7/30/90 ngày,10cột TOTAL/DAILY/TOP_TITLE, BOM/CRLF/formula escaping/decimal strings, audit trước gửi file. Không xuất private viewer/session/hash hoặc draft title. Browser dùng Blob qua api client chung có auth refresh/abort; không đưa token vào URL.
- Catalog health chỉ đọc dữ liệu/điều kiện assetReady, không xác nhận CDN, không thêm chặn metadata hoặc tự xuất bản. Summary từ cùng response qua usePages.summary tùy chọn.
- db:admin-advanced với PJ_FLIM_APPLY_ADMIN_ADVANCED=true; SQL additive4cột/2index/permission, không thêm bảng. Migration cũ viewer-reviews đã tương thích extension; Prisma đồng bộ. Runbook docs/api/admin-advanced.md. Chưa review-report/kháng nghị/AI/bulk/schedule/email; các backlog/Colab/ST/REC/ENC không chuyển DONE vì tính năng này.
