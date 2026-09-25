/**
 * Campus News — JSON-API.
 *
 * Öffentlich:
 *   GET  /api/health
 *   GET  /api/setup-state        -> { needsSetup }
 *   POST /api/setup              -> erstes Redaktionskonto anlegen
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *   GET  /api/articles           -> nur veröffentlichte Artikel (wie data/articles.json)
 *
 * Redaktion (Session erforderlich):
 *   GET    /api/admin/articles
 *   POST   /api/admin/articles
 *   PUT    /api/admin/articles/:id
 *   DELETE /api/admin/articles/:id
 *   POST   /api/admin/uploads    -> roher Bild-Body, Content-Type: image/*
 *   POST   /api/auth/password    -> Passwort ändern
 */
import {
  CATEGORIES, categoryIds, listArticles, getArticleById, getPublishedBySlug,
  insertArticle, updateArticle, deleteArticle, stats, meta, slugExists
} from "./db.js";
import {
  needsSetup, setupAdmin, login, currentUser, createSession, destroySession,
  changePassword, throttleState, registerFailure, clearFailures,
  sessionCookie, clearedCookie, isSecureRequest
} from "./auth.js";
import { sendJson, readJsonBody, clientIp, sameOrigin } from "./http.js";
import { handleUpload } from "./uploads.js";

const CATEGORY_IDS = new Set(categoryIds());

/* ── Validierung / Normalisierung ───────────────────────────────────────── */

