# Database pj-Flim

Database đã được tạo trên PostgreSQL 17.11 ngày 10/11/2026 (Asia/Saigon).

| Thuộc tính             | Giá trị                                  |
| ---------------------- | ---------------------------------------- |
| Host                   | `127.0.0.1`                              |
| Port                   | `5432`                                   |
| Database               | `pj_flim`                                |
| Schema                 | `movie`                                  |
| Bảng                   | 59                                       |
| RBAC ứng dụng          | 5 role, 19 permission, 46 liên kết       |
| Migration/schema owner | `pj_flim_owner`                          |
| Kết nối API            | `pj_flim_api`, kế thừa `movie_api`       |
| Kết nối worker         | `pj_flim_worker`, kế thừa `movie_worker` |

## Kết nối

Trong pgAdmin, dùng PostgreSQL hiện có tại host/port trên, mở **Databases → pj_flim → Schemas → movie → Tables**. Có thể dùng tài khoản quản trị PostgreSQL bạn đã cung cấp để quản lý database; backend dùng các tài khoản runtime riêng.

Connection URL thực tế nằm trong [`.env.database.local`](../.env.database.local):

- `DATABASE_URL`: API.
- `WORKER_DATABASE_URL`: worker.
- `MIGRATION_DATABASE_URL`: owner, chỉ dùng migration.

Mật khẩu cho ba tài khoản được sinh ngẫu nhiên và lưu cục bộ. Mật khẩu quản trị PostgreSQL chỉ được dùng trong phiên khởi tạo, không lưu vào source/config. File chứa credential và `.local/` đã được thêm vào `.gitignore`. Chỉ dùng các credential này cho môi trường phát triển.

Tham số URL `schema=movie` dành cho Prisma. Với pgAdmin/libpq/psql, điền host, port, database, username và password riêng; database đã có search_path `movie, pg_catalog`. Backend NestJS hiện nạp tự động .env.database.local và .env.api.local; xem [hướng dẫn API](../docs/api/README.md).

