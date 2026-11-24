import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { PageDto } from "./common.dto";
export class AdminReviewQueryDto extends PageDto {
  @ApiPropertyOptional({ enum: ["VISIBLE", "HIDDEN"] })
  @IsOptional()
  @IsIn(["VISIBLE", "HIDDEN"])
  status?: string;
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  titleId?: string;
}
export class ModerateReviewDto {
  @ApiProperty({ enum: ["VISIBLE", "HIDDEN"] })
  @IsIn(["VISIBLE", "HIDDEN"])
  status!: string;
  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    description:
      "Visible to the review author and retained in audit; never enter secrets.",
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
import { CATALOG_ISSUES } from "../../../../packages/contracts/src/admin";
export class CatalogHealthQueryDto extends PageDto {
  @ApiPropertyOptional({ enum: CATALOG_ISSUES })
  @IsOptional()
  @IsIn(CATALOG_ISSUES)
  issue?: string;
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
