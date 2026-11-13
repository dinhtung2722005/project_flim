import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import helmet from "helmet";
/** Serve only the built public client. Never serve the project or .local directory. */
export function mountFrontend(server: express.Express) {
  const root = resolve(process.cwd(), "dist/web"),
    index = resolve(root, "index.html");
  if (!existsSync(index)) return false;
  const security = helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      connectSrc: [
        "'self'",
        "https://res.cloudinary.com",
        "https://api.cloudinary.com",
      ],
      mediaSrc: ["'self'", "blob:", "https://res.cloudinary.com"],
      workerSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: null,
    },
  });
  const files = express.static(root, {
    index: false,
    dotfiles: "deny",
    fallthrough: true,
    redirect: false,
  });
  server.use((req, res, next) => {
    if (/^\/api(?:\/|$)/.test(req.path)) return next();
    security(req, res, () => files(req, res, next));
  });
  server.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => {
    if (!req.accepts("html")) return next();
    res.set("Cache-Control", "no-store").sendFile(index);
  });
  return true;
}
