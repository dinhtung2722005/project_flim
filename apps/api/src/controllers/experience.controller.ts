import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Headers,
  Res,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiBearerAuth,
} from "@nestjs/swagger";
import type { Response } from "express";
import {
  Actor,
  Principal,
  Public,
  RequirePermissions,
  UuidPipe,
  json,
  rowTag,
  etag,
} from "../common";
import { MfaEnrollmentService } from "../services/mfa-enrollment.service";
import { ResourcesService } from "../services/resources.service";
import { PublicCatalogService } from "../services/public-catalog.service";
import {
  MfaEnrollmentDto,
  ConfirmEnrollmentDto,
  UpdateReportDto,
} from "../dto/experience.dto";
@ApiTags("Account security")
@ApiBearerAuth()
@Controller("me/mfa")
export class MfaEnrollmentController {
  constructor(private readonly service: MfaEnrollmentService) {}
  @Get()
  @ApiOperation({ summary: "Read own MFA enrollment status." })
  status(@Actor() actor: Principal, @Res({ passthrough: true }) res: Response) {
    res.set("Cache-Control", "no-store");
    return this.service.status(actor);
  }
  @Post("enrollments")
  @ApiOperation({
    summary:
      "Start own TOTP enrollment after password confirmation. Secret is shown once.",
  })
  start(
    @Actor() actor: Principal,
    @Body() dto: MfaEnrollmentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    return this.service.start(actor, dto.password);
  }
  @Post("enrollments/:id/verifications")
  @ApiOperation({
    summary:
      "Confirm own session-bound enrollment; return recovery codes once.",
  })
  confirm(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() dto: ConfirmEnrollmentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    return this.service.confirm(actor, id, dto.code);
  }
}
@ApiTags("Public catalog")
@Public()
@Controller("site")
export class PublicSiteController {
  constructor(private readonly catalog: PublicCatalogService) {}
  @Get()
  @ApiOperation({
    summary:
      "Read whitelisted site settings and currently active, public-playable homepage banners.",
  })
  site() {
    return this.catalog.site();
  }
}
@ApiTags("Admin catalog")
@ApiBearerAuth()
@Controller("admin")
export class ExperienceAdminController {
  constructor(private readonly resources: ResourcesService) {}
  @Patch("reports/:id")
  @RequirePermissions("reports.read", "catalog.write")
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOperation({
    summary:
      "Triage a content report with current permissions and version; AUDITOR cannot mutate.",
  })
  async report(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() dto: UpdateReportDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.resources.updateReport(actor, id, dto, match);
    res.set("ETag", etag("report", id, row.version));
    return json(row);
  }
}
