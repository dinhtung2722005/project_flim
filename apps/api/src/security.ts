import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import * as OTPAuth from "otpauth";
import { configuration } from "./config";
export const passwordHash = (password: string) =>
  argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export async function passwordMatches(stored: string, password: string) {
  try {
    return await argonVerify(stored, password);
  } catch {
    return false;
  }
}
export function encrypt(text: string): Buffer {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", configuration().encryption, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
export function decrypt(value: Uint8Array): string {
  const buffer = Buffer.from(value),
    decipher = createDecipheriv(
      "aes-256-gcm",
      configuration().encryption,
      buffer.subarray(0, 12),
    );
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([
    decipher.update(buffer.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
export function totp(secret: string, email = "admin") {
  return new OTPAuth.TOTP({
    issuer: "pj-Flim",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export function newTotp() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}
