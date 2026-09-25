/**
 * Campus News — Authentifizierung.
 *
 * Bewusste Entscheidungen:
 *  - scrypt (node:crypto) statt bcrypt: keine native Abhängigkeit, kein npm install.
 *  - Session-Token zufällig (256 bit), in der DB nur als SHA-256-Hash abgelegt.
 *  - Cookie: httpOnly, SameSite=Lax, Secure sobald HTTPS erkannt wird.
 *  - Kein Default-Passwort im Repo: der erste Admin wird über /admin angelegt
 *    ("Ersteinrichtung"), solange die user-Tabelle leer ist.
 *  - Login-Bremse pro IP und pro Benutzername gegen Durchprobieren.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import {
  countUsers, findUserByName, findUserById, createUser, findSession, createSessionRow,
  deleteSession, deleteSessionsForUser, updateUserPassword
} from "./db.js";

const COOKIE_NAME = "cn_session";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, saltBytes: 16 };

const SESSION_TTL_SHORT_H = 12;
const SESSION_TTL_LONG_D = 30;

const MAX_ATTEMPTS = 6;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/* ── Passwörter ─────────────────────────────────────────────────────────── */

export function hashPassword(password) {
  const salt = randomBytes(SCRYPT.saltBytes);
  const key = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * 1024 * 1024
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(keyB64, "base64");
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const WEAK = new Set([
  "passwort", "password", "1234567890", "campusnews", "redaktion", "schule",
  "qwertz1234", "admin12345", "letmein123"
]);

const COMMON_PARTS = [
  "passwort", "password", "admin", "campusnews", "redaktion",
  "qwertz", "123456", "letmein", "willkommen", "geheim"
];

/** Freundliche, konkrete Regeln statt kryptischer Fehlermeldungen. */
export function checkPasswordPolicy(password) {
  const pw = String(password ?? "");
  if (pw.length < 10) return "Das Passwort braucht mindestens 10 Zeichen.";
  if (pw.length > 200) return "Das Passwort ist zu lang (max. 200 Zeichen).";
  const lower = pw.toLowerCase();
  if (WEAK.has(lower)) return "Dieses Passwort ist zu geläufig. Bitte ein anderes wählen.";
  const part = COMMON_PARTS.find((w) => lower.includes(w));
  if (part) {
    return `Das Passwort enthält „${part}“ — das ist zu leicht zu erraten. Bitte etwas Eigenes wählen.`;
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (new Set(pw).size < 6) return "Das Passwort ist zu monoton. Bitte mehr unterschiedliche Zeichen.";
  if (classes < 2) return "Das Passwort braucht mindestens zwei Sorten Zeichen (z. B. Buchstaben und Zahlen).";
  return null;
}

export function checkUsername(username) {
  const u = String(username ?? "").trim();
  if (u.length < 3) return "Der Benutzername braucht mindestens 3 Zeichen.";
  if (u.length > 40) return "Der Benutzername ist zu lang (max. 40 Zeichen).";
  if (!/^[A-Za-z0-9._-]+$/.test(u)) return "Erlaubt sind Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich.";
  return null;
}

/* ── Login-Bremse ───────────────────────────────────────────────────────── */

const attempts = new Map(); // key -> { count, firstAt }

function bump(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

export function throttleState(keys) {
  const now = Date.now();
  for (const key of keys) {
    const entry = attempts.get(key);
    if (!entry) continue;
    if (now - entry.firstAt > ATTEMPT_WINDOW_MS) { attempts.delete(key); continue; }
    if (entry.count >= MAX_ATTEMPTS) {
      const retryAfterS = Math.ceil((entry.firstAt + ATTEMPT_WINDOW_MS - now) / 1000);
      return { blocked: true, retryAfterS, attempts: entry.count };
    }
  }
  return { blocked: false };
}

export function registerFailure(keys) {
  keys.forEach(bump);
}

export function clearFailures(keys) {
  keys.forEach((k) => attempts.delete(k));
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId, userAgent, remember) {
  const token = randomBytes(32).toString("base64url");
  const ttlMs = remember
    ? SESSION_TTL_LONG_D * 24 * 60 * 60 * 1000
    : SESSION_TTL_SHORT_H * 60 * 60 * 1000;
  createSessionRow({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    userAgent
  });
  return { token, maxAgeS: remember ? SESSION_TTL_LONG_D * 24 * 60 * 60 : null };
}

export function currentUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const row = findSession(hashToken(token));
  if (!row) return null;
  const user = findUserById(row.user_id);
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.display_name || user.username };
}

export function destroySession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) deleteSession(hashToken(token));
}

export function sessionCookie(token, { maxAgeS, secure }) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (maxAgeS) parts.push(`Max-Age=${maxAgeS}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie(secure) {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function isSecureRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return proto === "https" || !!req.socket.encrypted;
}

/* ── Setup / Login ──────────────────────────────────────────────────────── */

export function needsSetup() {
  return countUsers() === 0;
}

export function setupAdmin({ username, password, displayName }) {
  if (!needsSetup()) return { error: "Es existiert bereits ein Redaktionskonto." };
  const uErr = checkUsername(username);
  if (uErr) return { error: uErr };
  const pErr = checkPasswordPolicy(password);
  if (pErr) return { error: pErr };
  const user = createUser({ username, passwordHash: hashPassword(password), displayName });
  return { user };
}

export function login({ username, password }) {
  const user = findUserByName(username);
  if (!user) return { error: "Benutzername oder Passwort stimmt nicht." };
  if (!verifyPassword(password, user.password_hash)) {
    return { error: "Benutzername oder Passwort stimmt nicht." };
  }
  return { user };
}

export function changePassword(userId, currentPassword, nextPassword) {
  const user = findUserById(userId);
  if (!user) return { error: "Konto nicht gefunden." };
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return { error: "Das aktuelle Passwort stimmt nicht." };
  }
  const pErr = checkPasswordPolicy(nextPassword);
  if (pErr) return { error: pErr };
  updateUserPassword(userId, hashPassword(nextPassword));
  deleteSessionsForUser(userId);
  return { ok: true };
}
