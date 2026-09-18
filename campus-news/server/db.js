/**
 * Campus News — Datenschicht (node:sqlite, keine externen Abhängigkeiten).
 *
 * Ablage liegt unter DATA_DIR (Default ./data), damit sie im Container auf ein
 * Volume gemountet werden kann:
 *   DATA_DIR=/data   ->  /data/campusnews.db, /data/uploads/*
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(HERE, "..", "public");

mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "campusnews.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );

  CREATE TABLE IF NOT EXISTS articles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    slug             TEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    teaser           TEXT NOT NULL DEFAULT '',
    body             TEXT NOT NULL DEFAULT '[]',
    category         TEXT NOT NULL DEFAULT 'schule',
    kicker           TEXT NOT NULL DEFAULT '',
    date             TEXT NOT NULL,
    author           TEXT NOT NULL DEFAULT 'Redaktion',
    reading_minutes  INTEGER NOT NULL DEFAULT 2,
    tags             TEXT NOT NULL DEFAULT '[]',
    image            TEXT,
    featured         INTEGER NOT NULL DEFAULT 0,
    breaking         INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'draft',
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_articles_status_date ON articles(status, date DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

/* ── Zeilen <-> API-Objekte ─────────────────────────────────────────────── */

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function rowToArticle(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    teaser: row.teaser,
    body: parseJson(row.body, []),
    category: row.category,
    kicker: row.kicker,
    date: row.date,
    author: row.author,
    readingMinutes: row.reading_minutes,
    tags: parseJson(row.tags, []),
    image: row.image || null,
    featured: !!row.featured,
    breaking: !!row.breaking,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/* ── Nutzer ─────────────────────────────────────────────────────────────── */

export function countUsers() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

export function findUserByName(username) {
  return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username));
}

export function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function createUser({ username, passwordHash, displayName }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(String(username), String(passwordHash), displayName || null, now, now);
  return findUserById(Number(info.lastInsertRowid));
}

export function updateUserPassword(id, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    String(passwordHash),
    new Date().toISOString(),
    id
  );
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

export function createSessionRow({ tokenHash, userId, expiresAt, userAgent }) {
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tokenHash, userId, new Date().toISOString(), expiresAt, userAgent || null);
}

export function findSession(tokenHash) {
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(tokenHash);
    return null;
  }
  return row;
}

export function deleteSession(tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteSessionsForUser(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}

/* ── Artikel ────────────────────────────────────────────────────────────── */

export function listArticles({ status = null, category = null, featured = null } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push("status = ?"); params.push(status); }
  if (category && category !== "alle") { where.push("category = ?"); params.push(category); }
  if (featured !== null) { where.push("featured = ?"); params.push(featured ? 1 : 0); }
  const sql =
    "SELECT * FROM articles" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY date DESC, id DESC";
  return db.prepare(sql).all(...params).map(rowToArticle);
}

export function getArticleById(id) {
  return rowToArticle(db.prepare("SELECT * FROM articles WHERE id = ?").get(id));
}

export function getPublishedBySlug(slug) {
  return rowToArticle(
    db.prepare("SELECT * FROM articles WHERE slug = ? AND status = 'published'").get(String(slug))
  );
}

export function slugExists(slug) {
  return !!db.prepare("SELECT 1 FROM articles WHERE slug = ?").get(slug);
}

function serialize(article) {
  return {
    slug: article.slug,
    title: article.title,
    teaser: article.teaser ?? "",
    body: JSON.stringify(article.body ?? []),
    category: article.category ?? "schule",
    kicker: article.kicker ?? "",
    date: article.date,
    author: article.author ?? "Redaktion",
    reading_minutes: Number(article.readingMinutes ?? 2),
    tags: JSON.stringify(article.tags ?? []),
    image: article.image ?? null,
    featured: article.featured ? 1 : 0,
    breaking: article.breaking ? 1 : 0,
    status: article.status ?? "draft"
  };
}

export function insertArticle(article, userId) {
  const now = new Date().toISOString();
  const v = serialize(article);
  const info = db
    .prepare(
      `INSERT INTO articles
        (slug, title, teaser, body, category, kicker, date, author, reading_minutes,
         tags, image, featured, breaking, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      v.slug, v.title, v.teaser, v.body, v.category, v.kicker, v.date, v.author,
      v.reading_minutes, v.tags, v.image, v.featured, v.breaking, v.status,
      userId ?? null, now, now
    );
  return getArticleById(Number(info.lastInsertRowid));
}

export function updateArticle(id, article) {
  const existing = getArticleById(id);
  if (!existing) return null;
  const v = serialize({ ...existing, ...article });
  db.prepare(
    `UPDATE articles SET
       slug = ?, title = ?, teaser = ?, body = ?, category = ?, kicker = ?, date = ?,
       author = ?, reading_minutes = ?, tags = ?, image = ?, featured = ?, breaking = ?,
       status = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    v.slug, v.title, v.teaser, v.body, v.category, v.kicker, v.date, v.author,
    v.reading_minutes, v.tags, v.image, v.featured, v.breaking, v.status,
    new Date().toISOString(), id
  );
  return getArticleById(id);
}

export function deleteArticle(id) {
  return db.prepare("DELETE FROM articles WHERE id = ?").run(id).changes > 0;
}

export function stats() {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts
       FROM articles`
    )
    .get();
  return {
    total: row.total || 0,
    published: row.published || 0,
    drafts: row.drafts || 0
  };
}

/* ── Kategorien ─────────────────────────────────────────────────────────── */

export const CATEGORIES = [
  { id: "alle", label: "Alle" },
  { id: "schule", label: "Schule" },
  { id: "technik", label: "Technik" },
  { id: "projekte", label: "Projekte" },
  { id: "sport", label: "Sport" },
  { id: "kultur", label: "Kultur" },
  { id: "stadt", label: "Bernburg" }
];

export function categoryIds() {
  return CATEGORIES.filter((c) => c.id !== "alle").map((c) => c.id);
}

/* ── Erstbefüllung mit den Demo-Artikeln ────────────────────────────────── */

export function seedIfEmpty() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM articles").get().n;
  if (existing > 0) return { seeded: 0 };

  const file = path.join(PUBLIC_DIR, "assets", "data", "articles.json");
  if (!existsSync(file)) return { seeded: 0, reason: "seed file missing" };

  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { seeded: 0, reason: "seed file unreadable" };
  }

  const articles = Array.isArray(data.articles) ? data.articles : [];
  for (const a of articles) {
    insertArticle({ ...a, status: "published" }, null);
  }
  return { seeded: articles.length };
}

export function meta() {
  return {
    school: "Campus Technicus Bernburg",
    city: "Bernburg (Saale)",
    updated: new Date().toISOString().slice(0, 10)
  };
}
