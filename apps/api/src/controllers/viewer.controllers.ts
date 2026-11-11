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
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Actor, Principal, Public, UuidPipe, json } from "../common";
import { PageDto } from "../dto/common.dto";
import { PublicTitlesDto } from "../dto/catalog.dto";
import {
  RegisterDto,
  EmailRequestDto,
  ProofTokenDto,
  PasswordResetDto,
} from "../dto/accounts.dto";
import { CreatePlaybackDto, EventsDto } from "../dto/playback.dto";
import { ProgressDto } from "../dto/library.dto";
import { ReportDto } from "../dto/reports.dto";
import { ViewerRequest } from "../viewer-common";
import { PublicCatalogService } from "../services/public-catalog.service";
import { PlaybackService } from "../services/playback.service";
import { LibraryService } from "../services/library.service";
import { AccountsService } from "../services/accounts.service";
@ApiTags("Public / Catalog")
@Public()
@Controller()
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}
  @Get("titles")
  @ApiOperation({
    summary:
      "Browse/search published playable titles; q matches normalized names, aliases and cast; signed cursor pagination.",
  })
  titles(@Query() dto: PublicTitlesDto) {
    return this.catalog.titles(dto);
  }
  @Get("titles/:id")
  @ApiOperation({
    summary:
      "Public title details, genres and cast; hidden content returns 404.",
  })
  title(@Param("id", UuidPipe) id: string) {
    return this.catalog.detail(id);
  }
  @Get("genres")
  @ApiOperation({ summary: "List genres with cursor pagination." })
  genres(@Query() dto: PageDto) {
    return this.catalog.genres(dto);
  }
  @Get("titles/:id/seasons")
  @ApiOperation({
    summary:
      "Seasons containing published playable episodes, ordered by number.",
  })
  seasons(@Param("id", UuidPipe) id: string, @Query() dto: PageDto) {
    return this.catalog.seasons(id, dto);
  }
  @Get("seasons/:id/episodes")
  @ApiOperation({
    summary:
      "Published playable episodes in season order; no delivery credentials.",
  })
  episodes(@Param("id", UuidPipe) id: string, @Query() dto: PageDto) {
    return this.catalog.episodes(id, dto);
  }
  @Get("episodes/:id")
  @ApiOperation({ summary: "Public episode metadata and duration." })
  episode(@Param("id", UuidPipe) id: string) {
    return this.catalog.episode(id).then(json);
  }
  @Get("titles/:id/recommendations")
  @ApiOperation({
    summary:
      "MVP related titles sharing genres; excludes hidden/unplayable titles.",
  })
  recommendations(@Param("id", UuidPipe) id: string, @Query() dto: PageDto) {
    return this.catalog.recommendations(id, dto);
  }
}
@ApiTags("Accounts")
@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}
  @Public()
  @Post("users")
  @ApiOperation({
    summary:
      "Register a MEMBER account and enqueue verification email; roles/status cannot be supplied.",
  })
  @ApiResponse({
    status: 201,
    description:
      "Account created. Verification email queued; credentials are never returned.",
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: ViewerRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.accounts.register(dto, req);
    res.location("/api/v1/users/" + result.id);
    return result;
  }
  @ApiBearerAuth()
  @Get("users/:id")
  @ApiOperation({
    summary:
      "Read your own account; other users return 404. Admin uses /admin/users.",
  })
  user(@Actor() actor: Principal, @Param("id", UuidPipe) id: string) {
    return this.accounts.user(actor, id);
  }
  @Public()
  @Post("auth/password-reset-requests")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Request a reset email; same response for unknown/ineligible accounts.",
  })
  requestReset(@Body() dto: EmailRequestDto, @Req() req: ViewerRequest) {
    return this.accounts.requestEmail(dto, req, "reset-password");
  }
  @Public()
  @Post("auth/password-resets")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Consume a one-time reset token; revoke auth and playback sessions. Staff MFA remains required.",
  })
  reset(@Body() dto: PasswordResetDto, @Req() req: ViewerRequest) {
    return this.accounts.reset(dto, req);
  }
  @Public()
  @Post("auth/email-verification-requests")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Request email verification; generic response without account enumeration.",
  })
  requestVerification(@Body() dto: EmailRequestDto, @Req() req: ViewerRequest) {
    return this.accounts.requestEmail(dto, req, "verify-email");
  }
  @Public()
  @Post("auth/email-verifications")
  @HttpCode(200)
  @ApiOperation({ summary: "Consume a one-time email verification token." })
  verify(@Body() dto: ProofTokenDto, @Req() req: ViewerRequest) {
    return this.accounts.verify(dto, req);
  }
}
@ApiTags("Playback")
@Public()
@Controller()
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}
  @Post("episodes/:id/playback-sessions")
  @ApiBearerAuth()
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({
    name: "X-Guest-Id",
    required: false,
    description:
      "Guests must send a stable random 43-128 character URL-safe identifier. Store locally; never use an email.",
  })
  @ApiOperation({
    summary:
      "Create an authenticated user or guest playback session; only verified published HLS assets.",
  })
  @ApiResponse({
    status: 201,
    description:
      "Session with signed HLS URL, session expiry, telemetry token and guest management token. Signed CDN URL itself has no expiry; delivery.expiresAt=null.",
  })
  async create(
    @Param("id", UuidPipe) id: string,
    @Body() _dto: CreatePlaybackDto,
    @Req() req: ViewerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.playback.create(id, req, key);
    res.location("/api/v1/playback-sessions/" + result.id);
    return result;
  }
  @Get("playback-sessions/:id")
  @ApiBearerAuth()
  @ApiSecurity("playback-management")
  @ApiOperation({
    summary:
      "Read your playback session; guests need X-Playback-Management. Rechecks publication and pinned asset readiness.",
  })
  get(@Param("id", UuidPipe) id: string, @Req() req: ViewerRequest) {
    return this.playback.get(id, req);
  }
  @Delete("playback-sessions/:id")
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiSecurity("playback-management")
  @ApiOperation({
    summary:
      "Close your session; repeated closes succeed. Previously issued static CDN URLs are not immediately revoked.",
  })
  close(@Param("id", UuidPipe) id: string, @Req() req: ViewerRequest) {
    return this.playback.close(id, req);
  }
  @Post("playback-sessions/:id/renewals")
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiSecurity("playback-management")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary:
      "Renew a live session after permission/readiness checks; pins original asset version and increments delivery generation once per key.",
  })
  renew(
    @Param("id", UuidPipe) id: string,
    @Body() _dto: CreatePlaybackDto,
    @Req() req: ViewerRequest,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.playback.renew(id, req, key);
  }
  @Post("playback-sessions/:id/events")
  @HttpCode(202)
  @ApiSecurity("playback-telemetry")
  @ApiOperation({
    summary:
      "Durably accept 1-50 events atomically; duplicate event/batch IDs must have identical content. Does not update resume or aggregate views.",
  })
  events(
    @Param("id", UuidPipe) id: string,
    @Body() dto: EventsDto,
    @Req() req: ViewerRequest,
  ) {
    return this.playback.events(id, dto, req);
  }
}
@ApiTags("My library")
@ApiBearerAuth()
@Controller("me")
export class LibraryController {
  constructor(private readonly library: LibraryService) {}
  @Get("watchlist")
  @ApiOperation({ summary: "Your saved public playable titles." })
  watchlist(@Actor() actor: Principal, @Query() dto: PageDto) {
    return this.library.watchlist(actor, dto);
  }
  @Put("watchlist/:id")
  @ApiOperation({
    summary: "Save a published title; 201 on insert, 204 when already saved.",
  })
  @ApiResponse({ status: 201, description: "Added." })
  @ApiResponse({ status: 204, description: "Already saved." })
  async add(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const created = await this.library.add(actor, id);
    res.status(created ? 201 : 204);
    if (created) {
      res.location("/api/v1/me/watchlist");
      return { titleId: id };
    }
  }
  @Delete("watchlist/:id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove your saved title; repeated deletion succeeds.",
  })
  remove(@Actor() actor: Principal, @Param("id", UuidPipe) id: string) {
    return this.library.remove(actor, id);
  }
  @Get("history")
  @ApiOperation({
    summary: "Your progress history; excludes hidden/unplayable content.",
  })
  history(@Actor() actor: Principal, @Query() dto: PageDto) {
    return this.library.history(actor, dto);
  }
  @Get("continue-watching")
  @ApiOperation({
    summary:
      "Unfinished progress for the active asset; changed video versions are not resumed automatically.",
  })
  continuing(@Actor() actor: Principal, @Query() dto: PageDto) {
    return this.library.history(actor, dto, true);
  }
  @Get("watch-progress/:id")
  @ApiOperation({
    summary:
      "Read your progress; resumeEligible=false and positionSeconds=0 after video replacement.",
  })
  progress(@Actor() actor: Principal, @Param("id", UuidPipe) id: string) {
    return this.library.progress(actor, id);
  }
  @Put("watch-progress/:id")
  @ApiOperation({
    summary:
      "Save progress with current session generation and increasing sequence; merge actually watched intervals. Old sessions cannot overwrite new progress.",
  })
  @ApiResponse({ status: 201, description: "First progress saved." })
  async save(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() dto: ProgressDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.library.saveProgress(actor, id, dto);
    res.status(result.created ? 201 : 200);
    if (result.created) res.location("/api/v1/me/watch-progress/" + id);
    return result.body;
  }
}
@ApiTags("Reports")
@Public()
@Controller("reports")
export class ReportsController {
  constructor(private readonly library: LibraryService) {}
  @Post()
  @ApiBearerAuth()
  @ApiSecurity("playback-management")
  @ApiOperation({
    summary:
      "Report content problems. Guest needs own live playback session and X-Playback-Management; message is plain text.",
  })
  async create(
    @Body() dto: ReportDto,
    @Req() req: ViewerRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.library.report(dto, req);
    res.location("/api/v1/reports/" + result.id);
    return result;
  }
  @Get(":id")
  @ApiBearerAuth()
  @ApiSecurity("playback-management")
  @ApiOperation({
    summary:
      "Read your own report; other users return 404. Staff triage fields are excluded.",
  })
  detail(@Param("id", UuidPipe) id: string, @Req() req: ViewerRequest) {
    return this.library.reportDetail(id, req);
  }
}