Bổ sung 13/11/2026: đã áp dụng [migration recommendation](../docs/design/sql/movie-recommendations-v1.sql), thêm preferences/feedback/snapshots; tổng hiện tại **50 bảng**. Baseline SQL/hash 47 bảng được giữ nguyên. Máy mới chạy Initialize-Database trước, sau đó api:configure và db:recommendations theo [runbook](../docs/api/recommendations.md#database-và-triển-khai); không db push. Test-Database nhận baseline 47 hoặc phiên bản 50 đã có đủ ba bảng mới.

## Kiểm tra database

Chạy từ `E:\pj-Flim`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\database\Test-Database.ps1
```

Script kiểm tra số bảng/RBAC, khóa ngoại, partial unique, trạng thái media, playback ownership/version, refresh, idempotency và điều kiện fencing. Tất cả fixture được rollback. Kiểm tra bằng login API/worker thực tế xác nhận audit append/đọc dữ liệu được phép và tám truy vấn nhạy cảm bị từ chối với SQLSTATE 42501. Các truy vấn thử bị từ chối chạy trong transaction để không thay đổi dữ liệu nếu grant cấu hình sai.

Kiểm tra SQL không thay thế kiểm thử đồng thời ở service, kiểm thử tải hoặc restore drill. Chưa seed phim hoặc tài khoản người xem. Công cụ admin:bootstrap đã tạo SUPER_ADMIN local có password ngẫu nhiên và MFA; credential ở .local/api/bootstrap-admin.json.

## Khởi tạo hoặc chạy lại

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\database\Initialize-Database.ps1
```

Script hỏi mật khẩu quản trị bằng prompt ẩn; tự dùng PostgreSQL binaries tại `C:\Program Files\PostgreSQL\17\bin`. Có thể truyền `-DatabaseHost`, `-DatabasePort`, `-AdminUser` và `-PostgresBin`. Automation có thể cung cấp `PJ_FLIM_POSTGRES_PASSWORD` trong môi trường tiến trình rồi xóa sau khi chạy.

Bootstrap đọc [schema](../docs/design/sql/movie-database-schema.sql), [seed](../docs/design/sql/movie-database-rbac-seed.sql) và [grants](../docs/design/sql/movie-database-grants.sql) đã thiết kế. DDL ghi mục tiêu ban đầu PostgreSQL 18; bản SQL hiện tại đã chạy thành công trên PostgreSQL 17.11 đang cài trên máy.

Script không DROP database/schema, không đổi password khi chạy lại và không nhận database/role đã tồn tại nếu chưa có cấu hình cục bộ của dự án. Hash baseline được lưu tại `.local/database/baseline.json`; nếu SQL baseline thay đổi sau khi tạo database, script yêu cầu migration tăng dần thay vì tự chạy lại DDL. Giữ `.local/database/connection.json` và `.env.database.local` ở máy phát triển, không commit hoặc gửi log.

Đã có Prisma schema/client tại packages/database và API admin dùng pj_flim_api; chưa có baseline Prisma Migrate. SQL vẫn giữ constraint/grants; không chạy lại CREATE TABLE lên database đã có dữ liệu.


## Migration assistant — 14/11/2026

Đã áp dụng [movie-assistant-v1.sql](../docs/design/sql/movie-assistant-v1.sql), thêm assistant_runs và assistant_run_steps: **52 bảng hiện hành**, từ50bảng sau recommendation migration. Baseline47 giữ nguyên. Máy mới: bootstrap baseline → api:configure → db:recommendations → assistant:configure → db:assistant → db:introspect → db:generate. Không db push/Prisma Migrate.

Run/session/parent có FK ownership, retention7ngày, lease/generation/fencing, evidence và giới hạn payload. API CRUD; worker/auditor không có quyền bảng private. Outbox dùng bảng hiện có, MQ chỉ mang run/event ID. Test-Database chấp nhận47/50/52 theo migration tương ứng; SQL39assertions rollback và8permissiondenials đạt sau migration. [Chi tiết](../docs/api/assistant.md).


## Migration review — 23/11/2026

Đã áp dụng [movie-reviews-v1.sql](../docs/design/sql/movie-reviews-v1.sql): review_sources (mapping, generation/version, lease, TTL và title_version) và external_reviews (nội dung plaintext, tác giả, điểm nullable thang10, ngôn ngữ, link gốc). **54 bảng hiện hành**. PK/FK cascade theo title/mapping, unique(title_id,external_id), index(title_id,fetched_at DESC,id DESC). API CRUD; không cấp worker/auditor đọc hai bảng.

Máy mới chạy db:reviews sau db:assistant với PJ_FLIM_APPLY_REVIEWS=true rồi introspect/generate. Migration không reset database; chạy lại kiểm tra idempotent. Test-Database chấp nhận47/50/52/54 tùy migration, hiện đạt42assertions rollback và8permissiondenials. [Runbook](../docs/api/reviews.md). Database thật chưa có mapping/review giả lập.


## Đánh giá người xem — 25/11/2026

Migration movie-viewer-reviews-v1.sql thêm viewer_reviews, hiện55bảng. UNIQUE(user_id,title_id), rating1–10/content2000/version/flag và indexcreatedAt+id; API CRUD, worker/auditor không đọc. Chạy db:viewer-reviews với PJ_FLIM_APPLY_VIEWER_REVIEWS=true rồi introspect/generate; không db push/reset baseline. Test-Database cập nhật nhận55 và kiểm grants mới. [API](../docs/api/viewer-reviews.md).

## Thống kê lượt xem — 25/11/2026

Đã áp dụng movie-view-stats-v1.sql, tổng58bảng. Thêm view_stats_policy, view_session_facts, view_daily_viewers; title_daily_stats có sẵn lưu definition2. API chỉ SELECT policy/aggregate, không đọc fact/dedup hoặc ghi counter; worker quyền hẹp cho3bảng mới. Prisma đã introspect/generate58models. db:views có flag PJ_FLIM_APPLY_VIEWS=true, chạy lại giữ nguyên mốc đo. Chạy analytics:configure để tạo khóa riêng, rồi analytics worker; xem [vận hành](../docs/api/view-statistics.md). Kiểm53assertion rollback và8runtime permission denials đạt; không tạo lượt giả trên catalog thật.

## Admin nâng cao — 25/11/2026

movie-admin-advanced-v1.sql mở rộng viewer_reviews4cột kiểm duyệt,2index và quyền reviews.moderate cho ADMIN/SUPER_ADMIN. Tổng58bảng/19permission/46liên kết; giữ API CRUD và worker/auditor không đọc review. db:admin-advanced có flag PJ_FLIM_APPLY_ADMIN_ADVANCED=true, rerun an toàn; db:viewer-reviews cũ tương thích. Prisma đã đồng bộ; kiểm57assertion rollback+8denials đạt. [Vận hành](../docs/api/admin-advanced.md).


## Quản lý phim hàng loạt — 25/11/2026

movie-catalog-batches-v1.sql đã áp dụng thêm catalog_batches:59bảng,19permission/46liên kết. Chỉ API CRUD; worker/auditor không đọc biên nhận riêng. db:catalog-batches yêu cầu PJ_FLIM_APPLY_CATALOG_BATCHES=true, migration chạy lại an toàn. Prisma introspect/generate59models; database verify61assertion rollback và8runtime permission denials đạt. Không thay metadata/video/trạng thái phim có sẵn. [Runbook](../docs/api/catalog-batches.md).
