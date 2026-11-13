# Kiểm thử live search — 13/11/2026

Phạm vi: thanh tìm phim công khai của pj-Flim. Source [LiveSearch.tsx](../../apps/web/src/components/LiveSearch.tsx), nối vào [Catalog](../../apps/web/src/pages/Public.tsx), giao diện ở [ux.css](../../apps/web/src/ux.css). Không thay API, DTO backend, phân quyền, database schema hoặc các nghiên cứu REC/ENC/EXT.

## Hành vi đã triển khai

- Gõ từ 2 ký tự sau trim để mở gợi ý, debounce 300 ms, tối đa 6 kết quả qua GET /api/v1/titles với q/kind/genre/sort/limit=6. Không gửi bearer token cho truy vấn catalog công khai.
- Kết quả gồm tên, tên gốc nếu khác, poster/placeholder, loại phim và năm khi có. Nguồn là API thực với publication/playability guard hiện hành; không dựng dữ liệu phim cho database thật.
- Phím lên/xuống chọn phim, Enter mở lựa chọn; Enter khi chưa chọn hoặc nút Tìm kiếm/Xem tất cả kết quả cập nhật danh mục và URL như trước. Từ khóa một ký tự vẫn tìm toàn bộ qua nút/Enter.
- Escape, Tab hoặc nhấn ngoài đóng; nhấn lại ô mở gợi ý. Nút xóa từ khóa trả focus về input, giữ các bộ lọc khác. Back/Forward đồng bộ lại từ khóa từ URL.
- Loading, rỗng, lỗi/thử lại; hủy timer/request khi đổi từ khóa/filter, đóng hoặc unmount. Kiểm signal và khóa truy vấn trước hiển thị, không để response cũ thay kết quả mới.
- Tạm dừng gợi ý và không submit Enter trong IME composition; mở lại khi composition kết thúc. Không cần cài package mới.
- ARIA combobox/listbox/option, active descendant và giữ DOM focus tại input; trạng thái được thông báo. Tham khảo [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/); chưa coi đây là audit screen reader/WCAG đầy đủ.

## Kiểm thử và kết quả

- Web TypeScript/build đạt.
- Runner frontend-only chạy trên Chrome thật và PostgreSQL tạm: **202 kiểm tra đạt**, 64,516 giây. Trong đó live search thêm **54 kiểm tra**; số cũ không cộng thành một lần chạy backend mới.
- Regression ở [live-search.browser.ts](../../tests/live-search.browser.ts), nối vào [frontend.integration.ts](../../tests/frontend.integration.ts). Phim publish/playable được chuẩn bị bằng suite hiện có; alias tiếng Việt và phim draft mới chỉ trong database pj_flim_test_<random>, được runner dọn.
- Kiểm API thực: người xem khách, phim đã xuất bản xuất hiện/phim nháp không xuất hiện, alias tiếng Việt tìm không dấu, kind/sort giữ đúng, URL/history và mở chi tiết bằng chuột/bàn phím.
- Fault injection riêng: response 503/thử lại và response cũ bị giữ chậm. Những response này là mô phỏng transport trong browser, không phải kết quả provider ngoài.
- Composition được kiểm bằng sự kiện mô phỏng, không phải IME hệ điều hành thật. Debounce và các thao tác đóng/mở/clear được kiểm trong browser.
- Bốn mẫu responsive 320/390/768/1440 px: không tràn ngang, popover nằm trong chiều rộng viewport. Đã xem ảnh mobile và desktop; không có pageerror.
- Runtime localhost:3000: thêm 6 kiểm tra read-only bằng guest với phim hiện có, gợi ý/selection/Enter mở chi tiết hoạt động. Không mở video, ghi database hoặc restart API. Static server đang phục vụ bundle mới.

## Lỗi phát hiện và chỉnh sửa

Bài bàn phím phát hiện khi đóng/mở popover, dữ liệu giữ từ lần trước có thể xuất hiện trước effect tải mới, khiến lựa chọn bị reset rồi Enter submit full search. Đã tập trung thao tác đóng vào closeSuggestions để xóa dữ liệu/selection cũ; mở lại chờ kết quả mới. Nhấn lại input đang focus cũng mở được popup. Bài kiểm click bên ngoài dùng vùng hero không bị popover che; không ép click xuyên overlay.

## Bằng chứng riêng

Các file dưới .local/web/live-search được Git bỏ qua: result.json, runtime-result.json, integration.log, search-320.png/search-390.png/search-768.png/search-1440.png và runtime.png. Kết quả toàn frontend ở .local/web/integration-result.json; không commit log/ảnh fixture hoặc credential.

## Giới hạn

Không chạy lại bộ hồi quy backend/RabbitMQ/Cloudinary vì không đổi backend/media. Suite frontend vẫn mock provider upload tại ranh giới ngoài như trước; không dùng kết quả này chứng minh transcode/HD/DRM. Chưa đo tải tìm kiếm hoặc bổ sung ranking/fuzzy/Redis; backend vẫn tìm chuỗi chuẩn hóa trong tên/alias/credits, sort theo hợp đồng hiện tại. Chưa nghiệm thu Safari/Android/iPhone, screen reader hoặc IME hệ điều hành. ST01–ST06 giữ nguyên trạng thái.
