import {
  existsSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
const target = path.resolve(".env.api.local");
if (!existsSync(target))
  writeFileSync(
    target,
    [
      "NODE_ENV=development",
      "API_HOST=127.0.0.1",
      "API_PORT=3000",
      "SWAGGER_ENABLED=true",
      "AUTH_MFA_REQUIRED=true",
      "JWT_SECRET=" + randomBytes(48).toString("hex"),
      "MFA_ENCRYPTION_KEY=" + randomBytes(32).toString("hex"),
      "CURSOR_SECRET=" + randomBytes(32).toString("hex"),
    ].join("\n") + "\n",
  );
const ignore = readFileSync(".gitignore", "utf8");
for (const line of ["dist/", "coverage/"])
  if (!ignore.split(/\r?\n/).includes(line))
    appendFileSync(".gitignore", "\n" + line + "\n");
mkdirSync(".local/api", { recursive: true });
console.log(
  "API local configuration ready. Secrets are stored only in .env.api.local.",
);
