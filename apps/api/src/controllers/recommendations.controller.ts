import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Actor, Principal, UuidPipe, etag } from "../common";
import {
  RecommendationFeedbackDto,
  RecommendationPreferencesDto,
  RecommendationQueryDto,
} from "../dto/recommendations.dto";
import { RecommendationsService } from "../services/recommendations.service";
@ApiTags("Viewer / Recommendations")
@ApiBearerAuth()
@ApiResponse({ status: 401, description: "Invalid or revoked session." })
@Controller("me")
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}
  @Get("recommendations")
  @ApiOperation({
    summary:
      "Private content-based feed; opt-in signals, MMR diversity, signed 10-minute snapshot cursor. No impression tracking.",
  })
  @ApiResponse({
    status: 200,
    description:
      "data: public title cards + recommendation reason; page: limit/hasMore/nextCursor; meta: modelVersion/personalized/enabled/candidateTruncated/expiresAt.",
  })
  @ApiResponse({
    status: 400,
    description: "REQUEST_INVALID_CURSOR: tampered, wrong owner or surface.",
  })
  @ApiResponse({
    status: 409,
    description:
      "RECOMMENDATION_FEED_EXPIRED: expired/evicted feed or changed preferences. Refresh first page.",
  })
  feed(
    @Actor() actor: Principal,
    @Query() dto: RecommendationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return this.recommendations.feed(actor, dto);
  }
  @Get("recommendation-preferences")
  @ApiOperation({
    summary: "Read your consent/preferences and ETag. Default enabled=false.",
  })
  async preferences(
    @Actor() actor: Principal,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.recommendations.preferences(actor);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "ETag",
      etag("recommendation-preferences", actor.id, row.version),
    );
    return row;
  }
  @Patch("recommendation-preferences")
  @ApiHeader({
    name: "If-Match",
    required: true,
    description: "ETag returned by GET preferences.",
  })
  @ApiOperation({
    summary:
      "Replace both preference flags. Disabling deletes recommendation feedback/snapshots, preserves watchlist/history.",
  })
  @ApiResponse({
    status: 412,
    description: "RESOURCE_VERSION_MISMATCH; reload preferences before saving.",
  })
  @ApiResponse({ status: 428, description: "PRECONDITION_REQUIRED." })
  async update(
    @Actor() actor: Principal,
    @Body() dto: RecommendationPreferencesDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.recommendations.update(actor, dto, match);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "ETag",
      etag("recommendation-preferences", actor.id, row.version),
    );
    return row;
  }
  @Put("recommendation-feedback/:titleId")
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Idempotent NOT_INTERESTED for an eligible title; requires opt-in, affects current feed pages.",
  })
  @ApiResponse({
    status: 409,
    description: "RESOURCE_CONFLICT when personalization is disabled.",
  })
  async feedback(
    @Actor() actor: Principal,
    @Param("titleId", UuidPipe) id: string,
    @Body() _dto: RecommendationFeedbackDto,
  ) {
    await this.recommendations.feedback(actor, id);
  }
  @Delete("recommendation-feedback/:titleId")
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Undo your feedback, including a title that is now hidden. Reload feed to rerank.",
  })
  async undo(
    @Actor() actor: Principal,
    @Param("titleId", UuidPipe) id: string,
  ) {
    await this.recommendations.feedback(actor, id, true);
  }
}
