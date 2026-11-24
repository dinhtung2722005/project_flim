import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  ArrayMaxSize,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsUUID,
  IsIn,
  IsInt,
  Min,
  Max,
  ValidateNested,
} from "class-validator";
export class MfaEnrollmentDto {
  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}
export class ConfirmEnrollmentDto {
  @ApiProperty() @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class UpdateReportDto {
  @ApiProperty({ enum: ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] })
  @IsIn(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"])
  status!: string;
  @ApiProperty() @IsString() @MaxLength(2000) resolutionNote = "";
}
