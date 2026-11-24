# Điểm IMDb và Metacritic trên giao diện

Cập nhật 24/11/2026. Trang chủ/catalog có nhãn điểm trên thẻ phim; trang chi tiết và trang xem video có hai ô điểm với tiêu đề “Điểm đánh giá”. **Máy local chưa có OMDB_API_KEY; điểm thật chưa được lấy.** Giao diện hiển thị “Chưa có điểm”, không dùng số mẫu hoặc điểm TMDB thay cho IMDb/Metacritic.

## Giao diện

- IMDb: điểm khán giả theo thang 10, số lượt đánh giá nếu có, link đúng IMDb ID.
- Metacritic: **Metascore của giới phê bình**, thang 100; không phải User Score.
- Hai nguồn độc lập: một nguồn thiếu điểm vẫn hiển thị nguồn còn lại. Điểm 0 hợp lệ được giữ nguyên; N/A thành null.
- Có nguồn OMDb, ngày cập nhật, trạng thái đang tải và thử lại khi nguồn lỗi. Thiếu key không hiển thị chi tiết cấu hình máy chủ cho người xem.
- Desktop hai cột; màn hình nhỏ dưới 420px xếp dọc. Không render HTML hoặc URL tùy ý từ nguồn.
- MovieCard dùng chung hiển thị IMDb/Metacritic ở trang chủ, catalog, gợi ý và thư viện. Trang /titles/:id và /watch/:episodeId hiển thị hai ô đầy đủ; trang xem dùng titleId từ episode metadata, độc lập với trạng thái player. Admin chưa có ô điểm riêng.

## Cấu hình

Thêm OMDB_API_KEY vào E:\pj-Flim\.env.api.local theo [.env.ratings.example](../../.env.ratings.example). Key do OMDb cấp, khác với API key hoặc Read Access Token của TMDB. Không dùng VITE_, không gửi key qua chat, không commit env local.

Sau khi thêm key, restart API theo script dự án. Không cần migration: database vẫn 54 bảng. Backend chỉ đọc catalog; không sửa publication, review mapping hay video.

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "E:\pj-Flim\scripts\Start-LocalProcess.ps1" -Service api
~~~

## API

GET /api/v1/titles/:id/ratings là public, chỉ dành cho phim PUBLISHED và có media đủ điều kiện. Phim nháp/không tồn tại/không phát được trả RESOURCE_NOT_FOUND=404; UUID sai trả lỗi chuẩn hiện hành. Response HTTP200 cho trạng thái điểm:

~~~json
{
  "status": "NOT_CONFIGURED",
  "provider": "OMDB",
  "imdb": {"score": null, "votes": null, "url": null, "scale": 10},
  "metacritic": {"score": null, "scale": 100},
  "fetchedAt": null
}
~~~

Các status: READY, NOT_CONFIGURED, NOT_FOUND, UNAVAILABLE. READY có thể chứa một hoặc hai score=null khi nguồn trả N/A. Provider lỗi không làm trang phim hoặc playback lỗi. Cache-Control: no-store trên HTTP để không bỏ qua kiểm quyền/publication.

Backend tra cứu OMDb bằng tên gốc (nếu có), năm và loại movie/series do catalog sở hữu; không nhận query/URL từ client. Kiểm lại tên sau chuẩn hóa Unicode, năm bắt đầu chính xác, loại phim và định dạng IMDb ID trước khi trả điểm. Thiếu năm, sai tên/năm/loại không hiển thị điểm. Đây là đối chiếu metadata tự động cho lookup đọc, không tạo mapping admin hoặc tự duyệt mapping review TMDB.

Source URL IMDb được dựng từ tt ID đã kiểm định dạng; không nhận URL tùy ý từ provider. Metascore không có deep link phim Metacritic trong OMDb nên UI chỉ ghi nguồn OMDb, không đoán đường dẫn bài.

## Cache và giới hạn

- Positive cache 24 giờ; NOT_FOUND 5 phút; lỗi nguồn 60 giây.
- LRU tối đa 500 mục, khóa theo title ID/version và hash key; không lưu API key thô trong cache.
- Deduplicate request cùng phim/version. Tối đa 2 lượt lookup đồng thời và 200 lượt bắt đầu lookup mỗi ngày UTC trong một tiến trình API.
- Budget/cache ở bộ nhớ, reset khi restart và không dùng chung giữa nhiều replica. Chưa phải quota toàn hệ thống hoặc lưu điểm bền trong PostgreSQL.
- Cùng một cache không bỏ qua eligibility: kiểm public/media trước đọc và kiểm lại sau external request. Gỡ phim trong lúc chờ nguồn trả404.
- HTTPS cố định www.omdbapi.com, không redirect, timeout6giây, response tối đa256.000byte, kiểm JSON/điểm/votes. OMDb yêu cầu apikey trong query phía server; không log URL, lỗi gốc, body upstream hoặc trả key về trình duyệt.
- HTTP401/403/429, timeout, JSON/schema sai, payload lớn đều trả UNAVAILABLE cùng score=null. Không fallback sang số đoán hoặc dữ liệu sai phim.

## Kiểm thử

~~~powershell
npm.cmd run test:ratings:provider
# PJ_FLIM_TEST_ADMIN_PASSWORD truyền riêng qua môi trường.
npm.cmd run test:ratings
~~~

Provider36 kiểm tra và tích hợp71 kiểm tra đạt trên PostgreSQL tạm/NestJS/Chrome với HTTP nguồn giả lập. Có trường hợp đầy đủ, N/A, zero, sai mapping, Unicode, lỗi nguồn, request đồng thời, cache/version, unpublish trong lúc fetch, desktop/mobile và link nguồn. Ảnh riêng: .local/ratings/scores-desktop.png và scores-mobile.png. Không đưa số điểm fixture vào database thật.

Tài liệu nguồn: [OMDb API và tham số theo tên/ID/năm/loại](https://www.omdbapi.com/). OMDb công bố dữ liệu theo CC BY-NC4.0; lưu ý phạm vi phi thương mại trước triển khai sản phẩm thương mại. Chưa nghiệm thu OMDb thật vì thiếu key. Trợ lý CATALOG vẫn chưa đọc/tổng hợp các điểm này.


Báo cáo lượt triển khai: [kiểm thử giao diện và API](../testing/ratings-2026-11-23.md). API local đã restart; IMDb/Metascore hiện null/NOT_CONFIGURED khi chưa có key. Hồi quy frontend227 và review233 đều đạt.


## Bổ sung khả năng nhìn thấy điểm — 24/11/2026

MovieRatingBadges chỉ tải khi thẻ gần viewport qua IntersectionObserver; hàng đợi phía trình duyệt xử lý tuần tự các request badge. Không lồng link/button trong link thẻ phim. Thiếu key, chưa có dữ liệu hoặc lỗi vẫn hiện hai nhãn với dấu —; không sinh điểm mẫu. Cơ chế này không thay đổi quota/cache backend và không phải giới hạn phân tán.

Build đạt; ratings integration79 kiểm tra và hồi quy frontend227 kiểm tra đạt. Local homepage/detail HTTP200, API NOT_CONFIGURED/null, không lỗi JavaScript. OMDB_API_KEY vẫn rỗng; chưa nghiệm thu nguồn OMDb thật.
