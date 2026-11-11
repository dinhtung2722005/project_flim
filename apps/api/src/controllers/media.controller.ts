import { RetryMediaDto } from "../dto/media.dto";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Actor, Principal, RequirePermissions, UuidPipe } from "../common";
import { CreateUploadIntentDto, VerifyUploadDto } from "../dto/media.dto";
import { MediaService } from "../services/media.service";

const uploadIntentSchema = {
  type: "object",
  required: ["id", "episodeId", "assetId", "status", "expiresAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    episodeId: { type: "string", format: "uuid" },
    assetId: { type: "string", format: "uuid" },
    internalVersion: { type: "integer" },
    status: {
      type: "string",
      enum: ["PENDING", "VERIFIED", "EXPIRED", "REJECTED"],
    },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    verifiedAt: { type: "string", format: "date-time", nullable: true },
    expectedBytes: { type: "integer" },
    sourceFormat: { type: "string" },
    upload: {
      type: "object",
      description:
        "Only present for unexpired PENDING intents. Never cache signed fields.",
      properties: {
        method: { type: "string", enum: ["POST"] },
        url: { type: "string", format: "uri" },
        resourceType: { type: "string", enum: ["video"] },
        deliveryType: { type: "string", enum: ["authenticated"] },
        chunkSize: { type: "integer", example: 20971520 },
        expectedBytes: { type: "integer" },
        maxBytes: { type: "integer" },
        signatureExpiresAt: { type: "string", format: "date-time" },
        fields: {
          type: "object",
          additionalProperties: {
            oneOf: [
              { type: "string" },
              { type: "integer" },
              { type: "boolean" },
            ],
          },
        },
      },
    },
  },
};
const verificationSchema = {
  type: "object",
  required: [
    "intentId",
    "episodeId",
    "assetId",
    "status",
    "processingStatus",
    "operationId",
  ],
  properties: {
    intentId: { type: "string", format: "uuid" },
    episodeId: { type: "string", format: "uuid" },
    assetId: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["VERIFIED"] },
    processingStatus: {
      type: "string",
      description:
        "UPLOADED on first verification; completion requires a separate worker.",
    },
    operationId: { type: "string", format: "uuid", nullable: true },
    operationUrl: { type: "string", nullable: true },
  },
};

@ApiTags("Admin / Uploads")
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  description: "Authenticated session with MFA required.",
})
@ApiResponse({
  status: 403,
  description: "Required media.upload or media.retry permission missing.",
})
@ApiResponse({
  status: 404,
  description:
    "Episode/intent not found, archived, or intent owned by another user.",
})
@ApiResponse({
  status: 409,
  description:
    "Expired intent, conflicting idempotency key, or upload not available yet.",
})
@ApiResponse({
  status: 422,
  description: "Invalid input or provider metadata mismatch.",
})
@ApiResponse({
  status: 429,
  description: "Upload or verification quota exceeded.",
})
@ApiResponse({
  status: 503,
  description: "Cloudinary configuration, preset, or provider unavailable.",
})
@Controller("admin")
@RequirePermissions("media.upload")
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @Post("episodes/:id/upload-intents")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary:
      "Reserve an episode asset and issue signed direct-upload parameters.",
  })
  @ApiCreatedResponse({
    description:
      "Upload intent and signed form fields; never the API secret. Location points to the intent.",
    schema: uploadIntentSchema,
    headers: {
      Location: { schema: { type: "string" } },
      "Cache-Control": { schema: { type: "string", example: "no-store" } },
    },
  })
  async create(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: CreateUploadIntentDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.media.create(actor, id, body, key);
    res.location("/api/v1/admin/upload-intents/" + result.id);
    res.set("Cache-Control", "no-store");
    return result;
  }
  @Get("upload-intents/:id")
  @ApiOperation({
    summary:
      "Read your upload intent; pending intents include the original signed fields.",
  })
  @ApiOkResponse({
    description: "Intent metadata and upload instructions when still pending.",
    schema: uploadIntentSchema,
  })
  async get(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    return this.media.get(actor, id);
  }
  @Post("upload-intents/:id/verifications")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary:
      "Verify the original video directly with Cloudinary and durably queue HLS processing.",
    description:
      "Bounded synchronous metadata lookup. VERIFIED means the source is verified; the asset remains UPLOADED until the separate worker processes HLS and backup. Provider results supplied by the browser are not accepted.",
  })
  @ApiOkResponse({
    description:
      "Verified intent, asset ID and durable processing operation reference.",
    schema: verificationSchema,
  })
  @ApiResponse({ status: 502, description: "Malformed provider response." })
  @ApiResponse({
    status: 504,
    description:
      "Cloudinary metadata lookup timed out; same key may be retried.",
  })
  async verify(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: VerifyUploadDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    return this.media.verify(actor, id, body, key);
  }

  @Post("media-assets/:id/processing-attempts")
  @HttpCode(202)
  @RequirePermissions("media.retry")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary:
      "Retry failed media processing as a new fenced attempt. Active attempts cannot be duplicated.",
  })
  @ApiResponse({
    status: 202,
    description:
      "Durable processing operation queued; Location and Retry-After point to status.",
  })
  async retry(
    @Actor() actor: Principal,
    @Param("id", UuidPipe) id: string,
    @Body() body: RetryMediaDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.media.retry(actor, id, body, key);
    res
      .location(result.operationUrl)
      .set("Retry-After", "3")
      .set("Cache-Control", "no-store");
    return result;
  }
}
