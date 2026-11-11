import { mkdir, writeFile } from "node:fs/promises";
import { createApplication } from "../apps/api/src/application";
async function main() {
  const { app, document } = await createApplication();
  try {
    await mkdir("docs/api", { recursive: true });
    await writeFile(
      "docs/api/openapi.json",
      JSON.stringify(document, null, 2) + "\n",
    );
    console.log("Exported docs/api/openapi.json");
  } finally {
    await app.close();
  }
}
main().catch(() => {
  console.error("OpenAPI export failed.");
  process.exitCode = 1;
});
