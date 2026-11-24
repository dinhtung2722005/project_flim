import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
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
import { Actor, Principal, Public, UuidPipe } from "../common";
import { PageDto } from "../dto/common.dto";
import { ViewerReviewDto } from "../dto/viewer-reviews.dto";
import { ViewerReviewsService } from "../services/viewer-reviews.service";

@ApiTags("Viewer / Community reviews")
@Controller()
export class ViewerReviewsController {
  constructor(private readonly reviews: ViewerReviewsService) {}
  @Public()
  @Get("titles/:id/viewer-reviews")
  @ApiOperation({
    summary:
      "Read pj-Flim viewer reviews and aggregate score, independent of OMDb/TMDB; public playable titles only.",
  })
  list(
    @Param("id", UuidPipe) id: string,
    @Query() dto: PageDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.reviews.list(id, dto);
  }
  @Get("me/title-reviews/:id")
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Read your review (or null) and ETag for create/edit; owner is the active session.",
  })
  @ApiResponse({
    status: 200,
    description:
      "review is null when not yet rated. ETag is required for PUT/DELETE.",
  })
  async get(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reviews.get(actor, id);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("ETag", result.etag);
    return result.body;
  }
  @Put("me/title-reviews/:id")
  @ApiBearerAuth()
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOperation({
    summary:
      "Create or update your single 1-10 rating and optional plain-text review; active session, public title, 10 writes/minute.",
  })
  @ApiResponse({
    status: 428,
    description: "Read your current review ETag first.",
  })
  @ApiResponse({
    status: 412,
    description:
      "Concurrent change; reload explicitly, preserve unsaved draft.",
  })
  async save(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() dto: ViewerReviewDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reviews.save(actor, id, dto, match);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("ETag", result.etag);
    return result.body;
  }
  @Delete("me/title-reviews/:id")
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOperation({
    summary:
      "Delete only your own review, also allowed after title unpublication; current ETag required.",
  })
  async remove(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("ETag", await this.reviews.remove(actor, id, match));
  }
}
