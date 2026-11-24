import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";
export class ReviewSourceDto {
  @ApiProperty({
    minimum: 1,
    maximum: 2147483647,
    description: "TMDB movie/TV ID; server verifies kind, title and year.",
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  externalId!: number;
}
