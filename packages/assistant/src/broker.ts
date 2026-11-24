import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
export type AssistantWake = { v: 1; runId: string; eventId: string };
const validId = (x: unknown) =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    x,
  );
export class AssistantBroker {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private returned = new Set<string>();
  private stopped?: () => void;
  constructor(
    readonly url: string,
    readonly prefix: string,
  ) {}
  async open() {
    const uri = new URL(this.url);
    uri.searchParams.set("heartbeat", "15");
    this.connection = await amqp.connect(uri.toString(), { timeout: 5000 });
    this.connection.on("error", () => {});
    this.connection.on("close", () => {
      this.channel = undefined;
      this.stopped?.();
    });
    const c = (this.channel = await this.connection.createConfirmChannel());
    c.on("error", () => {});
    c.on("close", () => {
      this.channel = undefined;
      this.stopped?.();
    });
    c.on("return", (msg) => this.returned.add(msg.properties.messageId ?? ""));
    await c.assertExchange(this.prefix + ".events", "direct", {
      durable: true,
    });
    await c.assertExchange(this.prefix + ".dead", "direct", { durable: true });
    await c.assertQueue(this.prefix + ".dlq", {
      durable: true,
      arguments: { "x-queue-type": "quorum" },
    });
    await c.bindQueue(this.prefix + ".dlq", this.prefix + ".dead", "dead");
    await c.assertQueue(this.prefix + ".jobs", {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-delivery-limit": 8,
        "x-dead-letter-exchange": this.prefix + ".dead",
        "x-dead-letter-routing-key": "dead",
        "x-overflow": "reject-publish",
        "x-dead-letter-strategy": "at-least-once",
        "x-max-length": 1000,
      },
    });
    await c.bindQueue(this.prefix + ".jobs", this.prefix + ".events", "work");
    await c.prefetch(1);
  }
  async publish(wake: AssistantWake) {
    const c = this.channel;
    if (!c) throw new Error("ASSISTANT_BROKER_CLOSED");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("ASSISTANT_CONFIRM_TIMEOUT")),
        5000,
      );
      try {
        c.publish(
          this.prefix + ".events",
          "work",
          Buffer.from(JSON.stringify(wake)),
          {
            persistent: true,
            mandatory: true,
            messageId: wake.eventId,
            contentType: "application/json",
          },
          (err) => {
            clearTimeout(timer);
            if (err || this.returned.delete(wake.eventId))
              reject(new Error("ASSISTANT_PUBLISH_FAILED"));
            else resolve();
          },
        );
      } catch {
        clearTimeout(timer);
        reject(new Error("ASSISTANT_PUBLISH_FAILED"));
      }
    });
  }
  async consume(handler: (wake: AssistantWake) => Promise<void>) {
    const c = this.channel;
    if (!c) throw new Error("ASSISTANT_BROKER_CLOSED");
    await c.consume(
      this.prefix + ".jobs",
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;
        let wake: AssistantWake;
        try {
          if (msg.content.length > 1024) throw 0;
          wake = JSON.parse(msg.content.toString("utf8"));
          if (
            wake.v !== 1 ||
            !validId(wake.runId) ||
            !validId(wake.eventId) ||
            Object.keys(wake).some(
              (k) => !["v", "runId", "eventId"].includes(k),
            )
          )
            throw 0;
        } catch {
          c.nack(msg, false, false);
          return;
        }
        try {
          await handler(wake);
          c.ack(msg);
        } catch {
          await this.close();
        }
      },
      { noAck: false },
    );
  }
  closed() {
    return new Promise<void>((resolve) => {
      if (!this.channel) resolve();
      else this.stopped = resolve;
    });
  }
  async close() {
    try {
      await this.channel?.close();
    } catch {}
    try {
      await this.connection?.close();
    } catch {}
    this.channel = undefined;
    this.stopped?.();
  }
}
