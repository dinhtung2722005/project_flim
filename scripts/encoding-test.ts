import "../apps/api/src/config";
import { runEncodingChecks } from "../tests/encoding.integration";
runEncodingChecks()
  .then((checks) =>
    console.log(
      JSON.stringify({
        event: "encoding.tests.passed",
        checks,
        provider: "mocked at boundary",
      }),
    ),
  )
  .catch(() => {
    console.error(JSON.stringify({ event: "encoding.tests.failed" }));
    process.exitCode = 1;
  });
