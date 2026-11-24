import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ViewerReviewDto {
  @ApiProperty({
    minimum: 1,
    maximum: 10,
    description: "One integer score per account/title.",
  })
  @IsInt()
  @Min(1)
  @Max(10)
  rating!: number;
  @ApiPropertyOptional({ maxLength: 2000, default: "" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  @Matches(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/u)
  content = "";
  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  containsSpoilers = false;
}
