# Kiểm thử quản lý phim hàng loạt — 25/11/2026

Thực hiện trong E:\pj-Flim, Asia/Saigon. [Hợp đồng/vận hành](../api/catalog-batches.md), [plan2.43](../plans/movie-streaming-platform-plan.md).

## Kết quả

| Phạm vi | Kết quả |
| --- | --- |
| Build backend + frontend | Đạt npm run build:all; TypeScript và Vite |
| Feature integration | 170 kiểm tra, gồm 6 browser assertions Chrome; PostgreSQL tạm |
| Hồi quy chung | 2.782 kiểm tra; 275 frontend, 1.099 xác thực/phân quyền, 40 Swagger |
| Database local | 61 assertions rollback + 8 runtime permission denials |
| Migration | Áp dụng lần đầu; lần hai applied=false; không thay phim |
| Prisma | Introspect/generate 59 models |
| OpenAPI thực tế | 125 operation / 97 path / 66 admin; 90 error codes |
| Smoke API/UI local | History200, công cụ chọn phim hiện, mobile không tràn trang, 0 pageerror |
| Dữ liệu phim thật | Không thay; smoke không tạo preview hoặc thực hiện batch |

Nhóm frontend/security/Swagger là thành phần của tổng hồi quy chung, không cộng thêm lần nữa. Feature170 là suite riêng. Hồi quy chung dùng database tạm, media worker không được bật; không phải nghiệm thu provider/CDN/Colab hay tải production.

Bằng chứng private: .local/catalog-batches/integration-result.json, integration.log, history-mobile.png, local-smoke.json, local-history-mobile.png; .local/api/integration-result.json. Không đưa token, connection URL hoặc thông tin bootstrap vào báo cáo.

## Các trường hợp đã kiểm tra

- Anonymous401, MEMBER/AUDITOR403; EDITOR chỉ gắn/thay thể loại và bị403 khi publish/unpublish. Ma trận chung bao phủ66admin operations/5roles.
- DTO: danh sách rỗng, quá20phim, UUID lỗi/trùng kể cả uppercase, thiếu/trùng/quá30thể loại, action lạ, reason trống/quá500 và trường override/owner lạ bị từ chối.
- Preview201 có ETag/Location/no-store và không đổi phim/thể loại/outbox. Tham số lý do được trim, UUID chuẩn hóa. Không lộ owner/session ID.
- Owner khác không đọc/thực hiện đợt; cursor ràng buộc owner/state, phân trang không trùng. Phiên mới cùng user đọc được kết quả nhưng sameSession=false và không thực hiện được.
- If-Match thiếu428/sai412, confirm=false và override tham số bị từ chối; hết hạn409; thu hồi quyền sau preview khiến thực hiện403.
- ADD giữ thể loại cũ, REPLACE thay toàn bộ; vượt tổng30 bị BLOCKED, cùng danh sách UNCHANGED không tăng phiên bản. Phim không tồn tại/archived/thiếu tập phát được có kết quả rõ.
- PUBLISH/UNPUBLISH có tác dụng lên phim; không tự thay publication của tập. Video mất READY sau preview khiến item FAILED và phim không được xuất bản.
- Phim thay version sau preview nhận RESOURCE_VERSION_MISMATCH; phim hợp lệ khác vẫn APPLIED. Không tự sửa ETag để ghi đè.
- Gửi lại completed và thực hiện song song không tăng version/audit/outbox trùng. Các item đã APPLIED được bỏ qua.
- Trigger lỗi ghi batch audit chứng minh rollback cả thay đổi phim/thể loại/outbox/receipt. RUNNING còn READY, gỡ lỗi rồi tiếp tục bằng ETag preview gốc thành công.
- Gián đoạn sau phim đầu đã commit, trước phim thứ hai commit: chỉ phim đầu tăng version một lần; resume xử lý phim thứ hai, không áp dụng lại phim đầu.
- Chrome đăng nhập thật trên app test: chọn phim, genre/reason, preview không đổi DB, xác nhận đổi DB, xem lịch sử/kết quả. EDITOR không có option publish/ẩn. Tên phim chứa HTML hiển thị dạng text, không sinh image.
- Mobile390px không tràn document; bảng có thể cuộn ngang. Screenshot đã xem để kiểm tra bố cục.
- Swagger execution chỉ khai báo200 cho thành công; preview201. Không trùng header If-Match; schema response item/counts/session/version và errors qua ProblemDetails.

## Thực thi lại

npm.cmd run test:catalog-batches dùng credential test riêng theo các suite integration hiện có; test tạo/xóa database pj_flim_test_<random> và dùng runtime role giới hạn. Không dùng database/catalog thật làm fixture. Full regression qua test runner hiện có; không chia sẻ file cấu hình private.

Migration và khởi động xem [runbook](../api/catalog-batches.md). Kiểm database: powershell.exe -NoProfile -File database/Test-Database.ps1.

## Giới hạn

Chưa kiểm nhiều instance hoặc proxy timeout production. Bản này thực thi đồng bộ tối đa20phim, có resume theo biên nhận; chưa có worker bulk/scheduler/server cancellation/retention lịch sử riêng. Đóng trang không hủy giao dịch server đã nhận. Chưa kiểm tải cao, CDN live, Android/Safari hoặc Qwen/E5; các release gate cũ giữ nguyên.
