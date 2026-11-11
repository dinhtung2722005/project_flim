# Database pj-Flim

Database đã được tạo trên PostgreSQL 17.11 ngày 10/11/2026 (Asia/Saigon).

| Thuộc tính             | Giá trị                                  |
| ---------------------- | ---------------------------------------- |
| Host                   | `127.0.0.1`                              |
| Port                   | `5432`                                   |
| Database               | `pj_flim`                                |
| Schema                 | `movie`                                  |
| Bảng                   | 47                                       |
| RBAC ứng dụng          | 5 role, 18 permission, 44 liên kết       |
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
