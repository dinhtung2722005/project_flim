import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
async function main() {
  let old: Record<string, string> = {};
  try {
    old = parse(await readFile(".env.assistant.local"));
  } catch {}
  const value = {
    ASSISTANT_ENABLED: "true",
    ASSISTANT_ENGINE: "CATALOG",
    ASSISTANT_WORKER_SECRET: randomBytes(32).toString("hex"),
    ASSISTANT_SERVICE_SECRET: randomBytes(32).toString("hex"),
    ASSISTANT_API_ORIGIN: "http://127.0.0.1:3000",
    ASSISTANT_SERVICE_ORIGIN: "http://127.0.0.1:8010",
    ASSISTANT_QUEUE_PREFIX: "pjflim.assistant",
    ASSISTANT_MODEL: "qwen2.5:7b",
    ASSISTANT_OLLAMA_ORIGIN: "http://host.docker.internal:11434",
    ...old,
  };
  await mkdir(".local/assistant", { recursive: true });
  await writeFile(
    ".env.assistant.local",
    Object.entries(value)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n",
  );
  await writeFile(
    ".local/assistant/agent.env",
    [
      "ASSISTANT_SERVICE_SECRET=" + value.ASSISTANT_SERVICE_SECRET,
      "ASSISTANT_ENGINE=" + value.ASSISTANT_ENGINE,
      "ASSISTANT_GATEWAY_ORIGIN=http://host.docker.internal:3000",
      "ASSISTANT_MODEL=" + value.ASSISTANT_MODEL,
      "ASSISTANT_OLLAMA_ORIGIN=" + value.ASSISTANT_OLLAMA_ORIGIN,
    ].join("\n") + "\n",
  );
  console.log(
    JSON.stringify({
      event: "assistant.configuration.saved",
      engine: value.ASSISTANT_ENGINE,
      privateFiles: [".env.assistant.local", ".local/assistant/agent.env"],
    }),
  );
}
main().catch(() => {
  console.error("ASSISTANT_CONFIGURATION_FAILED");
  process.exitCode = 1;
});
