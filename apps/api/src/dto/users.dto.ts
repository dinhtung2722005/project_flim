import { PageDto, ReasonDto } from "./common.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class UsersQueryDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional({ enum: ["ACTIVE", "SUSPENDED", "DELETED"] })
  @IsOptional()
  @IsIn(["ACTIVE", "SUSPENDED", "DELETED"])
  status?: string;
}

export class UserStatusDto extends ReasonDto {
  @ApiProperty({ enum: ["ACTIVE", "SUSPENDED"] })
  @IsIn(["ACTIVE", "SUSPENDED"])
  status!: string;
}

export class UserRolesDto extends ReasonDto {
  @ApiProperty({
    type: [String],
    enum: ["MEMBER", "EDITOR", "ADMIN", "SUPER_ADMIN", "AUDITOR"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(["MEMBER", "EDITOR", "ADMIN", "SUPER_ADMIN", "AUDITOR"], { each: true })
  roles!: string[];
}
