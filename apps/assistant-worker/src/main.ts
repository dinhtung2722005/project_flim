import {
  AssistantBroker,
  AssistantWake,
} from "../../../packages/assistant/src/broker";
import { assistantConfiguration } from "../../api/src/assistant.config";
class SafeError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}
function origin(value: string) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error("Invalid assistant private origin.");
  return u.origin;
}
async function main() {
  const cfg = assistantConfiguration();
  if (!cfg.enabled) throw new Error("Assistant disabled.");
  const api = origin(cfg.apiOrigin),
    service = origin(cfg.agentOrigin);
  let stopping = false,
    broker: AssistantBroker | undefined;
  const log = (event: string) => console.log(JSON.stringify({ event }));
  const post = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(api + "/api/v1/internal/assistant/runs/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new SafeError(
        typeof data.code === "string" ? data.code : "AGENT_WORKER_UNAVAILABLE",
        r.status,
      );
    return data;
  };
  async function processRun(wake: AssistantWake) {
    const claim = await post(
      wake.runId + "/claims",
      {},
      { "X-Assistant-Worker-Key": cfg.secret },
    );
    if (!claim.active) return;
    const headers = { Authorization: "Bearer " + claim.capability };
    const cancel = new AbortController();
    let beating = false;
    const heartbeat = setInterval(() => {
      if (beating) return;
      beating = true;
      void post(wake.runId + "/heartbeats", {}, headers)
        .catch(() => cancel.abort())
        .finally(() => {
          beating = false;
        });
    }, 10000);
    heartbeat.unref();
    const deadline = setTimeout(() => cancel.abort(), 125000);
    try {
      const res = await fetch(service + "/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Assistant-Service-Key": cfg.agentKey,
        },
        body: JSON.stringify({ run: claim.run, capability: claim.capability }),
        redirect: "error",
        signal: cancel.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new SafeError(
          data.code ?? "AGENT_WORKER_UNAVAILABLE",
          res.status,
        );
      await post(wake.runId + "/results", data, headers);
      log("assistant.run.completed");
    } catch (error) {
      const allowed = new Set([
        "AGENT_MODEL_UNAVAILABLE",
        "AGENT_TOOL_BUDGET_EXCEEDED",
        "AGENT_ANSWER_INVALID",
        "AGENT_CONTEXT_CHANGED",
        "AGENT_TIMEOUT",
        "AUTH_SESSION_REVOKED",
      ]);
      const code =
        error instanceof SafeError && allowed.has(error.code)
          ? error.code
          : cancel.signal.aborted
            ? "AGENT_TIMEOUT"
            : "AGENT_WORKER_UNAVAILABLE";
      try {
        await post(wake.runId + "/failures", { code }, headers);
      } catch (failure) {
        if (!(
          failure instanceof SafeError &&
          [401, 403, 404, 409].includes(failure.status)
        ))
          throw failure;
      }
      log("assistant.run.stopped");
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
    }
  }
  const stop = () => {
    stopping = true;
    void broker?.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopping) {
    try {
      broker = new AssistantBroker(cfg.amqp, cfg.prefix);
      await broker.open();
      await broker.consume(processRun);
      log("assistant.worker.ready");
      await broker.closed();
    } catch {
      log("assistant.worker.reconnecting");
    } finally {
      await broker?.close();
    }
    if (!stopping) await new Promise((r) => setTimeout(r, 2000));
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({
      event: "assistant.worker.failed",
      code: "CONFIGURATION_OR_RUNTIME",
    }),
  );
  process.exitCode = 1;
});
