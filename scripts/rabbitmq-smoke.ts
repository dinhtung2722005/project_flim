import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import { Broker, Wake } from "../apps/worker/src/broker";
import { workerConfiguration } from "../apps/worker/src/config";

const prefix = "pjflim.broker-test." + randomUUID().replaceAll("-", "");
const originalPrefix = process.env.RABBITMQ_PREFIX;
const originalPrefetch = process.env.WORKER_PREFETCH;
const brokers = new Set<Broker>();
const cases: string[] = [];
let stage = "configuration";
let connection: ChannelModel | undefined;
let control: ConfirmChannel | undefined;
let release: (() => void) | undefined;
let checks = 0;
let cleanup = false;
let passed = false;
const startedAt = new Date().toISOString();
const reportPath = ".local/worker/rabbitmq-smoke-result.json";
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function check(value: unknown, name: string): asserts value {
  assert.ok(value, name);
  checks++;
}
async function until<T>(
  get: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await get();
    if (ready(value)) return value;
    await sleep(30);
  }
  throw new Error("Timeout: " + label);
}
async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Test deadline exceeded")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function open() {
  const broker = new Broker();
  brokers.add(broker);
  await broker.open();
  return broker;
}
async function close(broker: Broker) {
  await broker.close();
  brokers.delete(broker);
}
async function empty() {
  const state = await until(
    () => control!.checkQueue(prefix + ".jobs"),
    (q) => q.messageCount === 0 && q.consumerCount === 0,
    "jobs drained",
  );
  check(
    state.messageCount === 0 && state.consumerCount === 0,
    "ACK drained queue",
  );
}
async function deadLetter(id: string, reason: string) {
  const message = await until(
    () => control!.get(prefix + ".dlq", { noAck: false }),
    (m) => !!m,
    "DLQ arrival",
  );
  check(!!message, "dead letter exists");
  check(message.properties.messageId === id, "DLQ preserves message ID");
  const deaths = message.properties.headers?.["x-death"] as
    Array<{ reason: string; queue: string }> | undefined;
  check(
    deaths?.some((d) => d.reason === reason && d.queue === prefix + ".jobs"),
    "DLQ death reason/source",
  );
  control!.ack(message);
  await control!.checkQueue(prefix + ".dlq"); // round trip after ACK
  return message;
}
async function rawPublish(content: Buffer, id: string) {
  await deadline(
    new Promise<void>((resolve, reject) => {
      control!.publish(
        prefix + ".events",
        "work",
        content,
        {
          persistent: true,
          mandatory: true,
          messageId: id,
          contentType: "application/json",
        },
        (error) => (error ? reject(error) : resolve()),
      );
    }),
  );
}
function done(name: string) {
  cases.push(name);
  console.log("PASS " + name);
}

