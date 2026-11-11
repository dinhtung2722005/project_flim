import { PageDto } from "./common.dto";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ListDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional({
    enum: ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"],
  })
  @IsOptional()
  @IsIn(["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"])
  status?: string;
}

export class AliasDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) alias!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(35)
  language?: string;
}

export class CreditDto {
  @ApiProperty() @IsUUID() personId!: string;
  @ApiProperty({ enum: ["ACTOR", "DIRECTOR", "WRITER", "PRODUCER"] })
  @IsIn(["ACTOR", "DIRECTOR", "WRITER", "PRODUCER"])
  role!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  characterName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class CreateTitleDto {
  @ApiProperty({ enum: ["MOVIE", "SERIES"] })
  @IsIn(["MOVIE", "SERIES"])
  kind!: string;
  @ApiProperty({ example: "phim-moi" })
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug!: string;
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  localizedTitle!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  originalTitle?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  synopsis?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1888)
  @Max(2200)
  releaseYear?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @Matches(/^[A-Z]{2}$/, { each: true })
  countryCodes?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(35)
  originalLanguage?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ageRating?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  posterAssetRef?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  backdropAssetRef?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  trailerAssetRef?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  genreIds?: string[];
  @ApiPropertyOptional({ type: [AliasDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AliasDto)
  aliases?: AliasDto[];
  @ApiPropertyOptional({ type: [CreditDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreditDto)
  credits?: CreditDto[];
}

export class UpdateTitleDto extends PartialType(CreateTitleDto, {
  skipNullProperties: false,
}) {}

export class PublicationDto {
  @ApiProperty({ enum: ["PUBLISHED", "UNPUBLISHED"] })
  @IsIn(["PUBLISHED", "UNPUBLISHED"])
  status!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateSeasonDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(10000) number!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class UpdateSeasonDto extends PartialType(CreateSeasonDto, {
  skipNullProperties: false,
}) {}

export class CreateEpisodeDto {
  @ApiProperty() @IsInt() @Min(1) @Max(100000) number!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  synopsis?: string;
}

export class UpdateEpisodeDto extends PartialType(CreateEpisodeDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  activeAssetId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999)
  introStartSeconds?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999)
  introEndSeconds?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999)
  creditsStartSeconds?: number | null;
}

export class PublicTitlesDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug?: string;
  @ApiPropertyOptional({ enum: ["MOVIE", "SERIES"] })
  @IsOptional()
  @IsIn(["MOVIE", "SERIES"])
  kind?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(100)
  genre?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1888)
  @Max(2200)
  year?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional({ enum: ["newest", "oldest"] })
  @IsOptional()
  @IsIn(["newest", "oldest"])
  sort: string = "newest";
}
