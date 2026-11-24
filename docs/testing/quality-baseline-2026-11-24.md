# Đo chất lượng gợi ý và nén — 24/11/2026

Đã chạy trên dữ liệu/file local thực. Đây là đánh giá offline có giới hạn, không phải nghiệm thu hiệu quả người dùng hoặc cấu hình phát production.

## Gợi ý

CLI: npm.cmd run benchmark:recommendations -- --labels .local/benchmarks/recommendations/judgments.proposed.json

Đọc PostgreSQL bằng transaction READ ONLY, chỉ metadata phim; không đọc tài khoản/lịch sử/credential hoặc video URL. Dataset23tựa gồm22DRAFT/1PUBLISHED và cả3tựa thử kỹ thuật. Snapshot .local/benchmarks/recommendations/catalog-metadata.json không phải snapshot public được phép đưa vào Colab. Colab phải dùng exporter public riêng.

Kiểm toán: thiếu đoàn phim23/23, ngôn ngữ23/23, thể loại3/23, năm3/23, synopsis2/23. UI admin đã thêm gán đoàn phim và nhập ngôn ngữ/quốc gia để quản trị viên sửa theo nguồn đã xác minh; không tự điền dữ liệu đoán.

Bộ4case đề xuất do người triển khai đọc metadata/tên cùng series, chưa được đánh giá độc lập:2case Will Trent,1khoa học viễn tưởng,1tâm lý/tình cảm. Các nhãn là PROPOSED, không phải sở thích người dùng. Model content-v1 và recency dùng cùng candidate/seed exclusion/as-of, không lấy holdout làm seed và loại phim tương lai. Draft dùng thời gian nhập làm mốc recency, không phải lịch phát hành thực.

| Chỉ số @5 | content-v1 | Recency |
| --- | --- | --- |
| Precision | 0.400 | 0.300 |
| Recall | 0.833 | 0.667 |
| nDCG | 0.797 | 0.314 |
| Catalog coverage | 0.478 | 0.261 |

Các số trên chỉ kiểm tra đường chạy đánh giá trên nhãn metadata đề xuất. Nhãn chưa đầy đủ; phim không được gán nhãn tính là không liên quan. Không kết luận cải thiện tương tác, không tối ưu trọng số theo4case này hoặc chuyển REC06 VERIFIED. Cần bộ nhãn độc lập/catalog đủ public và đánh giá timeline trước A/B. acceptedQuality=false trong báo cáo.

Evaluator có Precision/Recall/nDCG/HitRate@K, coverage, intra-list diversity và thời gian xử lý; kiểm ID/gain/seed/temporal leakage. Quy ước gain0–3, DCG=(2^gain-1)/log2(rank+1), precision chiaK ngay cả khi trả ít hơnK; không có nhãn dương trảnull. [Tài liệu đối chiếu](https://recommenders-team.github.io/recommenders/evaluation.html).

## Encoding

Nguồn test123.mp4: H.264 1280×720,24fps,bt709,1211,8giây; SHA256 6c68f1f7f7f7c8acd61008d5b5472982010d44dafadfd21833c9de68325a8428. Chọn3đoạn6giây tại đầu/giữa/cuối theo offset trong report,2CRF×3độ phân giải =18phép đo. Chỉ3đoạn, không phải18phim độc lập.

FFmpeg9.1 Gyan essentials, libx264 medium, CRF23/26, VBV maxrate800/1400/2800kbps cho360/480/720p. Nguồn không bị upscale thành1080p. Reference FFV1 được chuẩn hóa fps/SAR/yuv420p; bản nén được scale bicubic về1280×720 và đồng bộ timestamp trước tính VMAF vmaf_v0.6.1/SSIM/PSNR. Audio loại khỏi phép đo.

| CRF | Mức | Đoạn | kbps video | VMAF | SSIM | PSNR dB |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | 360p | 3 | 523.4 | 75.23 | 0.97961 | 35.20 |
| 23 | 480p | 3 | 802.4 | 82.47 | 0.98239 | 36.39 |
| 23 | 720p | 3 | 1170.7 | 89.93 | 0.98804 | 39.71 |
| 26 | 360p | 3 | 379.6 | 71.72 | 0.97700 | 34.95 |
| 26 | 480p | 3 | 574.6 | 79.62 | 0.98022 | 36.09 |
| 26 | 720p | 3 | 932.1 | 88.62 | 0.98728 | 39.17 |

Giá trị là trung bình theo3đoạn, không phải chất lượng toàn bộ phim. CRF26 giảm bitrate nhưng giảm điểm so với23; bitrate nguồn toàn file khoảng698,2kbps đã gồm audio, không so trực tiếp như cùng điều kiện. Ví dụ720p CRF26 vẫn khoảng932,1kbps video trong các đoạn chọn: không được hứa chuyển mã luôn giảm dung lượng. Không đổi preset Cloudinary, asset/pointer hoặc chuyển mã catalog. Đây là LOCAL_H264_EXPERIMENT_NOT_CLOUDINARY_PRESET, không đo CDN startup/rebuffer, GOP toàn bitstream, thiết bị, audio/HDR hoặc corpus đại diện.

CLI hỗ trợ --source/--out/--ffmpeg/--ffprobe/--seconds1–15/--crf16–35. Ví dụ:

~~~powershell
npm.cmd run benchmark:encoding -- --source E:\Videos\sample.mp4 --ffmpeg E:\Tools\ffmpeg.exe --ffprobe E:\Tools\ffprobe.exe --seconds 6 --crf 26
~~~

Artifact private: .local/benchmarks/{recommendations,encoding,encoding-crf26}/report.json, proposal labels/catalog-metadata, và reference/renditions/metric JSON theo sample. Kết quả không upload provider hoặc đổi dữ liệu gốc.

Nguồn kỹ thuật: [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html#libvmaf), [Netflix VMAF/FFmpeg](https://github.com/Netflix/vmaf/blob/master/resource/doc/ffmpeg.md). Binary Gyan nằm trong [danh sách build Windows của FFmpeg](https://ffmpeg.org/download.html).

## Kiểm thử code

11kiểm tra evaluator và4test an toàn kích thước nguồn/không upscale đạt. Hồi quy API/security/viewer/frontend2624đạt, trong đó275frontend; build/typecheck API/web đạt. Provider trong integration là fixture; phép đo18encoding dùng file thực/FFmpeg thật. Chưa SMTP thật, Qwen/Colab hoặc ST05/ST06 production. Không thay acceptedQuality của recommender thànhtrue từ kết quả thử này.
