# Thống kê lượt xem

Cập nhật 25/11/2026, Asia/Saigon. Triển khai local trong E:\pj-Flim; definitionVersion=2. Lượt xem trên thẻ phim, trang chi tiết và trang xem; admin /admin có báo cáo 7/30/90 ngày, biểu đồ, bảng theo ngày UTC và top10 phim công khai đang phát được.

## Định nghĩa và giới hạn

Một phiên PUBLIC đủ điều kiện khi tích lũy ít nhất min(120 giây, 50% thời lượng asset đã pin). Mở trang, tạo phiên, tải lại hoặc chỉ nhận play không tăng qualifiedViews. playbackStarts ghi một lần cho mỗi phiên có play hợp lệ; đây là chỉ số khác lượt xem.

Thuật toán trong packages/analytics/src/views.ts đọc tối đa 2.000 sự kiện đầu theo sequence. Chỉ xử lý prefix liên tục bắt đầu từ 0; thiếu sự kiện thì chờ lô tới sau, tránh bỏ qua pause/seek bị đến chậm. Mỗi khoảng phải có trạng thái playing, không buffering, vị trí tiến lên, thời gian tăng không quá 45 giây và tốc độ hợp lý; credit không vượt thời gian thực của khoảng. Không cộng bước nhảy khi seek; hợp nhất các đoạn vị trí để xem lặp đoạn không cộng trùng. Timestamp phải nằm trong giới hạn server nhận, qualifiedAt không vượt receivedAt.

Mỗi tài khoản hoặc định danh khách chỉ đóng góp tối đa một lượt/phim/ngày UTC, kể cả nhiều phiên hoặc tập. Ngày lượt xem lấy từ sự kiện xác nhận đã đạt ngưỡng; ngày playbackStarts lấy từ createdAt của phiên. Danh tính khách dựa trên guest ID hiện có, đổi/xóa localStorage có thể tạo định danh khác. Telemetry do client báo, có kiểm token/thời gian/dedup nhưng chưa phải bằng chứng frame/CDN hoặc hệ chống bot hoàn chỉnh. Không gọi số liệu này là số người duy nhất.

Số liệu bắt đầu từ measurementStartedAt trong policy. Không tự dựng lịch sử từ tiến độ hoặc các lô trước thời điểm bật. Phiên PREVIEW, phiên trước policy hoặc cũ quá30 ngày không được cộng. Definition1 giữ nguyên, không trộn vào definition2. Lỗi analytics không chặn player/resume; số liệu cập nhật bất đồng bộ, UI detail/watch đọc lại mỗi30 giây khi tab hiện.

## API

| API | Quyền | Hành vi |
| --- | --- | --- |
| GET /api/v1/titles/:id/views | Public | views chuỗi bigint, updatedAt, measurementStartedAt, định nghĩa/ngưỡng; phim ẩn/chưa phát được trả404 |
| GET /api/v1/admin/metrics/views?days=7 | metrics.read | Chỉ nhận7/30/90; total, daily có đủ ngày kể cả0, top10, processing |
| GET /api/v1/admin/metrics/summary | metrics.read | viewsLastSevenDays là7 ngày UTC gồm hôm nay; definition2 |
| GET /api/v1/titles và detail | Public | Thêm viewCount chuỗi bigint trong projection title, không tăng lượt khi đọc |

Admin/Auditor/SuperAdmin có metrics.read; Member/Editor không có mặc định. Dùng JWT/session/quyền hiện hành và GlobalExceptionFilter hiện có. ID sai trả400; query DTO sai trả422; anon401, thiếuquyền403, tài nguyênẩn404. Không có API ghi trực tiếp số lượt. Không đổi registry90codes. Xem [OpenAPI](openapi.json).

Public response không chứa viewer key, user ID, guest hash hay session ID. workerInitialized chỉ xác nhận đã pin khóa, không phải healthcheck; processing.pendingBatches/lastProcessedAt giúp thấy độ trễ, chưa có hệ cảnh báo/SLO.

## Dữ liệu và xử lý

Migration additive [movie-view-stats-v1.sql](../design/sql/movie-view-stats-v1.sql) thêm3 bảng, tổng58:

