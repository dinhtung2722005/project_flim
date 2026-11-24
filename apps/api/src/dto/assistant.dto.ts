import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { PageDto } from "./common.dto";
export class AssistantFiltersDto {
  @ApiPropertyOptional({ enum: ["MOVIE", "SERIES"] })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(["MOVIE", "SERIES"])
  kind?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1880)
  @Max(2200)
  year?: number;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(/^[a-z0-9-]{1,100}$/)
  genre?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country?: string;
}
export class CreateAssistantRunDto {
  @ApiProperty({ maxLength: 2000 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
  @ApiPropertyOptional({ type: AssistantFiltersDto })
  @ValidateIf((_, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => AssistantFiltersDto)
  filters?: AssistantFiltersDto;
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  limit = 5;
  @ApiPropertyOptional({ default: true }) @IsBoolean() avoidSpoilers = true;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  contextTitleId?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  parentRunId?: string;
}
export class AssistantRunQueryDto extends PageDto {}
export class AssistantToolDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,80}$/) callId!: string;
  @IsIn([
    "search_catalog",
    "get_title_details",
    "get_published_episodes",
    "search_help",
    "get_title_feedback",
  ])
  tool!: string;
  @IsObject() args!: Record<string, unknown>;
}
export class AssistantSearchDto extends AssistantFiltersDto {
  @IsString() @MaxLength(300) query = "";
  @IsInt() @Min(1) @Max(5) limit = 5;
}
export class AssistantTitleDto {
  @IsUUID() titleId!: string;
}
export class AssistantHelpDto {
  @IsString() @MinLength(1) @MaxLength(300) query!: string;
}
export class AssistantSelectionDto {
  @IsIn(["FOUND", "EMPTY", "HELP", "NEEDS_INPUT"]) kind!:
    "FOUND" | "EMPTY" | "HELP" | "NEEDS_INPUT";
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  titleIds!: string[];
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  helpIds!: string[];
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  episodeIds!: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^ev-[a-f0-9]{32}$/, { each: true })
  evidenceIds!: string[];
}
export class AssistantResultDto {
  @IsObject()
  @ValidateNested()
  @Type(() => AssistantSelectionDto)
  selection!: AssistantSelectionDto;
  @IsIn(["CATALOG", "OLLAMA"]) engine!: "CATALOG" | "OLLAMA";
}
export class AssistantFailureDto {
  @IsIn([
    "AGENT_MODEL_UNAVAILABLE",
    "AGENT_TOOL_BUDGET_EXCEEDED",
    "AGENT_ANSWER_INVALID",
    "AGENT_CONTEXT_CHANGED",
    "AGENT_TIMEOUT",
    "AUTH_SESSION_REVOKED",
    "AGENT_WORKER_UNAVAILABLE",
  ])
  code!: string;
}
