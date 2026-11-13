# Nghiên cứu dữ liệu điểm số và bài review từ các website phim

Ngày xác minh: **13/11/2026**, Asia/Saigon. Dự án: pj-Flim tại E:\pj-Flim. Đã dùng ba agent nghiên cứu độc lập IMDb, Metacritic và các nguồn khác, sau đó đối chiếu tài liệu sơ cấp và source dự án. **Phạm vi: nghiên cứu/thiết kế; chưa tải bulk dataset, gọi API bằng credential, mua gói, gửi liên hệ hoặc triển khai importer.** Truy cập được tài liệu không chứng minh đã có quyền dùng dữ liệu trong production.

Liên quan: [plan hiện hành](../plans/movie-streaming-platform-plan.md), mục 9.6/14.7; [schema hiện tại](../../packages/database/prisma/schema.prisma), [publisher media hiện tại](../../apps/worker/src/outbox.ts). Hiện chưa có external IDs, bảng điểm/review bên ngoài, adapter nguồn hoặc UI review; `titles.age_rating` là phân loại độ tuổi, không phải điểm IMDb. Rating của thành viên pj-Flim cũng là tính năng riêng sau MVP.

## 1. Kết luận và thứ tự ưu tiên

| Nguồn | Có thể lấy gì qua tuyến được tài liệu hóa? | Điều kiện và lựa chọn cho pj-Flim |
| --- | --- | --- |
| IMDb | TSV public có aggregate rating/vote count; licensed bulk/API có các sản phẩm khác nhau; user review là sản phẩm riêng | TSV chỉ trong phạm vi quyền personal/non-commercial được xác nhận; website công khai cần chốt quyền display/distribution, không mặc định web miễn phí được dùng |
| Metacritic | Fabric Origin có API Metascore/User Score và critic quote/link/author/publication | Account được duyệt + core subscription trả phí + ToS riêng; chưa có quyền thì chỉ chuẩn bị mapping/link tham chiếu |
| TMDB | Rating/votes riêng TMDB và user reviews qua API movie/TV | Ưu tiên thử đầu tiên nếu phù hợp non-commercial/attribution; commercial cần tuyến cấp phép |
| Trakt | Ratings/votes, comments/reviews và mapping qua API | Nhánh tiếp theo cho tính năng app; policy cấm harvesting/mirror/resale, không dùng để xây bản sao catalog |
| Rotten Tomatoes | API/data feed theo quy trình licensing/đối tác | Quyền/coverage theo thỏa thuận; chưa có hợp đồng thì chưa nhập điểm/review |
| Letterboxd | API xét duyệt, member RSS, hướng dẫn ratings embed | Có loại dự án không nhận, gồm LLM/GPT/recommendation/data analysis; không chọn làm phụ thuộc bắt buộc |
| Publisher, ví dụ Guardian | Content API/RSS hoặc feed theo điều kiện publisher | Lấy bài review đúng phạm vi cấp phép; quote feed của aggregator không cấp toàn văn bài báo |

**Đề xuất của dự án:** bắt đầu adapter TMDB khi đã có quyền/key đúng mục đích; xem Trakt cho app-scoped reviews. IMDb/Metacritic/Rotten Tomatoes đi theo hợp đồng phù hợp nếu cần chính các điểm đó. Không dùng scraper/agent như một cách thay thế quyền dữ liệu. Khi thiếu quyền, UX vẫn có card liên kết nguồn được biên tập, không cần sao chép điểm hoặc toàn bài. Các hàng là quyết định thiết kế; nguồn chứng minh khả năng/điều kiện được dẫn trong từng mục dưới.

## 2. Phân biệt điểm, review và quyền sử dụng

Có bốn loại cần tách trong schema và UI:

1. **Aggregate rating:** điểm cùng số lượng đánh giá, loại khán giả/critic, phạm vi movie/series/season/episode.
2. **Critic excerpt:** đoạn trích được feed cho phép, tên tác giả/tòa soạn, ngày, URL bài gốc và điểm riêng nếu có.
3. **User review:** nội dung do thành viên của nguồn viết, có thể có rating/spoiler; không biến thành tài khoản hay đánh giá pj-Flim.
4. **AI summary/translation:** nội dung dẫn xuất có nhãn riêng và provenance; cần quyền xử lý tương ứng, không trình bày như lời nguyên văn của tác giả.

