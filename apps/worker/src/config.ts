import "../../../packages/config/src/environment";
import { config } from "dotenv";
config({ path: ".env.worker.local", quiet: true });
function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error("Invalid worker configuration: " + name);
  return value;
}
export function workerConfiguration() {
  const amqp = process.env.RABBITMQ_URL;
  if (!amqp || !process.env.WORKER_DATABASE_URL)
    throw new Error("Missing RabbitMQ/worker database configuration.");
  const url = new URL(amqp);
  if (!["amqp:", "amqps:"].includes(url.protocol))
    throw new Error("Invalid RabbitMQ URL.");
  const prefix = process.env.RABBITMQ_PREFIX ?? "pjflim.media";
  if (!/^[a-z0-9._-]{1,80}$/.test(prefix))
    throw new Error("Invalid RabbitMQ prefix.");
  const callbackSecret = process.env.MEDIA_CALLBACK_SECRET;
  if (!callbackSecret || !/^[a-f0-9]{64}$/i.test(callbackSecret))
    throw new Error("Missing media callback key.");
  const webhook = process.env.CLOUDINARY_WEBHOOK_URL;
  if (webhook) {
    const u = new URL(webhook);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/api/v1/webhooks/cloudinary"
    )
      throw new Error(
        "Cloudinary webhook URL must be HTTPS and end with /api/v1/webhooks/cloudinary.",
      );
  }
  const backupDriver = process.env.BACKUP_DRIVER ?? "filesystem";
  if (!["filesystem", "s3"].includes(backupDriver))
    throw new Error("Invalid backup driver.");
  if (
    process.env.NODE_ENV === "production" &&
    (backupDriver !== "s3" ||
      !webhook ||
      url.protocol !== "amqps:" ||
      (webhook && new URL(webhook).hostname.endsWith(".trycloudflare.com")))
  )
    throw new Error(
      "Production requires S3 backup, a fixed HTTPS webhook and AMQPS.",
    );
  return {
    amqp,
    prefix,
    callbackSecret,
    webhook,
    backupDriver,
    prefetch: integer("WORKER_PREFETCH", 2, 1, 8),
    leaseSeconds: integer("WORKER_LEASE_SECONDS", 120, 30, 600),
    pollMs: integer("WORKER_POLL_MS", 1000, 100, 30000),
    reconcileSeconds: integer("MEDIA_RECONCILE_SECONDS", 20, 1, 300),
    maxWaitSeconds: integer("MEDIA_MAX_WAIT_SECONDS", 7200, 60, 86400),
    maxFailures: integer("MEDIA_MAX_FAILURES", 8, 1, 30),
  };
}
