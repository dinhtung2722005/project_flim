import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync(".local/api", { recursive: true });
const child = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "pull"],
  { encoding: "utf8", env: process.env },
);
writeFileSync(
  ".local/api/prisma-introspection.log",
  (child.stdout ?? "") + (child.stderr ?? ""),
);
if (child.status !== 0) {
  console.error(
    "Prisma introspection failed; see .local/api/prisma-introspection.log",
  );
  process.exit(child.status ?? 1);
}
const file = "packages/database/prisma/schema.prisma";
let schema = readFileSync(file, "utf8");
for (const [field, model] of [
  [
    "video_assets_video_assets_current_attempt_id_idTomedia_attempts",
    "video_assets",
  ],
  ["other_refresh_tokens", "refresh_tokens"],
  ["resume_heads", "resume_heads"],
  ["watch_progress", "watch_progress"],
  ["episodes_episodes_active_asset_id_idTovideo_assets", "episodes"],
]) {
  schema = schema.replace(
    new RegExp("(^\\s+" + field + "\\s+)" + model + "\\?", "gm"),
    "$1" + model + "[]",
  );
}
writeFileSync(file, schema);
console.log(
  "Introspected movie schema (baseline + applied additive migrations); normalized five inverse relations for Prisma. Database was not changed. See .local/api/prisma-introspection.log for SQL constraint warnings.",
);
