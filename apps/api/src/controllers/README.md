# Controllers

Thư mục tiếp nhận HTTP request, gắn DTO/Swagger, xác thực/phân quyền và chuyển sang service. Có 15 file TypeScript chứa 26 controller.

| File | Controller |
| --- | --- |
| [auth.controller.ts](auth.controller.ts) | AuthController |
| [admin.controllers.ts](admin.controllers.ts) | CatalogController, UsersController, ResourcesController |
| [viewer.controllers.ts](viewer.controllers.ts) | PublicCatalogController, AccountsController, PlaybackController, LibraryController, ReportsController |
| [media.controller.ts](media.controller.ts) | MediaController |
| [cloudinary-webhook.controller.ts](cloudinary-webhook.controller.ts) | CloudinaryWebhookController |
| [health.controller.ts](health.controller.ts) | HealthController |

AppModule đăng ký controller từ thư mục này. Service ở [services](../services/README.md); DTO ở [dto](../dto/README.md). Endpoint, permission và Swagger giữ nguyên sau khi tách thư mục.


AssistantController và AssistantInternalController ở assistant.controller.ts:5RESToperations có auth/ownership, internal gateway dùng service/capability và không xuất Swagger. Tổng17controllerclasses; xem docs/api/assistant.md tại gốc.


PublicReviewsController/AdminReviewsController ở reviews.controller.ts:1public+6admin operations, DTO/permissions/ETag/Swagger. Tổng17controllerclasses trong9fileTypeScript.


RatingsController tại ratings.controller.ts thêm GET public /titles/:id/ratings, nullable scores/scales/status/source và Swagger. Tổng hiện18controllerclasses trong10fileTypeScript; admin vẫn55operation.

## Experience — 24/11/2026

experience.controller.ts thêm3controller: MfaEnrollmentController (own session), PublicSiteController (public whitelist) và ExperienceAdminController (report read+catalog.write). Tổng21controller/11TSfiles,110RESToperations/84paths/56admin. Service/DTO đặt riêng; không đưa nghiệp vụ vào controller. Xem docs/api/account-ui-and-site.md.


ViewerReviewsController:4operation GETpublic list/summary và private GET/PUT/DELETE own; Swagger/ETag/no-store. Tổng22controllerclasses/12files,56adminoperation giữ nguyên.

## View statistics — 25/11/2026

[view-stats.controller.ts](view-stats.controller.ts): PublicViewStatsController GET /titles/:id/views và AdminViewStatsController GET /admin/metrics/views?days=7, RequirePermissions(metrics.read), DTO/query, no-store, Swagger. Tổng24classes/13files,57adminoperation;116OpenAPIoperations/88paths. Không có endpoint tăng view tùy ý.

Admin25/11: AdminAdvancedController trong admin-advanced.controller.ts có5operation, DTO/RBAC/Swagger/no-store và CSVattachment. Tổng25classes/14files,62adminoperation,121ops/93paths.


[catalog-batch.controller.ts](catalog-batch.controller.ts):4endpoint preview/list/get/execution, ETag/no-store/DTO; service kiểm quyền theo action và ownership/session.
