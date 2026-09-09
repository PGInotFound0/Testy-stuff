import path from "node:path";
import { createApp } from "./app.js";
import { createAuth, migrateAuth } from "./auth.js";
import { openDatabase, resolveDbPath } from "./db.js";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.BETTER_AUTH_URL ?? `http://localhost:${PORT}`;
const SECRET = process.env.BETTER_AUTH_SECRET ?? "";
const DEV = process.env.NODE_ENV !== "production";

if (!SECRET && !DEV) {
  console.error("[red-board] FATAL: BETTER_AUTH_SECRET is missing. Aborting.");
  process.exit(1);
}

const dbPath = resolveDbPath(process.env.DB_PATH);
const db = openDatabase(dbPath);
const auth = createAuth(db, {
  baseURL: BASE_URL,
  secret: SECRET || "dev-only-insecure-secret-at-least-32-chars!!",
});

async function start() {
  await migrateAuth(auth);
  const app = createApp({
    db,
    auth,
    publicDir: path.join(process.cwd(), "dist", "public"),
    viteDev: DEV,
  });
  if (DEV) {
    // Dev: Vite as middleware — one process, one port.
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    // Fallback: serve index.html
    app.get(/.*/, async (req, res, next) => {
      try {
        if (req.path.startsWith("/api")) return next();
        const fs = await import("node:fs");
        let template = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  }

  app.listen(PORT, () => {
    console.log(`[red-board] ✊ Red Board running on :${PORT} (DB: ${dbPath})`);
  });
}

start().catch((err) => {
  console.error("[red-board] Startup failed:", err);
  process.exit(1);
});
