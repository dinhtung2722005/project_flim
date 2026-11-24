import {
  Body,
  Controller,
  Delete,
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
  ApiExcludeController,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Actor, Principal, Public, UuidPipe, fail } from "../common";
import { AssistantService } from "../services/assistant.service";
import {
  CreateAssistantRunDto,
  AssistantRunQueryDto,
  AssistantToolDto,
  AssistantResultDto,
  AssistantFailureDto,
} from "../dto/assistant.dto";
@ApiTags("Viewer / Assistant")
@ApiBearerAuth()
@ApiResponse({ status: 401, description: "Authentication/session required." })
@Controller("assistant")
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}
  @Get("capabilities")
  @ApiOperation({
    summary:
      "Public-catalog/FAQ scope, engine availability and seven-day retention; requires your session.",
  })
  capabilities(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "private, no-store");
    return this.assistant.capabilities();
  }
  @Post("runs")
  @HttpCode(202)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "8–128 ASCII letters, digits, dash or underscore; reuse for the same intention.",
  })
  @ApiOperation({
    summary:
      "Queue your read-only catalog/FAQ request; result is polled, no inference in the HTTP request.",
  })
  @ApiResponse({
    status: 202,
    description: "Run id/status; Location points to your run.",
  })
  @ApiResponse({
    status: 409,
    description: "Idempotency conflict or context too old/deep.",
  })
  @ApiResponse({
    status: 429,
    description: "10 new runs/minute; at most 2 active per owner.",
  })
  async create(
    @Actor() actor: Principal,
    @Body() dto: CreateAssistantRunDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const run = await this.assistant.create(actor, dto, key);
    res.setHeader("Location", "/api/v1/assistant/runs/" + run.id);
    res.setHeader("Cache-Control", "private, no-store");
    return run;
  }
  @Get("runs")
  @ApiOperation({
    summary:
      "List only your runs, with owner-bound signed cursor; retention seven days.",
  })
  list(
    @Actor() actor: Principal,
    @Query() dto: AssistantRunQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return this.assistant.list(actor, dto);
  }
  @Get("runs/:id")
  @ApiOperation({
    summary:
      "Read your run; revalidate current catalog/FAQ before rendering a stored selection.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Queued/running or terminal status; processing errors are safe codes in the run.",
  })
  get(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    return this.assistant.get(actor, id);
  }
  @Delete("runs/:id")
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Idempotently cancel your pending run; cancellation does not delete chat history.",
  })
  async cancel(@Actor() actor: Principal, @Param("id", UuidPipe) id: string) {
    await this.assistant.cancel(actor, id);
  }
}
@ApiExcludeController()
@Public()
@Controller("internal/assistant/runs")
export class AssistantInternalController {
  constructor(private readonly assistant: AssistantService) {}
  private cap(value: string | undefined) {
    const m = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(value ?? "");
    if (!m) fail("AUTH_FORBIDDEN");
    return m[1];
  }
  @Post(":id/claims")
  @HttpCode(200)
  claim(
    @Param("id", UuidPipe) id: string,
    @Headers("x-assistant-worker-key") key: string | undefined,
  ) {
    this.assistant.checkWorker(key);
    return this.assistant.claim(id);
  }
  @Post(":id/tools")
  @HttpCode(200)
  tool(
    @Param("id", UuidPipe) id: string,
    @Headers("authorization") token: string | undefined,
    @Body() dto: AssistantToolDto,
  ) {
    return this.assistant.tool(id, this.cap(token), dto);
  }
  @Post(":id/heartbeats")
  @HttpCode(200)
  heartbeat(
    @Param("id", UuidPipe) id: string,
    @Headers("authorization") token: string | undefined,
  ) {
    return this.assistant.heartbeat(id, this.cap(token));
  }
  @Post(":id/results")
  @HttpCode(200)
  result(
    @Param("id", UuidPipe) id: string,
    @Headers("authorization") token: string | undefined,
    @Body() dto: AssistantResultDto,
  ) {
    return this.assistant.complete(id, this.cap(token), dto);
  }
  @Post(":id/failures")
  @HttpCode(200)
  failure(
    @Param("id", UuidPipe) id: string,
    @Headers("authorization") token: string | undefined,
    @Body() dto: AssistantFailureDto,
  ) {
    return this.assistant.failure(id, this.cap(token), dto.code);
  }
}
