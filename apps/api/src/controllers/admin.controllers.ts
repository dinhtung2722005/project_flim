import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  applyDecorators,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import {
  Actor,
  Principal,
  RequirePermissions,
  StepUp,
  UuidPipe,
  etag,
  json,
  rowTag,
} from "../common";
import { CatalogService } from "../services/catalog.service";
import { UsersService } from "../services/users.service";
import { ResourcesService } from "../services/resources.service";
import { AuditQueryDto } from "../dto/audit.dto";
import {
  CreateBannerDto,
  CreateGenreDto,
  CreatePersonDto,
  SiteSettingsDto,
  UpdateBannerDto,
  UpdateGenreDto,
  UpdatePersonDto,
} from "../dto/resources.dto";
import {
  CreateEpisodeDto,
  CreateSeasonDto,
  CreateTitleDto,
  ListDto,
  PublicationDto,
  UpdateEpisodeDto,
  UpdateSeasonDto,
  UpdateTitleDto,
} from "../dto/catalog.dto";
import { PageDto } from "../dto/common.dto";
import { ReportsQueryDto } from "../dto/reports.dto";
import { UserRolesDto, UserStatusDto, UsersQueryDto } from "../dto/users.dto";
const problem = {
  type: "object",
  required: ["type", "title", "status", "code", "requestId"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    code: { type: "string" },
    detail: { type: "string" },
    requestId: { type: "string" },
    errors: { type: "array", items: { type: "object" } },
  },
};
const resource = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string", format: "uuid" },
    version: {
      type: "string",
      description: "Decimal bigint optimistic-lock version.",
    },
    createdAt: { type: "string", format: "date-time" },
  },
};
const collection = {
  type: "object",
  properties: {
    data: { type: "array", items: resource },
    page: {
      type: "object",
      properties: {
        limit: { type: "integer" },
        hasMore: { type: "boolean" },
        nextCursor: { type: "string", nullable: true },
      },
    },
  },
};
const ApiAdmin = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiResponse({
      status: 401,
      description: "Authentication/session required",
      content: { "application/problem+json": { schema: problem } },
    }),
    ApiResponse({
      status: 403,
      description: "Permission, MFA or step-up required",
      content: { "application/problem+json": { schema: problem } },
    }),
    ApiResponse({
      status: 422,
      description: "Validation failure",
      content: { "application/problem+json": { schema: problem } },
    }),
  );
const IfMatch = () =>
  applyDecorators(
    ApiHeader({
      name: "If-Match",
      required: true,
      description: "Strong ETag returned by GET for this exact resource.",
    }),
    ApiResponse({ status: 428, description: "If-Match missing" }),
    ApiResponse({ status: 412, description: "Resource ETag changed" }),
  );
const Item = () =>
  ApiOkResponse({
    schema: resource,
    headers: { ETag: { schema: { type: "string" } } },
  });
