# Thuật toán gợi ý và cá nhân hóa đang chạy

Cập nhật 13/11/2026, Asia/Saigon. Phiên bản thuật toán **content-v1**. Bản đầu đã được triển khai bằng TypeScript/Node.js trong [content.ts](../../packages/recommendations/src/content.ts), [service](../../apps/api/src/services/recommendations.service.ts), [controller](../../apps/api/src/controllers/recommendations.controller.ts) và [trang Dành cho bạn](../../apps/web/src/pages/ForYou.tsx).

Đây là gợi ý theo nội dung, dùng dữ liệu hiện tại của chính tài khoản đã đồng ý. Các trọng số là cấu hình khởi đầu, chưa được tối ưu bằng dữ liệu người dùng hoặc A/B test. Kế hoạch nâng cấp giữ tại [mục 9.2/14.5](../plans/movie-streaming-platform-plan.md); [hợp đồng API](../api/recommendations.md) mô tả phần đã có.

~~~mermaid
flowchart TD
  A["GET feed: JWT và phiên hiện hành"] --> B["Preference của chính tài khoản"]
  B --> C["Catalog đã xuất bản và phát được"]
  B --> D["Nếu opt-in: saved + accepted coverage"]
  C --> E["Vector metadata + profile"]
  D --> E
  E --> F["Cosine + recency → top 200"]
  F --> G["MMR → tối đa 100 ID"]
  G --> H["Snapshot có hạn và cursor HMAC"]
  H --> I["Kiểm lại quyền/catalog/feedback mỗi trang"]
  I --> J["Card + lý do chung trên /for-you"]
~~~

## 1. Dữ liệu đầu vào

Đơn vị xếp hạng là **phim/title**, không phải tập. Metadata gồm tên Việt/tên gốc, synopsis, thể loại, vai trò + ID diễn viên/đạo diễn, ngôn ngữ, quốc gia và năm phát hành. Không dùng email, giới tính, IP, thiết bị, dữ liệu người dùng khác, điểm IMDb hoặc review bên ngoài.

Hai nguồn tín hiệu tích cực:

| Nguồn | Điều kiện | Trọng số ban đầu |
| --- | --- | --- |
| Phim đã lưu | Watchlist hiện tại của đúng tài khoản; phim vẫn đủ điều kiện phát | 2 |
| Đã xem hợp lệ | Watch progress đã được backend chấp nhận; đúng active asset/version; watched_seconds đủ ngưỡng | 3 |

Không coi một lần hiện card là một lượt xem. Bỏ lưu không thành dislike. Không dùng số lần cập nhật progress làm số lượt xem. Một bộ phim nhiều tập chỉ có tối đa một tín hiệu xem với trọng số 3, lấy thời điểm mới nhất trong các tập đủ ngưỡng. Lịch sử cũ ở đây là **snapshot hiện tại**, không tái tạo chuỗi sự kiện quá khứ.

## 2. Kiểm tra quyền và nội dung trước khi tính

Tất cả endpoint mới cần JWT và phiên server hợp lệ; service kiểm lại trạng thái user/session/authVersion và chính sách MFA hiện hành. Owner chỉ lấy từ Principal, không nhận userId trong DTO.

Ứng viên phải qua cùng publicTitle/publicEpisode với catalog: phim/tập PUBLISHED, active asset ACTIVE/READY, HLS đúng attempt/config/profile đã verified và backup nguồn đã verified. Production còn giữ yêu cầu backup S3/version. Gợi ý không cấp signed URL video hoặc quyền phát mới.

Chỉ khi enabled=true mới đọc watchlist, progress và feedback để cá nhân hóa. Khi tắt, không dùng các dữ liệu đó hoặc hideCompleted để lọc feed; đưa về khám phá theo ngày xuất bản.

## 3. Giới hạn công việc mỗi lần tạo feed

