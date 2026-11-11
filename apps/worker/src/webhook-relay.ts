import { createServer, request as httpRequest } from "node:http";
import "../../../packages/config/src/environment";
const targetPort = Number(process.env.API_PORT ?? 3000);
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method !== "POST" || url.pathname !== "/api/v1/webhooks/cloudinary") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (
    !String(req.headers["content-type"] ?? "").startsWith("application/json")
  ) {
    res.writeHead(415);
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 256 * 1024) {
      res.writeHead(413);
      res.end();
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const outgoing = httpRequest(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path: url.pathname + url.search,
        method: "POST",
        timeout: 20000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bytes,
          "X-Cld-Signature": String(req.headers["x-cld-signature"] ?? ""),
          "X-Cld-Timestamp": String(req.headers["x-cld-timestamp"] ?? ""),
        },
      },
      (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, {
          "Content-Type": "application/json",
        });
        incoming.pipe(res);
      },
    );
    outgoing.on("timeout", () => outgoing.destroy());
    outgoing.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    outgoing.end(Buffer.concat(chunks));
  });
});
server.listen(3001, "127.0.0.1", () =>
  console.log(JSON.stringify({ event: "webhook.relay.started", port: 3001 })),
);
