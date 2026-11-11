# Controllers

Thư mục tiếp nhận HTTP request, gắn DTO/Swagger, xác thực/phân quyền và chuyển sang service. Có 6 file chứa 12 controller.

| File | Controller |
| --- | --- |
| [auth.controller.ts](auth.controller.ts) | AuthController |
| [admin.controllers.ts](admin.controllers.ts) | CatalogController, UsersController, ResourcesController |
| [viewer.controllers.ts](viewer.controllers.ts) | PublicCatalogController, AccountsController, PlaybackController, LibraryController, ReportsController |
| [media.controller.ts](media.controller.ts) | MediaController |
| [cloudinary-webhook.controller.ts](cloudinary-webhook.controller.ts) | CloudinaryWebhookController |
| [health.controller.ts](health.controller.ts) | HealthController |

AppModule đăng ký controller từ thư mục này. Service ở [services](../services/README.md); DTO ở [dto](../dto/README.md). Endpoint, permission và Swagger giữ nguyên sau khi tách thư mục.