function slugify(input) {
  const base = String(input || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return base || "artikel";
}

function uniqueSlug(title, currentSlug = null) {
  let base = slugify(title);
  if (currentSlug && base === currentSlug) return base;
  let candidate = base;
  let i = 2;
  while (slugExists(candidate)) {
    candidate = `${base}-${i++}`;
    if (i > 200) { candidate = `${base}-${Date.now().toString(36)}`; break; }
  }
  return candidate;
}

function bodyToParagraphs(body) {
  if (Array.isArray(body)) {
    return body.map((p) => String(p).trim()).filter(Boolean);
  }
  return String(body || "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Gibt { article } oder { error, field } zurück — Fehler für die UI zuordenbar. */
function validateArticle(input, existing = null) {
  const title = String(input.title ?? existing?.title ?? "").trim();
  if (title.length < 4) return { error: "Der Titel braucht mindestens 4 Zeichen.", field: "title" };
  if (title.length > 220) return { error: "Der Titel ist zu lang (max. 220 Zeichen).", field: "title" };

  const teaser = String(input.teaser ?? existing?.teaser ?? "").trim();
  if (teaser.length > 600) return { error: "Der Teaser ist zu lang (max. 600 Zeichen).", field: "teaser" };
  if (!teaser) return { error: "Bitte einen Teaser angeben — er erscheint auf der Startseite.", field: "teaser" };

  const body = bodyToParagraphs(input.body ?? existing?.body ?? []);
  if (!body.length) return { error: "Der Artikeltext ist noch leer.", field: "body" };
  if (body.some((p) => p.length > 12000)) return { error: "Ein Absatz ist zu lang.", field: "body" };

  const category = String(input.category ?? existing?.category ?? "schule");
  if (!CATEGORY_IDS.has(category)) return { error: "Unbekanntes Ressort.", field: "category" };

  const date = String(input.date ?? existing?.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Bitte ein Datum im Format JJJJ-MM-TT angeben.", field: "date" };

  const author = String(input.author ?? existing?.author ?? "Redaktion").trim() || "Redaktion";
  if (author.length > 80) return { error: "Der Autorenname ist zu lang.", field: "author" };

  const kicker = String(input.kicker ?? existing?.kicker ?? "").trim().slice(0, 60);

  let tags = input.tags ?? existing?.tags ?? [];
  if (typeof tags === "string") tags = tags.split(",");
  tags = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
  if (tags.some((t) => t.length > 40)) return { error: "Ein Tag ist zu lang (max. 40 Zeichen).", field: "tags" };

  const rawMinutes = Number(input.readingMinutes ?? existing?.readingMinutes ?? 0);
  const words = body.join(" ").split(/\s+/).filter(Boolean).length;
  const readingMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0
    ? Math.min(60, Math.round(rawMinutes))
    : Math.max(1, Math.round(words / 200));

  const status = String(input.status ?? existing?.status ?? "draft");
  if (!["draft", "published"].includes(status)) return { error: "Unbekannter Status.", field: "status" };

  const image = input.image === undefined ? (existing?.image ?? null) : (input.image || null);
  if (image && !/^\/uploads\/[A-Za-z0-9._-]+$/.test(String(image))) {
    return { error: "Ungültige Bild-Referenz.", field: "image" };
  }

  return {
    article: {
      title,
      teaser,
      body,
      category,
      date,
      author,
      kicker,
      tags,
      readingMinutes,
      image,
      status,
      breaking: !!(input.breaking ?? existing?.breaking),
      featured: !!(input.featured ?? existing?.featured),
      slug: uniqueSlug(title, existing?.slug || null)
    }
  };
}

/* ── Wächter ────────────────────────────────────────────────────────────── */

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Nicht angemeldet.", needsLogin: true });
    return null;
  }
  return user;
}

function throttleKeys(req, username) {
  return [`ip:${clientIp(req)}`, username ? `user:${String(username).toLowerCase()}` : null].filter(Boolean);
}

function checkThrottle(res, keys) {
  const state = throttleState(keys);
  if (state.blocked) {
    sendJson(res, 429, {
      error: `Zu viele Fehlversuche. Bitte in ${Math.ceil(state.retryAfterS / 60)} Minuten erneut versuchen.`,
      retryAfterS: state.retryAfterS
    }, { "Retry-After": String(state.retryAfterS) });
    return true;
  }
  return false;
}

/* ── Router ─────────────────────────────────────────────────────────────── */

export async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = String(req.method || "GET").toUpperCase();
  const secure = isSecureRequest(req);

  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: "Anfrage von fremder Herkunft abgelehnt." });
    return true;
  }

  /* Health */
  if (method === "GET" && path === "/api/health") {
    sendJson(res, 200, { ok: true, ts: new Date().toISOString(), articles: stats() });
    return true;
  }

  /* Ersteinrichtung */
  if (method === "GET" && path === "/api/setup-state") {
    sendJson(res, 200, { needsSetup: needsSetup() });
    return true;
  }

  if (method === "POST" && path === "/api/setup") {
    const body = await readJsonBody(req);
    const keys = throttleKeys(req, body.username);
    if (checkThrottle(res, keys)) return true;
    if (!needsSetup()) {
      sendJson(res, 409, { error: "Es existiert bereits ein Redaktionskonto. Bitte anmelden." });
      return true;
    }
    const result = setupAdmin({
      username: body.username,
      password: body.password,
      displayName: body.displayName
    });
    if (result.error) {
      registerFailure(keys);
      sendJson(res, 400, { error: result.error });
      return true;
    }
    clearFailures(keys);
    const session = createSession(result.user.id, req.headers["user-agent"], true);
    sendJson(res, 201, {
      user: { username: result.user.username, displayName: result.user.display_name || result.user.username }
    }, { "Set-Cookie": sessionCookie(session.token, { maxAgeS: session.maxAgeS, secure }) });
    return true;
  }

  /* Login / Logout / Me */
  if (method === "POST" && path === "/api/auth/login") {
    const body = await readJsonBody(req);
    const keys = throttleKeys(req, body.username);
    if (checkThrottle(res, keys)) return true;

    const result = login({ username: body.username, password: body.password });
    if (result.error) {
      registerFailure(keys);
      const state = throttleState(keys);
      const left = state.blocked ? 0 : Math.max(0, 6 - (state.attempts || 1));
      sendJson(res, 401, {
        error: result.error,
        remainingAttempts: left
      });
      return true;
    }
    clearFailures(keys);
    const remember = !!body.remember;
    const session = createSession(result.user.id, req.headers["user-agent"], remember);
    sendJson(res, 200, {
      user: { username: result.user.username, displayName: result.user.display_name || result.user.username },
      remember
    }, { "Set-Cookie": sessionCookie(session.token, { maxAgeS: session.maxAgeS, secure }) });
    return true;
  }

  if (method === "POST" && path === "/api/auth/logout") {
    destroySession(req);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearedCookie(secure) });
    return true;
  }

  if (method === "GET" && path === "/api/auth/me") {
    const user = currentUser(req);
    sendJson(res, 200, user ? { user, needsSetup: false } : { user: null, needsSetup: needsSetup() });
    return true;
  }

  if (method === "POST" && path === "/api/auth/password") {
    const user = requireUser(req, res);
    if (!user) return true;
    const body = await readJsonBody(req);
    const keys = throttleKeys(req, user.username);
    if (checkThrottle(res, keys)) return true;
    const result = changePassword(user.id, body.currentPassword, body.nextPassword);
    if (result.error) {
      registerFailure(keys);
      sendJson(res, 400, { error: result.error });
      return true;
    }
    clearFailures(keys);
    // Passwortwechsel beendet alle Sessions — neues Cookie ausstellen
    const session = createSession(user.id, req.headers["user-agent"], true);
    sendJson(res, 200, { ok: true, hint: "Bitte mit dem neuen Passwort weiterarbeiten." },
      { "Set-Cookie": sessionCookie(session.token, { maxAgeS: session.maxAgeS, secure }) });
    return true;
  }

  /* Öffentliche Artikel (identische Struktur wie assets/data/articles.json) */
  if (method === "GET" && path === "/api/articles") {
    const articles = listArticles({ status: "published" });
    sendJson(res, 200, { meta: meta(), categories: CATEGORIES, articles }, {
      "Cache-Control": "public, max-age=30"
    });
    return true;
  }

  if (method === "GET" && path.startsWith("/api/articles/")) {
    const slug = decodeURIComponent(path.slice("/api/articles/".length));
    const article = getPublishedBySlug(slug);
    if (!article) { sendJson(res, 404, { error: "Artikel nicht gefunden." }); return true; }
    sendJson(res, 200, { article });
    return true;
  }

  /* Redaktionsbereich */
  if (path === "/api/admin/uploads" && method === "POST") {
    const user = requireUser(req, res);
    if (!user) return true;
    await handleUpload(req, res, user);
    return true;
  }

  if (path === "/api/admin/articles" && method === "GET") {
    const user = requireUser(req, res);
    if (!user) return true;
    sendJson(res, 200, {
      articles: listArticles({}),
      stats: stats(),
      categories: CATEGORIES,
      user
    });
    return true;
  }

  if (path === "/api/admin/articles" && method === "POST") {
    const user = requireUser(req, res);
    if (!user) return true;
    const body = await readJsonBody(req, 2 * 1024 * 1024);
    const { article, error, field } = validateArticle(body);
    if (error) { sendJson(res, 400, { error, field }); return true; }
    sendJson(res, 201, { article: insertArticle(article, user.id) });
    return true;
  }

  const adminItem = path.match(/^\/api\/admin\/articles\/(\d+)$/);
  if (adminItem) {
    const user = requireUser(req, res);
    if (!user) return true;
    const id = Number(adminItem[1]);
    const existing = getArticleById(id);
    if (!existing) { sendJson(res, 404, { error: "Artikel nicht gefunden." }); return true; }

    if (method === "GET") { sendJson(res, 200, { article: existing }); return true; }

    if (method === "PUT" || method === "PATCH") {
      const body = await readJsonBody(req, 2 * 1024 * 1024);
      const { article, error, field } = validateArticle(body, existing);
      if (error) { sendJson(res, 400, { error, field }); return true; }
      sendJson(res, 200, { article: updateArticle(id, article) });
      return true;
    }

    if (method === "DELETE") {
      deleteArticle(id);
      sendJson(res, 200, { ok: true, deleted: id });
      return true;
    }
  }

  return false;
}
