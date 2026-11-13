# Kế hoạch xây dựng AI agent cho pj-Flim

Ngày: 13/11/2026. Cập nhật: 14/11/2026 — Asia/Saigon. Phiên bản: 1.6.
Trạng thái: **COLAB_POC_IMPLEMENTED — đã có code/notebook, chờ kiểm runtime Colab thật**.

Người dùng chọn **Google Colab làm môi trường thử agent**, thay cho chạy model trên máy Windows. Giữ **Qwen2.5:7b qua Ollama bên trong runtime Colab**, LangChain và RAG/search. Yêu cầu mới “giúp tôi build agent” cho phép triển khai PoC. Đã tạo notebook/source/exporter/tests theo mục16. Chưa chạy Colab/Qwen/E5 thật; không cài model trên Windows hoặc tích hợp backend/UI. Bảng/API/worker và phần ngoài mục16 vẫn là thiết kế dự kiến.

Lộ trình tích hợp website: [12 bước build chatbot đọc dữ liệu pj-Flim](website-chatbot-implementation-plan.md). Lượt ngày14/11 này chỉ bổ sung kế hoạch, chưa code gateway/API/UI chatbot.

Liên quan: [plan chính](movie-streaming-platform-plan.md), [nghiên cứu nguồn review](../design/external-ratings-reviews-research.md). Agent hỗ trợ REC và EXT nhưng không thay thế các backlog đó.

## 1. Mục tiêu và phạm vi sản phẩm

Xây một agent dùng tiếng Việt, có công cụ đọc dữ liệu phim, tìm kiếm ngữ nghĩa và tạo câu trả lời kèm căn cứ. Tách hai nhóm tác vụ để tránh lẫn quyền người xem với quyền quản trị:

| Nhóm | Tác vụ dự kiến | Kết quả |
| --- | --- | --- |
| Người xem | Tìm phim theo ý định: “phim phiêu lưu nhẹ nhàng, sản xuất năm 2020” | Danh sách phim đang xem được, lý do dựa trên metadata, liên kết chi tiết |
| Người xem | Hỏi nội dung, thể loại, diễn viên; so sánh các phim trong kho | Câu trả lời có nguồn, nêu rõ dữ liệu còn thiếu, tùy chọn tránh spoiler |
| Người xem, có đồng ý | Gợi ý theo thể loại trong danh sách yêu thích của chính tài khoản | Gợi ý có nhãn cá nhân hóa và cách tắt; chưa cần gửi toàn bộ lịch sử xem |
| Admin | Gợi ý ghép phim với IMDb/TMDB ID, tìm bài review tại nguồn được phép | Bản nháp gồm candidate ID, scope, nguồn và điểm cần xác minh |
| Admin | Tóm tắt/biên dịch review được phép xử lý bằng AI | Bản nháp có dẫn chứng, ngôn ngữ, phạm vi mẫu và nhãn AI; người có quyền duyệt |

**MVP đầu tiên:** agent hỏi đáp/tìm phim trên catalog nội bộ. Nhánh nguồn ngoài triển khai tiếp khi có key, mapping và policy phù hợp. Điểm IMDb/Metacritic, review và độ chính xác gợi ý không được tự sinh khi thiếu dữ liệu.

Chưa đưa vào MVP: học collaborative filtering, fine-tuning Qwen, autonomous browsing toàn Internet, mua dịch vụ, tự sửa metadata/xuất bản phim, tải video hoặc đọc filesystem/shell tùy ý. Đây là giới hạn sản phẩm, không phải yêu cầu xây đầy đủ các nhánh rồi mới thử được agent.

## 2. Quyết định công nghệ

| Thành phần | Lựa chọn kế hoạch | Lý do và điều kiện |
| --- | --- | --- |
| API chính | Giữ Node.js/NestJS | Sở hữu auth, RBAC, catalog eligibility, DTO, audit và Problem Details hiện có |
| AI runtime | Python trong notebook Colab; FastAPI cho dịch vụ dài hạn | PoC tương tác chạy module agent trong notebook; API chính/pipeline media vẫn ở máy/server |
| LLM | Qwen2.5:7b qua Ollama trong Colab runtime | Lựa chọn mới; model tải về runtime Google, benchmark GPU/tiếng Việt/tool/latency thực |
| Điều phối | LangChain Python, ChatOllama; vòng lặp tool hữu hạn | Dùng API hiện hành, pin/lock phiên bản sau thử tương thích; không phụ thuộc ví dụ import cũ |
| Embedding | intfloat/multilingual-e5-small | Phù hợp thử truy vấn tiếng Việt/đa ngôn ngữ hơn việc mặc định chọn all-MiniLM-L6-v2; vẫn phải so baseline |
| Vector index | FAISS CPU cho PoC Colab | Tìm láng giềng vector; metadata, quyền và phiên bản vẫn ở PostgreSQL/manifest |
| Dữ liệu chính | PostgreSQL hiện có | Nguồn sự thật về phim/quyền/publication; vector index là dữ liệu dẫn xuất có thể dựng lại |
| Job nền dài hạn | RabbitMQ trên máy/server, topology và consumer AI riêng | Kiến trúc tích hợp website sau PoC; notebook Colab free không chạy distributed queue worker |
| Nguồn ngoài | OMDb cho IMDb/Metascore theo lựa chọn mới; TMDB tùy chọn | Adapter có schema, quota và kiểm scope; nguồn lỗi không cản xem phim |
| Web discovery | DDGS tùy chọn, tắt mặc định | Chỉ phát hiện link; không phải API có SLA, không bảo đảm miễn phí/ổn định hoặc quyền đọc toàn bài |
| Colab | Môi trường PoC agent ưu tiên, giao diện notebook | Mục 9.1–9.5: inference/search/benchmark tương tác, snapshot dữ liệu, checkpoint; không cam kết GPU/uptime |

FAISS là thư viện tìm vector, không tự cung cấp ownership/RBAC, đồng bộ dữ liệu hoặc transaction với PostgreSQL. Không chọn đồng thời FAISS và Chroma trong MVP. Chroma server hoặc pgvector là phương án xem xét sau nếu cần nhiều replica/filter vận hành thuận tiện hơn; pgvector cần extension và phương án migration được kiểm riêng.

Không dùng LLM để nhập số liệu rating đơn giản: adapter xác định thực hiện HTTP, parse, normalize và lưu evidence. Agent chỉ hỗ trợ tác vụ có ngữ cảnh như matching, tổng hợp và giải thích.

## 3. Kiến trúc và phân lớp

Luồng PoC ưu tiên trên Colab (notebook tương tác):

```text
Backend pj-Flim -> snapshot catalog tối thiểu có version/hash -> người dùng nạp
                                                                  |
                                                                  v
Notebook UI -> Python/LangChain -> Ollama/Qwen cùng runtime Colab
                     |
                     +-> E5 / FAISS snapshot
                     +-> catalog / metadata / web tools theo mode và policy
                     |
                     v
             kết quả + sources + báo cáo
                     |
                     v
      kiểm lại qua backend trước khi dùng trên website
```

Kiến trúc dịch vụ trên máy/server dài hạn khi cần tích hợp website liên tục:

```text
React / Swagger -> NestJS auth/session/DTO/quota -> PostgreSQL/outbox
                         |
                         v
               RabbitMQ AI topology
                         |
                         v
       Python/FastAPI + AI worker -> Ollama + retrieval/tools
                         |
                         v
       staging -> validator/quyền/nguồn -> API trả kết quả
```

Notebook PoC không chạy consumer RabbitMQ thường trực. Chi tiết phương án Colab và đường dữ liệu tại mục 9.1–9.5.

Cấu trúc dự kiến, **chưa tạo**:

```text
apps/agent/
  app/api/                # health, internal boundary; không public trực tiếp
  app/schemas/            # input/output/tool contracts
  app/services/           # orchestration, policy, grounding
  app/tools/              # catalog, ratings, review-reference tools
  app/retrieval/          # embedding, hybrid search, FAISS snapshot
  app/providers/          # Ollama/TMDB/OMDb/DDGS adapters
  app/workers/            # AI queue consumer, indexing/enrichment
  tests/                  # provider mocks + acceptance datasets
apps/api/src/dto/          # assistant DTO riêng
apps/api/src/controllers/  # assistant/admin HTTP binding riêng
apps/api/src/services/     # permission, transaction, run ownership
docs/api/                 # hợp đồng và runbook khi triển khai
.local/agent/             # model/cache/index/log riêng tư, Git ignore
```

Các run API/queue/worker dưới đây thuộc phương án dịch vụ dài hạn; PoC Colab gọi module agent trực tiếp trong cell với snapshot và ghi rõ không kiểm quyền live.

NestJS không chờ giữ request HTTP suốt thời gian chạy model. Chọn job API trả 202, client polling có backoff; phù hợp client API hiện có timeout khoảng 20 giây. SSE/progress stream chỉ thêm ở giai đoạn sau và phải giữ auth, cancellation, buffering và proxy timeout đúng.

Python không nhận JWT trình duyệt, DB password, Cloudinary secret hoặc URL media có chữ ký. Kênh nội bộ xác thực service, bind loopback khi local; nhiều máy cần TLS/network policy và service identity. Job chỉ mang run ID, tenant/user reference tối thiểu và version, không mang credential hoặc nguyên review dài.

## 4. Thiết kế công cụ và vòng lặp agent

### 4.1. Tool allowlist

