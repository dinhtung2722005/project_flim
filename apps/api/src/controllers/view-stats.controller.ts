import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  Actor,
  Principal,
  Public,
  RequirePermissions,
  UuidPipe,
} from "../common";
import { ViewStatsService } from "../services/view-stats.service";
import { ViewMetricsDto } from "../dto/view-stats.dto";
@ApiTags("Viewer / Views")
@Controller("titles")
export class PublicViewStatsController {
  constructor(private readonly stats: ViewStatsService) {}
  @Public()
  @Get(":id/views")
  @ApiOperation({
    summary:
      "Read qualified view count for a public playable title, definition 2; counts start at measurementStartedAt, not page opens.",
  })
  get(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.stats.title(id);
  }
}
@ApiTags("Admin / Metrics")
@ApiBearerAuth()
@Controller("admin/metrics")
export class AdminViewStatsController {
  constructor(private readonly stats: ViewStatsService) {}
  @Get("views")
  @RequirePermissions("metrics.read")
  @ApiOperation({
    summary:
      "Read UTC 7/30/90-day qualified views, playback starts, zero-filled daily chart, currently public top10 and processing lag. Aggregate data only.",
  })
  get(
    @Actor() actor: Principal,
    @Query() dto: ViewMetricsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return this.stats.admin(actor, dto);
  }
}
