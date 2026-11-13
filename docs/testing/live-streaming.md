# Nghiệm thu streaming thật trên local

Ngày 11/11/2026. Phạm vi được yêu cầu: upload → HLS/backup → xuất bản phim thử riêng và kiểm tra player trên Chrome Windows.

## Phân biệt hai bộ kiểm tra

- test:integration và test:web dùng database tạm, mock provider tại ranh giới ngoài, không tự xuất bản phim trong pj_flim.
- streaming:smoke là nghiệm thu có tác động thật: tạo phim thử, upload Cloudinary, tiêu thụ quota chuyển mã/lưu trữ/CDN, tạo backup và xuất bản đúng phim thử tại API local. Không dùng cờ này trong CI mặc định.
- Không sửa trạng thái database thành READY/VERIFIED để làm bài test đạt. Worker, HLS verifier, checksum và webhook phải hoàn thành thật.
- Phim thử cũ được giữ trạng thái; script dùng state riêng tại .local/web/live-streaming/state.json để chạy tiếp đúng tài nguyên đã tạo.

## Chuẩn bị

1. Chạy PostgreSQL, API, RabbitMQ, worker và webhook theo [runbook](../api/media-worker.md).
2. API đã phục vụ build web. Tài khoản bootstrap local dùng chính sách mật khẩu đã được người dùng chọn; smoke dừng nếu nhận PENDING_MFA.
3. Có Chrome cài sẵn. Có thể đặt PJ_FLIM_CHROME_PATH cho vị trí khác.
4. Video nằm trong giới hạn tài khoản. Bản 20 phút đã giảm dung lượng dùng khoảng 101 MB; bản gốc vượt giới hạn 100 MiB. Thử thêm bản cắt 45 giây để chuyển tập và xem hết.
5. Đường dẫn mặc định là .local/media/test123-under-limit.mp4 và .local/media/streaming-short-test.mp4. Có thể đặt PJ_FLIM_LIVE_VIDEO và PJ_FLIM_LIVE_SHORT_VIDEO; phải có quyền dùng video.

## Chạy có chủ đích

```powershell
Set-Location E:\pj-Flim
$env:PJ_FLIM_LIVE_MEDIA='true'
npm.cmd run streaming:smoke -- prepare
$env:PJ_FLIM_LIVE_FRESH_VIEWER='true' # tài khoản thử mới để đo completion từ trạng thái sạch
npm.cmd run streaming:smoke -- playback
Remove-Item Env:PJ_FLIM_LIVE_MEDIA
Remove-Item Env:PJ_FLIM_LIVE_FRESH_VIEWER
```

Không truyền mode sẽ chạy cả hai. Base API mặc định http://127.0.0.1:3000; PJ_FLIM_TEST_API_URL chỉ chấp nhận HTTP localhost hoặc 127.0.0.1. Không có bước deploy website hoặc public API.

prepare tạo phim bộ thử, mùa và hai tập bằng UI; upload từng video trực tiếp từ browser; chờ worker; kiểm lại HLS, webhook và backup SHA-256 so với file local; chọn active asset và xuất bản qua UI. Nếu upload bị gián đoạn, phải xác minh intent trước khi tạo lượt upload khác. Không xóa state để thử lại mù.

playback dùng tài khoản MEMBER thử riêng, kiểm hình đã giải mã, 720p, đổi xuống mức thấp, Auto, tua tiến/lùi, tốc độ, lưu tiến trình, logout/login xem tiếp, ngắt mạng browser trong 8 giây rồi khôi phục, đổi tập và xem hết bản ngắn tự nhiên. Tải manifest/segment từ Cloudinary thật; không route.fulfill dữ liệu video trong nghiệm thu này.

## Bằng chứng riêng tư

Thư mục .local/web/live-streaming được Git bỏ qua:

- state.json: ID phim/mùa/tập/asset, đường dẫn nguồn và hash phục vụ chạy tiếp.
- prepare-result.json, playback-result.json, result.json: kiểm tra, số đo và giai đoạn; result là lần chạy gần nhất.
- viewer.json: thông tin tài khoản thử riêng, không commit hoặc chép vào tài liệu.
- title.png, player.png: ảnh trình duyệt.
- Log gọi script đặt dưới .local/web; không log JWT, chữ ký upload hoặc URL CDN đã ký.

Chỉ báo cáo kết quả đã đạt; timeout Cloudinary hoặc lỗi browser là FAILED, không thay bằng fixture để kết luận đã nghiệm thu.

## Các lỗi được phát hiện và sửa

