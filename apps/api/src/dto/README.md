# DTO của API

Thư mục riêng cho 40 class DTO đầu vào của NestJS. Controller/service import trực tiếp theo nghiệp vụ; index.ts dùng để export tập trung. Các DTO giữ nguyên tên class, decorators class-validator/class-transformer và metadata Swagger.

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
| [media.dto.ts](media.dto.ts) | Upload intent, xác minh nguồn và retry processing |

Ví dụ import:

~~~ts
import { RegisterDto } from "./dto/accounts.dto";
import { PageDto } from "./dto/common.dto";
~~~

Các module DTO chỉ import lớp dùng chung từ file cụ thể để tránh vòng lặp qua index.ts. Giữ nguyên class tham chiếu trong ValidateNested/Type/PartialType để validation và schema Swagger hoạt động khi chạy thật.

Các schema response người xem hiện ở [viewer.openapi.ts](../viewer.openapi.ts). [Hướng dẫn API](../../../../docs/api/README.md) và [API người xem](../../../../docs/api/viewer-api.md) mô tả hợp đồng HTTP.
