import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Actor, Principal, RequirePermissions, UuidPipe } from "../common";
import { AdminAdvancedService } from "../services/admin-advanced.service";
import { ViewStatsService } from "../services/view-stats.service";
import {
  AdminReviewQueryDto,
  ModerateReviewDto,
  CatalogHealthQueryDto,
} from "../dto/admin-advanced.dto";
import { ViewMetricsDto } from "../dto/view-stats.dto";
import { viewMetricsCsv } from "../../../../packages/analytics/src/csv";
@ApiTags("Admin / Advanced")
@ApiBearerAuth()
@Controller("admin")
export class AdminAdvancedController {
  constructor(
    private readonly advanced: AdminAdvancedService,
    private readonly views: ViewStatsService,
  ) {}
  @Get("viewer-reviews")
  @RequirePermissions("reviews.moderate")
  @ApiOperation({
    summary:
      "List viewer reviews for moderation, cursor-bound status/title filters; no email or user ID.",
  })
  list(
    @Actor() a: Principal,
    @Query() q: AdminReviewQueryDto,
    @Res({ passthrough: true }) r: Response,
  ) {
    r.setHeader("Cache-Control", "private, no-store");
    return this.advanced.reviews(a, q);
  }
  @Get("viewer-reviews/:id")
  @RequirePermissions("reviews.moderate")
  @ApiOperation({ summary: "Read current viewer review and moderation ETag." })
  async get(
    @Actor() a: Principal,
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) r: Response,
  ) {
    const v = await this.advanced.review(a, id);
    r.setHeader("Cache-Control", "private, no-store");
    r.setHeader("ETag", v.etag);
    return v.body;
  }
  @Patch("viewer-reviews/:id/moderation")
  @RequirePermissions("reviews.moderate")
  @ApiHeader({
    name: "If-Match",
    required: true,
    description: "Current review-moderation ETag from detail.",
  })
  @ApiOperation({
    summary:
      "Hide/restore a viewer review with an audited reason. Author edits do not unhide.",
  })
  async moderate(
    @Actor() a: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() b: ModerateReviewDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    const v = await this.advanced.moderate(a, id, b, match);
    r.setHeader("Cache-Control", "private, no-store");
    r.setHeader("ETag", v.etag);
    return v.body;
  }
  @Get("catalog-health")
  @RequirePermissions("catalog.read_drafts")
  @ApiOperation({
    summary:
      "Read catalog metadata warnings and video readiness; read-only preflight, publication still validates at mutation time.",
  })
  health(
    @Actor() a: Principal,
    @Query() q: CatalogHealthQueryDto,
    @Res({ passthrough: true }) r: Response,
  ) {
    r.setHeader("Cache-Control", "private, no-store");
    return this.advanced.health(a, q);
  }
  @Get("metrics/views/export")
  @RequirePermissions("metrics.read")
  @ApiProduces("text/csv")
  @ApiOperation({
    summary:
      "Download bounded 7/30/90-day qualified view metrics CSV; audited, bigint-safe, formula-escaped, UTF-8 BOM.",
  })
  async csv(
    @Actor() a: Principal,
    @Query() q: ViewMetricsDto,
    @Res() r: Response,
  ) {
    const data = await this.views.admin(a, q, true);
    r.setHeader(
      "Content-Disposition",
      'attachment; filename="pj-flim-views-' + q.days + '-days.csv"',
    );
    r.setHeader("Cache-Control", "private, no-store");
    r.type("text/csv; charset=utf-8").send(viewMetricsCsv(data));
  }
}
