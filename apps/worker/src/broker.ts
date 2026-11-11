import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import { workerConfiguration } from "./config";
export type Wake =
  { kind: "event"; eventId: string } | { kind: "job"; jobId: string };
export class Broker {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private returned = new Set<string>();
  readonly cfg = workerConfiguration();
  private stop?: () => void;
  async open() {
    const uri = new URL(this.cfg.amqp);
    uri.searchParams.set("heartbeat", "15");
    this.connection = await amqp.connect(uri.toString(), { timeout: 10000 });
    this.connection.on("error", () => undefined);
    this.connection.on("close", () => this.stop?.());
    this.channel = await this.connection.createConfirmChannel();
    this.channel.on("error", () => undefined);
    this.channel.on("close", () => this.stop?.());
    this.channel.on("return", (msg) =>
      this.returned.add(msg.properties.messageId ?? ""),
    );
    const dead = this.cfg.prefix + ".dead",
      exchange = this.cfg.prefix + ".events";
    await this.channel.assertExchange(exchange, "direct", { durable: true });
    await this.channel.assertExchange(dead, "direct", { durable: true });
    await this.channel.assertQueue(this.cfg.prefix + ".dlq", {
      durable: true,
      arguments: { "x-queue-type": "quorum" },
    });
    await this.channel.bindQueue(this.cfg.prefix + ".dlq", dead, "dead");
    await this.channel.assertQueue(this.cfg.prefix + ".jobs", {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-delivery-limit": 8,
        "x-dead-letter-exchange": dead,
        "x-dead-letter-routing-key": "dead",
        "x-overflow": "reject-publish",
        "x-dead-letter-strategy": "at-least-once",
      },
    });
    await this.channel.bindQueue(this.cfg.prefix + ".jobs", exchange, "work");
    await this.channel.prefetch(this.cfg.prefetch);
  }
  async publish(body: Wake, id: string) {
    const channel = this.channel;
    if (!channel) throw new Error("Broker closed.");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Publisher confirm timed out.")),
        10000,
      );
      try {
        channel.publish(
          this.cfg.prefix + ".events",
          "work",
          Buffer.from(JSON.stringify({ schemaVersion: 1, ...body })),
          {
            persistent: true,
            mandatory: true,
            messageId: id,
            contentType: "application/json",
          },
          (error) => {
            clearTimeout(timer);
            if (error || this.returned.delete(id))
              reject(new Error("Message not confirmed/routed."));
            else resolve();
          },
        );
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  async consume(
    handler: (body: Wake, msg: ConsumeMessage) => Promise<"ack" | "dead">,
  ) {
    const channel = this.channel!;
    await channel.consume(
      this.cfg.prefix + ".jobs",
      async (msg) => {
        if (!msg) return;
        try {
          if (msg.content.length > 4096) throw new Error("Invalid message.");
          const data = JSON.parse(msg.content.toString("utf8"));
          const validId = (id: any) =>
            typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id);
          if (
            data.schemaVersion !== 1 ||
            !(
              (data.kind === "event" && validId(data.eventId)) ||
              (data.kind === "job" && validId(data.jobId))
            )
          )
            throw new Error("Invalid message.");
          try {
            const result = await handler(data, msg);
            if (result === "dead") channel.nack(msg, false, false);
            else channel.ack(msg);
          } catch {
            await this.close();
          } // Keep unacknowledged work recoverable on transient DB/connection failure.
        } catch {
          try {
            channel.nack(msg, false, false);
          } catch {}
        }
      },
      { noAck: false },
    );
  }
  closed() {
    return new Promise<void>((resolve) => {
      this.stop = resolve;
    });
  }
  async close() {
    try {
      await this.channel?.close();
    } catch {}
    try {
      await this.connection?.close();
    } catch {}
  }
}
