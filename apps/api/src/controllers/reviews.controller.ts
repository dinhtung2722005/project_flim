import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
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
import {
  Actor,
  Principal,
  Public,
  RequirePermissions,
  UuidPipe,
  etag,
} from "../common";
import { PageDto } from "../dto/common.dto";
import { ReviewSourceDto } from "../dto/reviews.dto";
import { ReviewsService } from "../services/reviews.service";
@ApiTags("Viewer / Reviews")
@Controller("titles")
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get(":id/reviews")
  @Public()
  @ApiOperation({
    summary:
      "Read cached TMDB user reviews for an eligible published title; no external network request.",
  })
  @ApiResponse({
    status: 200,
    description:
      "data/page/meta; explicit NOT_CONFIGURED, UNMAPPED, NOT_FETCHED, STALE or READY status. Plain text content; TMDB rating out of 10.",
  })
  @ApiResponse({
    status: 404,
    description: "Title unavailable, draft or not playable.",
  })
  list(
    @Param("id", UuidPipe) id: string,
    @Query() dto: PageDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.reviews.list(id, dto);
  }
}
@ApiTags("Admin / Reviews")
@ApiBearerAuth()
@ApiResponse({ status: 401, description: "Session required." })
@ApiResponse({
  status: 403,
  description: "Current catalog permission required.",
})
@Controller("admin/titles")
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get(":id/review-source")
  @RequirePermissions("catalog.read_drafts")
  @ApiOperation({
    summary:
      "Read review mapping/configuration and ETag; version zero represents no mapping.",
  })
  async source(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.reviews.source(id);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("ETag", etag("review-source", id, row.etagVersion));
    return row;
  }
  @Get(":id/reviews")
  @RequirePermissions("catalog.read_drafts")
  @ApiOperation({
    summary: "Preview cached reviews, including draft titles; read-only.",
  })
  list(
    @Param("id", UuidPipe) id: string,
    @Query() dto: PageDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return this.reviews.list(id, dto, true);
  }
  @Get(":id/review-candidates")
  @RequirePermissions("catalog.write")
  @ApiOperation({
    summary:
      "Search TMDB using server-owned title metadata; candidates are not automatically mapped.",
  })
  candidates(@Actor() actor: Principal, @Param("id", UuidPipe) id: string) {
    return this.reviews.candidates(actor, id);
  }
  @Put(":id/review-source")
  @RequirePermissions("catalog.write")
  @ApiHeader({
    name: "If-Match",
    required: true,
    description: "ETag from GET review-source.",
  })
  @ApiOperation({
    summary:
      "Verify TMDB ID against kind/name/year, save mapping and purge old reviews atomically.",
  })
  @ApiResponse({ status: 412, description: "Concurrent mapping/title change." })
  @ApiResponse({ status: 428, description: "If-Match required." })
  async map(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() dto: ReviewSourceDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.reviews.map(actor, id, dto.externalId, match);
    res.setHeader("ETag", etag("review-source", id, row.etagVersion));
    return row;
  }
  @Post(":id/review-sync")
  @RequirePermissions("catalog.write")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Fetch verified TMDB review metadata/content; Vietnamese first, English fallback on zero results, at most first 20 reviews, 24h TTL, audit/lease fencing.",
  })
  @ApiResponse({
    status: 200,
    description: "data/page/meta/sync; empty results succeed with count zero.",
  })
  @ApiResponse({
    status: 409,
    description: "Sync in progress or mapping changed.",
  })
  @ApiResponse({
    status: 429,
    description:
      "Admin budget/provider rate limit; at least 60 seconds between attempts per title.",
  })
  @ApiResponse({
    status: 503,
    description:
      "Provider not configured, credentials rejected, or provider unavailable.",
  })
  sync(@Actor() actor: Principal, @Param("id", UuidPipe) id: string) {
    return this.reviews.sync(actor, id);
  }
  @Delete(":id/review-source")
  @RequirePermissions("catalog.write")
  @HttpCode(204)
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOperation({
    summary:
      "Remove mapping and purge cached reviews; invalidates an in-flight sync.",
  })
  remove(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Headers("if-match") match: string | undefined,
  ) {
    return this.reviews.remove(actor, id, match);
  }
}
