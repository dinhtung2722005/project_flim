import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { PageDto } from "./common.dto";
import {
  CATALOG_BATCH_ACTIONS,
  MAX_CATALOG_BATCH_TITLES,
  type CatalogBatchAction,
} from "../../../../packages/contracts/src/catalog-batch";
export class CatalogBatchPreviewDto {
  @ApiProperty({ enum: CATALOG_BATCH_ACTIONS })
  @IsIn(CATALOG_BATCH_ACTIONS)
  action!: CatalogBatchAction;
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: MAX_CATALOG_BATCH_TITLES,
  })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === "string" ? v.toLowerCase() : v))
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CATALOG_BATCH_TITLES)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  titleIds!: string[];
  @ApiPropertyOptional({
    type: [String],
    minItems: 1,
    maxItems: 30,
    description:
      "Required for ADD_GENRES/REPLACE_GENRES; forbidden for publication actions.",
  })
  @ValidateIf(
    (o, v) =>
      ["ADD_GENRES", "REPLACE_GENRES"].includes(o.action) || v !== undefined,
  )
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === "string" ? v.toLowerCase() : v))
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  genreIds?: string[];
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
export class CatalogBatchConfirmDto {
  @ApiProperty({ enum: [true] }) @IsBoolean() @Equals(true) confirm!: boolean;
}
export class CatalogBatchQueryDto extends PageDto {
  @ApiPropertyOptional({ enum: ["PREVIEW", "RUNNING", "COMPLETED"] })
  @IsOptional()
  @IsIn(["PREVIEW", "RUNNING", "COMPLETED"])
  state?: string;
}
