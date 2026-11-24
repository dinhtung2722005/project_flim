import "../../../packages/config/src/environment";
import { config } from "dotenv";
config({ path: ".env.worker.local", quiet: true });
config({ path: ".env.analytics.local", quiet: true });
export function analyticsConfiguration() {
  const amqp =
    process.env.ANALYTICS_RABBITMQ_URL || process.env.RABBITMQ_URL || "";
  const database = process.env.WORKER_DATABASE_URL || "";
  const hashSecret = process.env.ANALYTICS_HASH_SECRET || "";
  const prefix = process.env.ANALYTICS_QUEUE_PREFIX || "pjflim.analytics";
  if (
    !/^[a-f0-9]{64}$/.test(hashSecret) ||
    !database ||
    !amqp ||
    !/^[a-zA-Z0-9._-]{3,100}$/.test(prefix)
  )
    throw Error("Invalid analytics configuration.");
  const url = new URL(amqp);
  if (
    !["amqp:", "amqps:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" && url.protocol !== "amqps:")
  )
    throw Error("Invalid analytics broker.");
  return { amqp, database, hashSecret, prefix };
}