async function main() {
  process.env.RABBITMQ_PREFIX = prefix;
  process.env.WORKER_PREFETCH = "1";
  try {
    const config = workerConfiguration();
    const uri = new URL(config.amqp);
    // This local smoke suite never opens non-local brokers.
    check(
      ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname),
      "local broker only",
    );
    connection = await amqp.connect(uri.toString(), { timeout: 10000 });
    connection.on("error", () => undefined);
    control = await connection.createConfirmChannel();
    control.on("error", () => undefined);
    let broker = await open();

    stage = "topology";
    await control.checkQueue(prefix + ".jobs");
    await control.checkQueue(prefix + ".dlq");
    check(broker.cfg.prefetch === 1, "prefetch configuration");
    done("connect and isolated topology");

    stage = "confirmed event and ACK";
    const eventId = randomUUID();
    let received: ConsumeMessage | undefined;
    let body: Wake | undefined;
    await broker.consume(async (data, message) => {
      body = data;
      received = message;
      return "ack";
    });
    await broker.publish({ kind: "event", eventId }, eventId);
    await until(
      async () => received,
      (m) => !!m,
      "confirmed event",
    );
    check(body?.kind === "event" && body.eventId === eventId, "event payload");
    check(received?.properties.messageId === eventId, "message correlation");
    check(received?.properties.deliveryMode === 2, "persistent delivery");
    check(
      received?.properties.contentType === "application/json",
      "content type",
    );
    await close(broker);
    await empty();
    done(stage);

    stage = "queued job survives producer reconnect";
    broker = await open();
    const jobId = randomUUID();
    await broker.publish({ kind: "job", jobId }, jobId);
    await close(broker);
    const queued = await control.checkQueue(prefix + ".jobs");
    check(queued.messageCount === 1, "job remains queued after producer close");
    broker = await open();
    let job: Wake | undefined;
    await broker.consume(async (data) => {
      job = data;
      return "ack";
    });
    await until(
      async () => job,
      (value) => !!value,
      "job delivery after reconnect",
    );
    check(
      job?.kind === "job" && job.jobId === jobId,
      "job payload after reconnect",
    );
    await close(broker);
    await empty();
    done(stage);

    stage = "prefetch limits unacknowledged work";
    broker = await open();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    await broker.consume(async () => {
      count++;
      if (count === 1) await gate;
      return "ack";
    });
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      await broker.publish({ kind: "event", eventId: id }, id);
    }
    await until(
      async () => count,
      (value) => value === 1,
      "first prefetch delivery",
    );
    await sleep(200);
    check(count === 1, "second message held while first unacknowledged");
    release!();
    await until(
      async () => count,
      (value) => value === 2,
      "delivery after ACK",
    );
    check(Number(count) === 2, "next delivery resumes after ACK");
    await close(broker);
    await empty();
    done(stage);

    stage = "handler rejects to DLQ";
    broker = await open();
    await broker.consume(async () => "dead");
    const rejectedId = randomUUID();
    await broker.publish({ kind: "job", jobId: rejectedId }, rejectedId);
    await deadLetter(rejectedId, "rejected");
    await close(broker);
    await empty();
    done(stage);

    stage = "invalid message validation";
    broker = await open();
    let invalidHandlerCalls = 0;
    await broker.consume(async () => {
      invalidHandlerCalls++;
      return "ack";
    });
    const invalidPayloads = [
      Buffer.from("{invalid"),
      Buffer.from(
        JSON.stringify({
          schemaVersion: 2,
          kind: "event",
          eventId: randomUUID(),
        }),
      ),
      Buffer.alloc(4097, 120),
      Buffer.from(
        JSON.stringify({ schemaVersion: 1, kind: "event", eventId: "invalid" }),
      ),
    ];
    for (const payload of invalidPayloads) {
      const id = randomUUID();
      await rawPublish(payload, id);
      await deadLetter(id, "rejected");
    }
    check(invalidHandlerCalls === 0, "invalid messages never reach handler");
    await close(broker);
    await empty();
    done("malformed JSON, unsupported schema, oversized body, invalid ID");

    stage = "mandatory routing detects missing binding";
    broker = await open();
    await control.unbindQueue(prefix + ".jobs", prefix + ".events", "work");
    try {
      const id = randomUUID();
      await assert.rejects(
        broker.publish({ kind: "event", eventId: id }, id),
        /not confirmed\/routed/,
      );
      checks++;
    } finally {
      await control.bindQueue(prefix + ".jobs", prefix + ".events", "work");
    }
    await close(broker);
    await empty();
    done(stage);

    stage = "handler failure requeues unacknowledged message";
    broker = await open();
    const closed = broker.closed();
    await broker.consume(async () => {
      throw new Error("Intentional test failure");
    });
    const retryId = randomUUID();
    await broker.publish({ kind: "event", eventId: retryId }, retryId);
    await deadline(closed);
    await close(broker);
    const retryQueued = await until(
      () => control!.checkQueue(prefix + ".jobs"),
      (q) => q.messageCount === 1,
      "requeued after disconnect",
    );
    check(
      retryQueued.messageCount === 1,
      "failed handler leaves message recoverable",
    );
    broker = await open();
    let retried: ConsumeMessage | undefined;
    await broker.consume(async (_, message) => {
      retried = message;
      return "ack";
    });
    await until(
      async () => retried,
      (m) => !!m,
      "redelivery",
    );
    check(retried?.fields.redelivered === true, "redelivery flag set");
    check(retried?.properties.messageId === retryId, "redelivery preserves ID");
    await close(broker);
    await empty();
    done(stage);

    stage = "poison message reaches configured delivery limit";
    await control.prefetch(1);
    let deliveries = 0;
    const poisonId = randomUUID();
    const consumer = await control.consume(
      prefix + ".jobs",
      (message) => {
        if (!message) return;
        deliveries++;
        control!.reject(message, true);
      },
      { noAck: false },
    );
    await rawPublish(
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          kind: "job",
          jobId: poisonId,
        }),
      ),
      poisonId,
    );
    await deadLetter(poisonId, "delivery_limit");
    await control.cancel(consumer.consumerTag);
    check(
      deliveries >= 8 && deliveries <= 10,
      "poison deliveries bounded by limit 8",
    );
    await empty();
    done(stage);
    passed = true;
  } finally {
    release?.();
    for (const broker of brokers) await broker.close();
    if (!/^pjflim\.broker-test\.[a-f0-9]{32}$/.test(prefix))
      throw new Error("Unsafe test prefix");
    try {
      if (control) {
        await control.deleteQueue(prefix + ".jobs");
        await control.deleteQueue(prefix + ".dlq");
        await control.deleteExchange(prefix + ".events");
        await control.deleteExchange(prefix + ".dead");
        cleanup = true;
      }
    } catch {
      passed = false;
    }
    try {
      await control?.close();
    } catch {}
    try {
      await connection?.close();
    } catch {}
    if (originalPrefix === undefined) delete process.env.RABBITMQ_PREFIX;
    else process.env.RABBITMQ_PREFIX = originalPrefix;
    if (originalPrefetch === undefined) delete process.env.WORKER_PREFETCH;
    else process.env.WORKER_PREFETCH = originalPrefetch;
    await mkdir(".local/worker", { recursive: true });
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          passed: passed && cleanup,
          cases,
          checks,
          cleanup,
          isolatedPrefix: prefix,
          ...(passed ? {} : { failedStage: stage }),
          limitations: [
            "single local node",
            "no broker restart",
            "no load test",
            "no Redis integration",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  }
  if (!passed || !cleanup) throw new Error("Smoke test did not complete");
  console.log(JSON.stringify({ passed, cases: cases.length, checks, cleanup }));
}
void main().catch(() => {
  // Never print connection URLs, credentials or raw SDK errors.
  console.error(
    "RabbitMQ smoke failed at stage: " + stage + ". See " + reportPath,
  );
  process.exitCode = 1;
});
