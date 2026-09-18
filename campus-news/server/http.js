/**
 * Campus News — HTTP-Grundlagen: Header, Antworten, Body-Lesen, CSRF-Prüfung.
 * Bewusst getrennt von index.js/api.js, damit kein Zirkel-Import entsteht.
 */

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
};

export function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders, ...headers });
  res.end(body);
}

export function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
}

export function sendText(res, status, text, headers = {}) {
  send(res, status, text, { "Content-Type": "text/plain; charset=utf-8", ...headers });
}

export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

/** JSON-Body mit Größenlimit lesen. Wirft { status, message } bei Problemen. */
export async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error("Die Anfrage ist zu groß.");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    const err = new Error("Die Anfrage war kein gültiges JSON.");
    err.status = 400;
    throw err;
  }
}

/**
 * CSRF-Schutz: SameSite=Lax-Cookie plus Origin-Prüfung auf allen schreibenden
 * Requests. Ein Login von einer fremden Seite aus scheitert damit doppelt.
 */
export function sameOrigin(req) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const host = req.headers.host;
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  const allowed = new Set();
  if (host) allowed.add(host);
  for (const extra of String(process.env.PUBLIC_ORIGIN || "").split(",")) {
    const t = extra.trim();
    if (t) {
      try { allowed.add(new URL(t).host); } catch { /* ignore */ }
    }
  }

  if (origin) {
    try { return allowed.has(new URL(origin).host); } catch { return false; }
  }
  if (referer) {
    try { return allowed.has(new URL(referer).host); } catch { return false; }
  }
  // Kein Origin/Referer: kein Browser-Formular-Cross-Site-Fall -> erlauben
  return true;
}
