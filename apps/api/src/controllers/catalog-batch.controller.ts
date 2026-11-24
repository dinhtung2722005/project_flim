import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Actor, Principal, RequirePermissions, UuidPipe } from "../common";
import { CatalogBatchService } from "../services/catalog-batch.service";
import {
  CatalogBatchPreviewDto,
  CatalogBatchConfirmDto,
  CatalogBatchQueryDto,
} from "../dto/catalog-batch.dto";
@ApiTags("Admin / Catalog batches")
@ApiBearerAuth()
@Controller("admin/catalog-batches")
export class CatalogBatchController {
  constructor(private readonly batches: CatalogBatchService) {}
  @Post("previews")
  @RequirePermissions("catalog.read_drafts")
  @ApiOperation({
    summary:
      "Create a five-minute immutable preview for up to20 titles. Publication additionally requires catalog.publish; genres require catalog.write.",
  })
  async preview(
    @Actor() a: Principal,
    @Body() b: CatalogBatchPreviewDto,
    @Res({ passthrough: true }) r: Response,
  ) {
    const v = await this.batches.preview(a, b);
    r.setHeader("ETag", v.etag);
    r.setHeader("Location", "/api/v1/admin/catalog-batches/" + v.body.id);
    r.setHeader("Cache-Control", "private, no-store");
    return v.body;
  }
  @Get()
  @RequirePermissions("catalog.read_drafts")
  @ApiOperation({
    summary:
      "Read your catalog batch history, cursor-bound owner/state filter; no other staff jobs.",
  })
  list(
    @Actor() a: Principal,
    @Query() q: CatalogBatchQueryDto,
    @Res({ passthrough: true }) r: Response,
  ) {
    r.setHeader("Cache-Control", "private, no-store");
    return this.batches.list(a, q);
  }
  @Get(":id")
  @RequirePermissions("catalog.read_drafts")
  @ApiOperation({
    summary:
      "Read your batch preview/progress/result with per-title receipts and current ETag.",
  })
  async get(
    @Actor() a: Principal,
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) r: Response,
  ) {
    const v = await this.batches.get(a, id);
    r.setHeader("ETag", v.etag);
    r.setHeader("Cache-Control", "private, no-store");
    return v.body;
  }
  @Post(":id/execution")
  @HttpCode(200)
  @RequirePermissions("catalog.read_drafts")
  @ApiHeader({
    name: "If-Match",
    required: true,
    description:
      "Preview ETag; replay/resume accepts original preview or current receipt ETag.",
  })
  @ApiOperation({
    summary:
      "Confirm/resume a bounded batch; each title change, audit/outbox and receipt commit together. Current permissions and title versions rechecked.",
  })
  async execute(
    @Actor() a: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() b: CatalogBatchConfirmDto,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) r: Response,
  ) {
    const v = await this.batches.execute(a, id, match);
    r.status(200).setHeader("ETag", v.etag);
    r.setHeader("Cache-Control", "private, no-store");
    return v.body;
  }
}
