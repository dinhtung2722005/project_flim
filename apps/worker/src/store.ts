import { Pool, PoolClient } from "pg";
import "./config";
export type Sql = Pool | PoolClient;
export async function rows(
  db: Sql,
  sql: string,
  values: unknown[] = [],
): Promise<Record<string, any>[]> {
  return (await db.query(sql, values)).rows;
}
export async function row(db: Sql, sql: string, values: unknown[] = []) {
  return (await rows(db, sql, values))[0];
}
export class WorkerStore {
  readonly pool: Pool;
  constructor(url = process.env.WORKER_DATABASE_URL!) {
    const u = new URL(url);
    u.searchParams.delete("schema");
    this.pool = new Pool({
      connectionString: u.toString(),
      max: 8,
      options: "-c timezone=UTC",
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
    this.pool.on("error", () =>
      console.error(
        JSON.stringify({
          event: "worker.database.error",
          code: "SERVICE_UNAVAILABLE",
        }),
      ),
    );
  }
  async tx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
export async function systemAudit(
  db: Sql,
  action: string,
  assetId: string,
  operationId: string,
  initiator: string | null,
  diff: object = {},
) {
  await rows(
    db,
    "INSERT INTO movie.audit_logs(actor_kind,initiator_user_id,operation_id,action,resource_type,resource_id,outcome,safe_diff) VALUES ('SYSTEM',$1::uuid,$2::uuid,$3,'video_asset',$4,$5,$6::jsonb) RETURNING id",
    [
      initiator,
      operationId,
      action,
      assetId,
      action.endsWith(".failed") ? "FAILED" : "SUCCESS",
      JSON.stringify(diff),
    ],
  );
}