| Tool dự kiến | Input giới hạn | Output | Kiểm soát ngoài model |
| --- | --- | --- | --- |
| search_catalog | q, bộ lọc đã xác thực, topK | ID, metadata tối thiểu, evidence refs | SQL eligibility, giới hạn số ứng viên, không SQL tùy ý |
| search_movie_metadata | Tên/ID candidate, year/kind, sourceId | Candidate/detail có provenance | Adapter TMDB/OMDb, matching và policy; không tự ghi mapping |
| search_web | Query phim + mode/lang/date/source IDs đã kiểm | Result IDs, URLs/metadata được phép, retrievedAt | Explicit web option, provider/domain allowlist, budget và privacy |
| read_search_source | Result/reference ID trong run | Evidence cho field/đoạn được phép | SSRF/redirect/size limits, quyền display/storage/AI, không URL tùy ý |
| get_title_facts | titleId | Tên, năm, synopsis, genres/credits đã có | Title phải nằm trong scope của run và còn được phép đọc |
| get_personalization_context | Không nhận userId từ model | Sở thích thể loại tổng hợp | Chỉ bật sau opt-in, owner lấy từ phiên API; không gửi lịch sử chi tiết |
| get_external_ratings | mappingId/sourceId | Điểm gốc, scale, count nếu có, thời gian và nguồn | Mapping được xác minh, policy/quota/field allowlist |
| find_review_references | titleRef + nguồn được duyệt | Link/tiêu đề/tác giả/ngày nếu có | Domain allowlist, số kết quả hữu hạn; không fetch arbitrary URL |
| read_permitted_review | referenceId | Đoạn/text được phép dùng và evidence ID | Policy cho storage + AI/derivatives, length budget, spoiler |
| propose_entity_mapping | candidates đã lấy từ API | Đề xuất + evidence + uncertainties | Không cập nhật mapping hoặc tự duyệt |

Viewer không được gọi tool quản trị hoặc thấy bản nháp matching/review. Provider adapter giữ key phía server; model chỉ nhận schema, dữ liệu đã lọc và lỗi an toàn.

### 4.2. Các bước xử lý một yêu cầu

1. API kiểm phiên hiện hành, validation, quota, quyền tài nguyên; lấy owner từ phiên.
2. Ghi run, input có thời hạn lưu và outbox; trả run ID + Location.
3. Worker claim lease, kiểm hạn chót/cancel/owner/policy trước khi xử lý.
4. Xác định mục đích và bộ lọc. Giá trị có cấu trúc người dùng chọn là ràng buộc bắt buộc. Điều kiện model trích xuất từ câu tự nhiên là đề xuất phải validate; mơ hồ thì hỏi lại.
5. Gọi retrieval ban đầu theo luồng xác định để bảo đảm có bằng chứng, dù model quên gọi tool.
6. LangChain cấp đúng tool theo loại task. Model chọn tool, orchestrator kiểm schema/quyền/budget trước mỗi lần gọi; kết quả tool được coi là dữ liệu.
7. Sinh output có schema: answer, recommendedTitleIds, claims/evidenceRefs, warnings, uncertainties.
8. Validator kiểm schema, ID, evidence, policy, freshness và tính nhất quán. Numeric ratings chỉ đi qua formatter xác định.
9. Kiểm lại eligibility và trạng thái phiên sau suy luận. Nếu nguồn/phim bị gỡ, hủy kết quả cũ hoặc tạo lại có giới hạn; không chỉ bỏ thẻ phim nhưng vẫn để câu trả lời lộ nội dung.
10. Lưu kết quả hợp lệ, trả qua API có kiểm ownership; frontend render text an toàn và liên kết do server dựng.

Giới hạn thử ban đầu: tối đa 4 lượt gọi model, 6 tool calls tổng cộng, 1 lần sửa output sai schema, context 4.096 token, output tối đa khoảng 600 token, 1 inference đồng thời. Mọi lần sửa/retry tính chung trong budget; không chạy thêm vô hạn.

Deadline tổng dự kiến 120 giây cho inference local, cấu hình riêng cho mỗi provider call và thời gian chờ queue. Đây là cấu hình để benchmark, không phải cam kết latency. Timeout ở orchestrator phải kèm hủy lời gọi HTTP khi hỗ trợ; lease/generation ngăn kết quả đến muộn ghi đè, watchdog xử lý task không hủy được.

Không lưu hoặc công khai chain-of-thought. Lưu tên tool, trạng thái, evidence references, phiên bản và lý do ngắn phục vụ audit/diagnostics.

## 5. Thuật toán retrieval và gợi ý

### 5.1. Chuẩn hóa và embedding

- Giữ bản gốc tiếng Việt để hiển thị/embedding; tạo bản chuẩn hóa lower-case, dấu và khoảng trắng cho keyword matching như catalog hiện có.
- Document gồm title ID, tên gốc/tên Việt/alias, synopsis có giới hạn, thể loại và credits phù hợp; loại secret, URL phát và private metadata.
- E5 dùng prefix `query: ` cho câu hỏi, `passage: ` cho document; normalize vector. Model card mô tả 384 chiều và giới hạn input trong ví dụ 512 token; tokenizer thực tế là nguồn kiểm độ dài.
- Không chunk review rồi coi thành nhiều phim độc lập. Lưu titleRef/documentRef/sourceRef và content hash cho từng chunk.
- Version khóa theo embedding model/revision, tokenizer, dimensions, normalization và preprocessing. Thay các thành phần này tạo index mới, không trộn vector cũ/mới.

### 5.2. Hybrid retrieval

1. SQL lọc publication/playability và các điều kiện cứng như kind/year/country/genre.
2. Nhánh keyword lấy exact/alias/prefix hoặc text search có cấu hình tiếng Việt được đo; không gọi search substring hiện có là BM25.
3. Nhánh semantic tìm top-K trên tập eligible. PoC nhỏ dùng exact cosine với normalized vectors/FAISS IndexFlatIP; không bắt đầu bằng ANN khi chưa cần.
4. Hợp ID bằng Reciprocal Rank Fusion:

```text
RRF(item) = sum_over_lists( weight(list) / (k + rank(item, list)) )
```

Khởi đầu thử k=60, trọng số hai nhánh bằng nhau; đây là giả thuyết cần đánh giá. Exact title match có thể ưu tiên bằng quy tắc riêng. Không cộng trực tiếp cosine, điểm IMDb và lượt xem vì khác thang đo.

5. Nếu opt-in, cộng tín hiệu tương đồng thể loại từ watchlist của chính owner với hệ số nhỏ đã cấu hình, rồi đa dạng hóa bằng MMR hoặc giới hạn phim quá giống nhau.
6. Lấy tối đa 5–10 phim cho câu trả lời. Không đủ phim phù hợp thì trả ít hơn và nói rõ; không ép đủ K bằng phim draft hoặc sai bộ lọc.

Nếu index toàn kho rồi lọc sau top-K, có thể bỏ sót phim hợp lệ. MVP nhỏ xây tập candidate hợp lệ trước; kho lớn cần filter-aware index/partition hoặc chiến lược tăng K có giới hạn kèm exact fallback. Nếu tạm giới hạn catalog scan, response phải nêu phạm vi và có `truncated`, không tự nhận đã tìm toàn kho.

### 5.3. Đồng bộ và vô hiệu hóa index

Publish/update/unpublish tạo event versioned qua outbox cùng transaction; consumer AI riêng có inbox/idempotency. Worker đọc metadata qua boundary được giới hạn, kiểm eligibility trước embedding và trước promotion index.

Index snapshot gồm manifest + vectors + ID mapping + checksum; build sang generation mới, verify rồi atomic switch. Không load pickle/object deserialization từ file không tin cậy. File index cũng cần kiểm nguồn/hash, không coi binary index là an toàn tự động.

Publication thu hồi phải được chặn tại API ngay cả khi index chưa cập nhật. Có reconciliation/backfill theo watermark để sửa event bị trễ, retention/purge xóa cả text, embedding và derivatives. Stale index không phải quyền truy cập.

### 5.4. Cold start và fallback

- Catalog ít metadata: hỏi điều kiện rõ hơn, dùng keyword/thể loại; không hứa hiểu sâu phim không có synopsis.
- User mới/không opt-in: gợi ý theo câu hỏi, không suy đoán hồ sơ.
- Không có kết quả: gợi ý bỏ bộ lọc, không bịa tên phim.
- Ollama lỗi: trả lỗi dịch vụ rõ ràng; có thể hiển thị kết quả search xác định với nhãn riêng. Không ghi đó là câu trả lời của Qwen.
- Không đưa độ tương đồng vector thành “xác suất người dùng thích 95%”.

### 5.5. Search trong kho, metadata provider và web

Khả năng search là một nhánh có công cụ riêng của agent, ngoài retrieval phục vụ gợi ý. **Thiết kế bổ sung ngày 13/11/2026; chưa code hoặc bật truy cập web ở runtime.**

| Phạm vi | Ví dụ yêu cầu | Nguồn và đầu ra |
| --- | --- | --- |
| CATALOG | “Tìm phim Hàn về gia đình trong web này” | Keyword + semantic trên phim eligible; trả thẻ có liên kết nội bộ |
| METADATA | “Phim tên X năm 2020 của đạo diễn nào?” | TMDB/OMDb adapter theo quyền; matching trước khi lấy chi tiết, có nguồn |
| WEB | “Tìm các bài review mới về phim X” | Web search/discovery và đọc nguồn được phép; trả link, thời gian, evidence |
| HYBRID | “Tìm review phim X và xem web mình có phim đó không” | Search nguồn ngoài + đối chiếu catalog; phân biệt thông tin ngoài kho với phim xem được |

Giao diện có lựa chọn **Trong kho / Trên web / Kết hợp**. Trường mode dự kiến gồm CATALOG, WEB, HYBRID, AUTO; METADATA là loại tool bên trong nhánh nguồn ngoài, không cần thêm chế độ UI.

CATALOG là mặc định. AUTO chọn kế hoạch theo intent nhưng chỉ được dùng nguồn ngoài khi người dùng đã bật tùy chọn web cho lượt hỏi và hệ thống cho phép; không vì tìm nội bộ không thấy mà tự gửi nguyên câu hỏi ra bên ngoài. WEB/HYBRID thể hiện rõ việc dùng dịch vụ ngoài. Tool vẫn bị giới hạn ở chủ đề phim và nguồn được duyệt.

### 5.6. Search router và lập truy vấn

