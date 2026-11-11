import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import { ApiError, Principal, fail, hash, secureEqual } from "../common";
import { configuration } from "../config";
import {
  decrypt,
  encrypt,
  passwordHash,
  passwordMatches,
  totp,
} from "../security";
type TokenPayload = {
  sub: string;
  sid: string;
  av: string;
  kind: string;
  cid?: string;
  purpose?: string;
};
const opaque = () => randomBytes(48).toString("base64url");
const profileSql =
  "SELECT u.id,u.email_normalized,u.display_name,u.status,u.auth_version,s.state,s.mfa_verified_at,s.step_up_at,s.idle_expires_at,s.absolute_expires_at,s.auth_version AS session_auth_version,ARRAY(SELECT r.code FROM movie.user_roles ur JOIN movie.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id ORDER BY r.code) AS roles,ARRAY(SELECT DISTINCT p.code FROM movie.user_roles ur JOIN movie.role_permissions rp ON rp.role_id=ur.role_id JOIN movie.permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id ORDER BY p.code) AS permissions,EXISTS(SELECT 1 FROM movie.mfa_factors f WHERE f.user_id=u.id AND f.verified_at IS NOT NULL AND f.disabled_at IS NULL) AS mfa_enabled FROM movie.users u JOIN movie.auth_sessions s ON s.user_id=u.id WHERE u.id=$1::uuid AND s.id=$2::uuid";
