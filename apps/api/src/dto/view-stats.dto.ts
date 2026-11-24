import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn } from "class-validator";
export class ViewMetricsDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 7 })
  @Type(() => Number)
  @IsIn([7, 30, 90])
  days = 7;
}
