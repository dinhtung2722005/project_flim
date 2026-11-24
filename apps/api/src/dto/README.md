# DTO của API

Thư mục riêng cho 65 class DTO đầu vào của NestJS. Controller/service import trực tiếp theo nghiệp vụ; index.ts dùng để export tập trung. Các DTO giữ nguyên tên class, decorators class-validator/class-transformer và metadata Swagger.

| File | Phạm vi |
| --- | --- |
| [common.dto.ts](common.dto.ts) | PageDto, ReasonDto |
| [auth.dto.ts](auth.dto.ts) | Đăng nhập, refresh, xác minh MFA |
| [accounts.dto.ts](accounts.dto.ts) | Đăng ký, yêu cầu email, token xác minh, reset mật khẩu |
| [catalog.dto.ts](catalog.dto.ts) | Tìm/lọc phim, alias/credit, tạo/sửa phim, mùa, tập và publication |
| [users.dto.ts](users.dto.ts) | Danh sách user, trạng thái và phân quyền admin |
| [resources.dto.ts](resources.dto.ts) | Thể loại, người tham gia, banner và cấu hình site |
| [audit.dto.ts](audit.dto.ts) | Bộ lọc audit log |
| [reports.dto.ts](reports.dto.ts) | Báo lỗi của người xem và bộ lọc báo cáo admin |
| [playback.dto.ts](playback.dto.ts) | Tạo phiên phát, event và batch telemetry |
| [library.dto.ts](library.dto.ts) | Lưu tiến độ xem |
| [recommendations.dto.ts](recommendations.dto.ts) | Feed query, hai cờ preference bắt buộc, NOT_INTERESTED feedback |
| [media.dto.ts](media.dto.ts) | Upload intent, xác minh nguồn và retry processing |

Ví dụ import:

~~~ts
import { RegisterDto } from "./dto/accounts.dto";
import { PageDto } from "./dto/common.dto";
~~~

Các module DTO chỉ import lớp dùng chung từ file cụ thể để tránh vòng lặp qua index.ts. Giữ nguyên class tham chiếu trong ValidateNested/Type/PartialType để validation và schema Swagger hoạt động khi chạy thật.

Các schema response người xem hiện ở [viewer.openapi.ts](../viewer.openapi.ts). [Hướng dẫn API](../../../../docs/api/README.md) và [API người xem](../../../../docs/api/viewer-api.md) mô tả hợp đồng HTTP.


Assistant DTO riêng tại assistant.dto.ts:10classes cho create/options/cursor và internal claims/tools/heartbeat/results/failure; nested validation nghiêm. Tổng hiện hành54DTOclasses. Xem docs/api/assistant.md tại gốc dự án.


ReviewSourceDto ở reviews.dto.ts nhận externalId số nguyên1..2147483647, từ chối null/string/field lạ. Dùng PageDto chung cho list/cursor. Tổng54DTOclasses;14nhóm.

## Experience DTO — 24/11/2026

experience.dto.ts: MfaEnrollmentDto, ConfirmEnrollmentDto, UpdateReportDto; input validation và Swagger, không nhận userId/role/owner từ client. Tổng57DTOclasses/15nhóm. Đoàn phim tái sử dụng CreditDto/title DTO đang có.


ViewerReviewDto trong viewer-reviews.dto.ts: rating integer1–10, content trim/<=2000/không control chars, containsSpoilers boolean; whitelist không nhận owner/version. Tổng58DTOclasses/16groups.

## View statistics — 25/11/2026

[view-stats.dto.ts](view-stats.dto.ts): ViewMetricsDto chỉ nhận days=7/30/90 (mặc định7), chuyển số và reject field lạ bằng global validation. Tổng59class/17nhómDTO. Response bigint chuỗi, schema ở view-stats.openapi.ts; không có DTO ghi lượt trực tiếp.

Admin25/11: admin-advanced.dto.ts thêm AdminReviewQueryDto, ModerateReviewDto, CatalogHealthQueryDto; enum vấn đề dùng packages/contracts/src/admin.ts. Status/titleId/cursor/filter/reason trim3–500; tổng62class/18nhóm. Không nhận role/owner/moderatedBy từ client.


[catalog-batch.dto.ts](catalog-batch.dto.ts):3DTO preview/confirm/query; tổng19nhóm. Giới hạn20phim/30thể loại, UUID lowercase trước unique, reason trim3–500, confirm chỉ true, không nhận override tham số khi thực hiện.
