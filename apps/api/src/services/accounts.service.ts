import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  Database,
  one,
  query,
} from "../../../../packages/database/src/database";
import { Principal, fail, hash, json, sqlState } from "../common";
import { passwordHash } from "../security";
import { NotificationsService } from "./notifications.service";
import {
  RegisterDto,
  EmailRequestDto,
  PasswordResetDto,
  ProofTokenDto,
} from "../dto/accounts.dto";
import { ViewerRequest, budget } from "../viewer-common";
@Injectable()
export class AccountsService {
  constructor(
    private readonly db: Database,
    private readonly mail: NotificationsService,
  ) {}
  async register(dto: RegisterDto, req: ViewerRequest) {
    this.mail.assertAvailable();
    await budget(
      this.db,
      "account.register",
      req.ip ?? "unknown",
      5,
      3600,
      req.requestId,
    );
    const encoded = await passwordHash(dto.password);
    try {
      return await this.db.$transaction(async (tx) => {
        const user = await one(
          tx,
          "INSERT INTO movie.users(email_normalized,password_hash,display_name) VALUES ($1,$2,$3) RETURNING id,email_normalized,display_name,status,email_verified_at,created_at",
          [dto.email, encoded, dto.displayName],
        );
        await query(
          tx,
          "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1::uuid,id FROM movie.roles WHERE code='MEMBER' RETURNING user_id",
          [user!.id],
        );
        const token = randomBytes(48).toString("base64url");
        const row = await one(
          tx,
          "INSERT INTO movie.email_verification_tokens(user_id,email_normalized,token_hash,expires_at) VALUES ($1::uuid,$2,$3,now()+interval '24 hours') RETURNING expires_at",
          [user!.id, dto.email, hash(token)],
        );
        await this.mail.enqueue(
          tx,
          user!.id,
          {
            to: dto.email,
            kind: "verify-email",
            token,
            expiresAt: row!.expires_at.toISOString(),
          },
          req.requestId,
        );
        await query(
          tx,
          "INSERT INTO movie.security_events(category,outcome,user_id,request_id) VALUES ('account.registered','SUCCESS',$1::uuid,$2) RETURNING id",
          [user!.id, req.requestId],
        );
        return json(user);
      });
    } catch (error) {
      if (sqlState(error) === "23505" || (error as any)?.code === "P2002")
        fail("ACCOUNT_CONFLICT", "This email cannot be used.");
      throw error;
    }
  }
  async user(actor: Principal, id: string) {
    if (actor.id !== id) fail("RESOURCE_NOT_FOUND");
    const row = await one(
      this.db,
      "SELECT id,email_normalized,display_name,status,email_verified_at,created_at FROM movie.users WHERE id=$1::uuid",
      [id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return json(row);
  }
  async requestEmail(
    dto: EmailRequestDto,
    req: ViewerRequest,
    kind: "verify-email" | "reset-password",
  ) {
    this.mail.assertAvailable();
    await budget(
      this.db,
      "account.email.ip",
      req.ip ?? "unknown",
      20,
      3600,
      req.requestId,
    );
    await budget(
      this.db,
      "account.email.subject",
      dto.email,
      5,
      3600,
      req.requestId,
    );
    await this.db.$transaction(async (tx) => {
      const user = await one(
        tx,
        "SELECT id,email_normalized,email_verified_at FROM movie.users WHERE email_normalized=$1 AND status='ACTIVE' FOR UPDATE",
        [dto.email],
      );
      if (!user || (kind === "verify-email" && user.email_verified_at)) return;
      const token = randomBytes(48).toString("base64url");
      let row;
      if (kind === "verify-email")
        row = await one(
          tx,
          "INSERT INTO movie.email_verification_tokens(user_id,email_normalized,token_hash,expires_at) VALUES ($1::uuid,$2,$3,now()+interval '24 hours') RETURNING expires_at",
          [user.id, user.email_normalized, hash(token)],
        );
      else
        row = await one(
          tx,
          "INSERT INTO movie.password_reset_tokens(user_id,token_hash,expires_at) VALUES ($1::uuid,$2,now()+interval '30 minutes') RETURNING expires_at",
          [user.id, hash(token)],
        );
      await this.mail.enqueue(
        tx,
        user.id,
        {
          to: user.email_normalized,
          kind,
          token,
          expiresAt: row!.expires_at.toISOString(),
        },
        req.requestId,
      );
    });
    return {
      message: "If the account is eligible, an email will be delivered.",
    };
  }
  async verify(dto: ProofTokenDto, req: ViewerRequest) {
    await budget(
      this.db,
      "account.email.verify",
      req.ip ?? "unknown",
      30,
      3600,
      req.requestId,
    );
    return this.db.$transaction(async (tx) => {
      const ref = await one(
        tx,
        "SELECT user_id FROM movie.email_verification_tokens WHERE token_hash=$1",
        [hash(dto.token)],
      );
      if (!ref) fail("AUTH_VERIFICATION_TOKEN_INVALID");
      const user = await one(
        tx,
        "SELECT id,email_normalized,status FROM movie.users WHERE id=$1::uuid FOR UPDATE",
        [ref.user_id],
      );
      const token = await one(
        tx,
        "SELECT * FROM movie.email_verification_tokens WHERE token_hash=$1 FOR UPDATE",
        [hash(dto.token)],
      );
      if (
        !token ||
        token.consumed_at ||
        token.expires_at <= new Date() ||
        user?.status !== "ACTIVE" ||
        user.email_normalized !== token.email_normalized
      )
        fail("AUTH_VERIFICATION_TOKEN_INVALID");
      await query(
        tx,
        "UPDATE movie.email_verification_tokens SET consumed_at=now() WHERE user_id=$1::uuid AND consumed_at IS NULL RETURNING id",
        [user.id],
      );
      await query(
        tx,
        "UPDATE movie.users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1::uuid RETURNING id",
        [user.id],
      );
      return { verified: true };
    });
  }
  async reset(dto: PasswordResetDto, req: ViewerRequest) {
    await budget(
      this.db,
      "account.password.reset",
      req.ip ?? "unknown",
      20,
      3600,
      req.requestId,
    );
    const encoded = await passwordHash(dto.password);
    return this.db.$transaction(async (tx) => {
      const ref = await one(
        tx,
        "SELECT user_id FROM movie.password_reset_tokens WHERE token_hash=$1",
        [hash(dto.token)],
      );
      if (!ref) fail("AUTH_RESET_TOKEN_INVALID");
      const user = await one(
        tx,
        "SELECT id,status FROM movie.users WHERE id=$1::uuid FOR UPDATE",
        [ref.user_id],
      );
      const token = await one(
        tx,
        "SELECT * FROM movie.password_reset_tokens WHERE token_hash=$1 FOR UPDATE",
        [hash(dto.token)],
      );
      if (
        !token ||
        token.consumed_at ||
        token.expires_at <= new Date() ||
        user?.status !== "ACTIVE"
      )
        fail("AUTH_RESET_TOKEN_INVALID");
      await query(
        tx,
        "UPDATE movie.password_reset_tokens SET consumed_at=now() WHERE user_id=$1::uuid AND consumed_at IS NULL RETURNING id",
        [user.id],
      );
      await query(
        tx,
        "UPDATE movie.users SET password_hash=$2,auth_version=auth_version+1,updated_at=now() WHERE id=$1::uuid RETURNING id",
        [user.id, encoded],
      );
      await query(
        tx,
        "UPDATE movie.auth_sessions SET state='REVOKED',revoked_at=now(),revoke_reason='password_reset' WHERE user_id=$1::uuid AND state IN ('ACTIVE','PENDING_MFA') RETURNING id",
        [user.id],
      );
      await query(
        tx,
        "UPDATE movie.playback_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1::uuid AND revoked_at IS NULL RETURNING id",
        [user.id],
      );
      await query(
        tx,
        "INSERT INTO movie.security_events(category,outcome,user_id,request_id) VALUES ('account.password_reset','SUCCESS',$1::uuid,$2) RETURNING id",
        [user.id, req.requestId],
      );
      return { reset: true };
    });
  }
}
