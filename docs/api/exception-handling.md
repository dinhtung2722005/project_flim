# Global exception handler

Đã triển khai trong E:\pj-Flim ngày 10/11/2026. [GlobalExceptionFilter](../../apps/api/src/filters/global-exception.filter.ts) được đăng ký qua APP_FILTER/useExisting trong AppModule; dùng chung một instance cho NestJS và các bridge lỗi Express/parser/Swagger. Phần xử lý lỗi cũ đã được tách khỏi common.ts.

[Exception mapper](../../apps/api/src/exceptions/exception-mapper.ts) phân loại lỗi. [Database error helper](../../packages/backend-core/src/database-errors.ts) đọc mã lỗi lồng nhau/cause/Prisma adapter có giới hạn và chống vòng lặp. [ApiError](../../packages/backend-core/src/errors.ts) tiếp tục là lỗi nghiệp vụ dùng chung cho API/worker; không tạo class ApiError thứ hai.

## Response thống nhất

HTTP errors trả Content-Type: application/problem+json, Cache-Control: no-store và X-Request-Id khớp body. Có type, title, status, code, detail, instance, requestId, retryable; errors là optional cho validation.

```json
{
  "type": "urn:pj-flim:problem:validation-failed",
  "title": "VALIDATION FAILED",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "detail": "Request validation failed.",
  "instance": "/api/v1/users",
  "requestId": "bd19cdab-8d18-41fa-aa25-a5cb3a9ae2b7",
  "retryable": false,
  "errors": [
    {
      "location": "body",
      "pointer": "/email",
      "code": "FIELD_INVALID_FORMAT",
      "message": "This field has an invalid format or value."
    }
  ]
}
```

instance chỉ chứa path, không đưa query có token vào response. Thiếu request ID thì sinh UUID và đặt cùng giá trị vào header/body/log. Không đưa lỗi vào response 200.

Validation errors chỉ giữ location/pointer/code/message, tối đa 50 mục. Message field dùng mẫu an toàn theo code, không trả value/target/stack hoặc dữ liệu tự do từ lỗi. Code field hiện gồm FIELD_UNKNOWN, FIELD_REQUIRED, FIELD_INVALID_TYPE, FIELD_INVALID_FORMAT.

retryable là gợi ý để xử lý lỗi tạm thời, không cho phép tự retry mọi POST. Chỉ retry thao tác an toàn hoặc cùng ý định có Idempotency-Key. RATE_LIMITED trả Retry-After: 60; AUTH_REFRESH_RETRY_CONFLICT trả Retry-After: 2.

## Ánh xạ

| Nguồn lỗi                                                         | HTTP/code                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ApiError có code trong registry                                   | Giữ mã nghiệp vụ và status registry; chỉ truyền message an toàn vào ApiError      |
| ApiError không đăng ký                                            | 500 / INTERNAL_ERROR                                                              |
| BadRequestException                                               | 400 / REQUEST_INVALID                                                             |
| JSON parser sai cú pháp                                           | 400 / REQUEST_MALFORMED_JSON                                                      |
| Body quá lớn                                                      | 413 / REQUEST_TOO_LARGE                                                           |
| Content type/charset/encoding không hỗ trợ                        | 415 / REQUEST_UNSUPPORTED_MEDIA_TYPE                                              |
| DTO validation                                                    | 422 / VALIDATION_FAILED, errors theo field                                        |
| HttpException thông dụng                                          | Theo status/code trong registry, không phát nguyên getResponse()/message ra ngoài |
| Unique constraint đã biết                                         | ACCOUNT_CONFLICT hoặc mã trùng slug/mùa/tập tương ứng                             |
| Unique constraint khác, Prisma P2002                              | 409 / RESOURCE_CONFLICT                                                           |
| Foreign key/check/not-null/dữ liệu DB không hợp lệ                | 422 / VALIDATION_FAILED                                                           |
| Prisma P2025                                                      | 404 / RESOURCE_NOT_FOUND                                                          |
| DB mất kết nối, pool timeout, deadlock/serialization/lock timeout | 503 / SERVICE_UNAVAILABLE                                                         |
| Gateway lỗi/timeout                                               | 502 / UPSTREAM_BAD_RESPONSE hoặc 504 / UPSTREAM_TIMEOUT                           |
| Lỗi bất ngờ hoặc ngoài hợp đồng đã ánh xạ                         | 500 / INTERNAL_ERROR                                                              |

