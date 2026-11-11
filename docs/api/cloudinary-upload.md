# Upload video Cloudinary cho admin

Triển khai tại E:\pj-Flim. API dùng signed direct upload; trình duyệt gửi video thẳng lên Cloudinary. Backend chỉ nhận JSON và đọc metadata provider. Đã có [RabbitMQ worker, webhook và backup](media-worker.md); giao diện admin/frontend chưa được triển khai.

## Cấu hình

Điền các biến vào `.env.api.local` (được Git bỏ qua), sau đó khởi động lại API:

```dotenv
CLOUDINARY_CLOUD_NAME=YOUR_CLOUD_NAME
CLOUDINARY_API_KEY=YOUR_API_KEY
CLOUDINARY_API_SECRET=YOUR_API_SECRET
CLOUDINARY_UPLOAD_PRESET=pj_flim_video_signed
CLOUDINARY_MAX_VIDEO_BYTES=104857600
CLOUDINARY_MAX_VIDEO_SECONDS=21600
CLOUDINARY_STREAMING_PROFILE=hd
```

```powershell
Set-Location E:\pj-Flim
npm.cmd run cloudinary:configure
```

Lệnh kiểm tra kết nối, tạo preset signed riêng nếu chưa tồn tại và kiểm tra profile HLS. Preset đã có chỉ được đọc/kiểm tra, không tự ghi đè. API sẽ từ chối cấp chữ ký nếu thiếu cấu hình, preset unsigned, có incoming/eager transformation hoặc folder làm sai public ID. Kết quả an toàn ở `.local/media/provider-check.json`; không có API secret.

Tài khoản hiện tại đã trả lỗi giới hạn **104857600 bytes (100 MiB)** với video gốc 105763856 bytes, vì vậy đã đặt giới hạn ứng dụng 100 MiB. Chunked upload không vượt được giới hạn mỗi file của gói Cloudinary. Nâng gói/giới hạn tài khoản trước khi tăng biến dung lượng.

