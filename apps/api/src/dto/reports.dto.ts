import { PageDto } from "./common.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";

export class ReportsQueryDto extends PageDto {
  @ApiPropertyOptional({ enum: ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] })
  @IsOptional()
  @IsIn(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"])
  status?: string;
}

export class ReportDto {
  @ApiProperty() @IsUUID() titleId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() episodeId?: string;
  @ApiPropertyOptional({ description: "Required for guest reports." })
  @IsOptional()
  @IsUUID()
  playbackSessionId?: string;
  @ApiProperty({ enum: ["PLAYBACK", "SUBTITLE", "METADATA", "OTHER"] })
  @IsIn(["PLAYBACK", "SUBTITLE", "METADATA", "OTHER"])
  category!: string;
  @ApiProperty()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  message!: string;
}
