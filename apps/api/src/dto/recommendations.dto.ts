import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";
export class RecommendationQueryDto {
  @ApiPropertyOptional({ enum: ["home"], default: "home" })
  @IsIn(["home"])
  surface = "home";
  @ApiPropertyOptional({ default: 12, minimum: 1, maximum: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit = 12;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}
export class RecommendationPreferencesDto {
  @ApiProperty({
    description:
      "Explicit consent. False ignores watchlist/progress and clears feedback and feeds.",
  })
  @IsBoolean()
  enabled!: boolean;
  @ApiProperty({
    description:
      "Hide titles whose currently playable episodes are all completed; applied only when enabled.",
  })
  @IsBoolean()
  hideCompleted!: boolean;
}
export class RecommendationFeedbackDto {
  @ApiProperty({ enum: ["NOT_INTERESTED"] })
  @IsIn(["NOT_INTERESTED"])
  kind!: "NOT_INTERESTED";
}
