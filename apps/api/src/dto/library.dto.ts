import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class ProgressDto {
  @ApiProperty() @IsUUID() sessionId!: string;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  sequence!: number;
  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999)
  positionSeconds!: number;
  @ApiPropertyOptional({
    description: "Start of continuous interval actually watched; omit on seek.",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999)
  intervalStartSeconds?: number;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  ended: boolean = false;
}
