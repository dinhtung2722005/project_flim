import { ApiProperty } from "@nestjs/swagger";
import {
  IsIn,
  ValidateIf,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { VIDEO_FORMATS } from "../../../../packages/media/src/cloudinary.config";

import {
  ENCODING_PRESETS,
  EncodingPresetId,
} from "../../../../packages/contracts/src/encoding";

export class CreateUploadIntentDto {
  @ApiProperty({
    required: false,
    enum: ENCODING_PRESETS.map((p) => p.id),
    default: "balanced-720p-v1",
    description:
      "Immutable H.264/AAC ABR preset; source dimensions cap the actual outputs.",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(ENCODING_PRESETS.map((p) => p.id))
  encodingPreset?: EncodingPresetId;
  @ApiProperty({
    description:
      "Exact original file size in bytes; verified against Cloudinary.",
    minimum: 1,
    maximum: 21474836480,
  })
  @IsInt()
  @Min(1)
  @Max(21474836480)
  expectedBytes!: number;

  @ApiProperty({
    enum: [...VIDEO_FORMATS],
    description:
      "Original container, for example mp4. No filename or provider URL is accepted.",
  })
  @IsIn([...VIDEO_FORMATS])
  sourceFormat!: string;
}

export class VerifyUploadDto {
  @ApiProperty({
    format: "uuid",
    description: "Must equal the episode bound to this upload intent.",
  })
  @IsUUID()
  episodeId!: string;
}

export class RetryMediaDto {
  @ApiProperty({
    description: "Reason for retrying a failed processing attempt.",
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