- Form dùng label bao quanh select làm tên truy cập gộp lựa chọn: đổi sang htmlFor/id và aria-describedby.
- Chrome có thể trả native HLS là maybe; ưu tiên hls.js/MSE ở trường hợp này, giữ native cho ManagedMediaSource hoặc khi không có MSE và có native. Có fallback native nếu hls.js không hỗ trợ. Dựa trên [hướng dẫn hls.js](https://github.com/video-dev/hls.js#using-hlsjs), vẫn cần thử Safari/iPhone riêng.
- Bản ESM hls.js cần workerPath: bundle worker cùng phiên bản từ package và phục vụ cùng origin, tránh xử lý transmux trên main thread.
- Khi mất master playlist, recovery tải lại nguồn thay vì chỉ startLoad khi chưa có levels. Hết lượt recovery hiển thị Mở lại video.
- Giữ tốc độ qua lần load media bằng defaultPlaybackRate; áp dụng resume một lần cho một phiên, không tua về điểm cũ mỗi khi metadata phát lại.
- Yêu thích chờ khôi phục phiên auth trước khi cho bấm.
- Trong giai đoạn eager async, CDN có thể trả 400 kèm thông báo byproduct của streaming profile chưa được tạo trực tiếp. Phân loại phản hồi cụ thể đó thành MediaPending, tiếp tục chờ trong maxWaitSeconds; lỗi profile không hợp lệ vẫn là MEDIA_PROVIDER_BAD_RESPONSE. Không bỏ kiểm manifest, từng rendition/segment, nguồn và backup.

- Tunnel cloudflared cũ còn process nhưng đã bị hủy phía provider: script phát hiện lỗi cụ thể và khởi động lại đúng process. Video dài READY nhờ reconciliation; callback muộn sau sửa tunnel được xác minh rồi bỏ qua vì attempt đã hoàn tất. Tập ngắn nhận callback và PROCESSED trên pipeline mới.
- Segment Cloudinary có thể dùng byte-range: HTTP 206 là hợp lệ, không chỉ 200.

## Kết quả đã nghiệm thu ngày 11/11/2026

- Phim thử: [mở trên local](http://localhost:3000/titles/065cb0a4-4c4e-442a-aa5e-985b825757c8). Hai tập đã PUBLISHED qua UI; phim thử Cloudinary cũ vẫn giữ DRAFT.
- Nguồn dài 1.211,803 giây và bản cắt 45 giây đều có 5 rendition 180p/270p/360p/540p/720p, HLS/operation SUCCEEDED, backup VERIFIED và checksum khớp file local. Backup đã được đọc lại.
- Video dài được reconcile thành READY trước callback; callback muộn sau khi thay tunnel được xác minh và bỏ qua đúng trạng thái kết thúc. Video ngắn nhận callback PROCESSED. Không dùng webhook giả.
- prepare đạt 3 kiểm tra tổng hợp; playback đạt 17 kiểm tra với provider/CDN thật.
- Chrome đã giải mã khung hình, phát 720p, chuyển 360p/Auto, tua 300 giây rồi 60 giây, đổi tốc độ, lưu/xem tiếp sau logout/login, mất mạng 8 giây rồi phát tiếp, đổi tập và xem hết tự nhiên.
- Lần chạy đạt ghi vị trí 154,023 giây với 14,784 giây coverage: đoạn tua qua không bị cộng thành thời gian đã xem. Tập ngắn completed, coverage cuối 44.812 giây.
- Startup lần đo đạt khoảng 3.211 giây, đo từ bấm Xem ngay đến currentTime > 1 giây. Không đồng nhất với time-to-first-frame và không phải p95.
- Quan sát 136 phản hồi CDN: playlist 200, media byte-range 206. Có 3 worker HLS cho các phiên, không có pageerror trong Chrome. Đã kiểm screenshot player thật.
- Bộ hồi quy riêng trên PostgreSQL tạm/RabbitMQ đạt 1.198 kiểm tra, gồm 53 browser checks; không dùng số này thay cho 20 kiểm tra live.

## Giới hạn kết luận

Đây là Chrome headless Windows với autoplay được cho phép và video muted. Không chứng minh chất lượng âm thanh, Safari/iPhone/Android thật, khả năng truy cập media controls trên mọi thiết bị, long-run memory, gia hạn 30 phút/nhiều giờ hoặc tải đồng thời.

Mất mạng được tạo bằng browser offline rồi dùng CDN thật khi nối lại; đó không thay ma trận băng thông/latency/loss. Thời gian startup của một lần chạy không phải benchmark p95. URL CDN vẫn không có TTL/thu hồi theo phiên API; ST01–ST04/ST06 và phần nghiệm thu thiết bị/tải của ST05 còn mở.
