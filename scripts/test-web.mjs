import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    require.resolve("ts-node/dist/bin.js"),
    "--project",
    "apps/api/tsconfig.json",
    "tests/admin.integration.ts",
  ],
  { stdio: "inherit", env: { ...process.env, PJ_FLIM_TEST_WEB_ONLY: "true" } },
);
process.exit(result.status ?? 1);
