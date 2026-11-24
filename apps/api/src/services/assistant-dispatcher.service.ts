import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Database,
  one,
  query,
} from "../../../../packages/database/src/database";
import { AssistantBroker } from "../../../../packages/assistant/src/broker";
import { assistantConfiguration } from "../assistant.config";
import { AssistantService } from "./assistant.service";
@Injectable()
export class AssistantDispatcher implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private broker?: AssistantBroker;
  private busy = false;
  private stopped = false;
  private readonly owner = randomUUID();
  private lastMaintenance = 0;
  private nextConnect = 0;
  private readonly log = new Logger(AssistantDispatcher.name);
  constructor(
    private readonly db: Database,
    private readonly assistant: AssistantService,
  ) {}
  onModuleInit() {
    if (
      !assistantConfiguration().enabled ||
      process.env.ASSISTANT_DISPATCH_ENABLED === "false"
    )
      return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => this.log.warn("assistant.dispatch_failed"));
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.broker?.close();
  }
  async tick() {
    if (this.busy || this.stopped || !assistantConfiguration().enabled) return;
    this.busy = true;
    try {
      if (Date.now() - this.lastMaintenance > 10000) {
        await this.assistant.maintain();
        this.lastMaintenance = Date.now();
      }
      if (!this.broker) {
        if (Date.now() < this.nextConnect) return;
        const c = assistantConfiguration(),
          candidate = new AssistantBroker(c.amqp, c.prefix);
        try {
          await candidate.open();
          if (this.stopped) {
            await candidate.close();
            return;
          }
          this.broker = candidate;
          void candidate.closed().then(() => {
            if (this.broker === candidate) this.broker = undefined;
          });
        } catch {
          await candidate.close();
          this.nextConnect = Date.now() + 5000;
          return;
        }
      }
      const event = await this.db.$transaction(async (tx) => {
        const e = await one(
          tx,
          "SELECT id FROM movie.outbox_events WHERE type='assistant.run.requested' AND published_at IS NULL AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        );
        if (!e) return null;
        return one(
          tx,
          "UPDATE movie.outbox_events SET lease_owner=$2,lease_until=clock_timestamp()+interval '30 seconds',lease_token=lease_token+1 WHERE id=$1::uuid RETURNING *",
          [e.id, this.owner],
        );
      });
      if (!event) return;
      try {
        await this.broker!.publish({
          v: 1,
          eventId: event.id,
          runId: event.aggregate_id,
        });
        await query(
          this.db,
          "UPDATE movie.outbox_events SET published_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL WHERE id=$1::uuid AND lease_owner=$2 AND lease_token=$3::bigint AND lease_until>clock_timestamp() RETURNING id",
          [event.id, this.owner, event.lease_token.toString()],
        );
      } catch {
        await query(
          this.db,
          "UPDATE movie.outbox_events SET lease_owner=NULL,lease_until=NULL,attempt_count=attempt_count+1,next_attempt_at=clock_timestamp()+interval '5 seconds' WHERE id=$1::uuid AND lease_owner=$2 AND lease_token=$3::bigint RETURNING id",
          [event.id, this.owner, event.lease_token.toString()],
        );
        await this.broker?.close();
        this.broker = undefined;
        this.nextConnect = Date.now() + 5000;
      }
    } finally {
      this.busy = false;
    }
  }
}
