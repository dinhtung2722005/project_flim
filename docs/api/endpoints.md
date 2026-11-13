# Endpoint ?? tri?n khai

Bổ sung 13/11/2026: tổng hiện hành **92 operation/70 path**; 5 operation mới GET feed, GET/PATCH preferences, PUT/DELETE feedback tại [API gợi ý](recommendations.md). Bảng cũ dưới đây mô tả baseline 87 operation.

C?p nh?t 10/11/2026. T?ng h?p t? [OpenAPI](openapi.json): 87 operation/67 path, g?m 49 operation admin. Xem [API ng??i xem](viewer-api.md) v? [h??ng d?n chung](README.md).

## Public / Catalog

| Method | Path                                | X?c th?c |
| ------ | ----------------------------------- | -------- |
| GET    | /api/v1/titles                      | Public   |
| GET    | /api/v1/titles/{id}                 | Public   |
| GET    | /api/v1/genres                      | Public   |
| GET    | /api/v1/titles/{id}/seasons         | Public   |
| GET    | /api/v1/seasons/{id}/episodes       | Public   |
| GET    | /api/v1/episodes/{id}               | Public   |
| GET    | /api/v1/titles/{id}/recommendations | Public   |

## Accounts

| Method | Path                                     | X?c th?c      |
| ------ | ---------------------------------------- | ------------- |
| POST   | /api/v1/users                            | Public        |
| GET    | /api/v1/users/{id}                       | Access Bearer |
| POST   | /api/v1/auth/password-reset-requests     | Public        |
| POST   | /api/v1/auth/password-resets             | Public        |
| POST   | /api/v1/auth/email-verification-requests | Public        |
| POST   | /api/v1/auth/email-verifications         | Public        |

## Playback

| Method | Path                                    | X?c th?c                            |
| ------ | --------------------------------------- | ----------------------------------- |
| POST   | /api/v1/episodes/{id}/playback-sessions | Bearer ho?c kh?ch                   |
| GET    | /api/v1/playback-sessions/{id}          | Guest management ho?c Access Bearer |
| DELETE | /api/v1/playback-sessions/{id}          | Guest management ho?c Access Bearer |
| POST   | /api/v1/playback-sessions/{id}/renewals | Guest management ho?c Access Bearer |
| POST   | /api/v1/playback-sessions/{id}/events   | Session telemetry                   |

## My library

| Method | Path                           | X?c th?c      |
| ------ | ------------------------------ | ------------- |
| GET    | /api/v1/me/watchlist           | Access Bearer |
| PUT    | /api/v1/me/watchlist/{id}      | Access Bearer |
| DELETE | /api/v1/me/watchlist/{id}      | Access Bearer |
| GET    | /api/v1/me/history             | Access Bearer |
| GET    | /api/v1/me/continue-watching   | Access Bearer |
| GET    | /api/v1/me/watch-progress/{id} | Access Bearer |
| PUT    | /api/v1/me/watch-progress/{id} | Access Bearer |

## Reports

| Method | Path                 | X?c th?c                            |
| ------ | -------------------- | ----------------------------------- |
| POST   | /api/v1/reports      | Guest management ho?c Access Bearer |
| GET    | /api/v1/reports/{id} | Guest management ho?c Access Bearer |

## Admin / Uploads

| Method | Path                                                | X?c th?c      |
| ------ | --------------------------------------------------- | ------------- |
| POST   | /api/v1/admin/episodes/{id}/upload-intents          | Access Bearer |
| GET    | /api/v1/admin/upload-intents/{id}                   | Access Bearer |
| POST   | /api/v1/admin/upload-intents/{id}/verifications     | Access Bearer |
| POST   | /api/v1/admin/media-assets/{id}/processing-attempts | Access Bearer |

## Health

| Method | Path           | X?c th?c |
| ------ | -------------- | -------- |
| GET    | /api/v1/health | Public   |

## Authentication

| Method | Path                                               | X?c th?c      |
| ------ | -------------------------------------------------- | ------------- |
| POST   | /api/v1/auth/sessions                              | Public        |
| POST   | /api/v1/auth/mfa-challenges/{id}/verifications     | Public        |
| POST   | /api/v1/auth/token-renewals                        | Public        |
| GET    | /api/v1/me                                         | Access Bearer |
| POST   | /api/v1/auth/step-up-challenges                    | Access Bearer |
| POST   | /api/v1/auth/step-up-challenges/{id}/verifications | Public        |
| GET    | /api/v1/auth/sessions/{id}                         | Access Bearer |
| GET    | /api/v1/auth/mfa-challenges/{id}                   | MFA context   |
| GET    | /api/v1/auth/step-up-challenges/{id}               | MFA context   |
| DELETE | /api/v1/auth/sessions/current                      | Access Bearer |

