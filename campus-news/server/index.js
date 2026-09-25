/**
 * Campus News — HTTP-Server: statische Auslieferung + JSON-API.
 *
 * Keine externen Abhängigkeiten (node:http, node:sqlite, node:crypto, node:zlib).
 *   PORT      (Default 3000)
 *   HOST      (Default 0.0.0.0)
 *   DATA_DIR  (Default ./data)        -> SQLite-DB + Uploads
 *   PUBLIC_DIR(Default ./public)      -> statische Dateien
 */
import http from "node:http";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { PUBLIC_DIR, UPLOAD_DIR, DATA_DIR, seedIfEmpty, purgeExpiredSessions } from "./db.js";
import { handleApi } from "./api.js";
import { sendJson, sendText, securityHeaders } from "./http.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest))/;

/* ── Statische Dateien ─────────────────────────────────────────────────── */

async function serveFile(res, req, absPath, { cacheSeconds = 0 } = {}) {
  let info;
  try {
    info = await stat(absPath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const ext = path.extname(absPath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const headers = {
    ...securityHeaders,
    "Content-Type": type,
    "Last-Modified": info.mtime.toUTCString(),
    "Cache-Control": cacheSeconds > 0
      ? `public, max-age=${cacheSeconds}`
      : "no-cache, must-revalidate"
  };

  const buffer = await readFile(absPath);

  const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
  if (acceptsGzip && COMPRESSIBLE.test(type) && buffer.length > 512) {
    res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    const gzip = createGzip();
    gzip.on("error", () => res.destroy());
    res.on("close", () => gzip.destroy());
    Readable.from(buffer).pipe(gzip).pipe(res);
    return true;
  }

  res.writeHead(200, { ...headers, "Content-Length": String(buffer.length) });
  res.end(buffer);
  return true;
}

/** Pfad darf das Wurzelverzeichnis nicht verlassen (Path-Traversal-Schutz). */
function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const target = path.resolve(root, "." + path.posix.normalize(decoded));
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

function sendNotFound(res) {
  res.writeHead(404, { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>404 — Campus News</title>
<body style="background:#0b0b0c;color:#f2f2ef;font:16px/1.5 system-ui;padding:60px">
<h1 style="letter-spacing:-.03em;font-size:56px;margin:0 0 10px">404</h1>
<p style="color:#a4a4ad">Diese Seite gibt es nicht.
<a style="color:#ff3b1f" href="/">Zur Startseite</a></p>`);
}

async function serveStatic(req, res, urlPath) {
  // Hochgeladene Bilder liegen außerhalb von public/
  if (urlPath.startsWith("/uploads/")) {
    const abs = safeJoin(UPLOAD_DIR, urlPath.slice("/uploads".length));
    if (!abs) return sendText(res, 400, "Ungültiger Pfad");
    if (await serveFile(res, req, abs, { cacheSeconds: 3600 })) return;
    return sendText(res, 404, "Bild nicht gefunden");
  }

  if (urlPath === "/admin") {
    res.writeHead(302, { ...securityHeaders, Location: "/admin/" });
    return res.end();
  }

  let rel = urlPath === "/" ? "/index.html" : urlPath;
  if (rel.endsWith("/")) rel += "index.html";

  const abs = safeJoin(PUBLIC_DIR, rel);
  if (!abs) return sendText(res, 400, "Ungültiger Pfad");

  // Assets werden ohne Fingerprint im Dateinamen ausgeliefert — deshalb nur
  // eine Stunde Cache, damit Änderungen nicht tagelang hängen bleiben.
  const isAsset = rel.startsWith("/assets/") || rel.startsWith("/admin/");
  if (await serveFile(res, req, abs, { cacheSeconds: isAsset ? 3600 : 0 })) return;

  // Kein SPA-Fallback: das Routing läuft über den URL-Hash, unbekannte Pfade
  // sollen ehrlich 404 liefern (statt irreführend die Startseite).
  return sendNotFound(res);
}

/* ── Server ────────────────────────────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "Unbekannter API-Endpunkt." });
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error("[campus-news] Fehler:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Interner Serverfehler." });
    else res.end();
  }
});

server.on("clientError", (err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

if (process.env.NODE_ENV !== "test") {
  const seed = seedIfEmpty();
  purgeExpiredSessions();
  setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref?.();

  server.listen(PORT, HOST, () => {
    console.log(`Campus News läuft auf http://${HOST}:${PORT}`);
    console.log(`  Daten:    ${DATA_DIR}`);
    console.log(`  Uploads:  ${UPLOAD_DIR}`);
    console.log(`  Statisch: ${PUBLIC_DIR}`);
    if (seed.seeded) console.log(`  Demo-Artikel eingespielt: ${seed.seeded}`);
  });
}

export { server };
