import "reflect-metadata";
import { createApplication } from "./application";
import { configuration } from "./config";
async function main() {
  const { app } = await createApplication();
  const cfg = configuration();
  app.enableShutdownHooks();
  await app.listen(cfg.port, cfg.host);
  console.log(
    JSON.stringify({
      level: "info",
      event: "api.started",
      host: cfg.host,
      port: cfg.port,
      swagger: cfg.docs ? "/api/docs-login" : null,
    }),
  );
}
main().catch(() => {
  console.error(JSON.stringify({ level: "fatal", code: "API_START_FAILED" }));
  process.exitCode = 1;
});
