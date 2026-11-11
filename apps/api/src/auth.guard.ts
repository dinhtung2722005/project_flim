import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { AuthService } from "./services/auth.service";
import { Principal, assertStepUp, fail } from "./common";
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const incoming = ctx.switchToHttp().getRequest<Request>();
    if (
      ["POST", "PUT", "PATCH"].includes(incoming.method) &&
      (Number(incoming.get("content-length") ?? 0) > 0 ||
        incoming.get("transfer-encoding")) &&
      !incoming.is("application/json")
    )
      fail("REQUEST_UNSUPPORTED_MEDIA_TYPE");
    if (
      this.reflector.getAllAndOverride<boolean>("public", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return true;
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { actor: Principal; requestId: string }>();
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "");
    if (!match) fail("AUTHENTICATION_REQUIRED");
    req.actor = await this.auth.authenticate(match[1], req.requestId);
    const permissions =
      this.reflector.getAllAndOverride<string[]>("permissions", [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    if (req.path.startsWith("/api/v1/admin/") && permissions.length === 0)
      fail("AUTH_FORBIDDEN");
    if (permissions.some((p) => !req.actor.permissions.includes(p)))
      fail("AUTH_FORBIDDEN");
    if (
      this.reflector.getAllAndOverride<boolean>("stepUp", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      assertStepUp(req.actor);
    return true;
  }
}
