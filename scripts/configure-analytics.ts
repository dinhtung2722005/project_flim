import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse } from "dotenv";
async function main() {
  let old: Record<string, string> = {};
  try {
    old = parse(await readFile(".env.analytics.local"));
  } catch {}
  const value = {
    ANALYTICS_HASH_SECRET: randomBytes(32).toString("hex"),
    ANALYTICS_QUEUE_PREFIX: "pjflim.analytics",
    ...old,
  };
  if (!/^[a-f0-9]{64}$/.test(value.ANALYTICS_HASH_SECRET))
    throw Error(
      "Invalid existing analytics hash secret; do not rotate a live key without a new metric version.",
    );
  await mkdir(".local/analytics", { recursive: true });
  await writeFile(
    ".env.analytics.local",
    Object.entries(value)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n",
  );
  console.log(
    JSON.stringify({
      event: "analytics.configuration.ready",
      secretPrinted: false,
    }),
  );
}
main().catch(() => {
  console.error(JSON.stringify({ event: "analytics.configuration.failed" }));
  process.exitCode = 1;
});
