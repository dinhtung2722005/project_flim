# Kiểm thử đánh giá người xem — 25/11/2026

## Kết quả

| Nhóm | Kết quả | Phạm vi |
| --- | --- | --- |
| Tính năng viewer review |161checks đạt, gồm20Chrome checks | PostgreSQL tạm, auth/API/UI thật, không dữ liệu người dùng thật |
| Hồi quy toàn dự án |2624checks đạt, gồm275frontend/941security/341viewer/40Swagger | PostgreSQL tạm, Chrome; không media worker live |
| Review TMDB hồi quy |233checks đạt,39provider fixture calls | Public/admin TMDB UI vẫn đúng nguồn; không gọi TMDB thật |
| Database local |46assertions rollback và8permissiondenials đạt |55bảng, quyền API/worker/auditor; fixture không lưu |
| Build/OpenAPI |Đạt |114operations/86paths/56admin,90codes |

Các nhóm con đã nằm trong tổng của từng suite, không cộng lặp. Hồi quy toàn dự án chạy trước hai chỉnh UI cuối: widget mobile gọn hơn và yêu cầu tự chọn điểm; suite161checks chạy trên build cuối và kiểm hai chỉnh này.

## Điều đã xác minh

- Khách đọc summary/list; ownGET/PUT/DELETE bắt đăng nhập và current session.
- Một rating/account/title; scale1–10, không nhận0/11/decimal/string/null, content trim/2000/control chars, spoiler boolean và chống gán owner/role.
- Average/count cập nhật đúng khi tạo/sửa/xóa, empty=null, tác giả SUSPENDED bị loại khỏi cả list và aggregate.
- Cross-owner ETag không sửa/xóa được người khác; stale412, thiếu428, song song cùng ETag chỉ một commit. Review UUID tránh ABA sau delete/recreate.
- Cursor cùng microsecond không mất bản ghi, không dùng sang phim khác; quota10PUT/phút và revoked session bị chặn.
- Phim nháp/ẩn trả404 khi public đọc/PUT; owner vẫn DELETE được sau unpublish với precondition đúng.
- Public projection không có email/userId/session. Review HTML chỉ là text, không script/img/svg trong cards hoặc dialog.
- Chrome: guest→login→sửa review→spoiler disclosure→xung đột phiên khác giữ draft→explicit reload→xóa→logout. Ô chọn điểm có label đúng và bắt chọn điểm khi viết mới, không điền sẵn điểm8.
- Mobile320px không tràn; launcher Trợ lý thu thành icon48px khi có phần review, giữ aria-label. Xem ảnh community-mobile/desktop.
- Runtime local thật: GETviewer-reviews200, anonymous own401, region/login prompt hiển thị,0pageerrors. Count0/average=null, không seed review giả để hiển thị.

## Migration và vận hành

Đã chạy db:viewer-reviews thành công, chạy lại applied=false. Introspect/generate đồng bộ55bảng, gồm các model review TMDB đã tồn tại trong DB và viewer_reviews mới; baseline DDL không thay. API được build/restart qua process script của project; không lưu PID vào tài liệu. OpenAPI export được kiểm tại server thật114/86.

Không thay role/user/catalog/video thật hoặc khóa nguồn, không tải model/Colab, không commit/push hay sửa diagram/cá nhân. Chỉ migration/schema/grants cần cho tính năng; Test-Database fixture rollback.

## Bằng chứng riêng tư

- .local/viewer-reviews/integration-result.json và integration.log.
- .local/viewer-reviews/community-mobile.png, community-desktop.png.
- .local/viewer-reviews/local-smoke.json và local-community-mobile.png.
- .local/api/integration-result.json và .local/reviews/regression.log.
- .local/reviews/integration-result.json và .local/viewer-reviews/external-reviews.log.

Trong QA đã sửa label ô điểm (label bao select làm tên truy cập chứa toàn bộ options), thu gọn launcher che giao diện mobile, bỏ điểm mặc định để người xem chủ động chọn. Test fixture ban đầu dùng sai status/schema revoked_at và selector nhầm textarea với đoạn review được sửa đúng; không bỏ assert bảo mật/concurrency/spoiler.

Chưa có admin moderation/report chuyên biệt cho review, reply/helpful vote hoặc export review vào chatbot/Colab. Không coi kết quả local là load test hay nghiệm thu production.
