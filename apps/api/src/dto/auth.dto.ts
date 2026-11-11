import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin@pj-flim.local" })
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}

export class VerifyMfaDto {
  @ApiProperty() @IsString() @MaxLength(2048) challengeToken!: string;
  @ApiProperty({ description: "Six digit TOTP, or one unused recovery code." })
  @IsString()
  @Matches(/^(?:\d{6}|[a-f0-9]{32})$/)
  code!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(40)
  @MaxLength(256)
  refreshToken!: string;
}
