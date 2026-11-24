# Nhập metadata phim từ web — 14/11/2026

Theo yêu cầu bổ sung ảnh bìa, tóm tắt và số tập, đã nhập **20 tựa phim: 10 phim lẻ và 10 phim bộ**, **20 ảnh bìa**, **227 bản ghi tập**, **14 thể loại** vào database local pj_flim. Mỗi tựa có tóm tắt tiếng Việt được biên tập lại từ thông tin nguồn. Nguồn là [API công khai KKPhim](https://www.kkphim2.com/api-document), endpoint metadata phimapi.com.

Ảnh gốc được lấy từ CDN phimimg.com và lưu loại image trong Cloudinary. Database lưu public_id ở poster_asset_ref; không nới validation nhận URL bất kỳ hoặc thay cách hiển thị ảnh.

## Kết quả kiểm tra

- Database trước → sau: titles3→23, seasons3→23, episodes4→231, genres0→14. Schema vẫn52 bảng, OpenAPI97 operation/73path; không migration/API/frontend mới.
- Video assets **4→4**, upload intents **4→4**. Không tải/nhập video, trailer, link nhúng hoặc m3u8. Không tạo media job cho lô metadata.
- Cả20 tựa và227 tập mới đều **DRAFT**, active_asset_id=null. Tổng số tập là số nguồn công bố, gồm tập dự kiến chưa phát; không phải số tập đang xem được.
- Phim lẻ có một tập kỹ thuật do API tạo cùng title. Phim bộ có 217 tập metadata được tạo qua API; tên tập là Tập1…N. Các phần Will Trent giữ số phần lấy từ tên nguồn.
- Toàn bộ title/episode/asset cũ khớp snapshot trước nhập. Admin API giữ auth/RBAC và audit trong transaction; không dùng SQL ghi trực tiếp.
- 20 ảnh qua kiểm tra HTTP200. Chrome thật tải20/20 ảnh trên bảng quản trị; form chi tiết hiển thị đúng tóm tắt và public_id, không pageerror; session kiểm tra đã logout204.
- Chạy lại cùng batch: **created=0, resumed=20, newSeriesEpisodes=0, newGenres=0**. Không tạo bản ghi trùng.
- 10 Node tests đạt: chuẩn hóa tiếng Việt, HTML/entities, số tập rõ ràng, ảnh HTTPS/host/path/magic, whitelist loại video fields, dữ liệu lỗi và trùng tên/năm/loại.

## Dữ liệu đã nhập

| Phim | Loại | Năm nguồn công bố | Tổng tập metadata |
| --- | --- | --- | --- |
| Tay Đấm Thuê | Phim lẻ | 2026 | 1 |
| Không Đầu Hàng | Phim lẻ | 2026 | 1 |
| Hoán Đổi Dịp Giáng Sinh | Phim lẻ | 2026 | 1 |
| Giải Bóng Chày Nữ | Phim lẻ | 1992 | 1 |
| Godzilla Trừ Một | Phim lẻ | 2023 | 1 |
| Allen | Phim lẻ | 2026 | 1 |
| Suzane Von Richthofen: Tội Ác Của Cô Con Gái | Phim lẻ | 2026 | 1 |
| Phúc Âm Giáng Sinh | Phim lẻ | 2026 | 1 |
| Người Mẹ Khác | Phim lẻ | 2026 | 1 |
| Một Ngày Hè Tươi Sáng Hơn | Phim lẻ | 1991 | 1 |
| Siêu Nhân Tiga | Phim bộ | 1996 | 52 |
| Gấp Ánh Trăng | Phim bộ | 2026 | 27 |
| Chuyện Cũ Miền Biên Ải | Phim bộ | 2026 | 24 |
| Cuộc Chiến Hoa Hồng | Phim bộ | 2026 | 25 |
| Đặc Vụ Will Trent (Phần 3) | Phim bộ | 2025 | 18 |
| Đặc Vụ Will Trent (Phần 2) | Phim bộ | 2024 | 10 |
| Đặc Vụ Will Trent (Phần 1) | Phim bộ | 2023 | 13 |
| The Body | Phim bộ | 2026 | 8 |
| Mười Ba Kiểu Tình Yêu | Phim bộ | 2026 | 18 |
| Tình Gửi Cuối Thu | Phim bộ | 2026 | 22 |

Xem ở http://localhost:3000/admin/titles sau khi đăng nhập. Trang người xem và chatbot public chưa hiển thị lô này vì chưa đủ điều kiện xuất bản/phát; giữ nguyên publication guard.

## Công cụ và cách chạy

[Importer](../../scripts/import-catalog-metadata.mjs), [normalizer](../../scripts/lib/catalog-metadata.mjs), [tests](../../tests/catalog-metadata.test.mjs).

~~~powershell
# Bước đọc nguồn, chưa ghi DB:
npm.cmd run catalog:metadata -- --fetch --limit 20

# Điền bản tóm tắt đã biên tập theo slug vào file local synopses.vi.json.
npm.cmd run catalog:metadata -- --prepare

# Nhập plan đã chuẩn hóa vào API local và Cloudinary:
npm.cmd run catalog:metadata -- --apply
npm.cmd run test:catalog:metadata
~~~

Dữ liệu/source URL/provider ID/số tập nguồn/manifest/ảnh kiểm và báo cáo ở **.local/catalog-import/kkphim/**, được Git bỏ qua. Credential admin lấy từ bootstrap local hoặc PJ_FLIM_ADMIN_CREDENTIALS_FILE; Cloudinary đọc .env.api.local, không in key/token. Importer chỉ gọi API local loopback, không chạy production.

Plan hạn24 giờ, tối đa100 tựa, mỗi tựa1–100 tập rõ ràng. Nguồn trả ? hoặc chuỗi khoảng không được đoán số. Poster chỉ HTTPS phimimg.com với hai prefix ảnh quan sát được, raster JPEG/PNG/WebP≤5MB, không redirect/SVG; Cloudinary image public_id xác định, overwrite=false. Source JSON chỉ giữ whitelist metadata; không lưu phần chứa đường dẫn video.

API tự tạo audit/outbox cho tài nguyên. File state giữ title IDs/poster và nguồn để tiếp tục batch lỗi giữa chừng; batch mới dùng --batch ten-lo-moi để có thư mục state/manifest riêng, tránh trộn mapping. Title trùng tên/năm/loại hoặc slug có sẵn được bỏ qua; importer không sửa nội dung cũ hoặc tự gộp phim.

Bằng chứng private: first-run.json, last-run.json, database-verification.json, browser-verification.json, admin-catalog.png, before-db.json và state.json. DB kiểm bằng truy vấn đọc; browser dùng Chrome profile tạm riêng.

Giới hạn: metadata là snapshot nguồn, chưa xác minh độc lập toàn bộ nội dung/năm hoặc quyền tái phát hành thương mại của ảnh. Chưa đồng bộ tăng dần, metadata-source table/ID matching IMDb-TMDB, episode title thật từng tập, backdrop, video, ratings/reviews hoặc tự xuất bản. Nguồn API công khai không được coi là giấy phép video. Các backlog EXT/REC/ENC/AG giữ trạng thái riêng; không chạy lại suite app/model toàn bộ vì không đổi code API/frontend.

Lô bổ sung: thêm --batch bo-sung-02 vào cả ba lệnh --fetch/--prepare/--apply; đặt synopses.vi.json trong .local/catalog-import/kkphim/bo-sung-02. Tên batch chỉ gồm chữ thường, số và dấu gạch ngang; không ghi đè state của lô mặc định.
