import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir(".local/rabbitmq", { recursive: true });
await mkdir(".local/worker", { recursive: true });
let env = "";
try {
  env = await readFile(".env.worker.local", "utf8");
} catch {}
if (!env) {
  const password = randomBytes(32).toString("hex");
  env = [
    "RABBITMQ_URL=amqp://pj_flim_worker:" +
      password +
      "@127.0.0.1:5672/pj_flim",
    "RABBITMQ_PREFIX=pjflim.media",
    "WORKER_PREFETCH=2",
    "WORKER_LEASE_SECONDS=120",
    "WORKER_POLL_MS=1000",
    "MEDIA_RECONCILE_SECONDS=20",
    "MEDIA_MAX_WAIT_SECONDS=7200",
    "MEDIA_MAX_FAILURES=8",
    "MEDIA_CALLBACK_SECRET=" + randomBytes(32).toString("hex"),
    "CLOUDINARY_WEBHOOK_URL=",
    "BACKUP_DRIVER=filesystem",
    "BACKUP_LOCAL_ROOT=E:/pj-Flim/.local/backups",
    "BACKUP_BUCKET=",
    "BACKUP_REGION=ap-southeast-1",
    "BACKUP_S3_ENDPOINT=",
    "BACKUP_ACCESS_KEY_ID=",
    "BACKUP_SECRET_ACCESS_KEY=",
    "",
  ].join("\n");
  await writeFile(".env.worker.local", env);
  await writeFile(
    ".local/rabbitmq/bootstrap.env",
    [
      "RABBITMQ_DEFAULT_USER=pj_flim_worker",
      "RABBITMQ_DEFAULT_PASS=" + password,
      "RABBITMQ_DEFAULT_VHOST=pj_flim",
      "",
    ].join("\n"),
  );
}
console.log("Worker environment ready; secrets remain in ignored local files.");
