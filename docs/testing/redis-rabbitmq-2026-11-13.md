# Kiểm thử Redis và RabbitMQ — 13/11/2026

Thực hiện tại E:\pj-Flim, giờ Asia/Saigon. RabbitMQ được kiểm thử trên broker thật; Redis chưa được tích hợp nên không có kết quả kiểm thử chức năng Redis.

## Kết quả

| Thành phần | Kết quả | Bằng chứng |
| --- | --- | --- |
| RabbitMQ local | PASS, 9 nhóm/42 assertion | `npm.cmd run rabbitmq:smoke` |
| Sức khỏe broker | RabbitMQ 4.4.0, 1 node running, không memory/disk alarm hoặc network partition | Management API local và diagnostics ping |
| Queue xử lý phim | jobs/dlq durable, quorum; cả hai không có message tại thời điểm kiểm tra | Đọc metadata, không sửa queue ứng dụng |
| Consumer xử lý phim | 0 consumer đang kết nối | Broker hoạt động, worker xử lý phim không chạy tại thời điểm đo |
| Dọn fixture | PASS | Xóa đúng 2 queue/2 exchange thuộc prefix thử; management xác nhận 0 queue smoke còn lại |
| Redis | NOT_INTEGRATED | Không dependency/client Redis, không biến REDIS* trong cấu hình local, không container Redis |
| Redis local | Không có dịch vụ trên 127.0.0.1:6379 | TCP ECONNREFUSED; chưa gửi được PING |
| TypeScript | PASS | `npm.cmd run typecheck` |

Queue jobs hiện có delivery limit 8, dead-letter exchange/routing key, overflow reject-publish và dead-letter strategy at-least-once. Đây là cấu hình được đọc từ broker thật. Một node chưa chứng minh khả năng chịu lỗi mất node.

## Phạm vi RabbitMQ đã kiểm thử

| Nhóm | Điều kiện nghiệm thu |
| --- | --- |
| 1. Kết nối/topology | Broker của ứng dụng tạo được queue/exchange riêng với prefix ngẫu nhiên |
| 2. Publish/confirm/ACK | Event đúng payload/ID/content type, persistent delivery; ACK xong queue rỗng |
| 3. Producer reconnect | Job chưa có consumer vẫn tồn tại sau khi đóng producer; producer/consumer mới nhận và ACK được |
| 4. Prefetch | Prefetch=1: message thứ hai chưa được giao khi message đầu đang chờ ACK; giao tiếp sau ACK |
| 5. Handler từ chối | Handler trả dead đưa message vào DLQ; giữ ID và x-death reason/source |
| 6. Validation | JSON hỏng, schemaVersion không hỗ trợ, body 4097 byte và ID sai vào DLQ; không gọi handler |
| 7. Mandatory routing | Gỡ binding của queue thử khiến publish bị từ chối thay vì báo thành công; khôi phục binding sau test |
| 8. Consumer lỗi | Handler ném lỗi làm đóng kết nối; message chưa ACK được giao lại với redelivered=true, giữ ID và ACK thành công |
| 9. Poison message | Reject/requeue lặp lại đến giới hạn đưa message vào DLQ với reason delivery_limit |

Nhóm 6 có bốn trường hợp đầu vào; tổng cả suite là 42 assertion. Test dùng lớp Broker hiện có của dự án và amqplib, không mock RabbitMQ. Delivery limit được kiểm bằng basic.reject/requeue, phù hợp với cách đếm lỗi của quorum queue trong các phiên bản mới; xem [tài liệu RabbitMQ về quorum queues](https://www.rabbitmq.com/docs/quorum-queues).

Test prefetch chủ động đặt 1 trong tiến trình kiểm thử; cấu hình worker local vẫn giữ nguyên. Không restart broker, không kiểm mất điện/ổ đĩa, HA nhiều node, DLQ đứt mạng hoặc tải lớn. Producer reconnect không phải nghiệm thu persistence qua broker restart.

## Chạy lại

Cần Node/dependency đã cài, RabbitMQ local và cấu hình worker hợp lệ trong .env.worker.local. Script chỉ chấp nhận broker loopback, không kết nối production.

```powershell
Set-Location E:\pj-Flim
npm.cmd run rabbitmq:smoke
npm.cmd run typecheck
```

Script tạo prefix pjflim.broker-test.<random>, chạy kiểm thử và dọn đúng topology của lần chạy trong finally. Không ghi database, không gọi Cloudinary, không xuất bản phim và không lấy queue phim làm fixture. Không cần dừng worker hiện có.

Báo cáo máy đọc được nằm trong .local/worker/rabbitmq-smoke-result.json; log không in URL có credential hoặc lỗi SDK thô. Các bằng chứng đọc runtime của lần này nằm trong .local/worker/rabbitmq-health-result.json và redis-check-result.json. Thư mục .local không commit.

Nếu cần kiểm toàn pipeline cùng database, dùng bộ integration với PJ_FLIM_TEST_WORKER=true theo [worker runbook](../api/media-worker.md). Kết quả full-stack trước đó nằm trong [báo cáo riêng](full-stack-2026-11-13.md); không cộng số kiểm tra cũ vào lần chạy này.

## Redis và việc còn thiếu

Redis trong plan là hạng mục dự kiến. Hiện source không có client/cache Redis và không có instance local của dự án. Catalog đang trả Cache-Control: no-store; các cơ chế giới hạn/trạng thái hiện tại không được coi là Redis phân tán.

Không thực hiện SET/GET/TTL/DEL, đo hiệu năng hoặc failover Redis vì chưa có tích hợp để kiểm. Không tự cài container/client hoặc chuyển store khi chỉ kiểm thử.

Khi triển khai Redis cần chốt phạm vi cache/rate-limit/store chung, thêm cấu hình và client, rồi nghiệm thu cache hit/miss, TTL, invalidation sau mutation, khóa cache theo scope/quyền, hành vi khi Redis mất kết nối và giới hạn request đồng thời trên nhiều API instance. Không lưu trạng thái job/lịch sử duy nhất trong cache.