1. Lấy tối đa 1.000 phim đủ điều kiện, mới xuất bản trước; đọc thêm một ID để biết bị cắt. meta.candidateTruncated=true nếu catalog vượt giới hạn.
2. Lấy tối đa 100 phim đã lưu gần đây và 100 phim có progress đạt ngưỡng gần đây; gộp theo title.
3. Lấy metadata của tập ứng viên cộng seed, tối đa khoảng 1.200 title; không truy vấn N lần cho từng phim.
4. Mỗi title tối đa 30 thể loại, 30 credit; text đọc có giới hạn, bộ tách giữ 180 token trước khi sinh bigram. Vocabulary tối đa 10.000 term.
5. Chấm điểm rồi giữ top 200 để rerank; kết quả cuối tối đa 100 title.

Phim cũ ngoài cửa sổ 1.000 có thể không được đề xuất dù hợp sở thích. Đây là giới hạn của MVP, cần retrieval/index offline khi catalog lớn. API không xây ma trận cosine N×N toàn kho; nó tạo vector theo tập dữ liệu có giới hạn và rerank tập nhỏ trong request.

## 4. Chuẩn hóa và TF-IDF

Text được lowercase, đổi đ→d, NFD bỏ dấu, loại ký tự ngoài a–z/0–9/khoảng trắng, bỏ stopword cơ bản Việt/Anh. Sau đó lấy unigram và bigram kề nhau. Ví dụ “Chiến binh vũ trụ” tạo các term gần với “chien”, “binh”, “vu”, “tru”, “chien binh”, “binh vu”, “vu tru”.

Đây là tokenizer đơn giản theo khoảng trắng, chưa phải word segmentation hoặc embedding ngữ nghĩa tiếng Việt. Bỏ dấu giúp khớp biến thể nhưng cũng làm mất một phần nghĩa; cần benchmark sau.

Với n lần term xuất hiện trong một document và df document chứa term:

~~~text
tf(term, document) = 1 + ln(n)          khi n > 0
idf(term) = 1 + ln((N + 1)/(df + 1))
textWeight = tf × idf
~~~