1. Xác thực mode/opt-in/source policy và budget trước khi hỏi model lập kế hoạch.
2. Tách ý định: tìm tên phim, tìm theo nội dung, diễn viên/đạo diễn, metadata, rating, review hoặc thông tin mới. Bộ lọc UI luôn là ràng buộc cứng; title/năm/kind trích từ câu hỏi cần validate.
3. Ưu tiên exact name/alias hoặc ID đã xác minh để nhận diện phim; nếu trùng tên/remake thì hỏi lại hoặc trình bày candidates, không ghép theo tên duy nhất.
4. Sinh tối đa 2 truy vấn trong một lượt, ví dụ tên gốc + năm + review; có thể một truy vấn tiếng Việt và một tiếng Anh khi phù hợp. Chỉ gửi thông tin phim cần thiết, không gửi user ID, token, watchlist/lịch sử hoặc toàn bộ hội thoại.
5. API metadata ưu tiên lookup ID đã khớp; search chỉ tạo candidates. TMDB có luồng search movie/TV/person rồi lấy details; OMDb hỗ trợ search theo tên, type/year/page nhưng không được coi là tìm ngữ nghĩa hay full-review search. Tham khảo [TMDB search workflow](https://developer.themoviedb.org/docs/search-and-query-for-details), [OMDb parameters](https://www.omdbapi.com/).
6. Web adapter nhận query và source IDs từ allowlist phía server. DDGS là ứng viên PoC, chỉ bật sau kiểm compatibility/điều kiện sử dụng; tách interface để đổi sang search API có key khi cần. Không hardcode giới hạn miễn phí hoặc coi đổi provider là cách vượt rate limit.
7. Giới hạn mở rộng truy vấn và mọi retry nằm chung budget; query expansion không được bỏ điều kiện “trong kho”, năm/kind hoặc tránh spoiler. Ngoài chủ đề phim trả hướng dẫn phù hợp, không chuyển thành agent browsing tổng quát.

Nếu hỏi “mới nhất”, dùng khoảng thời gian có mốc/ngày và múi giờ rõ, phân biệt ngày xuất bản/cập nhật/truy xuất. Search provider có thể thiếu ngày hoặc hiểu bộ lọc thời gian khác nhau; không tự gán publishedAt bằng retrievedAt hoặc hứa bao phủ mọi bài mới.

### 5.7. Hợp kết quả, xếp hạng và đọc nguồn

Pipeline dự kiến:

```text
intent + explicit mode/filters
  -> query plan được validate
  -> catalog retrieval / metadata API / web discovery theo scope
  -> chuẩn hóa URL và khử lặp
  -> matching entity + ranking
  -> đọc tối đa một số nguồn được phép
  -> đối chiếu claim/evidence
  -> câu trả lời + kết quả search + nguồn + cảnh báo độ phủ
```

- Chuẩn hóa URL HTTPS, host/path, loại tracking đã biết; không bỏ bừa query parameter làm đổi bài. Canonical/redirect là dữ liệu không tin cậy, phải kiểm lại đích.
- Dedup theo provider ID/canonical URL, rồi content hash khi được phép fetch; bài đăng lại không được tính là nhiều bằng chứng độc lập. Giữ provenance của các nguồn đã hợp.
- Catalog dùng hybrid tại mục 5.2. Search web xếp theo entity đúng tên/năm/kind, độ liên quan, nguồn gốc trực tiếp/độ tin cậy biên tập, độ mới theo câu hỏi, ngôn ngữ và đa dạng domain. Có thể RRF các danh sách provider rồi rerank theo quy tắc; hệ số và ngưỡng cần benchmark, không lấy vector score làm xác suất.
- API/provider chính thức phù hợp cho metadata/score; bài review chỉ thể hiện quan điểm của tác giả. Không để một snippet nổi bật sửa điểm số có nguồn hoặc biến ý kiến thành sự thật.
- Kết quả search ban đầu chỉ là DISCOVERY_ONLY. Chỉ các field đã đọc/xác minh qua API hoặc nguồn được phép mới có evidence VERIFIED_FOR_FIELDS; trạng thái này không khẳng định toàn bộ bài đúng. Snippet không đủ để tuyên bố agent đã đọc hoặc tóm tắt toàn bài.
- Tool đọc nguồn chỉ nhận result/reference ID do server cấp trong run, không nhận URL tự do từ model. Fetcher kiểm domain, DNS/IP, mỗi redirect, content type, timeout và kích thước sau giải nén; không thực thi script hoặc tải file executable.
- Discovery/link permission, display/storage permission và AI/derivatives permission kiểm riêng. Link được search thấy không mặc nhiên cho phép đọc toàn bài, embedding hoặc summary; nguồn không cho đọc thì chỉ hiển thị reference hợp lệ.
- Phim ngoài kho có externalId và availableOnPlatform=false; chỉ gán localTitleId/liên kết Xem sau khi khớp và kiểm eligibility hiện hành. Không tự nhập phim, tải video hoặc lấy URL streaming bên ngoài.
- Khi các nguồn bất đồng, trả giá trị/ý kiến theo từng nguồn với ngày và uncertainty; không chọn số cao nhất hoặc lấy trung bình các score khác thang.

### 5.8. Hợp đồng search, cache, UX và fallback

Dùng chung POST /assistant/runs và GET run tại mục 8, không tạo endpoint search trùng để bỏ qua auth/quota. Input bổ sung dự kiến:

| Field | Quy tắc |
| --- | --- |
| mode | CATALOG, WEB, HYBRID hoặc AUTO; mặc định CATALOG |
| allowExternalSearch | Mặc định false; WEB/HYBRID yêu cầu true và feature/policy cho phép |
| language | vi/en/auto theo allowlist, không tự dịch tên riêng làm đổi entity |
| sourceIds | Chỉ chọn từ source registry đã được phép; không nhận host/URL tùy ý |
| publishedAfter/publishedBefore | Ngày ISO hợp lệ, khoảng có thứ tự; provider không hỗ trợ phải trả cảnh báo |
| responseFormat | ANSWER hoặc SEARCH_RESULTS; cả hai vẫn kiểm nguồn/quyền |
| limit | Giữ 1–10 kết quả theo DTO, ngân sách tối đa do server quyết định |

Output bổ sung: searchModeUsed, searchStatus COMPLETE/PARTIAL/EMPTY, normalizedQuery, appliedFilters, searchResults[], sources[], warnings[] và truncated. COMPLETE nghĩa hoàn tất kế hoạch giới hạn của run, không phải đã tìm hết Internet. Đây là metadata của kết quả, không thêm state mới vào run state machine.

Mỗi search result dự kiến có resultId, type CATALOG/METADATA/WEB, title, safeUrl, sourceId/domain, language, publishedAt nullable, retrievedAt, evidenceLevel, citationRefs, availableOnPlatform và localTitleId nullable. Nội dung excerpt chỉ trả khi policy cho phép; không ép field không có thành dữ liệu giả. Citation trỏ đúng evidence/URL đã dùng cho từng claim.

Budget PoC đề xuất: tối đa 2 query ngoài/run, 5 discovery results/query, dedup rồi tối đa 2 trang được phép đọc, timeout mỗi search/fetch khoảng 8 giây và tổng phần search khoảng 25 giây. Các giới hạn con nằm trong 6 tool calls/deadline tổng tại mục 4.2, không cộng thêm một ngân sách ngầm. Đây là thông số thử, cần điều chỉnh theo số đo và quota nguồn.

Cache chỉ những field được phép; khởi điểm đề xuất TTL metadata 24 giờ, discovery 15 phút, nội dung đọc theo policy riêng, kết quả rỗng 60 giây. Key gồm normalized query, mode, language/date/source/filter, policy/mapping version và scope owner khi có cá nhân hóa. TTL không thay thế quyền nguồn; thu hồi phải vô hiệu ngay, không chờ hết TTL. Không cache công khai prompt chứa thông tin cá nhân, không lưu search query đầy đủ vô hạn.

UI hiển thị chế độ search, tiến độ Đang tìm nguồn/Đang đối chiếu, nút hủy và danh sách nguồn có ngày. Tách “Phim có trên pj-Flim” với “Thông tin trên web”; luôn giữ câu hỏi/bộ lọc khi lỗi. Nguồn không đọc được phải ghi rõ, không hiện nhãn “đã kiểm chứng” chung chung.

Fallback theo mode: CATALOG không phụ thuộc Internet; HYBRID có thể trả kết quả nội bộ cùng PARTIAL + warning nếu web lỗi; WEB không có nguồn hợp lệ thì trả lỗi an toàn hoặc EMPTY/PARTIAL đúng bằng chứng, không dùng kiến thức cũ của LLM rồi gắn nhãn vừa search. 429/5xx có retry hữu hạn/circuit breaker, không chuyển provider ngoài policy; cache cũ chỉ dùng nếu vẫn có quyền và ghi thời điểm/stale rõ ràng.

## 6. Nguồn ngoài, rating và review

### 6.1. Pipeline dữ liệu

```text
source policy approved -> provider API -> staging -> normalize/validate
  -> mapping verified -> atomic promotion -> evidence store
  -> optional AI draft -> người có quyền review -> publish theo workflow riêng
```

Pipeline ingest chạy nền theo lịch/admin task, không tải lại toàn bộ review mỗi lượt chat. Agent đọc dữ liệu đã kiểm chứng; một số lookup theo yêu cầu chỉ bật với source/policy/budget cụ thể. Key không được gửi vào prompt, browser hoặc query log.

| Nguồn | Kế hoạch sử dụng | Điều kiện/giới hạn |
| --- | --- | --- |
| TMDB | Metadata, external-ID matching, review references/content theo quyền | Key, attribution, quyền use case thực tế; developer API miễn phí dành cho phi thương mại theo FAQ |
| OMDb | Lookup theo IMDb ID để lấy trường rating mà response/gói thực tế có | Xác minh response với key trước; N/A giữ null, không coi OMDb là IMDb chính thức hoặc review API |
| IMDb trực tiếp | Dataset rating/metadata hoặc licensed feed khi được phép | Dataset công khai không cung cấp full review text; không mặc định có quyền sản phẩm User Reviews |
| Metacritic | Điểm có nguồn qua adapter được phép; Origin/licensed feed khi có entitlement | Phân biệt score, quote và toàn bài; không scrape để bù thiếu API/key |
| DDGS/search | Phát hiện URL từ domain allowlist | Kết quả search là manh mối, không phải bằng chứng đã đọc bài; không cam kết số request miễn phí ổn định |
| Publisher khác | Link/đoạn được phép; ưu tiên nguồn có API/feed/permission rõ | Kiểm quyền storage/display/AI, attribution, region và take-down theo từng nguồn |

TMDB có điều kiện thương mại/attribution; OMDb công bố CC BY-NC 4.0 trên trang chủ. Đó là căn cứ để lập checklist, không phải kết luận pj-Flim đã đủ quyền dùng mọi field vào sản phẩm thương mại hoặc AI. Tiếp tục dùng ma trận EXT01 trước khi bật từng nguồn.

### 6.2. Entity matching

Ưu tiên ID đã xác minh → cross-reference IMDb/TMDB chính thức → danh sách candidate theo tên/năm/kind. Với candidate, so tên gốc/alias, năm, quốc gia và người tham gia; phân biệt movie/series/season/episode/remake.

LLM chỉ giải thích candidate, không phát minh ID. Candidate không rõ scope hoặc có nhiều phim tương đương chuyển trạng thái NEEDS_REVIEW. Ngưỡng scoring và quy tắc tự ghép chỉ được chốt sau bộ nhãn matching; không dùng confidence tự báo của model để tự ghi mapping.

Đổi mapping tăng generation; run đang dùng generation cũ không được promotion. Không gộp điểm season vào series hoặc điểm critic thành audience score.

### 6.3. Chuẩn dữ liệu và grounding

Rating lưu nguồn, entity scope, giá trị gốc, thang điểm, vote count nullable, collectedAt, providerUpdatedAt nếu có, mappingVersion và policyVersion. Không gán null/N/A thành 0, không lấy age_rating của catalog làm điểm IMDb, không gọi điểm OMDb truyền lại là nguồn IMDb trực tiếp.

Review reference lưu URL chuẩn hóa, provider review ID, tác giả/ngày/ngôn ngữ nếu có, spoiler UNKNOWN nếu thiếu, quyền cho từng field, content hash và hạn sử dụng. Full text chỉ lưu khi quyền cho phép, tách khỏi reference và có retention.

Mỗi claim do AI tạo cần evidence refs và phạm vi hỗ trợ. Quote phải đối chiếu đúng đoạn, không dịch rồi gắn là trích nguyên văn. Summary ghi rõ mẫu/nguồn/số review đã xử lý; không gọi vài review thu thập được là đồng thuận toàn bộ khán giả.

Không cho viewer trực tiếp đọc draft/admin evidence nhạy cảm. Những field không được dùng cho AI không được embedding, tóm tắt hoặc đưa vào prompt dù được phép hiển thị nguyên bản.

## 7. Database và trạng thái công việc dự kiến

Schema hiện có50bảng; baselineSQL47bảng là lịch sử trước migration recommendations. Lượt này không đổi database. Khi triển khai assistant, dùng migration SQL/grants có phiên bản theo workflow hiện hành; không tự db push. Những tên dưới đây cần đối chiếu EXT02 để tránh tạo hai schema cho cùng dữ liệu.

| Quan hệ dự kiến | Mục đích và ràng buộc chính | Giai đoạn |
| --- | --- | --- |
| assistant_runs | owner, task, trạng thái, deadline, generation, input/result refs có retention, model/prompt/index version | MVP |
| assistant_run_steps | Tool name/status/timing/evidence refs; unique(runId, generation, stepNo), không lưu chain-of-thought | MVP |
| ai_index_snapshots | Model/revision/preprocessing, dimensions, generation, checksum, watermark, trạng thái active | MVP |
| ai_index_documents | titleRef/documentRef/contentHash/version/tombstone; không phải nguồn quyền | MVP |
| assistant_preferences | Opt-in/version; owner-only; có thể hợp nhất preferences của REC01 | Khi cá nhân hóa |
| external_sources + source_policies | Allowed uses/fields, expiry, attribution, quota/policyVersion | EXT01–EXT02 |
| external_title_mappings | local entity + source ID/scope, generation, evidence, reviewer | EXT02 |
| external_rating_snapshots | Score/scale/count/scope/provenance/freshness | EXT02–EXT03 |
| external_review_references | Review IDs/links/rights, text ref khi được phép | EXT02–EXT03 |
| external_ingestion_runs | Provider run, receipt/dedup, staging/promote/error | EXT02–EXT03 |
| ai_content_drafts | Claims/evidence/uncertainties/AI label/status; không tự thành nội dung public | Nhánh admin |

Index theo owner+createdAt/id cho danh sách run, state+deadline/lease cho claim, source+externalId+scope cho mapping, run+stepNo và document+version/hash cho dedup. Kích thước input/output JSON có giới hạn; TTL/job cleanup được thiết kế cùng bảng, không để prompt/chat tăng vô hạn.

State machine:

```text
QUEUED -> RUNNING -> SUCCEEDED
                  -> NEEDS_INPUT
                  -> FAILED
                  -> TIMED_OUT
QUEUED/RUNNING -> CANCELLED
```

NEEDS_REVIEW thuộc draft/admin workflow, không coi là SUCCEEDED đã công khai. Claim có lease owner, leaseUntil và generation/fencing token. Sau crash, worker khác chỉ tiếp tục với generation hợp lệ; kết quả cũ đến muộn bị từ chối.

RabbitMQ at-least-once: inbox/receipt unique event ID; outbox cùng transaction tạo run; ACK sau ghi kết quả bền. Không hứa exactly-once cho lời gọi provider: có thể bị gọi lại sau crash, phải có call budget và receipt/cache phù hợp.

Tách queue cho inference, indexing và external ingest; consumer model concurrency=1 lúc thử local, queue có độ dài/hạn chờ giới hạn. Retry exponential backoff+jitter cho lỗi tạm; không retry vô hạn với 401/403, sai schema hoặc policy hết quyền. DLQ giữ refs an toàn, không giữ secret/nguyên bài. Không dùng media publisher hiện tại như thể đã hỗ trợ event AI.

## 8. REST API, DTO, error code và phân quyền

Các endpoint là **đề xuất**, chưa tồn tại trong OpenAPI/runtime. Không tăng số API đã triển khai trong README chỉ vì có bảng này.

| Method/path dự kiến dưới /api/v1 | Quyền | Thành công | Hành vi |
| --- | --- | --- | --- |
| POST /assistant/runs | User ACTIVE, phiên hợp lệ, quota | 202 + Location | Tạo run; Idempotency-Key bắt buộc, owner từ phiên |
| GET /assistant/runs | Owner | 200, data/page | Cursor buộc owner và filter; không trả prompt đầy đủ trong danh sách |
| GET /assistant/runs/:id | Owner | 200 | Trạng thái hoặc kết quả đã kiểm; ID của người khác trả 404 |
| DELETE /assistant/runs/:id | Owner | 204 | Hủy có tính idempotent; GET sau đó thấy CANCELLED; không có nghĩa xóa toàn bộ dữ liệu |
| GET /me/assistant-preferences | Owner | 200 + ETag | Đọc opt-in |
| PUT /me/assistant-preferences | Owner | 200 + ETag | If-Match, tắt cá nhân hóa vô hiệu hóa job/cache thích hợp |
| POST /admin/ai-research-runs | Permission mới được migration | 202 + Location | Chạy matching/discovery/summary giới hạn theo source/task |
| GET /admin/ai-research-runs/:id | Permission + phạm vi admin | 200 | Run/draft đã redaction |
| PATCH /admin/external-mappings/:id | Permission quản trị mapping | 200 + ETag | Quyết định của người có quyền; If-Match, reason và audit |
| PATCH /admin/ai-content-drafts/:id | Permission review/publish tương ứng | 200 + ETag | Chuyển trạng thái hợp lệ; kiểm quyền nguồn và evidence lần nữa |

Admin endpoints phải hợp nhất với EXT07, không tạo route thứ hai trùng chức năng. Các permission AI mới cần chốt tên và mapping role qua migration/seed; không suy ra đã có trong 18 permission hiện hành. MEMBER không có quyền nghiên cứu admin; AUDITOR chỉ xem dữ liệu log được redaction. Mutation admin ghi audit cùng transaction; lỗi audit phải rollback.

DTO dự kiến:

- CreateAssistantRunDto: message 2–1.000 ký tự không toàn khoảng trắng; optional structured filters kind/genre/year/country; limit 1–10; avoidSpoilers mặc định true; useWatchlist mặc định false.
- Không nhận ownerId, role, raw SQL, model arbitrary, URL fetch tùy ý, provider key hoặc prompt hệ thống từ client.
- Server tự dựng system prompt/tool list và model allowlist. Phản hồi gồm runId/status, answer, cards, sourceRefs, warnings, uncertainty, scope/truncated, personalizationUsed và version metadata an toàn.
- Sửa filter phải tạo run mới. Follow-up NEEDS_INPUT liên kết parentRun theo owner và TTL; không cho client chèn role system/tool hoặc history giả có quyền.
- Structured filters và preference không đồng nghĩa giới hạn tuổi hợp pháp. Nếu thêm tài khoản trẻ em, cần policy độ tuổi và metadata đáng tin riêng; age rating thiếu không được tự suy từ LLM.

| Mã lỗi mới dự kiến | HTTP | Ý nghĩa | Retry |
| --- | --- | --- | --- |
| AGENT_UNAVAILABLE | 503 | Runtime/model không sẵn sàng | Có, backoff |
| AGENT_QUEUE_FULL | 429 | Hàng chờ inference đạt giới hạn | Có, Retry-After |
| AGENT_TIMEOUT | 504 | Inference vượt deadline | Có giới hạn, không tự nhân đôi run |
| AGENT_BAD_RESPONSE | 502 | Output upstream không qua schema/grounding | Không tự retry từ browser |
| AGENT_CONTEXT_CHANGED | 409 | Catalog/policy thay đổi trong khi chạy | Tạo lại run nếu còn được phép |
| AGENT_SOURCE_NOT_ALLOWED | 403 | Tool/nguồn/use case chưa được phép | Không |
| AGENT_RUN_EXPIRED | 410 | Run/kết quả đã hết retention | Không |
| AGENT_RUN_STATE_CONFLICT | 409 | Chuyển trạng thái không hợp lệ | Theo trạng thái hiện tại |

Dùng lại VALIDATION_FAILED 422, AUTHENTICATION_REQUIRED 401, AUTH_FORBIDDEN 403, RESOURCE_NOT_FOUND 404, RATE_LIMITED 429 và mã idempotency hiện hành đúng nghĩa. Lỗi API vẫn application/problem+json với code/requestId/retryable; không trả raw Python traceback/prompt/provider response. Lỗi nền nằm trong safe error object của run sau 202; GET trạng thái vẫn 200, không giả thành HTTP 504 sau khi response tạo run đã kết thúc.

Swagger bổ sung tags/schema/auth/header/status/example khi thực sự code. Local Swagger mở theo policy hiện tại, nhưng endpoint AI vẫn xác thực. Internal FastAPI docs không được tự mở công khai.

## 9. Cấu hình runtime và kế hoạch Google Colab

Cấu hình dịch vụ máy/server dưới đây là dự kiến; notebook PoC đã có theo mục16–17 và runbook apps/agent, chưa phải service website. PoC Colab đặt cấu hình trong runtime/secret store; .env.agent.local dành cho phương án chạy máy/server sau này:

| Biến/nhóm | Kế hoạch |
| --- | --- |
| AGENT_RUNTIME | colab_interactive cho PoC; service cho máy/server dài hạn |
| AGENT_ENABLED | Mặc định false đến khi nghiệm thu |
| AGENT_PROVIDER / AGENT_MODEL | ollama / qwen2.5:7b |
| OLLAMA_BASE_URL | 127.0.0.1 trong cùng runtime Colab/host dịch vụ; không trỏ nhầm PC, không nhận từ request |
| OLLAMA_MODELS / model cache | PoC dưới workspace /content/pj-flim-agent; Drive checkpoint tùy chọn; máy/server dùng .local/agent |
| AGENT_INTERNAL_TOKEN | Sinh ngẫu nhiên khi triển khai, tối thiểu 64 ký tự; không ghi vào plan/Git |
| AGENT_EMBEDDING_MODEL | intfloat/multilingual-e5-small + revision khóa sau PoC |
| AGENT_CONTEXT / MAX_OUTPUT / concurrency | Khởi điểm 4096 / khoảng 600 / 1; đo rồi điều chỉnh |
| Deadline/tool/request budgets | Cấu hình hữu hạn, bao gồm retry và queue wait |
| External source flags/keys | Tắt mặc định; key lưu local/server, policy và quyền kiểm riêng |
| Tracing | Không gửi prompt/review đến cloud tracing mặc định |

Phương án dự phòng chạy máy cá nhân, chưa ưu tiên: khảo sát sơ bộ RAM khoảng 16 GB, tên GPU NVIDIA RTX 3050 6GB Laptop; AdapterRAM qua CIM không đáng tin để xác nhận chính xác VRAM. Cần kiểm driver/VRAM bằng công cụ phù hợp khi thử. Tên GPU/RAM không phải bằng chứng inference đạt tốc độ mong muốn.

Trang Ollama mô tả tag qwen2.5:7b khoảng 4,7 GB, Q4_K_M tại thời điểm tra cứu; đó là file model, không phải tổng RAM/VRAM cần dùng. Runtime, KV cache, embedding và các dịch vụ web/DB cần thêm bộ nhớ/ổ đĩa. Không dùng context tối đa 128K trong PoC trên máy này.

Trước lúc người dùng làm rõ chỉ lập kế hoạch, đã thử runtime Python portable và bị Windows Application Control chặn. Các file code thử và thư mục tải/runtime riêng của thử nghiệm đã được gỡ. Khi bắt đầu triển khai sau này, kiểm phương án Python chính thức được máy cho phép, không tắt/bypass policy. Ollama/model vẫn chưa được cài và nghiệm thu trong công việc này.

Môi trường ưu tiên được thay bằng Colab tại các mục dưới; không cài Python/Ollama Windows để hoàn tất kế hoạch. Chưa tạo notebook, tải model, mount Drive hoặc thay runtime trong lượt này.

### 9.1. Môi trường ưu tiên: Google Colab tương tác

**Quyết định mới ngày 13/11/2026:** chuyển môi trường thử agent từ máy Windows sang Google Colab. Giữ Qwen2.5:7b + Ollama + LangChain, chạy trong cùng runtime notebook; Ollama bind 127.0.0.1 bên trong Colab. Các mục cấu hình local bên trên chỉ còn là phương án dự phòng/dịch vụ dài hạn.

Colab ưu tiên notebook tương tác, GPU và thời lượng không được bảo đảm. Free runtime hạn chế distributed workers và việc dùng web UI bên ngoài làm giao diện chính; không thiết kế queue consumer thường trực, API 24/7 hoặc thủ thuật giữ phiên. [Colab FAQ](https://research.google.com/colaboratory/faq.html)

PoC mặc định nhập câu hỏi/chạy test trực tiếp bằng cell notebook. FastAPI và worker dịch vụ ở mục 3 là phương án triển khai trên máy/server chuyên dụng sau này; Colab PoC dùng lại module Python/tools, không cần public server. Nếu có gói trả phí/Enterprise, phải kiểm chính sách/quota thực tế trước một phương án phục vụ khác, không coi việc mua gói là cam kết uptime.

Colab là máy Google: localhost trong notebook không trỏ về localhost:3000, ổ E: hoặc PostgreSQL trên máy người dùng. Ollama chạy trong runtime này không có nghĩa dữ liệu vẫn nằm trên PC. Metadata/review đưa lên phải có quyền xử lý trên cloud; dữ liệu cá nhân chỉ dùng khi có đồng ý riêng phù hợp, mặc định tắt cá nhân hóa trong PoC.

### 9.2. Phân bố thành phần và đường dữ liệu

| Nơi chạy | Thành phần dự kiến | Quyền/trách nhiệm |
| --- | --- | --- |
| Máy/server pj-Flim | NestJS, PostgreSQL, RabbitMQ và pipeline media | Auth/RBAC, source of truth, xuất dữ liệu tối thiểu và kiểm lại kết quả |
| Colab notebook | Python, LangChain/ChatOllama, E5, FAISS, tool adapters | Agent tương tác, inference/retrieval/search, benchmark |
| Cùng Colab runtime | Ollama + qwen2.5:7b | Inference model tải về, loopback riêng; không public port Ollama |
| Google Drive, tùy chọn | Model cache/index manifest/checkpoint/báo cáo được phép lưu | Lưu artifact có version/hash/expiry; không lưu credential/prompt riêng tư mặc định |
| API nguồn ngoài | TMDB/OMDb/search adapter | Dùng key/policy phù hợp với notebook/cloud; budget theo run vẫn áp dụng |

**Luồng A — mặc định, snapshot nhập/xuất thủ công:**

1. Khi triển khai AG16, công cụ backend xuất catalog đang eligible thành JSON có schema/version/hash, exportedAt và scope; chỉ lấy metadata tối thiểu. Chưa có exporter hiện hành.
2. Người dùng chủ động đưa JSON vào runtime Colab. Notebook kiểm schema, kích thước, hash/nguồn và thời hạn trước khi embedding.
3. E5/FAISS tạo index từ snapshot; LangChain gọi Qwen và các tool đã bật. Câu hỏi nhập/chạy trong notebook.
4. Kết quả ghi rõ snapshot time, phạm vi dữ liệu, sources và trạng thái chưa kiểm quyền live. Có thể xuất báo cáo an toàn về máy.
5. Mở/xem phim và mọi thao tác import kết quả phải qua backend hiện hành để kiểm ID/eligibility/owner/policy lại. Snapshot cũ không cấp quyền phát video.

JSON phải do quy trình được kiểm soát tạo ra; checksum chỉ phát hiện thay đổi khi hash gốc đáng tin. Nếu nhận artifact qua kênh không tin cậy, dùng chữ ký và kiểm provenance; không coi hash do chính người gửi cung cấp là chứng minh nguồn.

**Luồng B — tích hợp HTTP có kiểm soát, giai đoạn sau:** notebook đang được sử dụng tương tác gọi từng thao tác xuất context/kiểm kết quả qua HTTPS endpoint giới hạn của backend. Backend local cần một đường HTTPS truy cập được từ Colab, có auth và policy; E:/localhost không tự truy cập được. Chưa thiết lập tunnel/gateway, endpoint hoặc credential trong lượt lập kế hoạch.

Bản free không dùng luồng B để tự nhận hàng loạt job từ web, chạy polling worker nền hoặc làm API phục vụ website. Khi cần agent hoạt động liên tục cho người xem, chuyển cùng module sang VM/container/server có tài nguyên và policy phù hợp; API run/RabbitMQ của kế hoạch áp dụng ở môi trường đó.

Không public PostgreSQL/RabbitMQ, không copy JWT trình duyệt/DB/Cloudinary secret vào notebook. Nếu triển khai gateway sau này, credential thí nghiệm phải ngắn hạn, bound task/dataset, chỉ đọc scope được phép, thu hồi được; kết quả gửi về qua validator, không có quyền publish.

### 9.3. Notebook dự kiến và thứ tự cell

Artifact đề xuất: notebooks/movie-agent-colab.ipynb và hướng dẫn sử dụng cùng phiên bản. **Chưa tạo notebook/cell thực thi trong lượt này.**

| Cell | Nội dung sẽ triển khai | Kết quả cần quan sát |
| --- | --- | --- |
| 1 | Scope/privacy/source-policy và chế độ PoC | Xác nhận dữ liệu được phép, cách tắt external search |
| 2 | Kiểm runtime/GPU/VRAM/RAM/disk | Báo cáo phần cứng thực tế, không giả luôn có T4 |
| 3 | Cài dependency đã khóa, chuẩn bị module agent | Version report; không nâng toàn bộ package nền thiếu kiểm soát |
| 4 | Khởi động Ollama loopback, tải model theo tag/digest | Kiểm model/digest và GPU offload thật |
| 5 | Smoke tiếng Việt/tool calling/JSON | Output hợp schema và đo cold/warm timing |
| 6 | Nạp/kiểm snapshot catalog, policy và TTL | Đủ metadata/evidence, không có credential hoặc private fields |
| 7 | E5 embedding + FAISS index/version | Index manifest/hash và retrieval baseline |
| 8 | Hỏi agent trong notebook, chọn CATALOG/WEB/HYBRID | Search results/citations rõ, budget/consent được kiểm |
| 9 | Chạy bộ nhãn, lỗi nguồn, injection, cancel/reset | Báo cáo chất lượng/latency/failure, không gọi mock là live |
| 10 | Xuất artifact sạch, checkpoint và kết thúc phiên | Không secret trong notebook output; stop process do notebook tạo |

Ưu tiên Ollama để tái sử dụng ChatOllama/tool schemas trong kế hoạch. Transformers/quantization là phương án đánh giá sau nếu Ollama không phù hợp runtime; phải có kiểm tool calling/structured output tương đương trước khi đổi adapter.

### 9.4. Model, bộ nhớ, lưu artifact và khôi phục

- Thử qwen2.5:7b định lượng đã chọn với context 4096, output khoảng 600 token, concurrency 1. Ghi GPU/VRAM thực được cấp, kiểm offload bằng công cụ runtime; đo đủ cold load, warm inference và peak memory.
- E5/FAISS CPU là khởi điểm để dành GPU cho LLM. Nếu OOM, giảm context/batch, unload phần không dùng và báo rõ; thay model nhỏ hơn chỉ theo cấu hình được chọn và ghi đúng model thực tế.
- Đề xuất workspace tạm /content/pj-flim-agent cho dependency/model/index đang sử dụng. Drive checkpoint tùy chọn chỉ lưu artifact được phép, theo manifest/model digest/embedding revision/schema/content hash; không chạy trực tiếp từ file không rõ nguồn.
- Tách model weights có thể tải lại với dữ liệu nguồn có hạn dùng. Review/personalization/log cần retention riêng; quyền nguồn rút thì cả bản trên Drive và index/summary phải được purge hoặc chặn phục hồi.
- Sau reset, cell bootstrap tái lập môi trường từ version lock, nạp checkpoint đã kiểm, kiểm expiry/policy rồi mới phục vụ tương tác. Không giả toàn bộ RAM, process, env hoặc model đã nạp sẽ còn tồn tại.
- Checkpoint không chứa secret hoặc token; khóa API chỉ nạp khi cần từ secret store/cơ chế nhập kín phù hợp, không in cell output hoặc lưu vào Drive/Git.
- Notebook cần chạy lại bootstrap an toàn, nhận diện process/index của chính nó, tránh hai Ollama process/hai phiên embedding chiếm bộ nhớ. Không daemon/auto-click để giữ phiên Colab.

### 9.5. Tiêu chí nghiệm thu riêng cho Colab

1. Một notebook mới có thể bootstrap theo tài liệu; báo runtime/dependency/model digest đúng và có ít nhất một lượt Qwen tiếng Việt/tool/JSON chạy thật.
2. CATALOG chạy được bằng snapshot hợp lệ; WEB/HYBRID chỉ bật khi người dùng chọn và nguồn cho phép; citation/truncated/snapshot freshness đúng.
3. Không có GPU hoặc hết quota thì notebook báo tình trạng và lựa chọn phù hợp, không âm thầm giả đã chạy GPU/model khác.
4. Runtime reset khôi phục được artifact hợp lệ; snapshot/index thiếu, hết TTL, hash sai hoặc policy bị rút phải được từ chối/xử lý rõ.
5. Token/key không xuất hiện trong notebook JSON/output/báo cáo/Drive snapshot; không nối public DB/RabbitMQ hoặc public Ollama.
6. Kết quả từ snapshot không được gọi là kiểm quyền live. Đưa vào website cần backend revalidation và nghiệm thu dịch vụ dài hạn riêng.
7. Có benchmark catalog/search theo mục 12 với ngày, model, GPU, dữ liệu và giới hạn; không dùng health 200 hoặc notebook mở được để đánh dấu AG02/AG15/AG16 hoàn tất.

## 10. Bảo mật, quyền riêng tư và chất lượng

- Tool boundary là lớp kiểm soát chính. Prompt “không làm theo nội dung web” chỉ hỗ trợ; trang/review/tool output luôn là dữ liệu không tin cậy.
- Không cấp shell, arbitrary filesystem/network, quyền DB ghi hoặc chức năng publish cho model. Network adapter allowlist host/route, kiểm DNS/IP và redirect, chặn loopback/private/link-local/metadata với nguồn ngoài. Ollama loopback là kết nối hạ tầng cố định riêng, không đi qua tool fetch URL.
- Kiểm JWT/session/revocation và owner ở create/read/cancel; kiểm lại quyền khi worker bắt đầu và khi trả kết quả. Cache không chia sẻ kết quả cá nhân giữa owner; cache key gồm policy/catalog/index/model version.
- Budget theo user/session/service, queue bound và circuit breaker; client IP chỉ là tín hiệu bổ sung. Chưa có Redis thì không mô tả quota hiện hành là Redis phân tán; thiết kế dùng DB/quota hiện có cho PoC, đo write amplification.
- Không log secret, token, signed playback URL hoặc nguyên văn prompt/review theo mặc định. Log runId/requestId, timing, safe error, tool/status/version và evidence ID. Link query có key phải redaction.
- Source rights hết hạn/opt-out/take-down tăng generation, chặn run đang xử lý và purge text/embedding/summary/cache cần xóa. Restore backup phải áp dụng suppression trước phục vụ.
- Không fine-tune hoặc gửi dữ liệu cá nhân ra cloud khi chưa có quyết định riêng. Người dùng cần biết câu trả lời do AI tạo và có thể sai.
- Markdown/HTML từ nguồn/model được render theo allowlist hoặc plain text, chặn script và URL nguy hiểm. Liên kết nội bộ dựng từ ID đã kiểm, liên kết nguồn ngoài qua validator.
- Tách CPU/GPU/memory/time budget của AI khỏi playback/HLS; khi quá tải tắt agent hoặc giảm concurrency, không chặn player.

## 11. Công đoạn triển khai AG01–AG16

**IN_PROGRESS:** AG01/02/04/05/08/11/12/13/15/16. **NOT_STARTED:** AG03/06/07/09/10/14. Chưa có ticket DONE; code PoC không hoàn tất nghiệm thu model/Colab hoặc tích hợp website. Bảng dưới giữ điều kiện hoàn tất toàn ticket; tiến trình chi tiết tại mục16.

| Ticket | Công đoạn sẽ làm | Phụ thuộc | Đầu ra và điều kiện hoàn tất |
| --- | --- | --- | --- |
| AG01 | Chốt scope MVP, dữ liệu được phép, hợp đồng task/tool, privacy và tiêu chí benchmark | Kế hoạch này, hiện trạng REC/EXT | ADR/phạm vi, bộ nhãn và threat model, không lấy review ngoài quyền |
| AG02 | Môi trường Colab Python/Ollama Qwen, dependency lock và model smoke | AG01, runtime/quota được cấp | Chạy thật trong notebook, ghi GPU/model digest/tool/JSON/memory/cold-warm timing; không chỉ health 200 |
| AG03 | Thiết kế SQL migration/grants/run state/outbox và internal service contract | AG01 | Ownership, TTL/lease/generation/idempotency/audit được test trên DB tạm |
| AG04 | Retrieval baseline + E5/FAISS snapshot, sync/reconcile/purge | AG02 + metadata/snapshot contract; AG03 cho service | Keyword vs semantic vs hybrid so trên cùng bộ nhãn; không lộ draft; rebuild/revoke được thử |
| AG05 | Agent tools read-only, bounded orchestration, schema/evidence validators | AG02/AG04; AG03 cho service | Timeout/invalid JSON/bogus ID/injection/tool budget/cancel đúng, không bịa nguồn |
| AG06 | NestJS DTO/controller/service run API, quota, error registry và Swagger | AG03–AG05 | HTTP auth/IDOR/revocation/validation/idempotency/202 polling và safe errors đạt |
| AG07 | Cá nhân hóa opt-in từ watchlist, opt-out/reset/retention | AG06, phối hợp REC01 | Đổi tài khoản/tắt opt-in không dùng sở thích cũ; đo lợi ích so query-only |
| AG08 | Nguồn TMDB/OMDb, matching/evidence và external worker | AG03–AG06 + EXT01–EXT03/key/quyền | Schema/nullable/scope/429/replay/policy change; báo cáo live chỉ khi gọi thật có quyền |
| AG09 | UI người xem: ô hỏi, ví dụ câu hỏi, chờ/hủy, thẻ phim/nguồn/lỗi/opt-in | AG06; AG07 nếu bật cá nhân hóa | Mobile/keyboard, không mất câu hỏi, không polling vô hạn, không render HTML nguy hiểm |
| AG10 | Admin research/draft workflow, review discovery/summary có điều kiện | AG08 + EXT06–EXT07 và quyền AI | Người có quyền kiểm evidence/duyệt; review có nhãn AI/spoiler/freshness; không tự publish |
| AG11 | Nghiệm thu end-to-end/model thật, failure/load/security, runbook/rollout | AG06/AG09; AG08/AG10 khi phát hành nguồn ngoài | Báo cáo đo thực, rollback/kill switch/rebuild/retention; ghi rõ các nhánh chưa làm |
| AG12 | Search router CATALOG/WEB/HYBRID/AUTO, query planning và provider search adapters | AG01/AG03–AG06, nguồn/quyền phù hợp; AG08 khi dùng API metadata | Mode/opt-in/filter đúng; có search result schema/Swagger; không tự gửi dữ liệu cá nhân ra web |
| AG13 | Result dedup/ranking, safe fetch/evidence, cache/freshness và fallback | AG12, source policy registry; AG08 khi dùng mapping | Không tin snippet như full article, SSRF/policy revoke/cache sai scope được chặn, budget hữu hạn |
| AG14 | UI search mode/source panel và benchmark E2E search | AG09 + AG12–AG13 | Kết quả ngoài kho/nguồn/ngày/partial rõ; test mơ hồ, tiếng Việt, provider lỗi, cancel và claim citations |
| AG15 | Notebook tương tác theo mục 9.3, bootstrap/checkpoint/cleanup | AG02; module AG04/AG05 cho agent đầy đủ, AG12/AG13 khi bật web | Chạy cell từ phiên mới, không public API/queue worker, artifact sạch và reset recovery được kiểm |
| AG16 | Catalog snapshot export/import contract, cloud data minimization và backend revalidation | AG01 + catalog hiện có; AG03/AG06 cho tích hợp service/HTTP | Schema/hash/provenance/TTL/policy, không private fields/credentials, nguồn bị gỡ và cloud consent được thử |

Mốc bàn giao:

1. **PoC model Colab:** AG01–AG02, notebook AG15 ở phần bootstrap/model smoke; xác nhận runtime được cấp chạy được và tool/JSON đủ ổn định. Nếu không đạt, ghi blocker và điều chỉnh cấu hình theo quyết định tiếp theo.
2. **PoC agent trên Colab:** AG04/AG05/AG15 và snapshot AG16 khi dùng dữ liệu pj-Flim; nhập câu hỏi trong notebook. Các phần migration/service chỉ bắt buộc khi tích hợp backend.
3. **MVP website dài hạn:** AG03–AG06 + AG09 trên máy/server phù hợp; dùng metadata nội bộ, có thể chưa cá nhân hóa/nguồn ngoài.
4. **Cá nhân hóa nhẹ:** AG07 sau khi có ownership/opt-in và dữ liệu phù hợp.
5. **Nguồn ngoài/admin:** AG08 + AG10 khi EXT01–EXT03 và quyền nguồn đáp ứng.
6. **Search web/kết hợp:** AG12 → AG13 → AG14; cần policy/provider phù hợp, không bắt buộc có quyền tóm tắt toàn bài mới hiển thị được reference theo quyền.
7. **Phát hành:** AG11 theo đúng phạm vi đã đạt; thêm AG12–AG14 vào gate nếu bật search web. Không đợi tất cả nguồn trả phí mới nghiệm thu MVP catalog.

EXT06 vẫn NOT_STARTED; AG05 chỉ hoàn tất agent catalog, không tự hoàn tất agent nguồn review. REC01–REC09 vẫn theo backlog riêng; opt-in/watchlist không đồng nghĩa đã triển khai hybrid recommender học từ hành vi. ENC/ST không bị đổi trạng thái bởi tài liệu này.

## 12. Kế hoạch kiểm thử và tiêu chí nghiệm thu

Bộ benchmark dự kiến tối thiểu 60 câu tiếng Việt có nhãn: exact/alias/không dấu, ý định nội dung, điều kiện năm/quốc gia/thể loại, phủ định/mơ hồ, ngoài catalog, thiếu metadata và prompt injection. Có tập riêng cho title trùng tên/remake/series/episode. Không lấy kho chỉ vài phim kỹ thuật làm bằng chứng độ chính xác tổng quát.

| Nhóm | Trường hợp cần thử | Điều kiện |
| --- | --- | --- |
| Retrieval | keyword/semantic/hybrid, hard filters, zero vector, stale/missing index | Recall@K/NDCG@K có nhãn/protocol; cùng corpus/version, không tự gán nhãn bằng chính model được đánh giá |
| Grounding | ID bịa, điểm/scale sai, nguồn thiếu, citation không hỗ trợ claim | 100% card ID hợp lệ trong bộ test; claim không có căn cứ bị loại/đánh dấu; vẫn cần người đánh giá câu trả lời |
| Auth/RBAC | Thiếu token, owner khác, revoked giữa run, admin-only tools | Không lộ run/private draft; worker/output không vượt quyền |
| Workflow | Duplicate/crash/lease expiry/cancel/late completion/queue outage | Không promotion hai lần; không ghi đè generation; resource budget hữu hạn |
| External | 429/401/403/5xx, nullable, pagination, scope và policy đổi giữa run | Không nhập dữ liệu sai/ngoài quyền; giữ last-good chỉ trong hạn cho phép |
| UI/API | DTO/Swagger/problem errors, polling/backoff/hủy, XSS link/HTML | Frontend đến API đến worker/model được quan sát; browser không gọi Ollama trực tiếp |
| Search routing | CATALOG/WEB/HYBRID/AUTO, opt-in, query rewrite, filter/negation, thiếu quyền nguồn | Không vượt mode/consent/budget hoặc gửi dữ liệu cá nhân ra query ngoài |
| Search quality | Trùng tên/remake, vi/en, ngày thiếu/sai, bài đăng lại, snippet khác bài, nguồn bất đồng | Citation đúng field, dedup đúng, publishedAt không giả, external title không tự có nút Xem |
| Search resilience | Provider 429/5xx/offline, nguồn SSRF/redirect/XSS, cache stale/revoke, hủy giữa fetch | PARTIAL/EMPTY/lỗi đúng mode, không unbounded retry, không đọc ngoài policy hoặc trả kết quả run đã hủy |
| Colab lifecycle | Phiên mới/reset, GPU không có/OOM, cache/index hết hạn hoặc sai hash, cloud secrets/output | Bootstrap/checkpoint rõ; model/tool chạy thật, không phục hồi nguồn bị gỡ, không distributed worker/API public |
| Local model | Cold/warm load, context/output, GPU/CPU offload, 1 và nhiều yêu cầu | Báo cáo p50/p95, peak RAM/VRAM, timeout/queue wait; không suy từ kích thước model |
| Isolation | Vừa xem HLS vừa inference/indexing, provider/AI offline | Phát video vẫn dùng đường cũ; đo tác động, có kill switch |
| Privacy | Opt-out/delete/expiry/purge/rebuild/restore | Không hồi sinh dữ liệu bị gỡ hoặc dùng sở thích sai owner |

Ngưỡng retrieval/latency/chất lượng ngôn ngữ được chốt sau baseline AG02/AG04, trước nghiệm thu AG11. Không đặt sẵn con số “độ chính xác 95%” hoặc “phản hồi dưới 2 giây” khi chưa có mẫu và phép đo. Mục tiêu an toàn bắt buộc: không rò quyền, không thực thi tool ngoài allowlist, không tự xuất bản, mỗi lỗi/budget có đường kết thúc hữu hạn.

Test DB chỉ dùng database pj_flim_test_<random> do runner tạo; broker dùng topology test riêng. Provider fixtures không được gọi là live thành công; Qwen smoke thật phải ghi model digest/phiên bản/phần cứng/ngày và giới hạn. Không seed phim giả READY vào kho thật để làm đẹp kết quả.

## 13. Cách triển khai và rollback sau này

PoC ưu tiên notebook Colab tương tác theo mục 9.1–9.5. Khi đưa agent vào website dài hạn, dùng máy/server phù hợp với feature flag mặc định tắt → test cô lập → opt-in → nhóm nhỏ → mở rộng theo số đo. Không tự deploy/public port hoặc push Git chỉ vì xong PoC.

API/media hoạt động khi AI tắt. Runbook cần hướng dẫn: runtime không chạy, model chưa tải, thiếu bộ nhớ, queue kẹt, provider quota, index hỏng, policy hết hạn, replay DLQ có kiểm, cancel/timeout và rebuild.

Rollback giữ schema tương thích, tắt tạo run mới, hủy/drain có giới hạn các run còn lại, quay index/model/prompt version đã kiểm nếu vẫn đúng policy. Model weights/vector cache không commit Git; backup theo nhu cầu và quyền nguồn, index có thể dựng lại.

Bàn giao chỉ khi có code, migration, API spec, hướng dẫn local, kết quả kiểm thử và danh sách giới hạn đúng phạm vi. **Hiện bàn giao PoC notebook/source theo mục16; chưa dịch vụ AI tích hợp website.**

## 14. Nguồn tham khảo và điểm chưa xác minh

Tra cứu ngày 13/11/2026; kiểm lại trước khi cài package hoặc mở production.

- [Qwen2.5:7b trên Ollama](https://ollama.com/library/qwen2.5:7b): tag, định lượng/kích thước tham chiếu; tag có thể thay đổi nên deployment cần digest.
- [Colab FAQ](https://research.google.com/colaboratory/faq.html): điều kiện notebook/runtime; kiểm lại theo gói thực tế trước triển khai.
- [Ollama FAQ](https://docs.ollama.com/faq): cấu hình context, loopback và kiểm GPU offload.
- [Ollama Windows](https://docs.ollama.com/windows): native runtime, GPU/driver, cài và vị trí lưu model.
- [LangChain ChatOllama](https://docs.langchain.com/oss/python/integrations/chat/ollama): adapter, tool calling và structured output; phải thử với model/phiên bản cụ thể.
- [LangChain agents](https://docs.langchain.com/oss/python/langchain/agents): agent/tool loop và orchestration.
- [multilingual-e5-small model card](https://huggingface.co/intfloat/multilingual-e5-small): multilingual retrieval, prefixes, normalization và embedding.
- [FAISS repository](https://github.com/facebookresearch/faiss): thư viện tìm vector, không thay database/quyền.
- [TMDB FAQ](https://developer.themoviedb.org/docs/faq): key, attribution, phi/thương mại và SLA.
- [OMDb](https://www.omdbapi.com/): tham số API, mô tả nguồn và license công bố; coverage rating phải thử bằng credential phù hợp.
- [TMDB search workflow](https://developer.themoviedb.org/docs/search-and-query-for-details): search candidate rồi truy vấn chi tiết bằng ID phù hợp.
- [DDGS repository](https://github.com/deedy5/ddgs): metasearch tùy chọn; không suy ra quyền copy bài.
- [Nghiên cứu nguồn ngoài trong dự án](../design/external-ratings-reviews-research.md): IMDb/Metacritic/provider policy, matching, attribution, purge và nguồn gốc.
- [OWASP prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): thiết kế boundary cho dữ liệu/tool không tin cậy.

Chưa xác minh bằng chạy thật: notebook/runtime Colab, GPU/quota thực được cấp, Ollama/Qwen, tool calling tiếng Việt, embedding index/checkpoint/khôi phục, GPU offload/latency, snapshot/backend revalidation, mức cải thiện retrieval, key/coverage/quyền AI/cloud của nguồn ngoài và chất lượng summary. Không có kết quả mới về backend/frontend/worker hoặc model được công bố từ lượt lập kế hoạch này.

## 15. Bổ sung nghiên cứu nguồn review — phiên bản 1.3

Đối chiếu [nghiên cứu nguồn phiên bản 1.1](../design/external-ratings-reviews-research.md#9-kết-quả-rà-soát-bổ-sung-phiên-bản-11). TMDB/Trakt là adapter có điều kiện; OMDb không có review-list, không coi plot=full là review hoặc API trả phí là quyền upstream. IMDb User Reviews và summary là sản phẩm riêng; Metacritic/RT có tuyến Origin paid/approved. Letterboxd loại khỏi agent mặc định vì access policy hạn chế loại dự án này. Nguồn Việt Nam đi qua feed/quyền từng publisher, không tự crawl cả website.

Số điểm lấy và kiểm bằng adapter xác định; agent chỉ matching/discovery/draft có evidence. Source policy tách fetch/store/display/translate/summarize/embed/train/cloudTransfer; UNKNOWN không được tự bật. Đưa text tới Colab là chuyển dữ liệu ra runtime Google, cần quyền processor/region/use case tương ứng; license hiển thị không chứng minh quyền LLM/RAG. Mặc định PoC chỉ dùng catalog snapshot/metadata/reference được phép, không credentials hoặc raw review ngoài quyền.

Tools dự kiến resolve_title_candidates/fetch_source_ratings/discover_review_refs/read_allowed_review/draft_review_summary/verify_external_draft được mô tả tại nghiên cứu mục9.5; backend giữ auth/quota/fetch/validation, mapping mơ hồ và publish qua luồng quản trị có audit. Không bổ sung runtime/code/notebook trong lượt này; AG01–AG16 và EXT01–EXT08 giữ NOT_STARTED. Content-v1 hiện có là thuật toán độc lập, không được coi đã có LLM hoặc được phép học từ review ngoài.


## 16. Triển khai PoC Colab — phiên bản 1.4

Yêu cầu mới “giúp tôi build agent” ngày 13/11/2026 cho phép code PoC notebook tương tác. Mục 15 ghi lượt nghiên cứu trước đó. Không thay runtime API/media, database, auth, frontend hoặc RabbitMQ.

Bàn giao: [notebook 10 cell](../../notebooks/movie-agent-colab.ipynb), [Python source/runbook](../../apps/agent/README.md), [public exporter](../../scripts/export-agent-catalog.mjs), [báo cáo kiểm thử](../testing/colab-agent-2026-11-13.md).

| Ticket | Trạng thái | Phần đã có và phần còn thiếu |
| --- | --- | --- |
| AG01 | IN_PROGRESS | Scope/catalog/tool boundary; thiếu bộ nhãn benchmark/ADR phát hành |
| AG02 | IN_PROGRESS | Bootstrap Ollama/Qwen, direct pins/digest, tool/JSON smoke; chưa GPU/inference/Colab/transitive lock/benchmark |
| AG03 | NOT_STARTED | Chưa migration/grants/run state/outbox/internal service |
| AG04 | IN_PROGRESS | Keyword/E5/FAISS/RRF, filter trước top-K, checkpoint; chưa E5 thật/quality/sync/purge live |
| AG05 | IN_PROGRESS | Bounded read-only tools/schema/evidence/final ID; chưa model thật/server cancel/load |
| AG06 | NOT_STARTED | Chưa NestJS agent DTO/controller/service/API/error/Swagger |
| AG07 | NOT_STARTED | Chưa agent watchlist/ownership/opt-in |
| AG08 | IN_PROGRESS | OMDb/TMDB adapter notebook, mapping/provenance/cache/quota; chưa live/registry/worker/DB |
| AG09 | NOT_STARTED | Chưa chatbot UI website |
| AG10 | NOT_STARTED | Chưa admin draft/summary/approval/publish |
| AG11 | IN_PROGRESS | 44 Python + 7 Node contracts, notebook static/runbook; chưa GPU/model/E2E/load/rollout |
| AG12 | IN_PROGRESS | Chỉ CATALOG/HYBRID, metadata search/discovery có cờ; chưa WEB/AUTO/API router |
| AG13 | IN_PROGRESS | URL allowlist/no article fetch, evidence/run cache/budget; chưa article fetcher/source revoke/cache liên phiên |
| AG14 | NOT_STARTED | Chưa search modes/panels UI và benchmark thật |
| AG15 | IN_PROGRESS | Notebook nhúng source, 10 cell bootstrap/search/checkpoint/owned-process cleanup; chưa Colab mới/reset thật |
| AG16 | IN_PROGRESS | Export whitelist/schema/hash/TTL≤1.000 title, Python nhập1title local; chưa backend revalidation/cloud policy registry |

Demo mặc định có 4 phim giả. Catalog thật chỉ metadata được phép cloud/embedding; rights là khai báo, không tự chứng minh giấy phép. Hash không xác thực nguồn; chỉ nhập artifact được kiểm soát. Snapshot hạn24giờ, output ghi rõ chưa kiểm eligibility live.

Đầu ra dựng từ facts/evidence, chưa sinh review summary tự do. Tối đa4model calls/6tool calls/1schema repair; context thử8192/output600token, HTTP timeout90s, deadline120s giữa bước; chưa hard cancellation. TMDB và DDGS link-only tùy cấu hình, mặc định tắt.

Contract fixtures không chứng minh chất lượng tiếng Việt/ngữ nghĩa/hiệu năng. Người dùng cần chạy Colab và lưu runtime/digest/GPU/smoke, kiểm câu hỏi/catalog/EMPTY/lỗi/reset trước khi quyết định tích hợp server. EXT01–EXT08 và REC/ENC/ST giữ trạng thái riêng; adapter PoC không phải importer hoặc quyền phân phối review.

## 17. OMDb được chọn cho điểm IMDb/Metascore — phiên bản 1.5

Ngày14/11/2026: theo yêu cầu “dùng omdb”, thêm adapter Python trong notebook. Nguồn điểm mặc định của PoC là OMDb; TMDB tùy chọn vẫn giữ điểm riêng. Các thiết kế backend/API/DB trước đó không được coi là đã triển khai.

- Tools search_omdb_metadata và get_imdb_metacritic_ratings chỉ nhận title_id trong snapshot thật. Search trả candidates chưa verified; rating yêu cầu mapping IMDb ID do người vận hành đối chiếu, kiểm tên gốc/tên hiển thị, năm±1, movie/series và ID.
- Colab Secrets OMDB_API_KEY, cấu hình ENABLE_OMDB=True/OMDB_MAPPINGS ở cell1; HYBRID khi catalog thật, demo không gọi nguồn ngoài. Runbook tại [apps/agent](../../apps/agent/README.md).
- IMDb rating/votes và Metascore critic chuẩn hóa riêng, null khi thiếu; không giả User Score/review text. Evidence ghi intermediary OMDB và rating source thật, thang điểm/timestamp/TTL; không tự bịa link Metacritic chi tiết khi payload không có.
- Cache RAM1giờ/LRU200, 2requests/run và900/client, client tái sử dụng khi hỏi lại. Budget không thay quota tài khoản/ngày của OMDb, cache không lưu checkpoint. Lỗi không trả raw provider message/URL chứa key; redaction httpx/httpcore.
- AG08/AG12/AG13 tiếp tục IN_PROGRESS; chưa API/schema/worker/UI hoặc ingest sources chính thức, EXT giữ backlog riêng. Chưa API-key live/model Colab/GPU E2E.
- Sửa clock của create_demo: thời gian truyền rõ dùng clock cố định cho fixture, mặc định vẫn live TTL. Contract tests không phụ thuộc ngày chạy notebook; không nới TTL public snapshot.

## 18. Các bước tích hợp chatbot website — phiên bản1.6

Theo yêu cầu ngày14/11/2026, bổ sung [lộ trình12bước](website-chatbot-implementation-plan.md) để chatbot đọc dữ liệu pj-Flim và trả lời người xem. Ưu tiên catalog/FAQ qua gateway read-only, run/outbox/queue riêng, retrieval có eligibility và backend revalidation, rồi REST/Swagger/React chat/follow-up. OMDb/cá nhân hóa là giai đoạn sau có quota/quyền/owner.

Kế hoạch giữ POST/GET/DELETE assistant/runs đã đề xuất, không tạo API chat trùng nghiệp vụ. PoC facts-first cần mở schema cho FAQ/NEEDS_INPUT; hội thoại chỉ giữ entity/intent hữu hạn và nạp lại facts mỗi lượt. Colab tiếp tục môi trường thử; host inference website chọn sau benchmark. Chưa code API/service/migration/frontend trong lượt này; mọi trạng thái AG/EXT/REC/ENC/ST giữ nguyên.
