import "reflect-metadata";
import { Broker } from "./broker";
import { WorkerStore } from "./store";
import { MediaWorker } from "./media-worker";
import { OutboxPublisher } from "./outbox";
import { workerConfiguration } from "./config";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false,
  current: Broker | undefined;
process.on("SIGTERM", () => {
  stopping = true;
  void current?.close();
});
process.on("SIGINT", () => {
  stopping = true;
  void current?.close();
});
async function main() {
  const cfg = workerConfiguration(),
    store = new WorkerStore(),
    media = new MediaWorker(store);
  await media.backup.check();
  try {
    while (!stopping) {
      const broker = new Broker();
      current = broker;
      let timer: ReturnType<typeof setInterval> | undefined;
      let ticking = false;
      const active = new Set<Promise<unknown>>();
      try {
        await broker.open();
        const closed = broker.closed();
        await broker.consume(async (body) => {
          const task =
            body.kind === "event"
              ? media.receiveEvent(body.eventId)
              : media.run(body.jobId);
          active.add(task);
          try {
            return await task;
          } finally {
            active.delete(task);
          }
        });
        const publisher = new OutboxPublisher(store, broker);
        timer = setInterval(async () => {
          if (ticking) return;
          ticking = true;
          try {
            await publisher.tick();
            await publisher.schedule();
          } catch {
            console.warn(
              JSON.stringify({
                event: "worker.dispatch.retry",
                code: "SERVICE_UNAVAILABLE",
              }),
            );
            await broker.close();
          } finally {
            ticking = false;
          }
        }, cfg.pollMs);
        console.log(
          JSON.stringify({
            event: "worker.connected",
            queue: cfg.prefix + ".jobs",
            prefetch: cfg.prefetch,
            backup: cfg.backupDriver,
          }),
        );
        await closed;
      } catch {
        console.warn(
          JSON.stringify({
            event: "worker.connection.retry",
            code: "SERVICE_UNAVAILABLE",
          }),
        );
      } finally {
        if (timer) clearInterval(timer);
        await broker.close();
        await Promise.race([Promise.allSettled([...active]), delay(30000)]);
      }
      if (!stopping) await delay(2000);
    }
  } finally {
    media.backup.close();
    await store.close();
  }
}
main().catch(() => {
  console.error(
    JSON.stringify({ event: "worker.failed", code: "SERVICE_UNAVAILABLE" }),
  );
  process.exitCode = 1;
});
