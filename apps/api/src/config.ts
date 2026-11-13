import "../../../packages/config/src/environment";
export function configuration() {
  for (const key of [
    "DATABASE_URL",
    "JWT_SECRET",
    "MFA_ENCRYPTION_KEY",
    "CURSOR_SECRET",
  ]) {
    if (!process.env[key])
      throw new Error("Missing required configuration: " + key);
  }
  if (
    process.env.JWT_SECRET!.length < 64 ||
    process.env.CURSOR_SECRET!.length < 64 ||
    !/^[a-f0-9]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY!)
  )
    throw new Error("Invalid authentication key configuration.");
  const port = Number(process.env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid API_PORT.");
  return {
    port,
    mfaRequired:
      process.env.NODE_ENV === "production" ||
      process.env.AUTH_MFA_REQUIRED !== "false",
    host: process.env.API_HOST ?? "127.0.0.1",
    docs:
      process.env.SWAGGER_ENABLED === "true" &&
      process.env.NODE_ENV !== "production",
    jwt: process.env.JWT_SECRET!,
    encryption: Buffer.from(process.env.MFA_ENCRYPTION_KEY!, "hex"),
    cursor: process.env.CURSOR_SECRET!,
  };
}
