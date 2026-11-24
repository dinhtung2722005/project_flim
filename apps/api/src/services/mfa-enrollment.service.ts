import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  Database,
  one,
  query,
  Tx,
} from "../../../../packages/database/src/database";
import { Principal, fail, hash } from "../common";
import { configuration } from "../config";
import { budget, checkViewer } from "../viewer-common";
import { newTotp, totp, encrypt, decrypt, passwordMatches } from "../security";
@Injectable()
export class MfaEnrollmentService {
  constructor(private readonly db: Database) {}
  async status(actor: Principal) {
    await checkViewer(this.db, actor);
    const row = await one(
      this.db,
      "SELECT EXISTS(SELECT 1 FROM movie.mfa_factors WHERE user_id=$1::uuid AND disabled_at IS NULL AND verified_at IS NOT NULL) AS enabled",
      [actor.id],
    );
    return { enabled: row!.enabled,requiredForLogin:configuration().mfaRequired };
  }
  async start(actor: Principal, password: string) {
    await budget(
      this.db,
      "account.mfa.enroll",
      actor.id,
      5,
      3600,
      actor.requestId,
    );
    const value = await this.db.$transaction(async (tx) => {
      // Serialize starts/confirms for this account; recheck session and password in the same transaction.
      await query(
        tx,
        "SELECT id FROM movie.users WHERE id=$1::uuid FOR UPDATE",
        [actor.id],
      );
      await checkViewer(tx, actor);
      const user = await one(
        tx,
        "SELECT password_hash,email_normalized FROM movie.users WHERE id=$1::uuid",
        [actor.id],
      );
      if (!user || !(await passwordMatches(user.password_hash, password)))
        fail("AUTH_INVALID_CREDENTIALS");
      if (
        await one(
          tx,
          "SELECT id FROM movie.mfa_factors WHERE user_id=$1::uuid AND disabled_at IS NULL AND verified_at IS NOT NULL",
          [actor.id],
        )
      )
        fail("RESOURCE_CONFLICT", "MFA is already enabled.");
      await query(
        tx,
        "UPDATE movie.mfa_factors SET disabled_at=clock_timestamp() WHERE user_id=$1::uuid AND verified_at IS NULL AND disabled_at IS NULL RETURNING id",
        [actor.id],
      );
      const secret = newTotp();
      const factor = await one(
        tx,
        "INSERT INTO movie.mfa_factors(user_id,encrypted_secret,encryption_key_id) VALUES($1::uuid,$2,'local-v1') RETURNING id",
        [actor.id, encrypt(secret)],
      );
      const challenge = await one(
        tx,
        "INSERT INTO movie.mfa_challenges(user_id,session_id,factor_id,purpose,challenge_hash,expires_at) VALUES($1::uuid,$2::uuid,$3::uuid,'ENROLLMENT',$4,clock_timestamp()+interval '10 minutes') RETURNING id,expires_at",
        [
          actor.id,
          actor.sid,
          factor!.id,
          hash(randomBytes(48).toString("base64url")),
        ],
      );
      return {
        id: challenge!.id,
        secret,
        otpauthUri: totp(secret, user.email_normalized).toString(),
        expiresAt: challenge!.expires_at,
      };
    });
    return value;
  }
  async confirm(actor: Principal, id: string, code: string) {
    await budget(
      this.db,
      "account.mfa.confirm",
      actor.id,
      20,
      3600,
      actor.requestId,
    );
    const result = await this.db.$transaction(async (tx) => {
      await query(
        tx,
        "SELECT id FROM movie.users WHERE id=$1::uuid FOR UPDATE",
        [actor.id],
      );
      await checkViewer(tx, actor);
      const c = await one(
        tx,
        "SELECT c.*,f.encrypted_secret,f.disabled_at,f.verified_at FROM movie.mfa_challenges c JOIN movie.mfa_factors f ON f.id=c.factor_id WHERE c.id=$1::uuid AND c.user_id=$2::uuid AND c.session_id=$3::uuid AND c.purpose='ENROLLMENT' FOR UPDATE OF c,f",
        [id, actor.id, actor.sid],
      );
      if (
        !c ||
        c.consumed_at ||
        c.disabled_at ||
        c.verified_at ||
        c.expires_at <= new Date() ||
        c.attempt_count >= c.max_attempts
      )
        return { error: true };
      const delta = totp(decrypt(c.encrypted_secret)).validate({
        token: code,
        window: 1,
      });
      if (delta === null) {
        await query(
          tx,
          "UPDATE movie.mfa_challenges SET attempt_count=attempt_count+1 WHERE id=$1::uuid RETURNING id",
          [id],
        );
        return { error: true };
      }
      const step = Math.floor(Date.now() / 30000) + delta;
      await query(
        tx,
        "UPDATE movie.mfa_factors SET verified_at=clock_timestamp(),last_accepted_step=$2 WHERE id=$1::uuid RETURNING id",
        [c.factor_id, step],
      );
      await query(
        tx,
        "UPDATE movie.mfa_challenges SET consumed_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
        [id],
      );
      await query(
        tx,
        "UPDATE movie.auth_sessions SET mfa_verified_at=clock_timestamp(),step_up_at=clock_timestamp() WHERE id=$1::uuid RETURNING id",
        [actor.sid],
      );
      const recoveryCodes = Array.from({ length: 8 }, () =>
        randomBytes(16).toString("hex"),
      );
      for (const item of recoveryCodes)
        await query(
          tx,
          "INSERT INTO movie.mfa_recovery_codes(factor_id,code_hash) VALUES($1::uuid,$2) RETURNING id",
          [c.factor_id, hash(item)],
        );
      await query(
        tx,
        "INSERT INTO movie.security_events(category,outcome,user_id,request_id) VALUES('account.mfa.enabled','SUCCESS',$1::uuid,$2) RETURNING id",
        [actor.id, actor.requestId],
      );
      return { enabled: true, recoveryCodes };
    });
    if ("error" in result) fail("AUTH_MFA_INVALID");
    return result;
  }
}
