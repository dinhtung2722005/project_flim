import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "../../config/src/environment";
export type Tx = Prisma.TransactionClient;
@Injectable()
export class Database
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.delete("schema");
    super({
      adapter: new PrismaPg(
        {
          connectionString: url.toString(),
          max: 10,
          options: "-c timezone=UTC",
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 10000,
        },
        { schema: "movie" },
      ),
    });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
export function query<T extends Record<string, any> = Record<string, any>>(
  db: Tx,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return db.$queryRawUnsafe<T[]>(sql, ...values);
}
export async function one<T extends Record<string, any> = Record<string, any>>(
  db: Tx,
  sql: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(db, sql, values))[0];
}
