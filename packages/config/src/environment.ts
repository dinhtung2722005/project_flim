import { config } from "dotenv";
for (const path of [".env.database.local", ".env.api.local"])
  config({ path, quiet: true });
