import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateGenreDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
}

export class UpdateGenreDto extends PartialType(CreateGenreDto, {
  skipNullProperties: false,
}) {}

export class CreatePersonDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  biography?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoAssetRef?: string;
}

export class UpdatePersonDto extends PartialType(CreatePersonDto, {
  skipNullProperties: false,
}) {}

export class CreateBannerDto {
  @ApiProperty() @IsUUID() titleId!: string;
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  imageAssetRef!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  headline?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() endsAt?:
    string | null;
}

export class UpdateBannerDto extends PartialType(CreateBannerDto, {
  skipNullProperties: false,
}) {}

export class SiteSettingsDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  supportEmail?: string;
}
