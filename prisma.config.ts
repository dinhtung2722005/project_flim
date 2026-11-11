import { defineConfig } from "prisma/config";
import { config } from "dotenv";
config({ path: ".env.database.local", quiet: true });
export default defineConfig({
  schema: "packages/database/prisma/schema.prisma",
  datasource: { url: process.env.MIGRATION_DATABASE_URL! },
});