Tách ba câu hỏi: **lấy được qua kỹ thuật**, **được lưu/xử lý thế nào**, **được hiển thị/tái phân phối thế nào**. API key không tự trả lời cả ba. Text trên trang công khai, RSS, JSON-LD, robots cho một path hoặc bên thứ ba bán endpoint đều không tự chứng minh quyền tái sử dụng mọi trường.

Thiết kế quyền theo từng nguồn/trường/use case; không áp một quy tắc “dưới N từ là tự do sử dụng”. Trích đoạn, toàn bài, logo, bản dịch, AI summary, embeddings/ML và quyền chuyển dữ liệu sang nhà cung cấp LLM phải được kiểm riêng trong điều khoản/hợp đồng áp dụng. Đây là gate thiết kế, không kết luận pháp lý thay hợp đồng cụ thể.

## 3. IMDb

### 3.1. Public dataset: phù hợp nghiên cứu có điều kiện

`title.ratings.tsv.gz` chứa `tconst`, `averageRating` có trọng số và `numVotes`; UTF-8 TSV gzip, cập nhật hằng ngày. Dataset không có review text, từng lượt chấm của từng user hoặc ma trận user–item. Có thể dùng các file title basics/aliases/episode cho matching trong phạm vi được phép. [IMDb Non-Commercial Datasets](https://data.imdb.com/non-commercial-datasets/)

IMDb nêu giới hạn personal/non-commercial và tái sử dụng dữ liệu; không suy “đồ án/website không thu phí” mặc nhiên được đưa toàn dữ liệu lên web công khai. Chỉ mở importer/display khi xác nhận use case đáp ứng quyền; ghi attribution theo hướng dẫn đúng phiên bản điều khoản. [IMDb data trong phần mềm](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX), [IMDb ratings trên website](https://help.imdb.com/article/imdb/track-movies-tv/can-i-use-your-ratings-on-my-website/GU66FTMF7DHVZBHZ)

Phương án importer **đề xuất, chưa chạy**: tải một snapshot được cho phép → kiểm response/header/giới hạn → giải nén streaming → parse TSV theo header → lọc các `tconst` đã mapping → staging → validate → đổi snapshot atomically. Giữ `\N` thành null, không đổi thành 0; numVotes phải là integer hợp lệ. Không cần nhập cả catalog vào PostgreSQL chỉ để hiển thị vài phim.

### 3.2. Licensed bulk/API

IMDb có tuyến AWS Data Exchange/Marketplace; GraphQL yêu cầu account/entitlement được duyệt và thông tin API asset. Node backend có thể dùng AWS SDK Data Exchange, giữ credential phía server. [Getting Access](https://data.imdb.com/documentation/api-documentation/getting-access/), [Calling the API](https://data.imdb.com/documentation/api-documentation/calling-the-api/)

Ví dụ query rating từ tài liệu, **chưa gọi và chỉ dùng nếu entitlement hỗ trợ**:

```graphql
query {
  title(id: "tt0120338") {
    ratingsSummary {
      aggregateRating
      voteCount
    }
  }
}
```

Nguồn: [IMDb sample queries](https://data.imdb.com/documentation/api-documentation/sample-queries/title-name). Không suy gói rating đã bao gồm review; schema/quota/SLA/license lấy theo sản phẩm thực tế, không dự toán bằng một mức giá quảng cáo.

### 3.3. Review text và summary là sản phẩm khác nhau

Sản phẩm IMDb User Reviews được niêm yết là add-on, tiếng Anh, tối đa 15 review/title theo lựa chọn “Most Helpful”, phân phối dạng S3 object qua ADX. Đây không phải toàn bộ review hoặc mẫu đại diện ngẫu nhiên. Trường chi tiết/coverage/quyền hiển thị phải kiểm sample và hợp đồng sau cấp quyền. [IMDb User Reviews trên AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-ruo6dxqm3iipe)

IMDb cũng có User Review Summaries: sentiment summary bằng AI, `titleId`, `userSummaryText`, themes và `publishedAt`, có bản Full/Base. Không có ở mọi title, không phải bài critic hoặc review gốc; lần phát hành có thể đổi dù text không đổi. Đây là lựa chọn licensed để khảo sát trước khi tự tóm tắt, không mặc định thuộc TSV/API rating. [IMDb User Review Summaries dictionary](https://data.imdb.com/documentation/bulk-data-documentation/data-dictionary/user-review-summaries/)

IMDb Conditions hạn chế robots/screen scraping khi chưa có chấp thuận bằng văn bản. Không dùng agent/headless browser/proxy để gom review từ trang ngoài quyền cho phép. [IMDb Conditions](https://www.imdb.com/conditions)

## 4. Metacritic

### 4.1. Có tuyến API qua Fabric Origin

Không kết luận “Metacritic không có API”. Fabric Origin Nexus tài liệu hóa Metacritic API; cần developer account được duyệt, subscription core trả phí và đồng ý ToS riêng. Dữ liệu Metacritic không có trong Free Trial. [Metacritic API introduction](https://developer.origin.fabricdata.com/origin/apis-all/metacritic-api-docs)

```text
GET https://api.origin.fabricdata.com/Metacritic/Movie/{originMovieId}
GET https://api.origin.fabricdata.com/Metacritic/TV/{originShowId}?SeasonNumber={n}
```

ID là Entertainment Movie/Show ID của Origin, không phải IMDb/TMDB ID. Schema mô tả `Metascore.Score/ReviewCount`, `Userscore.Score/RatingCount` và `Reviews.Review[]` với date, quote, score, URL, publication, critic. Chưa gọi API nên chưa xác minh coverage, freshness, nullability hay trường được entitlement cụ thể trả về. Không suy user score đồng nghĩa có audience review text. [Endpoint/schema Metacritic](https://developer.origin.fabricdata.com/origin/apis-all/metacritic-api-docs/metacritic)

Gói truy cập và quota phải xác nhận với provider. Nếu dùng key, ưu tiên header server-side như tài liệu Origin; không đặt subscription key vào frontend/query log. [Origin getting started](https://developer.origin.fabricdata.com/origin)

### 4.2. Quote không phải toàn bài

Metacritic giải thích critic review đầy đủ nằm ở website publisher, có thể cần tài khoản/thuê bao. Quote/link trong feed không tự cấp quyền lấy bài gốc; toàn văn cần API/feed/quyền của publisher. Chưa xác minh được feed cấp phép lấy toàn bộ audience review text từ tài liệu đã đọc. [Metacritic giải thích review links](https://metacritichelp.zendesk.com/hc/en-us/articles/10605510994711-Why-when-I-click-on-a-review-it-says-I-have-to-login-or-subscribe-to-read-the-review)

Metascore và User Score phải tách; user votes không tham gia Metascore. Không tự average các quote nhận được rồi gắn nhãn Metascore. [Metacritic FAQ](https://metacritichelp.zendesk.com/hc/en-us/articles/14482674768791-Are-user-votes-included-in-the-METASCORE-calculations)

### 4.3. Giới hạn kiểm chứng điều khoản

Trang Origin liên kết ToS Metacritic qua IVA/Fabric, nhưng PDF trả 404 khi mở trong lần nghiên cứu. Search index còn hiển thị các ràng buộc về vị trí lưu trữ, giữ nguyên nội dung, attribution/purge và số quote; **không coi nội dung indexed là hợp đồng hiện hành**. Phải lấy bản có hiệu lực và schedule trước khi chốt PostgreSQL/kho lưu/UX. Không đưa các con số hoặc điều kiện địa lý từ bản không truy cập được thành cấu hình production.

Footer Metacritic dẫn Fandom Terms of Use; công cụ gặp 402 nên chưa đọc được bản hiện hành. Robots có quy tắc theo user-agent, không thay giấy phép nội dung. [Origin với link ToS](https://developer.origin.fabricdata.com/origin/apis-all/metacritic-api-docs), [Fandom Terms](https://www.fandom.com/terms-of-use), [Metacritic robots](https://www.metacritic.com/robots.txt)

Phạm vi cần xác minh: field được cấp, domain/app/territory, storage region, cache/retention/backup/purge, logo/link placement, số/cách chọn quote, dịch/AI processing và quota. Không áp giấy phép CC của Fandom wiki cho Metacritic. Chưa liên hệ provider thay người dùng; có thể chuẩn bị yêu cầu qua [Metacritic support](https://metacritichelp.zendesk.com/hc/en-us/requests/new).

## 5. Các nguồn khác

### 5.1. TMDB: ứng viên đầu tiên cho tích hợp thử

```text
GET /3/movie/{movieId}
GET /3/movie/{movieId}/reviews?language=en-US&page=1
GET /3/tv/{seriesId}/reviews?language=en-US&page=1
GET /3/movie/{movieId}/external_ids
GET /3/find/{imdbId}?external_source=imdb_id
```

Các route trên thuộc `https://api.themoviedb.org`; ví dụ tài liệu, chưa gọi bằng key. Review movie/TV là review cộng đồng TMDB; API có phân trang/language. [Movie reviews](https://developer.themoviedb.org/reference/movie-reviews), [TV reviews](https://developer.themoviedb.org/reference/tv-series-reviews)

OpenAPI mô tả id/author/author_details/content/created_at/updated_at/url; rating tác giả có thể null, không có trường spoiler bảo đảm trong schema này. pj-Flim đề xuất chỉ lấy trường cần thiết, không nhập avatar hoặc gán nhãn “không spoiler” chỉ vì thiếu flag. [TMDB OpenAPI](https://developer.themoviedb.org/openapi/tmdb-api.json)

IMDb lookup có movie/show/episode/person, bảng hỗ trợ không đánh dấu season; TMDB numeric ID phải đi với media type. Review cấp series không tự thành review của một tập/mùa. [Find by ID](https://developer.themoviedb.org/reference/find-by-id), [Movie external IDs](https://developer.themoviedb.org/reference/movie-external-ids)

FAQ phân biệt non-commercial có attribution và commercial cần thỏa thuận; làm đúng branding/notice hiện hành. Việc API trả content không phải quyền sao chép vô hạn hoặc quyền với mọi bài báo mà user dẫn link. Không tự đặt TTL 24 giờ thành điều khoản TMDB. [TMDB FAQ/license](https://developer.themoviedb.org/docs/faq)

### 5.2. Trakt: phù hợp tính năng trong app, không mirror dữ liệu

API có ratings/votes/comments và mapping. Policy hiện tại cho phép free/paid apps và các tính năng discovery/recommendations nhưng cấm bulk harvesting, catalog mirroring và resale/redistribution không được phép; có cache phục vụ tính năng, không thay quyền nội dung bên thứ ba. Đọc docs hiện tại, tránh kết luận từ bài cũ rằng đăng ký luôn cần VIP. [Trakt API Use Policy](https://developer.trakt.tv/docs/api-use-policy)

Comments hỗ trợ Markdown/spoiler; sanitize khi render. Điều khiển tốc độ theo header/quota và Retry-After; không hardcode quota từ một ví dụ thành cam kết lâu dài. [Comments](https://developer.trakt.tv/docs/about-comments), [Rate limiting](https://developer.trakt.tv/docs/rate-limiting), [Caching/freshness](https://developer.trakt.tv/docs/caching-and-fresh-data)

### 5.3. Rotten Tomatoes và Letterboxd

Rotten Tomatoes có quy trình đề nghị licensing API/feed, branding và linkback; scope lấy theo chấp thuận, không có cơ sở xem là public API miễn phí. Tomatometer/Popcornmeter là tỷ lệ đánh giá tích cực theo nhóm, không tương đương điểm trung bình 9/10 khi hiển thị 90%. [Licensing](https://www.rottentomatoes.com/help_desk/licensing), [Score definitions](https://www.rottentomatoes.com/about)

Letterboxd API phải được xét duyệt và hiện loại một số nhóm dự án, gồm LLM/GPT và recommendation/data analysis. Có member RSS và hướng dẫn ratings embed; embed không cấp quyền tải review hàng loạt. Guide iframe gặp 403 trong nghiên cứu nên chưa chốt tham số hay khả năng dùng cho pj-Flim. Không cho agent tự gọi API Letterboxd vì có đường dẫn công khai. [API access](https://letterboxd.com/api-beta/), [Embed FAQ](https://support.letterboxd.com/hc/en-us/articles/17815623056911-Can-I-display-or-embed-Letterboxd-ratings-on-my-site-or-app)

### 5.4. Bài báo từ publisher và website phim Việt Nam

Guardian là ví dụ có Content API, developer/commercial access tiers và tài liệu query; RSS được mô tả cho cá nhân/phi thương mại. Chọn section/tag/query review, trường title/byline/date/URL trước; body chỉ khi gói/quyền cho phép. [Access tiers](https://open-platform.theguardian.com/access/), [API docs](https://open-platform.theguardian.com/documentation/), [RSS](https://www.theguardian.com/help/feeds)

Với báo/web review khác, kể cả tiếng Việt: kiểm tra API/feed/embeds/điều khoản của **chính website đó**; chưa nghiên cứu và cấp quyền thì trạng thái nguồn là chưa duyệt. RSS có full content về kỹ thuật cũng không tự mở quyền tái xuất. Phương án ban đầu là card title/tác giả/tòa soạn/ngày/link với các trường được phép hoặc được biên tập độc lập; không sao chép ảnh/đoạn giới thiệu mặc định.

Toàn bài: ưu tiên thỏa thuận trực tiếp, bài do đội ngũ pj-Flim viết hoặc cộng tác viên cấp quyền. Không vượt login/paywall/CAPTCHA/bot block, không lấy lời từ một bài rồi đổi attribution thành pj-Flim.

### 5.5. OMDb và các aggregator bên thứ ba

OMDb có API tra theo IMDb ID nhưng tự ghi không thuộc/được IMDb bảo trợ và nội dung theo CC BY-NC 4.0. Đây không phải API chính thức IMDb hoặc bằng chứng đã có quyền thương mại với dữ liệu upstream. `plot=full` là synopsis, không phải review toàn văn. [OMDb API](https://www.omdbapi.com/)

Các API tổng hợp khác chỉ là ứng viên sau kiểm tra provenance, freshness, license và quyền chuyển tiếp từng nguồn. Thanh toán API/scraper không tự cấp quyền nội dung gốc; không chọn chỉ vì một response có đủ IMDb/Metacritic/RT.

## 6. Thiết kế tích hợp cho Node.js/PostgreSQL/RabbitMQ

Phần này là **đề xuất riêng cho pj-Flim**, không phải mô tả chức năng đã có hoặc yêu cầu nguyên văn của provider.

### 6.1. Mapping danh tính phim

- Model mapping: internal entity kind/id ↔ provider/entity kind/external ID; giữ IMDb `tt...` nguyên chuỗi, TMDB ID kèm media type, Origin ID kèm movie/show và season scope khi cần.
- Ưu tiên external ID đã được xác nhận; nếu tìm theo tên thì lấy original/localized title/aliases, year, kind, director/cast khi có, country và parent show/season/episode. Năm phát hành lệch vùng không tự coi là phim khác.
- Tạo candidates trước, phát hiện remake/trùng tên/special/episode mismatch; agent đưa lý do + evidence URL, admin duyệt. Không auto-link chỉ vì fuzzy score cao hoặc LLM nói chắc chắn.
- Unique theo provider + entity type + external ID + scope phù hợp; quan hệ nhiều-một phải có lý do edition/alias. Mapping version tăng khi sửa để job cũ không ghi điểm nhầm phim.
- Tách local technical season/episode của phim lẻ khỏi series thật. Điểm movie không dùng cho episode, điểm season không dùng chung mọi mùa.

### 6.2. Quyền và bảng dữ liệu đề xuất

| Nhóm/bảng đề xuất | Trường và invariant chính |
| --- | --- |
| `external_sources` / `source_policies` | provider, policyVersion, evidence/contractRef, allowedFields/Uses, domains/territories, storageRegion, attribution, retention/purge, expiry; không chứa key |
| `external_title_mappings` | local kind/id, provider ID/type/scope, evidence, trạng thái duyệt, mappingVersion, người/thời điểm duyệt |
| `external_rating_snapshots` | mapping/sourceVersion, scoreType, value, scaleMin/Max, count/countKind, sourceURL, sourceUpdatedAt nullable, fetchedAt, validUntil nếu policy có |
| `external_review_references` | providerReviewId nếu có, publisher/author display, title/date/lang/URL, excerpt/text chỉ khi được phép, spoiler unknown/flag, contentHash, scope, source/policy versions |
| `external_ingestion_runs` / receipts | job/run ID, checkpoint, snapshot/schema versions, counts/errors, policy/mapping version và lease/dedup |
| `external_review_derivatives` nếu được phép | summary/translation type, source refs/hashes, model/prompt version, language, coverage, AI label, review status và purge dependencies |

Đây là bảng/field dự kiến, **chưa thêm vào baseline 47 bảng**. Review của pj-Flim cần bảng/ownership/moderation riêng, không nhập external author thành user nội bộ. Null score/count giữ null; count loại critic review khác audience votes. Không lưu raw full text trong audit, broker hoặc log; provenance không đòi lưu bản sao vô thời hạn.

Raw payload, snapshots, search index, cache, derivatives và backup đều thuộc policy retention/purge. Hết quyền: dừng fetch, ngừng public display theo hạn hợp đồng, xử lý purge/tombstone và restore suppression; backup restore không được làm sống lại text đã gỡ. Quyền storage-region có thể buộc kho riêng thay vì đưa mọi nguồn vào DB Việt Nam.

### 6.3. Pipeline và độ bền

```mermaid
flowchart LR
  A[Scheduler hoặc admin] --> B[Kiểm policy và mapping]
  B --> C[Adapter API hoặc licensed feed]
  C --> D[Validate và staging]
  D --> E[Đối chiếu version và commit snapshot]
  E --> F[Public API đọc dữ liệu đã duyệt]
  D --> G[Agent đề xuất mapping hoặc bản nháp]
  G --> H[Kiểm bằng chứng và quyền]
  H --> E
```

- Queue/consumer riêng cho external metadata/reviews; publisher media hiện chỉ nhận hai media event, **chưa xử lý ingestion mới**. Khi code phải bổ sung routing/publisher/consumer tương ứng; không chỉ thêm outbox row rồi nhận là đã chạy.
- Job chứa ID/config version, không chứa secret hoặc toàn bài. Check policy, mapping và generation trước fetch và trước commit; license bị rút hoặc mapping đổi trong lúc chạy thì không publish kết quả cũ.
- Idempotency theo source + entity + scope + requested snapshot/version; lease/receipt bền, transaction commit cùng outbox invalidation. At-least-once có thể fetch lặp; kiểm checkpoint trước yêu cầu tính phí.
- Rate limit theo entitlement, concurrency hữu hạn, 429/5xx backoff+jitter/Retry-After, circuit breaker; 401/403 dừng nguồn và cảnh báo, không lặp bằng đổi key/proxy.
- Bulk: parse streaming/backpressure, giới hạn compressed/decompressed bytes/rows/duration; tự tính checksum snapshot, ETag không thay checksum. Staging chỉ promote khi snapshot hoàn chỉnh; thiếu row trong lần fetch dở không được coi là nguồn đã xóa.
- API: phân trang có checkpoint, budget/title/run, language fallback được ghi rõ. Không quét toàn catalog khi policy chỉ cho tính năng app.
- Dữ liệu lỗi/lệch scale/count âm/ID sai đi quarantine; giữ last-good chỉ trong thời hạn được phép. Không đổi điểm vắng thành 0; nguồn outage không chặn catalog/playback hoặc READY media.
- Tách `fetchedAt` với `sourceUpdatedAt`; không bịa thời điểm nguồn cập nhật. Refresh theo độ mới/traffic và quota đã chốt, không đặt một TTL chung thành điều khoản mọi provider.

### 6.4. API và UI dự kiến

Chưa tạo route hay cập nhật OpenAPI runtime. Các đường dưới đây là **hợp đồng đề xuất**, cùng prefix `/api/v1`:

| API đề xuất | Hành vi |
| --- | --- |
| `GET /titles/{titleId}/external-ratings` | Điểm đã được cấp quyền/display, nguồn/scope/count/date/stale status; publication guard như catalog |
| `GET /titles/{titleId}/external-reviews` | Cursor có scope nguồn/ngôn ngữ/snapshot; chỉ trả fields hợp lệ, excerpt/link/AI label rõ |
| `GET /admin/external-sources` | Trạng thái quyền/health/usage, không trả credential |
| `PUT /admin/titles/{titleId}/external-mappings/{provider}` | RBAC, DTO validation, ETag/If-Match, audit, evidence và entity scope |
| `POST /admin/external-ingestion-runs` | Idempotency-Key, 202 + Location của run; kiểm quyền/quota |
| `GET /admin/external-ingestion-runs/{runId}` | Progress/counts/failure đã redact; trạng thái run không lẫn HTTP error |

Permission mới chỉ là thiết kế, cần migration/grants/guard/UI khi triển khai; không suy role hiện tại tự có quyền nhập nội dung bên ngoài. Error code đề xuất phải được đăng ký trước khi dùng, ví dụ `EXTERNAL_SOURCE_NOT_ENABLED` 409, `EXTERNAL_MAPPING_CONFLICT` 409, validation theo hợp đồng 400/422 hiện hành. Feed thiếu quyền có thể trả collection rỗng kèm availability hợp lệ; không trả 403 cho người xem chỉ vì server chưa mua gói. Job failed nằm trong resource trạng thái run; không biến GET run thành 500 mặc định.

UI hiển thị riêng “IMDb”, “Metascore”, “Metacritic User”, “TMDB”, “Trakt” hoặc “pj-Flim”; ghi movie/season scope, votes/reviews, thời điểm và link gốc theo quyền. Không lấy 90% positive đổi thành 9/10, không cộng vote counts của các nguồn có user trùng, không gộp critic với audience. Nếu thử composite score sau này thì đặt tên pj-Flim, công khai phương pháp và chỉ dùng nguồn cho phép; không gọi là Metascore.

Review card gồm tác giả/tòa soạn, nguồn, ngày, ngôn ngữ, đoạn được phép và nút đọc gốc. Translation/AI summary có nhãn riêng; unknown spoiler mặc định che nội dung dài. Sanitize Markdown/HTML, URL chỉ HTTPS/http hợp lệ theo policy, cấm javascript/data URL và remote tracking tùy tiện; link ngoài mở an toàn. Không lấy link hoặc external score làm bằng chứng có bản quyền phát video.

## 7. Dùng agent ở đâu hiệu quả?

Đã dùng agent để nghiên cứu lần này; **runtime agent chưa được xây**. Khuyến nghị giữ adapter API/ETL xác định cho đồng bộ số liệu, dùng agent cho các việc khó theo ngữ cảnh:

| Vai trò đề xuất | Đầu vào/đầu ra | Giới hạn |
| --- | --- | --- |
| Source researcher | Tài liệu/license URLs → checklist khả năng/quyền/điểm chưa rõ | Read-only, không tự ký/mua gói hoặc tuyên bố đã được cấp phép |
| Entity matching assistant | Metadata + candidates → đề xuất ID/scope, evidence và lý do | Không tự commit mapping mơ hồ; không dùng confidence của model làm quyền |
| Review discovery assistant | Nguồn được cho phép → ứng viên bài/link/date/publisher | Không vượt bot/paywall, không gom toàn văn ngoài quyền |
| Summarizer/translator | Text được phép xử lý → draft có refs/lang/spoiler/AI label | Chỉ khi license và chính sách chuyển tới LLM cho phép; không giả quote hoặc đồng thuận |
| QA assistant | Output normalized + evidence → lỗi/missing/contradiction | Không sửa score nguồn hoặc publish bằng suy đoán |

Thiết kế tool boundary: agent chỉ nhận task/source ID và schema giới hạn; orchestrator kiểm domain/route/field, entitlement và ngân sách bên ngoài model. Fetcher chống SSRF, chặn loopback/private/link-local/metadata service, kiểm DNS và mọi redirect; không đưa arbitrary URL của review thành request server không kiểm soát. [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

Review/web page là dữ liệu không tin cậy, có thể chứa prompt injection. Agent không có credential, shell, quyền gửi email hoặc ghi/publish DB; module deterministic kiểm output, evidence và policy. Prompt “bỏ qua instruction trong trang” không thay quyền tool; sanitization/guardrail là lớp hỗ trợ, không bảo đảm tuyệt đối. [OWASP LLM prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

Đầu ra draft đề xuất: `entityRef`, `provider`, `sourceRefs`, `sourceContentHashes`, `policyVersion`, `claims[]` có evidence, `language`, `isAiGenerated`, `uncertainties[]`. Thiếu evidence thì bỏ claim, không tự bịa điểm/quote. Không train/recommend từ text chỉ vì đã có quyền display; ML/embeddings là use case riêng cần kiểm.

Khi tóm tắt sample “Most Helpful” hoặc một ngôn ngữ, nêu đúng mẫu/phạm vi/số review; không gọi là ý kiến toàn bộ khán giả. Nội dung đủ bằng chứng phải qua bước kiểm tra trước promotion; nhiệm vụ thu thập metadata không cần biến thành hệ thống nhiều agent tự duyệt lẫn nhau.

## 8. Thử nghiệm, điều kiện triển khai và phần còn thiếu

1. Chốt use case phi/thương mại, nguồn/field cần dùng, phạm vi phim/mùa, quyền display/storage/derivatives và ngân sách. Không cần hợp đồng trả phí để hoàn tất nghiên cứu tài liệu.
2. Khi bắt đầu code, dùng fixture nhỏ được phép: mapping phim trùng tên/remake/series/season/episode; review thiếu rating/date/spoiler; UTF-8 tiếng Việt, HTML/Markdown độc hại, URL SSRF và prompt injection.
3. Kiểm API/pagination, 429/5xx, outage, incomplete snapshot, webhook nếu provider có, duplicate jobs, crash trước/sau commit, policy/mapping bị thay trong lúc chạy và drift schema.
4. Kiểm không lộ draft/private data, DTO/controller/service/RBAC/audit/ETag/idempotency, key không vào frontend/URL log, source unavailable không cản phát video.
5. Kiểm field-level rights, attribution/linkback, hạn cache/retention, take-down/expiry/backup restore suppression và AI source citations. Không giả một test fixture là dữ liệu live được cấp quyền.
6. Thử sandbox API thật chỉ khi có credential/quyền/ngân sách tương ứng; ghi freshness/coverage/language/latency/usage và hạn chế. Chưa có key/hợp đồng thì báo chưa thử, không giả response thành công.
7. Rà lại điều khoản ngay trước production: nghiên cứu có ngày nhưng chính sách/coverage/quota có thể đổi.

Chưa xác minh: hợp đồng/entitlement của pj-Flim ở mọi provider, quyền thương mại/chuyển nội dung sang LLM, giá thực, completeness và tốc độ cập nhật của feed trả phí, API live/coverage review tiếng Việt, điều khoản Fandom hiện tại và PDF Metacritic có hiệu lực. Không có runtime/key/importer mới hoặc kết quả test frontend/backend trong lượt này. Backlog thực hiện nằm ở mục 14.7 của plan, tất cả NOT_STARTED.