Lỗi nghiệp vụ và HttpException được xử lý trước nested cause để không đổi nhầm GatewayTimeout thành lỗi 503 chỉ vì cause có mã network. HttpException ngoài nhóm status được registry hỗ trợ được chuẩn hóa thành INTERNAL_ERROR/500; khi bổ sung status mới phải thêm mã vào registry/mapper/OpenAPI cùng nhau.

Registry runtime hiện có 73 code; 5 code mới là REQUEST_INVALID (400), RESOURCE_CONFLICT (409), REQUEST_TIMEOUT (408), UPSTREAM_BAD_RESPONSE (502), UPSTREAM_TIMEOUT (504). [Registry source](../../packages/contracts/src/errors.ts) và [OpenAPI](openapi.json) là nguồn mã máy đọc được.

Unique constraint không còn bị quy đồng thành CATALOG_SLUG_CONFLICT. Mapper chỉ giữ mã chuyên biệt khi nhận diện tên constraint đã allowlist; service nghiệp vụ vẫn có thể throw ApiError trước khi tới filter.

## Logging và response đã gửi

Lỗi 5xx ghi JSON event http.exception với code/status/kind/requestId/method/path/headersSent. Không ghi raw Error, SQL, connection string, query, request body, token, stack hoặc message chưa được lọc. Mọi lỗi 5xx trả detail chung; log/request ID cho phép đối chiếu với access log. Lỗi 4xx tiếp tục xuất hiện trong access/security log hiện có.

Handler không truy vấn database nên vẫn tạo được Problem Details khi DB lỗi. Middleware security logging hiện có vẫn chạy độc lập; các việc giới hạn log/quota chống spam ở ST02–ST03 trong plan chưa được giải quyết bởi thay đổi này.

Nếu response đã gửi header, filter không ghi JSON hoặc đổi status lần hai; kết nối chưa kết thúc được đóng bằng destroy để tránh trả thành công giả cho stream bị lỗi. Nếu response đã kết thúc/đã đóng thì không ghi tiếp.

## Phạm vi và kiểm thử

Áp dụng cho HTTP controller, guard, pipe, service và middleware lỗi được chuyển tới Express/Nest. Bridge parser đặt ngay sau các body parser để giữ đúng lỗi JSON/charset trước khi framework chuyển đổi lỗi. Swagger local hiện mở trực tiếp theo yêu cầu ngày 11/11/2026, không còn form login/CSRF. Route docs-session và POST docs-login cũ trả RESOURCE_NOT_FOUND/404 qua handler chung.

Không dùng filter HTTP để nuốt uncaughtException/unhandledRejection cấp process, lỗi startup hoặc lỗi job RabbitMQ. Worker giữ cơ chế lease/retry/DLQ; startup giữ xử lý fatal riêng.

[Kiểm thử exception](../../tests/global-exception.integration.ts) chạy trong bộ integration với PostgreSQL tạm riêng: ném lỗi qua service thật/controller public, kiểm header/schema/redaction/log, parser/DTO/unknown errors, nested cause, timeout, vòng lặp cause và unique constraint thật từ Prisma/PostgreSQL. Có kiểm response đã gửi header không bị ghi lần hai và API tiếp tục trả health bình thường.

Build và toàn bộ 1.070 kiểm tra đã đạt, gồm 509 assertion cho exception handler; báo cáo ở .local/api/integration-result.json. Không thêm endpoint thử lỗi vào ứng dụng production và không thay schema database.

Tham khảo: [NestJS exception filters](https://docs.nestjs.com/exception-filters), [Problem Details RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html).

Bổ sung 13/11/2026: registry hiện có 74 code; RECOMMENDATION_FEED_EXPIRED (409, retryable=false) báo snapshot hết hạn/bị evict hoặc preference epoch đổi. Người dùng làm mới feed trang đầu, không tự replay mutation. Xem [API gợi ý](recommendations.md).