## Admin / Catalog

| Method | Path                                    | X?c th?c      |
| ------ | --------------------------------------- | ------------- |
| GET    | /api/v1/admin/titles                    | Access Bearer |
| POST   | /api/v1/admin/titles                    | Access Bearer |
| GET    | /api/v1/admin/titles/{id}               | Access Bearer |
| PATCH  | /api/v1/admin/titles/{id}               | Access Bearer |
| GET    | /api/v1/admin/titles/{id}/publication   | Access Bearer |
| PUT    | /api/v1/admin/titles/{id}/publication   | Access Bearer |
| GET    | /api/v1/admin/titles/{id}/seasons       | Access Bearer |
| POST   | /api/v1/admin/titles/{id}/seasons       | Access Bearer |
| GET    | /api/v1/admin/seasons/{id}              | Access Bearer |
| PATCH  | /api/v1/admin/seasons/{id}              | Access Bearer |
| GET    | /api/v1/admin/seasons/{id}/episodes     | Access Bearer |
| POST   | /api/v1/admin/seasons/{id}/episodes     | Access Bearer |
| GET    | /api/v1/admin/episodes/{id}             | Access Bearer |
| PATCH  | /api/v1/admin/episodes/{id}             | Access Bearer |
| GET    | /api/v1/admin/episodes/{id}/publication | Access Bearer |
| PUT    | /api/v1/admin/episodes/{id}/publication | Access Bearer |

## Admin / Accounts and RBAC

| Method | Path                            | X?c th?c      |
| ------ | ------------------------------- | ------------- |
| GET    | /api/v1/admin/users             | Access Bearer |
| GET    | /api/v1/admin/users/{id}        | Access Bearer |
| GET    | /api/v1/admin/users/{id}/status | Access Bearer |
| PUT    | /api/v1/admin/users/{id}/status | Access Bearer |
| GET    | /api/v1/admin/roles             | Access Bearer |
| GET    | /api/v1/admin/permissions       | Access Bearer |
| GET    | /api/v1/admin/users/{id}/roles  | Access Bearer |
| PUT    | /api/v1/admin/users/{id}/roles  | Access Bearer |

## Admin / Resources

| Method | Path                                   | X?c th?c      |
| ------ | -------------------------------------- | ------------- |
| GET    | /api/v1/admin/genres                   | Access Bearer |
| POST   | /api/v1/admin/genres                   | Access Bearer |
| GET    | /api/v1/admin/genres/{id}              | Access Bearer |
| PATCH  | /api/v1/admin/genres/{id}              | Access Bearer |
| GET    | /api/v1/admin/people                   | Access Bearer |
| POST   | /api/v1/admin/people                   | Access Bearer |
| GET    | /api/v1/admin/people/{id}              | Access Bearer |
| PATCH  | /api/v1/admin/people/{id}              | Access Bearer |
| GET    | /api/v1/admin/banners                  | Access Bearer |
| POST   | /api/v1/admin/banners                  | Access Bearer |
| GET    | /api/v1/admin/banners/{id}             | Access Bearer |
| PATCH  | /api/v1/admin/banners/{id}             | Access Bearer |
| GET    | /api/v1/admin/settings/site            | Access Bearer |
| PUT    | /api/v1/admin/settings/site            | Access Bearer |
| GET    | /api/v1/admin/metrics/summary          | Access Bearer |
| GET    | /api/v1/admin/reports                  | Access Bearer |
| GET    | /api/v1/admin/audit-logs               | Access Bearer |
| GET    | /api/v1/admin/audit-logs/{id}          | Access Bearer |
| GET    | /api/v1/admin/media-assets/{id}        | Access Bearer |
| GET    | /api/v1/admin/processing-attempts/{id} | Access Bearer |
| GET    | /api/v1/admin/operations/{id}          | Access Bearer |

## Webhook provider

POST /api/v1/webhooks/cloudinary d?ng ch? k? Cloudinary v? callback proof, kh?ng d?ng JWT/cookie; t?ch kh?i Swagger. Xem [h?p ??ng webhook v? worker](media-worker.md).
