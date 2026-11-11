import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import {
  Database,
  Tx,
  one,
  query,
} from "../../../../packages/database/src/database";
import { encrypt, decrypt } from "../security";
import { fail } from "../common";
export type EmailJob = {
  to: string;
  kind: "verify-email" | "reset-password";
  token: string;
  expiresAt: string;
};
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  constructor(private readonly db: Database) {}
  mode() {
    return (
      process.env.MAIL_TRANSPORT ??
      (process.env.NODE_ENV === "production" ? "smtp" : "local")
    );
  }
  assertAvailable() {
    const mode = this.mode();
    if (mode === "local" && process.env.NODE_ENV !== "production") return;
    if (
      mode !== "smtp" ||
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD ||
      !process.env.MAIL_FROM
    )
      fail("SERVICE_UNAVAILABLE", "Email transport is not configured.");
  }
  async enqueue(tx: Tx, userId: string, job: EmailJob, requestId: string) {
    this.assertAvailable();
    await query(
      tx,
      "INSERT INTO movie.outbox_events(type,aggregate_type,aggregate_id,aggregate_version,initiating_actor_id,correlation_id,payload) VALUES ('notification.email.requested','user',$1::uuid,1,$1::uuid,$2,$3::jsonb) RETURNING id",
      [
        userId,
        requestId,
        JSON.stringify({
          encryptionKeyId: "local-v1",
          encrypted: encrypt(JSON.stringify(job)).toString("base64"),
        }),
      ],
    );
  }
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.drain();
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  drain(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.work()
      .catch(() => {
        console.error(
          JSON.stringify({
            event: "notification.dispatch.failed",
            code: "SERVICE_UNAVAILABLE",
          }),
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async work() {
    this.assertAvailable();
    const owner = "mail:" + randomUUID();
    const jobs = await this.db.$transaction((tx) =>
      query(
        tx,
        "UPDATE movie.outbox_events SET lease_owner=$1,lease_until=now()+interval '60 seconds',lease_token=lease_token+1,attempt_count=attempt_count+1 WHERE id IN (SELECT id FROM movie.outbox_events WHERE type='notification.email.requested' AND published_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 5) RETURNING id,payload,lease_token",
        [owner],
      ),
    );
    for (const job of jobs) {
      try {
        const data = JSON.parse(
          decrypt(Buffer.from(job.payload.encrypted, "base64")),
        ) as EmailJob;
        if (Date.parse(data.expiresAt) > Date.now())
          await this.deliver(job.id, data);
        await query(
          this.db,
          "UPDATE movie.outbox_events SET published_at=now(),lease_owner=NULL,lease_until=NULL,payload='{}'::jsonb WHERE id=$1::uuid AND lease_owner=$2 AND lease_token=$3::bigint RETURNING id",
          [job.id, owner, job.lease_token],
        );
      } catch {
        await query(
          this.db,
          "UPDATE movie.outbox_events SET lease_owner=NULL,lease_until=NULL,next_attempt_at=now()+make_interval(secs=>LEAST(300,5*attempt_count)) WHERE id=$1::uuid AND lease_owner=$2 AND lease_token=$3::bigint RETURNING id",
          [job.id, owner, job.lease_token],
        );
        console.error(
          JSON.stringify({
            event: "notification.delivery.retry",
            jobId: job.id,
            code: "SERVICE_UNAVAILABLE",
          }),
        );
      }
    }
  }
  private async deliver(id: string, job: EmailJob) {
    const from = process.env.MAIL_FROM ?? "no-reply@pj-flim.local";
    const mail = {
      from,
      to: job.to,
      messageId: "<" + id + "@pj-flim.local>",
      subject:
        job.kind === "verify-email"
          ? "Xac minh email pj-Flim"
          : "Khoi phuc mat khau pj-Flim",
      text:
        "pj-Flim " +
        job.kind +
        "\nToken: " +
        job.token +
        "\nExpires: " +
        job.expiresAt +
        "\nUse this one-time token with the matching API endpoint. Ignore this email if you did not request it.",
    };
    if (this.mode() === "local") {
      const root = path.resolve(process.env.MAIL_LOCAL_ROOT ?? ".local/mail");
      const relative = path.relative(path.resolve(".local"), root);
      if (
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        root === path.resolve(".local")
      )
        throw new Error(
          "Local mail must remain in the project's .local directory.",
        );
      await mkdir(root, { recursive: true });
      let current = root;
      while (current !== path.dirname(current)) {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Local mail cannot use symlink directories.");
        if (current === path.resolve(".")) break;
        current = path.dirname(current);
      }
      const target = path.join(root, id + ".json"),
        encoded = JSON.stringify(mail, null, 2) + "\n";
      try {
        await writeFile(target, encoded, { flag: "wx", mode: 0o600 });
      } catch (error: any) {
        if (
          error.code !== "EEXIST" ||
          (await lstat(target)).isSymbolicLink() ||
          (await readFile(target, "utf8")) !== encoded
        )
          throw error;
      }
      return;
    }
    const port = Number(process.env.SMTP_PORT ?? 465);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid SMTP port.");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    try {
      await transport.sendMail(mail);
    } finally {
      transport.close();
    }
  }
}
