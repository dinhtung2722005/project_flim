import { CatalogBatchController } from "./controllers/catalog-batch.controller";
import { CatalogBatchService } from "./services/catalog-batch.service";
import { AdminAdvancedController } from "./controllers/admin-advanced.controller";
import { AdminAdvancedService } from "./services/admin-advanced.service";
import {
  PublicViewStatsController,
  AdminViewStatsController,
} from "./controllers/view-stats.controller";
import { ViewStatsService } from "./services/view-stats.service";
import { ViewerReviewsController } from "./controllers/viewer-reviews.controller";
import { ViewerReviewsService } from "./services/viewer-reviews.service";
import {
  MfaEnrollmentController,
  PublicSiteController,
  ExperienceAdminController,
} from "./controllers/experience.controller";
import { MfaEnrollmentService } from "./services/mfa-enrollment.service";
import { RatingsController } from "./controllers/ratings.controller";
import { RatingsService } from "./services/ratings.service";
import {
  PublicReviewsController,
  AdminReviewsController,
} from "./controllers/reviews.controller";
import { ReviewsService } from "./services/reviews.service";
import {
  AssistantController,
  AssistantInternalController,
} from "./controllers/assistant.controller";
import { AssistantService } from "./services/assistant.service";
import { AssistantCatalogService } from "./services/assistant-catalog.service";
import { AssistantDispatcher } from "./services/assistant-dispatcher.service";
import { RecommendationsController } from "./controllers/recommendations.controller";
import { RecommendationsService } from "./services/recommendations.service";
import { GlobalExceptionFilter } from "./filters/global-exception.filter";
import { HealthController } from "./controllers/health.controller";
import {
  PublicCatalogController,
  AccountsController,
  PlaybackController,
  LibraryController,
  ReportsController,
} from "./controllers/viewer.controllers";
import { PublicCatalogService } from "./services/public-catalog.service";
import { PlaybackService } from "./services/playback.service";
import { LibraryService } from "./services/library.service";
import { AccountsService } from "./services/accounts.service";
import { NotificationsService } from "./services/notifications.service";
import { CloudinaryWebhookController } from "./controllers/cloudinary-webhook.controller";
import { CloudinaryProvider } from "../../../packages/media/src/cloudinary.provider";
import { MediaController } from "./controllers/media.controller";
import { MediaService } from "./services/media.service";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { Database } from "../../../packages/database/src/database";

import { AuthService } from "./services/auth.service";
import { AccessGuard } from "./auth.guard";
import { AuthController } from "./controllers/auth.controller";
import { CatalogService } from "./services/catalog.service";
import { UsersService } from "./services/users.service";
import { ResourcesService } from "./services/resources.service";
import {
  CatalogController,
  ResourcesController,
  UsersController,
} from "./controllers/admin.controllers";

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    CatalogBatchController,
    AdminAdvancedController,
    PublicViewStatsController,
    AdminViewStatsController,
    ViewerReviewsController,
    MfaEnrollmentController,
    PublicSiteController,
    ExperienceAdminController,
    RatingsController,
    PublicReviewsController,
    AdminReviewsController,
    AssistantController,
    AssistantInternalController,
    RecommendationsController,
    PublicCatalogController,
    AccountsController,
    PlaybackController,
    LibraryController,
    ReportsController,
    CloudinaryWebhookController,
    MediaController,
    HealthController,
    AuthController,
    CatalogController,
    UsersController,
    ResourcesController,
  ],
  providers: [
    CatalogBatchService,
    AdminAdvancedService,
    ViewStatsService,
    ViewerReviewsService,
    MfaEnrollmentService,
    RatingsService,
    ReviewsService,
    AssistantService,
    AssistantCatalogService,
    AssistantDispatcher,
    RecommendationsService,
    GlobalExceptionFilter,
    { provide: APP_FILTER, useExisting: GlobalExceptionFilter },
    PublicCatalogService,
    PlaybackService,
    LibraryService,
    AccountsService,
    NotificationsService,
    CloudinaryProvider,
    MediaService,
    Database,
    AuthService,
    CatalogService,
    UsersService,
    ResourcesService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
