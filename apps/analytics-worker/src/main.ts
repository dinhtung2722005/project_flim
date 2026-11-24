import { analyticsConfiguration } from "./config";
import { ViewStore } from "./store";
import { AnalyticsBroker } from "../../../packages/analytics/src/broker";
let stopping = false,
  current: AnalyticsBroker | undefined;
process.on("SIGTERM", () => {
  stopping = true;
  void current?.close();
});
process.on("SIGINT", () => {
  stopping = true;
  void current?.close();
});
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const cfg = analyticsConfiguration(),
    store = new ViewStore(cfg.database, cfg.hashSecret);
  try {
    await store.ready();
    while (!stopping) {
      const broker = new AnalyticsBroker(cfg.amqp, cfg.prefix);
      current = broker;
      let timer: ReturnType<typeof setInterval> | undefined,
        busy = false;
      const active = new Set<Promise<unknown>>();
      try {
        await broker.open();
        const closed = broker.closed();
        await broker.consume(async (wake) => {
          const task = store.receive(wake);
          active.add(task);
          try {
            await task;
          } finally {
            active.delete(task);
          }
        });
        let lastPrune = 0;
        const tick = async () => {
          if (busy || stopping) return;
          busy = true;
          try {
            if (Date.now() - lastPrune > 3600000) {
              await store.prune();
              lastPrune = Date.now();
            }
            for (let i = 0; i < 20; i++) {
              const e = await store.claim();
              if (!e) break;
              try {
                await broker.publish({
                  v: 1,
                  eventId: e.id,
                  batchId: e.aggregate_id,
                });
                await store.confirmed(e, true);
              } catch {
                await store.confirmed(e, false);
                throw Error("ANALYTICS_PUBLISH_FAILED");
              }
            }
          } catch {
            console.warn(
              JSON.stringify({
                event: "analytics.dispatch.retry",
                code: "SERVICE_UNAVAILABLE",
              }),
            );
            await broker.close();
          } finally {
            busy = false;
          }
        };
        const runTick = () => {
          const task = tick();
          active.add(task);
          void task.finally(() => active.delete(task));
          return task;
        };
        timer = setInterval(() => void runTick(), 1000);
        await runTick();
        console.log(
          JSON.stringify({
            event: "analytics.connected",
            definitionVersion: 2,
            queue: cfg.prefix + ".jobs",
          }),
        );
        await closed;
      } catch {
        console.warn(
          JSON.stringify({
            event: "analytics.connection.retry",
            code: "SERVICE_UNAVAILABLE",
          }),
        );
      } finally {
        if (timer) clearInterval(timer);
        await broker.close();
        await Promise.allSettled([...active]);
      }
      if (!stopping) await delay(2000);
    }
  } finally {
    await store.close();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({ event: "analytics.failed", code: "SERVICE_UNAVAILABLE" }),
  );
  process.exitCode = 1;
});
