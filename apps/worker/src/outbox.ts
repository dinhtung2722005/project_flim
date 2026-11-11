import { randomUUID } from "node:crypto";
import { Broker } from "./broker";
import { WorkerStore, row, rows } from "./store";
export class OutboxPublisher {
  readonly owner = randomUUID();
  constructor(
    private readonly store: WorkerStore,
    private readonly broker: Broker,
  ) {}
  async tick() {
    // A confirmed message may reach the DLQ during a prolonged consumer outage.
    // Reconcile durable business intent/inbox until the consumer has committed work.
    await rows(
      this.store.pool,
      "UPDATE movie.outbox_events e SET published_at=NULL,next_attempt_at=now(),lease_owner=NULL,lease_until=NULL WHERE e.published_at<now()-interval '1 minute' AND ((e.type='media.processing.requested' AND NOT EXISTS(SELECT 1 FROM movie.job_runs j WHERE j.logical_key=e.payload->>'attemptId' AND j.handler IN ('media.hls','media.backup'))) OR (e.type='media.webhook.received' AND EXISTS(SELECT 1 FROM movie.inbox_events i WHERE i.id::text=e.payload->>'inboxId' AND i.status='RECEIVED')))",
    );

    const events = await this.store.tx(async (tx) =>
      rows(
        tx,
        "WITH due AS (SELECT id FROM movie.outbox_events WHERE published_at IS NULL AND type IN ('media.processing.requested','media.webhook.received') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 20) UPDATE movie.outbox_events e SET lease_owner=$1,lease_until=now()+interval '30 seconds',lease_token=lease_token+1,attempt_count=attempt_count+1 FROM due WHERE e.id=due.id RETURNING e.id,e.lease_token,e.attempt_count",
        [this.owner],
      ),
    );
    for (const event of events) {
      try {
        await this.broker.publish(
          { kind: "event", eventId: event.id },
          event.id,
        );
        await rows(
          this.store.pool,
          "UPDATE movie.outbox_events SET published_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND lease_token=$3",
          [event.id, this.owner, event.lease_token],
        );
      } catch {
        await rows(
          this.store.pool,
          "UPDATE movie.outbox_events SET lease_owner=NULL,lease_until=NULL,next_attempt_at=now()+($4::int*interval '1 second') WHERE id=$1 AND lease_owner=$2 AND lease_token=$3",
          [
            event.id,
            this.owner,
            event.lease_token,
            Math.min(300, 2 ** Math.min(event.attempt_count, 8)),
          ],
        );
        throw new Error("Outbox publish unavailable.");
      }
    }
  }
  async schedule() {
    const jobs = await this.store.tx(async (tx) =>
      rows(
        tx,
        "WITH due AS (SELECT id FROM movie.job_runs WHERE handler IN ('media.hls','media.backup') AND state IN ('PENDING','WAITING','RUNNING') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 20) UPDATE movie.job_runs j SET lease_owner=$1,lease_until=now()+interval '15 seconds' FROM due WHERE j.id=due.id RETURNING j.id",
        ["dispatch:" + this.owner],
      ),
    );
    for (const job of jobs)
      await this.broker.publish({ kind: "job", jobId: job.id }, randomUUID());
  }
}
