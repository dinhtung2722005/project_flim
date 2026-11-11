import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreatePlaybackDto {
  @ApiPropertyOptional({ enum: ["HLS"], default: "HLS" })
  @IsOptional()
  @IsIn(["HLS"])
  format: string = "HLS";
}

export class PlaybackEventDto {
  @ApiProperty() @IsUUID() id!: string;
  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  sequence!: number;
  @ApiProperty({
    enum: [
      "play",
      "pause",
      "seek",
      "ended",
      "buffering-start",
      "buffering-end",
      "error",
      "quality-change",
      "heartbeat",
    ],
  })
  @IsIn([
    "play",
    "pause",
    "seek",
    "ended",
    "buffering-start",
    "buffering-end",
    "error",
    "quality-change",
    "heartbeat",
  ])
  type!: string;
  @ApiProperty({ maximum: 604800000 })
  @IsInt()
  @Min(0)
  @Max(604800000)
  elapsedMs!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999)
  positionSeconds?: number;
  @ApiPropertyOptional({
    description: "Stable error code, never URL or exception text.",
  })
  @IsOptional()
  @Matches(/^[A-Z0-9_]{1,80}$/)
  errorCode?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(16384)
  height?: number;
}

export class EventsDto {
  @ApiProperty() @IsUUID() batchId!: string;
  @ApiProperty({ type: [PlaybackEventDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PlaybackEventDto)
  events!: PlaybackEventDto[];
}
