# Kiểm thử admin nâng cao — 25/11/2026

Bộ tính năng đạt144kiểm tra, gồm15kiểm tra Chrome, trên database PostgreSQL tạm58bảng/19permission. Báo cáo .local/admin-advanced/integration-result.json; không dùng dữ liệu thật làm fixture.

Đã kiểm quyền ADMIN/SUPER_ADMIN/EDITOR/AUDITOR/MEMBER; DTO, cursor ràng buộc bộ lọc,428/412 và thu hồi quyền với token còn hạn. Kiểm ẩn/khôi phục, điểm trung bình loại review ẩn, trường hợp tất cả bị ẩn có count0/average null, tác giả không tự bỏ ẩn, ETag khi tác giả sửa, xóa/tạo lại và rollback cả trạng thái/version nếu audit lỗi. Cùng trạng thái không tạo thêm audit. Public không lộ lý do; danh sách admin không lộ email/userId.

Kho phim đã kiểm metadata đầy đủ, bản nháp thiếu thông tin và phim PUBLISHED có asset FAILED; tìm/lọc/summary/cursor đúng. CSV được kiểm401/403/422, header attachment/no-store/text-csv, UTF-8 BOM,7ngày, số9007199254740993 không mất chữ số và tên phim chứa HYPERLINK được escape; có audit cho ADMIN/AUDITOR.

Chrome kiểm quản trị với dữ liệu API thật trong DB tạm: đọc review dưới dạng text, xung đột giữ lý do, đọc bản mới và ẩn/khôi phục; tác giả đăng nhập thấy thông báo bị ẩn; filter HIDDEN, kiểm tra kho phim/mobile390px và tải file qua Blob có BOM. Hai trang admin mới lazy-load. Không có pageerror.

Hồi quy chung đạt2724kiểm tra trong79785ms, gồm275frontend/1041auth-security/40Swagger/341viewer/64pagination (nhóm con, không cộng lại vào tổng); không bao gồm media worker. Bộ viewer-reviews cũ161kiểm tra/20Chrome cũng đạt sau migration mở rộng.

Build API/web và OpenAPI export thành công;121operation/93path/62admin,90errorcodes. Database local applytrue/rerunfalse, db:viewer-reviews cũ rerunfalse, Prisma58models. Database verify57assertion rollback và8expected permission denials đạt;5role/19permission/46liên kết.

Smoke local đã đăng nhập bằng tài khoản cấu hình riêng, xác nhận menu quyền, moderation200, catalog-health200 và tải CSV756byte. Summary local:23phim cần bổ sung thông tin,22phim chưa có tập phát được; reviewRows0. Không sửa phim, review hoặc role của tài khoản thật. Phiên đăng nhập kiểm thử đã logout riêng; chỉ tạo audit xuất CSV theo hành vi kiểm thử. Không lưu credential/token trong báo cáo.

API đã restart qua script quản lý process; Chrome0pageerror, mobile không tràn ngang. Evidence .local/admin-advanced/{local-smoke.json,local-health-mobile.png,catalog-health-mobile.png,test.log}; hồi quy .local/api/integration-result.json, viewer .local/viewer-reviews/integration-result.json.

Chưa kiểm production load, Excel thực, CDN/video provider hoặc các chức năng tương lai ngoài phạm vi3công cụ. Không thay nghiệm thu Colab/AG hoặc ST/REC/ENC.
