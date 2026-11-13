# Kiểm tra trước cập nhật GitHub — 14/11/2026

Phạm vi: các thay đổi pj-Flim sau lần push trước, gồm encoding presets, content-v1 recommendations, PoC agent Colab/OMDb và kế hoạch chatbot website. Remote đích: https://github.com/dinhtung2722005/project_flim, nhánh main.

## Kiểm tra đã chạy lại trong lượt push

| Kiểm tra | Kết quả |
| --- | --- |
| npm run build:all | API TypeScript + web TypeScript/Vite đạt |
| npm run web:typecheck | Đạt |
| npm run test:encoding | 103 checks đạt; provider mocked ở biên |
| npm run test:recommendations | 23 checks thuật toán đạt |
| npm run test:agent:export | 7 Node tests đạt |
| Python unittest trong Docker Linux | 74 tests đạt; HTTP/model/encoder fixtures |
| Notebook | 10 code cells/15 bundle files/12 Python sources parse, hash/source đồng nhất, outputs sạch |
| Tài liệu agent/chatbot | 176 liên kết nội bộ trong11Markdown hợp lệ, UTF-8/fences đạt |
| Publication scan | File allowlist, đối chiếu credential local, private-key/token patterns và source notebook decoded |
| git diff --check | Đạt; có cảnh báo CRLF cũ ở PowerShell/SQL/memory, không phải lỗi whitespace |

## Phạm vi publish

Commit source/cấu hình mẫu/tài liệu/SQL/tests của pj-Flim. Không stage .env local, .local/.tmp, dependency/build output, credential, video/backup hoặc tài liệu cá nhân ở gốc. Manifest và scan report nằm riêng tại .local/publication, không commit.

Không chạy lại bộ backend/worker2309 hoặc browser227 của các báo cáo trước. Chưa model inference Qwen/E5, Colab E2E, OMDb live, load production hoặc full transitive lock Python. Build/test fixtures đạt không chứng minh các hạng mục đó đã nghiệm thu.

Kết quả commit/push và SHA remote được kiểm tra sau publish; xem nhật ký tương ứng trong memory.md. Không force-push hoặc đổi lịch sử remote.
