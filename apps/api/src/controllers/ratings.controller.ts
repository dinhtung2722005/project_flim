import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public, UuidPipe } from "../common";
import { RatingsService } from "../services/ratings.service";
@ApiTags("Viewer / Ratings")
@Controller("titles")
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}
  @Get(":id/ratings")
  @Public()
  @ApiOperation({
    summary:
      "Read IMDb rating and Metacritic Metascore via OMDb after exact title/year/type matching; 24h memory cache.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Separate 10/100 scales, nullable scores, source and timestamp. Missing provider data does not block playback.",
    schema: {
      type: "object",
      required: ["status", "provider", "imdb", "metacritic", "fetchedAt"],
      properties: {
        status: {
          type: "string",
          enum: ["READY", "NOT_CONFIGURED", "NOT_FOUND", "UNAVAILABLE"],
        },
        provider: { type: "string", enum: ["OMDB"] },
        imdb: {
          type: "object",
          required: ["score", "scale", "votes", "url"],
          properties: {
            score: { type: "number", minimum: 0, maximum: 10, nullable: true },
            scale: { type: "integer", enum: [10] },
            votes: { type: "integer", nullable: true },
            url: { type: "string", nullable: true, format: "uri" },
          },
        },
        metacritic: {
          type: "object",
          required: ["score", "scale"],
          properties: {
            score: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              nullable: true,
            },
            scale: { type: "integer", enum: [100] },
          },
        },
        fetchedAt: { type: "string", nullable: true, format: "date-time" },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Title unavailable, draft or not playable.",
  })
  get(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.ratings.get(id);
  }
}
