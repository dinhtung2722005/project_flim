import "../apps/api/src/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { Database, one, query } from "../packages/database/src/database";
import { encrypt, newTotp, passwordHash, totp } from "../apps/api/src/security";
import { hash } from "../apps/api/src/common";
async function main() {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  const db = new Database();
  try {
    await db.$connect();
    const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@pj-flim.local")
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new Error("Invalid bootstrap email.");
    const file = ".local/api/bootstrap-admin.json",
      existing = await one(
        db,
        "SELECT id FROM movie.users WHERE email_normalized=$1",
        [email],
      );
    if (existing) {
      console.log(
        "Bootstrap account already exists; password and MFA were not changed. Local credentials: " +
          file,
      );
      return;
    }
    const password =
      process.env.BOOTSTRAP_ADMIN_PASSWORD ??
      randomBytes(24).toString("base64url");
    if (password.length < 12)
      throw new Error(
        "Bootstrap password must contain at least 12 characters.",
      );
    const secret = newTotp(),
      recoveryCodes = Array.from({ length: 10 }, () =>
        randomBytes(16).toString("hex"),
      );
    const storedPassword = await passwordHash(password);
    const user = await db.$transaction(async (tx) => {
      await query(
        tx,
        "SELECT key FROM movie.policy_locks WHERE key='super_admin_roster' FOR UPDATE",
      );
      const created = await one(
        tx,
        "INSERT INTO movie.users(email_normalized,password_hash,display_name,email_verified_at) VALUES ($1,$2,'Local administrator',now()) RETURNING id",
        [email, storedPassword],
      );
      await query(
        tx,
        "INSERT INTO movie.user_roles(user_id,role_id) SELECT $1::uuid,id FROM movie.roles WHERE code='SUPER_ADMIN' RETURNING user_id",
        [created!.id],
      );
      const factor = await one(
        tx,
        "INSERT INTO movie.mfa_factors(user_id,encrypted_secret,encryption_key_id,verified_at) VALUES ($1::uuid,$2,'local-v1',now()) RETURNING id",
        [created!.id, encrypt(secret)],
      );
      for (const code of recoveryCodes)
        await query(
          tx,
          "INSERT INTO movie.mfa_recovery_codes(factor_id,code_hash) VALUES ($1::uuid,$2) RETURNING id",
          [factor!.id, hash(code)],
        );
      await query(
        tx,
        "INSERT INTO movie.system_settings(key,value,updated_by) VALUES ('site',$1::jsonb,$2::uuid) ON CONFLICT(key) DO NOTHING RETURNING key",
        [
          JSON.stringify({
            name: "pj-Flim",
            description: "Movie streaming platform",
          }),
          created!.id,
        ],
      );
      await query(
        tx,
        "INSERT INTO movie.audit_logs(actor_kind,action,resource_type,resource_id,outcome,safe_diff) VALUES ('SYSTEM','admin.bootstrap','user',$1,'SUCCESS',$2::jsonb) RETURNING id",
        [created!.id, JSON.stringify({ role: "SUPER_ADMIN" })],
      );
      return created!;
    });
    await mkdir(".local/api", { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        {
          email,
          password,
          userId: user.id,
          totpSecret: secret,
          totpUri: totp(secret, email).toString(),
          recoveryCodes,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(
      "Created local SUPER_ADMIN with MFA. Credentials: " +
        file +
        " (ignored by Git).",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error("Admin bootstrap failed: " + error.message);
  process.exitCode = 1;
});
