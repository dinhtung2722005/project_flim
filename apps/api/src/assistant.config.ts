import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
config({ path: ".env.assistant.local", quiet: true });
export function assistantConfiguration() {
  const enabled = process.env.ASSISTANT_ENABLED === "true";
  const secret = process.env.ASSISTANT_WORKER_SECRET ?? "";
  const agentKey = process.env.ASSISTANT_SERVICE_SECRET ?? "";
  const engine = process.env.ASSISTANT_ENGINE ?? "CATALOG";
  if (
    enabled &&
    (secret.length < 64 ||
      agentKey.length < 64 ||
      !["CATALOG", "OLLAMA"].includes(engine))
  )
    throw new Error("Invalid assistant configuration.");
  let workerEnv: Record<string, string> = {};
  try {
    workerEnv = parse(readFileSync(".env.worker.local"));
  } catch {}
  const amqp =
    process.env.ASSISTANT_RABBITMQ_URL ??
    process.env.RABBITMQ_URL ??
    workerEnv.RABBITMQ_URL ??
    "";
  const prefix = process.env.ASSISTANT_QUEUE_PREFIX ?? "pjflim.assistant";
  if (!/^[a-zA-Z0-9._-]{3,100}$/.test(prefix))
    throw new Error("Invalid assistant queue prefix.");
  if (enabled) {
    const uri = new URL(amqp);
    if (!["amqp:", "amqps:"].includes(uri.protocol))
      throw new Error("Invalid assistant broker.");
  }
  return {
    enabled,
    secret,
    agentKey,
    engine: engine as "CATALOG" | "OLLAMA",
    amqp,
    prefix,
    apiOrigin: process.env.ASSISTANT_API_ORIGIN ?? "http://127.0.0.1:3000",
    agentOrigin:
      process.env.ASSISTANT_SERVICE_ORIGIN ?? "http://127.0.0.1:8010",
    model: process.env.ASSISTANT_MODEL ?? "qwen2.5:7b",
  };
}