- view_stats_policy: mốc bắt đầu và fingerprint khóa cho definition2.
- view_session_facts: receipt từng phiên đã start/qualify, FK cascade khi xóa phiên.
- view_daily_viewers: khóa HMAC SHA256 trên ngày UTC + loại định danh + định danh, unique(title,day,key,version); không lưu danh tính thô.
- title_daily_stats có sẵn là aggregate theo phim/ngày/version; thêm index watch_events(session_id,sequence,id) cho bounded scan.

Collector ghi batch/events/outbox playback.events.accepted trong cùng transaction. apps/analytics-worker đọc outbox bằng SKIP LOCKED/lease token, publish confirm vào queue quorum riêng pjflim.analytics.jobs, ACK sau transaction tổng hợp. Message chỉ có v,batchId,eventId. Session advisory lock + fact + unique daily key + batch PROCESSED cùng transaction chống redelivery/concurrent worker tăng trùng. Publisher cũ mất lease không được đánh dấu published. Batch ACCEPTED có outbox đã published quá2 phút được hòa giải/publish lại khi chưa xử lý (tối đa100lô mỗi phút); lỗi broker không làm mất receipt.

Analytics tách khỏi media/assistant queue; không đưa video/key vào broker. Poison message bị DLQ sau delivery limit; dữ liệu durable vẫn cần điều tra nếu lỗi lặp, không purge media hoặc tự redrive queue khác. Worker chạy mỗi1giây, mỗi tick tối đa20publication; prefetch1, mỗi task tối đa2.000events. Quorum một node local chưa phải HA.

API chỉ SELECT aggregate/policy, không ghi title_daily_stats và không đọc2 bảng private. Worker dùng login giới hạn, không cấp UPDATE playback_sessions để lấy khóa. Auditor không đọc private hashes/facts. HMAC secret ổn định; worker từ chối khóa khác policy. Không chạy analytics:configure để chủ ý đổi khóa đã dùng; thiết kế migration/new metric version trước khi rotation.

Worker prune tối đa1.000 daily hashes cũ hơn90 ngày mỗi giờ, giữ aggregate. Đây chỉ là retention bảng dedup mới; raw watch_events/batches/facts/outbox và privacy/reset đầy đủ vẫn thuộc ST04/REC02 còn mở. Không xóa dữ liệu chưa tổng hợp để giảm lag.

## Cài và chạy

PostgreSQL/schema/RabbitMQ/login worker đã cấu hình theo [database](../../database/README.md) và [worker](media-worker.md). Không dùng owner làm runtime.

```powershell
Set-Location E:\pj-Flim
$env:PJ_FLIM_APPLY_VIEWS='true'
npm.cmd run db:views
npm.cmd run analytics:configure
npm.cmd run db:introspect
npm.cmd run db:generate
npm.cmd run build:all
powershell.exe -NoProfile -File scripts/Start-LocalProcess.ps1 -Service analytics
powershell.exe -NoProfile -File scripts/Start-LocalProcess.ps1 -Service api
```

db:views dùng MIGRATION_DATABASE_URL, từ chối database hệ thống, advisory lock, transaction DDL, kiểm bảng/cột/index/grants và chạy lại không đổi mốc bắt đầu. .env.analytics.local chứa ANALYTICS_HASH_SECRET, ANALYTICS_QUEUE_PREFIX; broker lấy RABBITMQ_URL từ .env.worker.local hoặc ANALYTICS_RABBITMQ_URL; database lấy WORKER_DATABASE_URL. File mẫu .env.analytics.example không chứa khóa. Không đưa khóa/URL có password vào VITE_ hoặc Git.

Production dùng AMQPS, secret manager, nhiều node/broker monitoring và có vận hành DLQ/retention; chưa nghiệm thu tải, HA hoặc chống bot. Log an toàn ở .local/analytics, process record do Start-LocalProcess quản lý; không mở cửa sổ background.

## Kiểm thử

```powershell
npm.cmd run test:views:algorithm
npm.cmd run test:views
npm.cmd run test:integration
```

test:views cần credential kiểm thử PostgreSQL theo runner hiện có và broker local; chỉ tạo/xóa database pj_flim_test_<random> cùng topology pjflim.analytics-test.<random>. Không tạo lượt giả trên pj_flim, không gọi provider thật. Chi tiết và số liệu mới ở [biên bản](../testing/view-statistics-2026-11-25.md).

Cập nhật admin25/11: đã có GET /admin/metrics/views/export?days=7 và nút Xuất CSV với quyền metrics.read/audit, UTC/BOM/formula escape. Chi tiết tại [admin nâng cao](admin-advanced.md).