const Items = () => ApiOkResponse({ schema: collection });
function respond(
  res: Response,
  type: string,
  row: Record<string, any>,
  created = false,
  path?: string,
) {
  res.set(
    "ETag",
    etag(type, row.id ?? row.key, row.version ?? row.auth_version),
  );
  if (created && path) res.location(path + (row.id ?? row.key));
  return json(row);
}
@ApiTags("Admin / Catalog")
@ApiAdmin()
@Controller("admin")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get("titles")
  @RequirePermissions("catalog.read_drafts")
  @Items()
  titles(@Query() dto: ListDto) {
    return this.catalog.titles(dto);
  }
  @Post("titles")
  @RequirePermissions("catalog.write")
  @ApiCreatedResponse({ schema: resource })
  async createTitle(
    @Actor() actor: Principal,
    @Body() body: CreateTitleDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "title",
      await this.catalog.createTitle(actor, body),
      true,
      "/api/v1/admin/titles/",
    );
  }
  @Get("titles/:id")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async title(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, "title", await this.catalog.title(id));
  }
  @Patch("titles/:id")
  @RequirePermissions("catalog.write")
  @IfMatch()
  @Item()
  async updateTitle(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateTitleDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "title",
      await this.catalog.updateTitle(actor, id, body, match),
    );
  }
  @Get("titles/:id/publication")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async titlePublication(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.catalog.title(id);
    res.set("ETag", etag("title", id, row.version));
    return json({ status: row.publication_status, version: row.version });
  }
  @Put("titles/:id/publication")
  @RequirePermissions("catalog.publish")
  @IfMatch()
  @Item()
  async publishTitle(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: PublicationDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.catalog.publication(actor, id, body, match, "title");
    res.set("ETag", etag("title", id, row.version));
    return json({ status: row.publication_status, version: row.version });
  }
  @Get("titles/:id/seasons")
  @RequirePermissions("catalog.read_drafts")
  @Items()
  seasons(@Param("id", UuidPipe) id: string, @Query() dto: PageDto) {
    return this.catalog.seasons(id, dto);
  }
  @Post("titles/:id/seasons")
  @RequirePermissions("catalog.write")
  @ApiCreatedResponse({ schema: resource })
  async createSeason(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: CreateSeasonDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "season",
      await this.catalog.createSeason(actor, id, body),
      true,
      "/api/v1/admin/seasons/",
    );
  }
  @Get("seasons/:id")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async season(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, "season", await this.catalog.season(id));
  }
  @Patch("seasons/:id")
  @RequirePermissions("catalog.write")
  @IfMatch()
  @Item()
  async updateSeason(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateSeasonDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "season",
      await this.catalog.updateSeason(actor, id, body, match),
    );
  }
  @Get("seasons/:id/episodes")
  @RequirePermissions("catalog.read_drafts")
  @Items()
  episodes(@Param("id", UuidPipe) id: string, @Query() dto: PageDto) {
    return this.catalog.episodes(id, dto);
  }
  @Post("seasons/:id/episodes")
  @RequirePermissions("catalog.write")
  @ApiCreatedResponse({ schema: resource })
  async createEpisode(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: CreateEpisodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "episode",
      await this.catalog.createEpisode(actor, id, body),
      true,
      "/api/v1/admin/episodes/",
    );
  }
  @Get("episodes/:id")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async episode(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, "episode", await this.catalog.episode(id));
  }
  @Patch("episodes/:id")
  @RequirePermissions("catalog.write")
  @IfMatch()
  @Item()
  async updateEpisode(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateEpisodeDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "episode",
      await this.catalog.updateEpisode(actor, id, body, match),
    );
  }
  @Get("episodes/:id/publication")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async episodePublication(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.catalog.episode(id);
    res.set("ETag", etag("episode", id, row.version));
    return json({ status: row.publication_status, version: row.version });
  }
  @Put("episodes/:id/publication")
  @RequirePermissions("catalog.publish")
  @IfMatch()
  @Item()
  async publishEpisode(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: PublicationDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.catalog.publication(
      actor,
      id,
      body,
      match,
      "episode",
    );
    res.set("ETag", etag("episode", id, row.version));
    return json({ status: row.publication_status, version: row.version });
  }
}
@ApiTags("Admin / Accounts and RBAC")
@ApiAdmin()
@Controller("admin")
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get("users")
  @RequirePermissions("users.read")
  @Items()
  list(@Query() dto: UsersQueryDto) {
    return this.users.list(dto);
  }
  @Get("users/:id")
  @RequirePermissions("users.read")
  @Item()
  async get(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, "user", await this.users.get(id));
  }
  @Get("users/:id/status")
  @RequirePermissions("users.read")
  @Item()
  async status(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.users.get(id);
    res.set("ETag", etag("user", id, row.auth_version));
    return json({ status: row.status, authVersion: row.auth_version });
  }
  @Put("users/:id/status")
  @RequirePermissions("users.suspend")
  @IfMatch()
  @Item()
  async changeStatus(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UserStatusDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "user",
      await this.users.change(actor, id, body, match, "status"),
    );
  }
  @Get("roles")
  @RequirePermissions("rbac.read")
  @ApiOkResponse({ schema: { type: "array", items: resource } })
  async roles() {
    return json(await this.users.roles());
  }
  @Get("permissions")
  @RequirePermissions("rbac.read")
  @ApiOkResponse({ schema: { type: "array", items: resource } })
  permissions() {
    return this.users.permissions();
  }
  @Get("users/:id/roles")
  @RequirePermissions("rbac.read")
  @Item()
  async userRoles(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, "user", await this.users.userRoles(id));
  }
  @Put("users/:id/roles")
  @RequirePermissions("rbac.assign")
  @StepUp()
  @IfMatch()
  @Item()
  async changeRoles(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UserRolesDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "user",
      await this.users.change(actor, id, body, match, "roles"),
    );
  }
}
@ApiTags("Admin / Resources")
@ApiAdmin()
@Controller("admin")
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}
  @Get("genres")
  @RequirePermissions("catalog.read_drafts")
  @Items()
  genres(@Query() dto: PageDto) {
    return this.resources.genres(dto);
  }
  @Post("genres")
  @RequirePermissions("catalog.write")
  @ApiCreatedResponse({ schema: resource })
  async createGenre(
    @Actor() actor: Principal,
    @Body() body: CreateGenreDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.resources.createGenre(actor, body);
    res
      .location("/api/v1/admin/genres/" + row.id)
      .set("ETag", rowTag("genre", row));
    return json(row);
  }
  @Get("genres/:id")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async genre(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.resources.genre(id);
    res.set("ETag", rowTag("genre", row));
    return json(row);
  }
  @Patch("genres/:id")
  @RequirePermissions("catalog.write")
  @IfMatch()
  @Item()
  async updateGenre(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateGenreDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.resources.updateGenre(actor, id, body, match);
    res.set("ETag", rowTag("genre", row));
    return json(row);
  }
  @Get("people")
  @RequirePermissions("catalog.read_drafts")
  @Items()
  people(@Query() dto: PageDto) {
    return this.resources.people(dto);
  }
  @Post("people")
  @RequirePermissions("catalog.write")
  @ApiCreatedResponse({ schema: resource })
  async createPerson(
    @Actor() actor: Principal,
    @Body() body: CreatePersonDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.resources.createPerson(actor, body);
    res
      .location("/api/v1/admin/people/" + row.id)
      .set("ETag", rowTag("person", row));
    return json(row);
  }
  @Get("people/:id")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async person(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.resources.person(id);
    res.set("ETag", rowTag("person", row));
    return json(row);
  }
  @Patch("people/:id")
  @RequirePermissions("catalog.write")
  @IfMatch()
  @Item()
  async updatePerson(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdatePersonDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.resources.updatePerson(actor, id, body, match);
    res.set("ETag", rowTag("person", row));
    return json(row);
  }
  @Get("banners")
  @RequirePermissions("catalog.read_drafts")
  @Items()
  banners(@Query() dto: PageDto) {
    return this.resources.banners(dto);
  }
  @Post("banners")
  @RequirePermissions("catalog.write")
  @ApiCreatedResponse({ schema: resource })
  async createBanner(
    @Actor() actor: Principal,
    @Body() body: CreateBannerDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "banner",
      await this.resources.createBanner(actor, body),
      true,
      "/api/v1/admin/banners/",
    );
  }
  @Get("banners/:id")
  @RequirePermissions("catalog.read_drafts")
  @Item()
  async banner(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, "banner", await this.resources.banner(id));
  }
  @Patch("banners/:id")
  @RequirePermissions("catalog.write")
  @IfMatch()
  @Item()
  async updateBanner(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateBannerDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "banner",
      await this.resources.updateBanner(actor, id, body, match),
    );
  }
  @Get("settings/site")
  @RequirePermissions("settings.write")
  @Item()
  async settings(@Res({ passthrough: true }) res: Response) {
    return respond(res, "settings", await this.resources.settings());
  }
  @Put("settings/site")
  @RequirePermissions("settings.write")
  @StepUp()
  @IfMatch()
  @Item()
  async updateSettings(
    @Actor() actor: Principal,
    @Body() body: SiteSettingsDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      "settings",
      await this.resources.updateSettings(actor, body, match),
    );
  }
  @Get("metrics/summary")
  @RequirePermissions("metrics.read")
  @ApiOkResponse({
    schema: { type: "object", additionalProperties: { type: "string" } },
  })
  async summary() {
    return json(await this.resources.summary());
  }
  @Get("reports")
  @RequirePermissions("reports.read")
  @Items()
  reports(@Actor() actor: Principal, @Query() dto: ReportsQueryDto) {
    return this.resources.reports(actor, dto);
  }
  @Get("audit-logs")
  @RequirePermissions("audit.read")
  @Items()
  auditLogs(@Actor() actor: Principal, @Query() dto: AuditQueryDto) {
    return this.resources.auditLogs(actor, dto);
  }
  @Get("audit-logs/:id")
  @RequirePermissions("audit.read")
  @ApiOkResponse({ schema: { type: "object", additionalProperties: true } })
  async auditLog(@Actor() actor: Principal, @Param("id") id: string) {
    return json(await this.resources.auditLog(actor, id));
  }
  @Get("media-assets/:id")
  @RequirePermissions("media.preview")
  @Item()
  async mediaAsset(
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, "asset", await this.resources.mediaAsset(id));
  }
  @Get("processing-attempts/:id")
  @RequirePermissions("media.preview")
  @ApiOkResponse({ schema: { type: "object", additionalProperties: true } })
  async attempt(@Param("id", UuidPipe) id: string) {
    return json(await this.resources.attempt(id));
  }
  @Get("operations/:id")
  @RequirePermissions("media.preview")
  @ApiOkResponse({ schema: { type: "object", additionalProperties: true } })
  async operation(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
  ) {
    return json(await this.resources.operation(actor, id));
  }
}
