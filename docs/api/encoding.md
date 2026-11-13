# Mã hóa, nén và nhiều độ phân giải HLS

Triển khai ngày 13/11/2026. Video mới được chuyển mã bằng Cloudinary H.264/AAC, tạo HLS adaptive bitrate trước khi xuất bản. Node điều phối API/job; player tải segment trực tiếp từ CDN.

## Sử dụng trên trang admin

1. Mở tập phim trong /admin, tới phần Video tập phim.
2. Chọn Chất lượng và dung lượng video, chọn file và bấm Tải video.
3. Chờ nguồn được xác minh, HLS xử lý và backup VERIFIED. Admin thấy danh sách kích thước/bitrate thực đã xác minh.
4. Chọn Sử dụng video này và xuất bản theo quyền hiện có. READY không tự xuất bản.

| Preset | Các mức danh nghĩa tối đa | Video bitrate cấu hình |
| --- | --- | --- |
| data-saver-v1 | 240 / 360 / 480p | 220 / 400 / 700 kbps |
| balanced-720p-v1, mặc định | 240 / 360 / 480 / 720p | 350 / 650 / 1.000 / 2.200 kbps |
| balanced-1080p-v1 | 240 / 360 / 480 / 720 / 1080p | 350 / 650 / 1.000 / 2.200 / 4.200 kbps |

Đây là thông số đầu vào encoder, không phải số đo bitrate đầu ra hoặc bảo đảm giảm dung lượng. Kích thước giới hạn dùng crop=limit, giữ tỷ lệ hình; bỏ các mức trùng khi nguồn nhỏ. Video dọc/widescreen có kích thước thực theo nguồn. Pixel được làm tròn theo encoder, UI dùng kích thước thật.

Nguồn 720p không tạo 1080p bằng phóng lớn. Nguồn 360p dùng tối đa kích thước gốc; nguồn quá nhỏ có thể chỉ có một rendition. Keyframe interval yêu cầu 2 giây; GOP/IDR thực trên mọi frame chưa được probe chuyên dụng. AAC áp dụng khi nguồn có audio.

Hệ thống giữ nguồn, các rendition và backup riêng; tổng storage có thể tăng dù byte truyền của mức thấp giảm.

Các phim/intent cũ giữ profile đã lưu, ví dụ hd. Không tự chuyển mã lại toàn bộ catalog, đổi asset đang active hoặc thay đường phát của phiên hiện có.

## API và cấu hình

POST /api/v1/admin/episodes/{id}/upload-intents giữ quyền media.upload, ownership và Idempotency-Key hiện có. DTO thêm encodingPreset optional theo allowlist; trường lạ, null hoặc preset không tồn tại bị validation từ chối.

```json
{
  "expectedBytes": 4831990,
  "sourceFormat": "mp4",
  "encodingPreset": "balanced-720p-v1"
}
```

Nếu client không gửi encodingPreset, dùng CLOUDINARY_ENCODING_PRESET hoặc balanced-720p-v1. UI mặc định Cân bằng 720p và gửi lựa chọn rõ. CLOUDINARY_STREAMING_PROFILE vẫn phục vụ compatibility intent cũ, không quyết định preset mới.

GET upload intent trả encodingPreset và encoding (null trước khi xác minh nguồn). GET /admin/media-assets/{id}, quyền media.preview, có encoding và renditions đã verify; không trả manifest ký hoặc credential. Response target settings khác số đo manifest. Các path/role/error code giữ nguyên; OpenAPI đã cập nhật.

```dotenv
# Optional; default for API clients that omit encodingPreset:
CLOUDINARY_ENCODING_PRESET=balanced-720p-v1
```

Không tạo migration/bảng mới: snapshot nằm trong expected_policy JSONB; manifest metadata nằm trong rendition_summary hiện có.

## Cơ chế và điều kiện READY

1. Intent lưu preset ID bất biến; upload direct giữ nguồn gốc, không áp incoming compression.
2. API lấy metadata từ Cloudinary, chọn ladder theo kích thước thật, lưu snapshot/profile/version/definition hash cùng transaction verification + attempt + outbox.
3. Worker kiểm snapshot, config hash, current attempt và quyền actor. Profile tên pjflim_h264_<hash> được tạo nếu thiếu; profile có cùng tên nhưng khác định nghĩa bị từ chối. Không sửa profile cũ hoặc built-in tại chỗ.
4. Eager async tạo HLS bằng đúng profile. Callback/lease/reconcile/idempotency và retry của pipeline cũ vẫn áp dụng.
5. Verifier kiểm đủ số/mức dự kiến, kích thước/không upscale, H.264 và AAC nếu có, playlist VOD/tổng thời lượng và segment đọc được. Profile được kiểm lại trước ghi output READY.
6. Asset chỉ READY khi HLS đã verify và backup nguồn đủ điều kiện; admin xuất bản riêng. Player Tự động/chọn mức tiếp tục lấy levels từ manifest thật.

Profile mới cần quyền Admin API streaming profiles của account Cloudinary và quota chuyển mã. Thiếu quyền hoặc cấu hình drift sẽ báo lỗi an toàn, không tự hạ xuống profile khác rồi đánh dấu thành công.

Source: [immutable recipe](../../packages/media/src/encoding-profiles.ts), [provider](../../packages/media/src/cloudinary.provider.ts), [verifier](../../packages/media/src/hls-verifier.ts), [worker](../../apps/worker/src/media-worker.ts), [upload UI](../../apps/web/src/features/admin/UploadPanel.tsx).

## Kiểm thử và smoke

```powershell
npm.cmd run test:encoding
npm.cmd run build:all
npm.cmd run openapi:export

# Live: dùng video được phép, tạo asset riêng tư pj-flim/encoding-smoke/<uuid>.
$env:PJ_FLIM_LIVE_ENCODING='true'
npm.cmd run encoding:smoke -- .local/media/streaming-short-test.mp4
npm.cmd run encoding:player-smoke

# Fixture 1080p tổng hợp riêng, không dùng để đánh giá chất lượng phim.
npm.cmd run encoding:fixture
$env:PJ_FLIM_ENCODING_FULL_HD='true'
npm.cmd run encoding:smoke -- .local/encoding/full-hd/source.webm
npm.cmd run encoding:player-smoke
```

Live smoke tạo derivative/quota thật trên account, giữ asset authenticated để xem lại; không dùng DB, không tự xuất bản. Rerun cùng state/hash tái sử dụng asset; đổi nguồn cần state riêng. Artifact/report/video/screenshot ở .local/encoding, không commit. Source fixture là WebM canvas + audio tổng hợp bằng Chrome, không biến nguồn 720p thành bằng chứng chất lượng 1080p.

Smoke đo byte media đầy đủ, hỗ trợ HLS byte-range và initialization object; kiểm Content-Range/length và giới hạn tổng 128 MiB. measured.segmentBytes là byte đã tải của một rendition, gồm media/init, chưa gồm playlist/HTTP overhead. estimatedMebibytesPerMinute trong manifest summary chỉ là ước lượng từ BANDWIDTH.

Bằng chứng, kết quả và giới hạn: [kiểm thử encoding](../testing/encoding-2026-11-13.md). Chưa có per-title RD optimization/VMAF, HEVC/AV1/DASH/HDR hoặc thử toàn bộ thiết bị. Giới hạn signed Cloudinary URL/ST01 và backup production/ST06 vẫn theo backlog chính.

Tham khảo API provider: [Cloudinary streaming profiles](https://cloudinary.com/documentation/admin_api#streaming_profiles), [adaptive streaming](https://cloudinary.com/documentation/adaptive_bitrate_streaming).