Cloudinary preset **không hỗ trợ giới hạn dung lượng riêng cho từng preset**. Ứng dụng kiểm tra dung lượng trước khi cấp chữ ký, helper kiểm tra file trước upload, backend xác minh lại metadata sau upload; giới hạn cứng trên đường truyền trực tiếp là giới hạn tài khoản Cloudinary. [Tài liệu preset chính thức](https://cloudinary.com/documentation/upload_presets).

## API

Cần access JWT sau MFA, quyền `media.upload` (EDITOR, ADMIN, SUPER_ADMIN). Mỗi intent chỉ cho người tạo đọc, lấy chữ ký và xác minh; người khác nhận 404.

| Method | Đường dẫn                                             | Kết quả                                        |
| ------ | ----------------------------------------------------- | ---------------------------------------------- |
| POST   | /api/v1/admin/episodes/{episodeId}/upload-intents     | 201, Location và signed upload fields          |
| GET    | /api/v1/admin/upload-intents/{intentId}               | 200, trạng thái và tham số upload còn hiệu lực |
| POST   | /api/v1/admin/upload-intents/{intentId}/verifications | 200, nguồn VERIFIED và operation xử lý         |

Hai POST bắt buộc `Idempotency-Key`: 8–128 ký tự ASCII gồm chữ/số, dấu chấm, gạch dưới, gạch ngang hoặc dấu hai chấm. Scope gồm user, method và route chứa resource ID; TTL kết quả 24 giờ. Replay tạo intent trả cùng ID và snapshot hiện tại, không gia hạn chữ ký; trạng thái/fields có thể khác nếu file đã được xác minh hoặc hết hạn. Verification replay trả kết quả đã lưu. Cùng key khác body trả 409; replay vẫn kiểm tra phiên/quyền/owner. Chữ ký upload không được lưu vào audit hay replay receipt.

Tạo intent:

```http
POST /api/v1/admin/episodes/{episodeId}/upload-intents
Authorization: Bearer <access-token>
Idempotency-Key: <uuid>
Content-Type: application/json

{"expectedBytes":101394973,"sourceFormat":"mp4"}
```

Server khóa tập phim, cấp asset ID/version/public ID mới và tạo asset ở trạng thái PENDING_UPLOAD cùng intent trong một transaction có audit. Không dùng tên file làm public ID; không nhận URL, preset, public ID, delivery type hoặc timestamp do client chọn. Source format cho phép: mp4, mov, mkv, webm, m4v, avi; Cloudinary phải nhận diện đúng container đã khai báo.

Phản hồi có `id`, `episodeId`, `assetId`, `internalVersion`, `expiresAt`, `upload.url`, `upload.chunkSize`, `upload.fields`. Fields gồm API key công khai, timestamp, chữ ký SHA-256, public ID, signed preset, context liên kết owner/intent/episode/asset và `overwrite=false`. API secret chỉ ở server. Video dùng delivery type `authenticated`.

Chữ ký Cloudinary có hiệu lực một giờ. GET chỉ dựng lại đúng chữ ký/timestamp ban đầu, không kéo dài thời hạn. Intent hết hạn trả EXPIRED khi đọc, không có upload fields; POST xác minh trả MEDIA_UPLOAD_INTENT_EXPIRED. Dọn asset/chunk dở và đồng bộ trạng thái hết hạn là phần reconciler ở C07. [Cơ chế chữ ký](https://cloudinary.com/documentation/authentication_signatures).

## Upload từ trình duyệt

Helper có sẵn ở [browser-upload.ts](../../packages/media/src/browser-upload.ts). Helper chia chunk 20 MiB, giữ một X-Unique-Upload-Id cho file, gửi Content-Range, hỗ trợ AbortSignal và callback tiến độ. JWT chỉ dùng khi gọi API của ứng dụng. Không gửi JWT/cookie ứng dụng đến Cloudinary. Khi tích hợp frontend, CSP connect-src của frontend cần cho phép https://api.cloudinary.com; ví dụ này gọi API ứng dụng cùng origin.

```ts
import { uploadVideoDirect } from "../../packages/media/src/browser-upload";

const headers = {
  Authorization: "Bearer " + accessToken,
  "Content-Type": "application/json",
};
const response = await fetch(
  "/api/v1/admin/episodes/" + episodeId + "/upload-intents",
  {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ expectedBytes: file.size, sourceFormat: "mp4" }),
  },
);
if (!response.ok) throw new Error("Không tạo được upload intent");
const intent = await response.json();

await uploadVideoDirect(file, intent.upload, {
  signal: abortController.signal,
  onProgress: (sent, total) => console.log(Math.round((sent / total) * 100)),
});

const verificationKey = crypto.randomUUID();
const verified = await fetch(
  "/api/v1/admin/upload-intents/" + intent.id + "/verifications",
  {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": verificationKey },
    body: JSON.stringify({ episodeId }),
  },
);
if (!verified.ok) throw new Error("Video chưa được xác minh");
const result = await verified.json();
```

Nếu mất phản hồi chunk cuối, gọi verification trước khi upload lại vì provider có thể đã nhận đủ file. Nếu verification bị timeout, retry cùng Idempotency-Key. Helper không tự gửi lại POST khi không biết kết quả; chưa hỗ trợ lưu phiên upload qua reload trang.

## Xác minh nguồn và hàng đợi xử lý

Body verification chỉ có `episodeId`. Backend đọc Cloudinary Admin API bằng public ID/account/delivery type trong DB, giới hạn request 10 giây, ngoài transaction DB. Client gửi provider response/URL sẽ bị từ chối 422.

Backend kiểm tra public ID, resource type, delivery type, context owner/intent/episode/asset, container, số byte chính xác, duration, kích thước ảnh, provider asset ID/version và thời gian upload. Việc này xác minh liên kết và metadata file; không xác minh nội dung phim bằng hình ảnh/âm thanh.

Nguồn hợp lệ: transaction kiểm tra lại quyền, khóa tập/intent/asset, ghi VERIFIED + UPLOADED, tạo operation QUEUED, attempt QUEUED, output HLS PENDING và outbox `media.processing.requested`, cùng audit và idempotency receipt. Hai verification đồng thời chỉ tạo một operation/attempt/event. Episode chưa được đổi active asset hay xuất bản.

**Điều chỉnh hợp đồng so với plan ban đầu:** verification hiện trả **200 sau khi đọc metadata đồng bộ**, thay cho 202 chờ worker xác minh nguồn. Không giữ transaction khi gọi provider. C07 tiếp nhận công việc xử lý HLS/backup đã lưu bền; broker/worker đã chạy để chuyển operation từ QUEUED sang RUNNING rồi SUCCEEDED/FAILED. Nếu sau này đưa cả metadata verification sang worker, cần version hóa hợp đồng API và bổ sung status operation riêng.

Metadata không khớp/format sai/vượt giới hạn: commit REJECTED, asset FAILED và audit trước khi trả 422. Lỗi provider tạm thời giữ PENDING để retry. Asset chưa thấy trên provider trả MEDIA_NOT_READY, không chuyển READY. Cấp tối đa 10 intent/user/giờ, tối đa 30 lần đọc metadata xác minh/user/giờ. Replay đã hoàn tất không gọi provider lại.

| HTTP        | Code thường gặp                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------ |
| 400         | IDEMPOTENCY_KEY_REQUIRED, REQUEST_INVALID_IDENTIFIER                                             |
| 401/403     | lỗi phiên/MFA hoặc AUTH_FORBIDDEN                                                                |
| 404         | RESOURCE_NOT_FOUND (bao gồm sai owner)                                                           |
| 409         | MEDIA_UPLOAD_INTENT_EXPIRED, MEDIA_NOT_READY, IDEMPOTENCY_KEY_REUSED, IDEMPOTENCY_RESULT_EXPIRED |
| 422         | MEDIA_UPLOAD_MISMATCH, MEDIA_FILE_LIMIT_EXCEEDED, MEDIA_FORMAT_UNSUPPORTED, VALIDATION_FAILED    |
| 429         | RATE_LIMITED                                                                                     |
| 502/503/504 | MEDIA_PROVIDER_BAD_RESPONSE, MEDIA_PROVIDER_UNAVAILABLE, MEDIA_PROVIDER_TIMEOUT                  |

Chữ ký Cloudinary không bao phủ nội dung file hoặc resource_type trong URL. Do đó không thể coi chữ ký là bằng chứng file đã đúng; server vẫn phải lookup video và đối chiếu metadata. Cần theo dõi quota ở provider và dọn nguồn không được xác minh trong reconciler. [Tài liệu chữ ký](https://cloudinary.com/documentation/authentication_signatures).

## Nghiệm thu với video thật

**Đã nghiệm thu thành công ngày 10/11/2026:** video 1211,803 giây (20 phút 11 giây), source 1280x720, upload 101394973 bytes. Cloudinary tạo 5 rendition: 1280x720, 960x540, 640x360, 480x270 và 320x180. Đã đọc master playlist, playlist 720p có ENDLIST và dữ liệu segment qua CDN. Upload mất khoảng 71,5 giây; xử lý HLS video dài cần nhiều phút. Kết quả thật ở [.local/media/smoke-result.json](../../.local/media/smoke-result.json).

```powershell
npm.cmd run cloudinary:smoke -- "E:\pj-Flim\.local\media\test123-under-limit.mp4"
```

Script dùng tài khoản bootstrap cục bộ, tạo phim lẻ DRAFT/tập kỹ thuật, tạo intent qua API, upload chia chunk trực tiếp, gọi verification, yêu cầu eager HLS bất đồng bộ ở Cloudinary, poll trong tối đa 15 phút để nghiệm thu cục bộ, rồi kiểm tra master playlist có nhiều bitrate, playlist con/VOD end marker và segment có dữ liệu. Không in token/API secret/signed delivery URL. Kết quả ở `.local/media/smoke-result.json`; draft được giữ để kiểm tra.

Với file gốc vượt giới hạn tài khoản, bản thử ở `.local/media/test123-under-limit.mp4` giữ nguyên video 1280x720 và toàn bộ thời lượng 1211,8 giây, chỉ mã hóa lại AAC từ 128 xuống 96 kbit/s; kích thước 101394973 bytes. File gốc không thay đổi. Kết quả lỗi giới hạn file gốc được giữ ở `.local/media/original-video-limit.json`.

Khi có cấu hình RabbitMQ, script smoke chờ worker hoàn tất HLS/webhook/backup rồi kiểm tra CDN; nó không tự gửi thêm eager transformation. Chế độ cũ PJ_FLIM_PROVIDER_ONLY=true chỉ nghiệm thu provider, cần dừng worker khi thử riêng và không tự đánh dấu asset READY hoặc backup VERIFIED. Cả hai chế độ đều giữ phim nháp. Source 720p không chứng minh 1080p; cần source và gói phù hợp để nghiệm thu Full HD. PoC dùng poll để nghiệm thu; production cần eager notification URL/webhook và reconciler có lưu trạng thái. Worker, webhook inbox, backup/checksum và retry/reconcile C07 đã nối tự động. Khi worker được cấu hình, script smoke chờ pipeline và không tự gửi eager trùng. Có thể chạy npm.cmd run worker:smoke để kiểm tra lại asset đã upload. Playback session C08 còn thiếu.

Kiểm thử tự động dùng Cloudinary SDK mock tại biên mạng và PostgreSQL tạm riêng; kiểm tra chữ ký, quyền/owner, mismatch, quota, retry, transaction audit và trùng lặp. Mock không được dùng để khẳng định đã nghiệm thu HLS thật. Xem [hướng dẫn kiểm thử](README.md).