@Injectable()
export class AuthService {
  private readonly dummy = passwordHash(randomBytes(32).toString("hex"));
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}
  sign(payload: TokenPayload, seconds = 900) {
    return this.jwt.sign(payload, {
      secret: configuration().jwt,
      algorithm: "HS256",
      issuer: "pj-Flim",
      audience: "pj-Flim-api",
      expiresIn: seconds,
    });
  }
  decode(token: string, kind: string): TokenPayload {
    try {
      const decoded = this.jwt.verify<TokenPayload>(token, {
        secret: configuration().jwt,
        algorithms: ["HS256"],
        issuer: "pj-Flim",
        audience: "pj-Flim-api",
      });
      if (decoded.kind !== kind || !decoded.sub || !decoded.sid || !decoded.av)
        throw Error();
      return decoded;
    } catch (error: any) {
      throw new ApiError(
        error.name === "TokenExpiredError"
          ? "AUTH_TOKEN_EXPIRED"
          : "AUTHENTICATION_REQUIRED",
      );
    }
  }
  async authenticate(token: string, requestId: string): Promise<Principal> {
    const payload = this.decode(token, "access");
    const row = await one(this.db, profileSql, [payload.sub, payload.sid]);
    if (
      !row ||
      row.state !== "ACTIVE" ||
      row.status !== "ACTIVE" ||
      row.auth_version.toString() !== payload.av ||
      row.session_auth_version.toString() !== payload.av ||
      row.idle_expires_at <= new Date() ||
      row.absolute_expires_at <= new Date()
    )
      fail("AUTH_SESSION_REVOKED");
    if (
      configuration().mfaRequired &&
      row.roles.some((r: string) => r !== "MEMBER") &&
      (!row.mfa_verified_at || !row.mfa_enabled)
    )
      fail("AUTH_MFA_REQUIRED");
    await query(
      this.db,
      "UPDATE movie.auth_sessions SET last_seen_at=now(),idle_expires_at=LEAST(absolute_expires_at,now()+$2::interval) WHERE id=$1::uuid AND state='ACTIVE' AND last_seen_at<now()-interval '1 minute' RETURNING id",
      [
        payload.sid,
        row.roles.some((r: string) => r !== "MEMBER") ? "30 minutes" : "7 days",
      ],
    );
    return {
      id: row.id,
      sid: payload.sid,
      authVersion: payload.av,
      roles: row.roles,
      permissions: row.permissions,
      stepUpAt: row.step_up_at,
      requestId,
    };
  }
  async me(actor: Principal) {
    const row = await one(
      this.db,
      "SELECT id,email_normalized,display_name,status,auth_version FROM movie.users WHERE id=$1::uuid",
      [actor.id],
    );
    return { ...row, roles: actor.roles, permissions: actor.permissions };
  }
  private async loginBudget(email: string, ip: string, requestId: string) {
    await this.db.$transaction(async (tx) => {
      const privateHash = (value: string) =>
        createHmac("sha256", configuration().cursor)
          .update(value)
          .digest("hex");
      const subject = privateHash("email:" + email),
        ipHash = privateHash("ip:" + ip);
      for (const lock of [
        "login-ip:" + ipHash,
        "login-subject:" + subject,
      ].sort())
        await query(
          tx,
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS locked",
          [lock],
        );
      const counts = await one(
        tx,
        "SELECT count(*) FILTER(WHERE subject_hash=$1) AS subject_count,count(*) FILTER(WHERE ip_hash=$2) AS ip_count FROM movie.security_events WHERE category='auth.login.attempt' AND received_at>now()-interval '15 minutes'",
        [subject, ipHash],
      );
      if (
        Number(counts!.subject_count) >= 10 ||
        Number(counts!.ip_count) >= 100
      )
        fail("RATE_LIMITED");
      await query(
        tx,
        "INSERT INTO movie.security_events(category,outcome,subject_hash,ip_hash,request_id) VALUES ('auth.login.attempt','SUCCESS',$1,$2,$3) RETURNING id",
        [subject, ipHash, requestId],
      );
    });
  }
  async login(email: string, password: string, ip: string, requestId: string) {
    email = email.trim().toLowerCase();
    await this.loginBudget(email, ip, requestId);
    const candidate = await one(
      this.db,
      "SELECT id,password_hash,auth_version FROM movie.users WHERE email_normalized=$1",
      [email],
    );
    const valid = await passwordMatches(
      candidate?.password_hash ?? (await this.dummy),
      password,
    );
    if (!candidate || !valid) fail("AUTH_INVALID_CREDENTIALS");
    return this.db.$transaction(async (tx) => {
      const user = await one(
        tx,
        "SELECT id,email_normalized,display_name,status,auth_version FROM movie.users WHERE id=$1::uuid FOR SHARE",
        [candidate.id],
      );
      if (
        !user ||
        user.status !== "ACTIVE" ||
        user.auth_version !== candidate.auth_version
      )
        fail("AUTH_INVALID_CREDENTIALS");
      const roles = await query(
        tx,
        "SELECT r.code FROM movie.user_roles ur JOIN movie.roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid",
        [user.id],
      );
      const staff = roles.some((row) => row.code !== "MEMBER");
      const factor = await one(
        tx,
        "SELECT id FROM movie.mfa_factors WHERE user_id=$1::uuid AND verified_at IS NOT NULL AND disabled_at IS NULL",
        [user.id],
      );
      const mfaRequired = configuration().mfaRequired;
      if (mfaRequired && staff && !factor) fail("AUTH_MFA_ENROLLMENT_REQUIRED");
      const requiresChallenge = mfaRequired && Boolean(factor);
      const session = await one(
        tx,
        "INSERT INTO movie.auth_sessions(user_id,state,auth_version,idle_expires_at,absolute_expires_at,ip_hash) VALUES ($1::uuid,$2,$3::bigint,now()+$4::interval,now()+$5::interval,$6) RETURNING id",
        [
          user.id,
          requiresChallenge ? "PENDING_MFA" : "ACTIVE",
          user.auth_version.toString(),
          requiresChallenge ? "5 minutes" : staff ? "30 minutes" : "7 days",
          staff ? "8 hours" : "7 days",
          hash(ip),
        ],
      );
      if (requiresChallenge && factor) {
        const challenge = await this.challenge(
          tx,
          user,
          session!.id,
          factor.id,
          "LOGIN",
        );
        return {
          state: "PENDING_MFA" as const,
          sessionId: session!.id,
          ...challenge,
        };
      }
      const result = await this.credentials(tx, user, session!.id);
      return {
        state: "ACTIVE" as const,
        sessionId: session!.id,
        ...result.body,
      };
    });
  }
  private async challenge(
    tx: Tx,
    user: Record<string, any>,
    sid: string,
    factorId: string,
    purpose: string,
  ) {
    const id = randomUUID(),
      token = this.sign(
        {
          sub: user.id,
          sid,
          av: user.auth_version.toString(),
          kind: "mfa",
          cid: id,
          purpose,
        },
        300,
      );
    await query(
      tx,
      "INSERT INTO movie.mfa_challenges(id,user_id,session_id,factor_id,purpose,challenge_hash,expires_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,now()+interval '5 minutes') RETURNING id",
      [id, user.id, sid, factorId, purpose, hash(token)],
    );
    return { challengeId: id, challengeToken: token, expiresIn: 300 };
  }
  async stepUpChallenge(actor: Principal) {
    return this.db.$transaction(async (tx) => {
      const factor = await one(
        tx,
        "SELECT id FROM movie.mfa_factors WHERE user_id=$1::uuid AND verified_at IS NOT NULL AND disabled_at IS NULL",
        [actor.id],
      );
      if (!factor) fail("AUTH_MFA_ENROLLMENT_REQUIRED");
      return this.challenge(
        tx,
        { id: actor.id, auth_version: actor.authVersion },
        actor.sid,
        factor.id,
        "STEP_UP",
      );
    });
  }
  private async credentials(
    tx: Tx,
    user: Record<string, any>,
    sid: string,
    previous?: Record<string, any>,
  ) {
    const refreshToken = opaque(),
      familyId = previous?.family_id ?? randomUUID(),
      generation = previous ? BigInt(previous.generation) + 1n : 1n;
    const token = await one(
      tx,
      "INSERT INTO movie.refresh_tokens(session_id,family_id,generation,token_hash,expires_at) SELECT id,$2::uuid,$3::bigint,$4,absolute_expires_at FROM movie.auth_sessions WHERE id=$1::uuid RETURNING id",
      [sid, familyId, generation.toString(), hash(refreshToken)],
    );
    if (previous)
      await query(
        tx,
        "UPDATE movie.refresh_tokens SET replaced_by_id=$2::uuid WHERE id=$1::uuid RETURNING id",
        [previous.id, token!.id],
      );
    return {
      body: {
        accessToken: this.sign({
          sub: user.id,
          sid,
          av: user.auth_version.toString(),
          kind: "access",
        }),
        refreshToken,
        tokenType: "Bearer",
        expiresIn: 900,
      },
      tokenId: token!.id,
      familyId,
    };
  }
  private key(value: string | undefined) {
    if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value))
      fail("IDEMPOTENCY_KEY_REQUIRED");
    return hash(value);
  }
  private async receipt(
    tx: Tx,
    sid: string,
    context: string,
    key: string,
    proof: string,
    body: unknown,
    refs: {
      familyId?: string;
      challengeId?: string;
      inputId?: string;
      outputId?: string;
    },
  ) {
    await query(
      tx,
      "INSERT INTO movie.auth_replay_receipts(session_id,family_id,challenge_id,context_key,request_key_hash,proof_fingerprint,input_refresh_token_id,output_refresh_token_id,encrypted_result,encryption_key_id,credential_expires_at,metadata_expires_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid,$8::uuid,$9,'local-v1',now()+interval '30 seconds',now()+interval '1 day') RETURNING id",
      [
        sid,
        refs.familyId ?? null,
        refs.challengeId ?? null,
        context,
        key,
        proof,
        refs.inputId ?? null,
        refs.outputId ?? null,
        encrypt(JSON.stringify(body)),
      ],
    );
  }
  private replay(row: Record<string, any>) {
    if (!row.encrypted_result || row.credential_expires_at <= new Date())
      fail("IDEMPOTENCY_RESULT_EXPIRED");
    return JSON.parse(decrypt(row.encrypted_result));
  }
  async verifyMfa(
    id: string,
    token: string,
    code: string,
    requestKey: string | undefined,
    purpose = "LOGIN",
  ) {
    const payload = this.decode(token, "mfa"),
      key = this.key(requestKey);
    if (payload.cid !== id || payload.purpose !== purpose)
      fail("AUTHENTICATION_REQUIRED");
    const context = "mfa:" + payload.sid + ":" + id,
      proof = hash(token + ":" + code);
    const result = await this.db.$transaction(async (tx) => {
      const user = await one(
        tx,
        "SELECT id,status,auth_version FROM movie.users WHERE id=$1::uuid FOR SHARE",
        [payload.sub],
      );
      const session = await one(
        tx,
        "SELECT * FROM movie.auth_sessions WHERE id=$1::uuid AND user_id=$2::uuid FOR UPDATE",
        [payload.sid, payload.sub],
      );
      if (
        !user ||
        user.status !== "ACTIVE" ||
        !session ||
        !["PENDING_MFA", "ACTIVE"].includes(session.state) ||
        session.absolute_expires_at <= new Date() ||
        session.idle_expires_at <= new Date() ||
        user.auth_version.toString() !== payload.av ||
        session.auth_version.toString() !== payload.av
      )
        fail("AUTH_SESSION_REVOKED");
      const cached = await one(
        tx,
        "SELECT * FROM movie.auth_replay_receipts WHERE context_key=$1 AND request_key_hash=$2",
        [context, key],
      );
      if (cached) {
        if (!secureEqual(cached.proof_fingerprint, proof))
          fail("IDEMPOTENCY_KEY_REUSED");
        return { body: this.replay(cached) };
      }
      const challenge = await one(
        tx,
        "SELECT * FROM movie.mfa_challenges WHERE id=$1::uuid AND user_id=$2::uuid AND session_id=$3::uuid FOR UPDATE",
        [id, user.id, session.id],
      );
      if (
        !challenge ||
        challenge.purpose !== purpose ||
        challenge.challenge_hash !== hash(token) ||
        challenge.expires_at <= new Date() ||
        challenge.consumed_at ||
        challenge.attempt_count >= challenge.max_attempts
      )
        fail("AUTH_CHALLENGE_EXPIRED");
      if (
        (purpose === "LOGIN" && session.state !== "PENDING_MFA") ||
        (purpose === "STEP_UP" && session.state !== "ACTIVE")
      )
        fail("AUTH_MFA_INVALID");
      const factor = await one(
        tx,
        "SELECT * FROM movie.mfa_factors WHERE id=$1::uuid AND user_id=$2::uuid AND verified_at IS NOT NULL AND disabled_at IS NULL FOR UPDATE",
        [challenge.factor_id, user.id],
      );
      let accepted = false;
      if (factor && /^\d{6}$/.test(code)) {
        const delta = totp(decrypt(factor.encrypted_secret)).validate({
          token: code,
          window: 1,
        });
        const step = Math.floor(Date.now() / 30000) + (delta ?? 0);
        if (
          delta !== null &&
          (factor.last_accepted_step === null ||
            BigInt(step) > factor.last_accepted_step)
        ) {
          await query(
            tx,
            "UPDATE movie.mfa_factors SET last_accepted_step=$2::bigint WHERE id=$1::uuid RETURNING id",
            [factor.id, step],
          );
          accepted = true;
        }
      } else if (factor) {
        const recovery = await query(
          tx,
          "UPDATE movie.mfa_recovery_codes SET consumed_at=now() WHERE factor_id=$1::uuid AND code_hash=$2 AND consumed_at IS NULL RETURNING id",
          [factor.id, hash(code)],
        );
        accepted = recovery.length === 1;
      }
      if (!accepted) {
        await query(
          tx,
          "UPDATE movie.mfa_challenges SET attempt_count=attempt_count+1 WHERE id=$1::uuid RETURNING id",
          [id],
        );
        return { error: "AUTH_MFA_INVALID" };
      }
      await query(
        tx,
        "UPDATE movie.mfa_challenges SET consumed_at=now() WHERE id=$1::uuid RETURNING id",
        [id],
      );
      if (purpose === "STEP_UP") {
        const updated = await one(
          tx,
          "UPDATE movie.auth_sessions SET step_up_at=now() WHERE id=$1::uuid RETURNING step_up_at",
          [session.id],
        );
        const body = { stepUpAt: updated!.step_up_at.toISOString() };
        await this.receipt(tx, session.id, context, key, proof, body, {
          challengeId: id,
        });
        return { body };
      }
      await query(
        tx,
        "UPDATE movie.auth_sessions SET state='ACTIVE',mfa_verified_at=now(),idle_expires_at=LEAST(absolute_expires_at,now()+interval '30 minutes') WHERE id=$1::uuid RETURNING id",
        [session.id],
      );
      const issued = await this.credentials(tx, user, session.id);
      const body = {
        state: "ACTIVE" as const,
        sessionId: session.id,
        ...issued.body,
      };
      await this.receipt(tx, session.id, context, key, proof, body, {
        challengeId: id,
        familyId: issued.familyId,
        outputId: issued.tokenId,
      });
      return { body };
    });
    if (result.error) fail(result.error);
    return result.body;
  }
  async refresh(refreshToken: string, requestKey: string | undefined) {
    const key = this.key(requestKey),
      tokenHash = hash(refreshToken);
    const token = await one(
      this.db,
      "SELECT rt.*,s.user_id FROM movie.refresh_tokens rt JOIN movie.auth_sessions s ON s.id=rt.session_id WHERE rt.token_hash=$1",
      [tokenHash],
    );
    if (!token) fail("AUTH_INVALID_CREDENTIALS");
    const result = await this.db.$transaction(async (tx) => {
      const user = await one(
        tx,
        "SELECT id,status,auth_version FROM movie.users WHERE id=$1::uuid FOR SHARE",
        [token.user_id],
      );
      const session = await one(
        tx,
        "SELECT * FROM movie.auth_sessions WHERE id=$1::uuid FOR UPDATE",
        [token.session_id],
      );
      if (
        !user ||
        user.status !== "ACTIVE" ||
        session!.state !== "ACTIVE" ||
        session!.auth_version !== user.auth_version ||
        session!.idle_expires_at <= new Date() ||
        session!.absolute_expires_at <= new Date()
      )
        fail("AUTH_SESSION_REVOKED");
      const current = await one(
        tx,
        "SELECT * FROM movie.refresh_tokens WHERE id=$1::uuid",
        [token.id],
      );
      const context = "refresh:" + token.session_id + ":" + token.family_id;
      const cached = await one(
        tx,
        "SELECT * FROM movie.auth_replay_receipts WHERE context_key=$1 AND request_key_hash=$2",
        [context, key],
      );
      if (cached) {
        if (
          current!.id !== cached.input_refresh_token_id &&
          current!.id !== cached.output_refresh_token_id
        )
          fail("IDEMPOTENCY_KEY_REUSED");
        return { body: this.replay(cached) };
      }
      if (current!.expires_at <= new Date()) fail("AUTH_TOKEN_EXPIRED");
      if (current!.consumed_at) {
        if (Date.now() - current!.consumed_at.getTime() < 30000)
          fail("AUTH_REFRESH_RETRY_CONFLICT");
        await query(
          tx,
          "UPDATE movie.auth_sessions SET state='REVOKED',revoked_at=now(),revoke_reason='refresh_reused' WHERE id=$1::uuid RETURNING id",
          [session!.id],
        );
        return { error: "AUTH_REFRESH_REUSED" };
      }
      await query(
        tx,
        "UPDATE movie.refresh_tokens SET consumed_at=now() WHERE id=$1::uuid RETURNING id",
        [current!.id],
      );
      const issued = await this.credentials(tx, user, session!.id, current);
      await this.receipt(
        tx,
        session!.id,
        context,
        key,
        hash("refresh:" + token.family_id),
        issued.body,
        {
          familyId: token.family_id,
          inputId: current!.id,
          outputId: issued.tokenId,
        },
      );
      return { body: issued.body };
    });
    if (result.error) fail(result.error);
    return result.body;
  }
  async session(actor: Principal, id: string) {
    const row = await one(
      this.db,
      "SELECT id,user_id,state,auth_version,mfa_verified_at,step_up_at,created_at,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at,revoke_reason FROM movie.auth_sessions WHERE id=$1::uuid AND user_id=$2::uuid",
      [id, actor.id],
    );
    if (!row) fail("RESOURCE_NOT_FOUND");
    return row;
  }
  async challengeMetadata(id: string, token: string, purpose: string) {
    const payload = this.decode(token, "mfa");
    if (payload.cid !== id || payload.purpose !== purpose)
      fail("AUTHENTICATION_REQUIRED");
    const row = await one(
      this.db,
      "SELECT id,purpose,attempt_count,max_attempts,expires_at,consumed_at FROM movie.mfa_challenges WHERE id=$1::uuid AND user_id=$2::uuid AND session_id=$3::uuid AND challenge_hash=$4",
      [id, payload.sub, payload.sid, hash(token)],
    );
    if (!row || row.expires_at <= new Date()) fail("AUTH_CHALLENGE_EXPIRED");
    return row;
  }
  async logoutToken(token: string) {
    const payload = this.decode(token, "access");
    await query(
      this.db,
      "UPDATE movie.auth_sessions SET state='REVOKED',revoked_at=now(),revoke_reason='logout' WHERE id=$1::uuid AND user_id=$2::uuid AND state IN ('ACTIVE','PENDING_MFA') RETURNING id",
      [payload.sid, payload.sub],
    );
  }
  async logout(actor: Principal) {
    await query(
      this.db,
      "UPDATE movie.auth_sessions SET state='REVOKED',revoked_at=now(),revoke_reason='logout' WHERE id=$1::uuid AND user_id=$2::uuid AND state IN ('ACTIVE','PENDING_MFA') RETURNING id",
      [actor.sid, actor.id],
    );
  }
}
