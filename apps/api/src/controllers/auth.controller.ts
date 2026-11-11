import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiSecurity,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Actor, Principal, Public, UuidPipe, fail, json } from "../common";
import { LoginDto, RefreshDto, VerifyMfaDto } from "../dto/auth.dto";
import { AuthService } from "../services/auth.service";
@ApiTags("Authentication")
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Post("auth/sessions")
  @ApiOperation({
    summary:
      "Create login session; staff MFA is required by default. Local AUTH_MFA_REQUIRED=false returns ACTIVE credentials after password login.",
  })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request & { requestId: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    const result = await this.auth.login(
      body.email,
      body.password,
      req.ip ?? "unknown",
      req.requestId,
    );
    res.location("/api/v1/auth/sessions/" + result.sessionId);
    return result;
  }
  @Public()
  @Post("auth/mfa-challenges/:id/verifications")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  async verify(
    @Param("id", UuidPipe) id: string,
    @Body() body: VerifyMfaDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    return this.auth.verifyMfa(id, body.challengeToken, body.code, key);
  }
  @Public()
  @Post("auth/token-renewals")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  async refresh(
    @Body() body: RefreshDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    return this.auth.refresh(body.refreshToken, key);
  }
  @ApiBearerAuth()
  @Get("me")
  async me(@Actor() actor: Principal) {
    return json(await this.auth.me(actor));
  }
  @ApiBearerAuth()
  @Post("auth/step-up-challenges")
  async stepUp(
    @Actor() actor: Principal,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.stepUpChallenge(actor);
    res.location("/api/v1/auth/step-up-challenges/" + result.challengeId);
    return result;
  }
  @Public()
  @Post("auth/step-up-challenges/:id/verifications")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  async verifyStepUp(
    @Param("id", UuidPipe) id: string,
    @Body() body: VerifyMfaDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    return this.auth.verifyMfa(
      id,
      body.challengeToken,
      body.code,
      key,
      "STEP_UP",
    );
  }
  @ApiBearerAuth()
  @Get("auth/sessions/:id")
  async session(@Actor() actor: Principal, @Param("id", UuidPipe) id: string) {
    return json(await this.auth.session(actor, id));
  }
  @Public()
  @ApiSecurity("mfa-context")
  @Get("auth/mfa-challenges/:id")
  async challenge(
    @Param("id", UuidPipe) id: string,
    @Headers("authorization") header: string | undefined,
  ) {
    const token = /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
    if (!token) fail("AUTHENTICATION_REQUIRED");
    return json(await this.auth.challengeMetadata(id, token, "LOGIN"));
  }
  @Public()
  @ApiSecurity("mfa-context")
  @Get("auth/step-up-challenges/:id")
  async stepUpMetadata(
    @Param("id", UuidPipe) id: string,
    @Headers("authorization") header: string | undefined,
  ) {
    const token = /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
    if (!token) fail("AUTHENTICATION_REQUIRED");
    return json(await this.auth.challengeMetadata(id, token, "STEP_UP"));
  }
  @Public()
  @ApiBearerAuth()
  @Delete("auth/sessions/current")
  @HttpCode(204)
  async logout(
    @Headers("authorization") header: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
    if (!token) fail("AUTHENTICATION_REQUIRED");
    res.clearCookie("pj_flim_docs", { path: "/api" });
    await this.auth.logoutToken(token);
  }
}