df tính trên tập metadata ứng viên + seed của lần tạo feed. Vocabulary chọn df cao trước, thứ tự term để phá hòa. Không tải thư viện Python/scikit-learn vào runtime; [tài liệu TF-IDF gốc của scikit-learn](https://scikit-learn.org/stable/modules/feature_extraction.html#tfidf-term-weighting) được dùng để đối chiếu công thức smoothing/sublinear TF.

## 5. Ghép vector nội dung

Mỗi nhóm được chuẩn hóa L2 riêng; nhóm thiếu metadata là vector rỗng, không tự điền giá trị giả.

| Nhóm | Feature | Trọng số |
| --- | --- | --- |
| Thể loại | Multi-hot theo genre ID | 0,40 |
| Văn bản | TF-IDF tên và synopsis | 0,30 |
| Người tham gia | Multi-hot role:personId | 0,15 |
| Ngôn ngữ/quốc gia | Multi-hot có prefix tách hai loại | 0,10 |
| Năm | Multi-hot theo thập niên floor(year/10) | 0,05 |

Ghép **sqrt(trọng số) × vector nhóm**, rồi chuẩn hóa L2 toàn vector. Dùng căn bậc hai để đóng góp dot product của hai nhóm có trọng số đúng hệ số khi các nhóm đầy đủ. Khi metadata thiếu, chuẩn hóa tổng khiến tỷ trọng thực giữa nhóm còn lại được phân phối lại. Hai năm ở hai bên ranh giới thập niên không có độ gần liên tục; đây là giản lược có chủ đích của bản đầu.

Vector dùng Map thưa, không cấp mảng 10.000 phần tử cho từng phim. Tiền tố g:/t:/p:/l:/y: tránh feature khác loại trùng tên.

## 6. Ngưỡng xem và hồ sơ sở thích

Với D là thời lượng nguồn bằng giây:

~~~text
q(D) = min(D, max(10, min(120, 0.2 × D)))
~~~

Ví dụ clip 5 giây cần 5 giây coverage; phim 100 giây cần 20 giây; phim dài cần 120 giây. Coverage lấy watched_seconds đã hợp nhất khoảng xem và chống cộng trùng ở LibraryService. Tua tới cuối, positionSeconds=duration hoặc ended=true đơn lẻ không đạt điều kiện. Coverage chỉ là bằng chứng hoạt động kỹ thuật, không chứng minh người xem chú ý hoặc yêu thích.

Mức ảnh hưởng suy giảm với half-life 30 ngày:

~~~text
weight_now = initial_weight × 0.5^(age_days / 30)
title_weight = min(5, saved_weight_now + qualified_watch_weight_now)
profile = L2_normalize(Σ title_weight × title_vector)
~~~

Thời gian lấy từ watchlist.created_at và max(progress.updated_at) của tập đủ ngưỡng. Không tăng trọng số theo số tập đã xem hoặc số request. Feedback NOT_INTERESTED loại title khỏi cả ứng viên lẫn seed tích cực. Nếu mọi seed không còn hợp lệ/không có feature, profile rỗng và quay về khám phá gần đây.

## 7. Cosine, độ mới và đa dạng

Vector đã chuẩn hóa nên cosine là dot product của feature chung; vector rỗng có similarity 0. [Định nghĩa cosine](https://scikit-learn.org/stable/modules/metrics.html#cosine-similarity) được đối chiếu với tài liệu thư viện; runtime tự tính trên sparse Map.

~~~text
similarity = cosine(candidate_vector, profile)
recency = exp(-max(0, now - published_at)/(90 ngày))

score = 0.85 × similarity + 0.15 × recency    nếu có profile
score = recency                              nếu không có profile
~~~

Ngày tạo chỉ là fallback khi published_at thiếu. Score không phải xác suất người dùng thích phim. Không hiển thị “đang thịnh hành” hoặc số lượt xem vì chưa có bộ tổng hợp thống kê thật.

Giữ 200 candidate điểm cao nhất rồi chọn tham lam, mỗi bước:

~~~text
MMR(candidate) = 0.8 × score(candidate)
                 - 0.2 × max cosine(candidate, phim đã chọn)
~~~

Sau khi chọn một phim, cập nhật redundancy của các phim còn lại; không tính lại toàn bộ tập các cặp đã chọn. ID phá hòa để cùng input/thời điểm cho kết quả tái lập. Ý tưởng cân bằng độ liên quan và độ trùng lặp tham khảo [Carbonell & Goldstein, SIGIR 1998](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf). Các hệ số trên là lựa chọn của dự án, không phải kết quả chứng minh từ paper hoặc số đo Netflix.

## 8. Xử lý phim đã biết và đã xem hết

- Mặc định tránh lặp các seed đã lưu/đã xem hợp lệ; người dùng xem tiếp từ thư viện.
- hideCompleted=true loại phim đã hoàn thành **tất cả tập hiện đang xuất bản và phát được**, mỗi progress phải đúng active asset/version.
- Xem xong một tập không tự hoàn thành cả phim bộ. Tập mới xuất bản làm điều kiện “đã xem hết các tập hiện có” thay đổi.
- hideCompleted=false cho phép đưa title đã hoàn thành vào lại, kể cả khi nó là seed, để gợi ý xem lại. Các seed chưa hoàn thành vẫn được tránh lặp.
- NOT_INTERESTED luôn loại khi đang bật cá nhân hóa; hoàn tác cho phép phim trở lại ở feed tạo mới. Feed cũ không tự bổ sung những title đã bị loại lúc tạo.

Độ đa dạng không bảo đảm quota cứng theo thể loại/quốc gia. Quốc gia và ngôn ngữ của phim là metadata nội dung, không được diễn giải thành thuộc tính nhạy cảm của người dùng.

## 9. Snapshot và phân trang an toàn

Tạo feed mới trong transaction, khóa preference của đúng owner để tuần tự hóa với opt-out/feedback:

1. Kiểm phiên và preference.
2. Tạo danh sách tối đa 100 ID + reason code.
3. Lưu snapshot cùng owner, preference version, model version, surface, thời gian hết hạn.
4. Trả trang đầu và cursor HMAC-SHA256.

Cursor chứa snapshot ID, owner, offset, model, surface, preference epoch và expiry; không chứa vector hoặc danh sách phim riêng tư. Không log cursor. TTL 10 phút, giữ tối đa 5 snapshot/tài khoản. Đổi limit giữa các trang được phép vì offset là vị trí trong snapshot, không phải điểm số động.

Trang sau kiểm HMAC/owner/model/surface, đọc đúng snapshot còn hạn và đúng preference version. Cắt một lát danh sách trước rồi kiểm lại catalog/feedback/completion hiện tại; phim không còn hợp lệ bị bỏ, có thể trả trang ngắn hoặc rỗng kèm hasMore. Không kéo phim từ vị trí sau để lấp chỗ trống, không tính lại điểm khi phân trang.

Thay preference vô hiệu hóa toàn bộ snapshot của owner. Cursor sai/tài khoản khác trả REQUEST_INVALID_CURSOR; snapshot hết hạn/bị đẩy khỏi 5 bản lưu/preference thay đổi trả RECOMMENDATION_FEED_EXPIRED. Client làm mới trang đầu khi người dùng chọn thử lại.

Lý do hiển thị chỉ là mã/text chung dựa vào similarity của candidate; không đưa tên phim nguồn, chi tiết lịch sử hoặc điểm tin cậy giả. Catalog card được đọc lại, không lấy poster/tên cũ từ snapshot.

## 10. Riêng tư, dung lượng và vận hành

enabled mặc định false. Opt-out xóa feedback và snapshot ngay trong transaction; watchlist/progress vẫn là dữ liệu thư viện do người dùng chủ động sử dụng. Vector/profile chỉ sống trong bộ nhớ request, không lưu DB. Khi bật lại, bản đầu sẽ sử dụng watchlist/progress hiện tại; **đây không phải chức năng reset lịch sử học**.

API trả private, no-store, frontend không ghi feed xuống storage. Trang được remount theo user.id; request có AbortSignal và generation guard; logout hủy tác vụ và xóa trạng thái riêng tư. Feedback chỉ được tạo cho phim đang xem được; DELETE feedback của chính mình vẫn được phép khi phim đã bị gỡ.

API có ngân sách bền trong PostgreSQL: 30 feed mới/phút/tài khoản, 60 mutation feedback/phút; cursor không chạy lại ranking. Tối đa 1.000 feedback/tài khoản. Mỗi API process dọn tối đa 500 snapshot hết hạn/phút bằng SKIP LOCKED; timer unref và được dừng khi shutdown. Khi cleanup lỗi chỉ log recommendation.retention_failed, không log dữ liệu cá nhân/raw error. TTL luôn được kiểm ở lượt đọc dù cleanup trễ; cần giám sát backlog khi triển khai có tải lớn.

Không có Redis/private cache, consumer analytics, impression/click tracking, popularity model, recommendation-worker hoặc LLM trong luồng này. Media worker/RabbitMQ giữ nhiệm vụ HLS/backup hiện có. Worker và auditor không được đọc ba bảng recommendation mới; API được cấp CRUD, retention chỉ SELECT/DELETE snapshot.

## 11. Ví dụ luồng

Tài khoản mới mở “Dành cho bạn”: cá nhân hóa tắt, nhận phim mới xuất bản được rerank để bớt trùng. Sau khi bật và lưu phim hành động vũ trụ A, phim B cùng thể loại/nội dung được nâng điểm; phim hài C có thể được chen vào để đa dạng. A không lặp lại khi đang là seed chưa hoàn thành.

Người dùng chọn “Không quan tâm” B: lưu feedback idempotent, B không xuất hiện ở trang kế tiếp hoặc feed mới. Hoàn tác xóa đúng feedback của owner. Tắt cá nhân hóa xóa cả feedback lẫn các snapshot, trả về khám phá; không xóa thư viện.

## 12. Phạm vi còn lại

REC01/03/04/05 mới hoàn thành một phần. Cần tiếp tục reset có watermark/baseline để không học lại tín hiệu cũ, feature/model artifact offline, analytics queue riêng có idempotency, impression proof, benchmark timeline/full-catalog, các slice cold-start, đo QoE/latency/memory có tải và A/B trước khi kết luận tăng tương tác. ALS/BPR/LightFM/two-tower, embedding và cá nhân hóa theo profile gia đình chưa làm.

Kiểm tra chức năng tại [báo cáo 13/11/2026](../testing/recommendations-2026-11-13.md). Các fixture tính tay chứng minh công thức/luồng, không đo độ chính xác của gợi ý với người dùng thật.
