import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type AppDatabase = Database.Database;

/** Resolve the SQLite file path. Production default: /data (Coolify volume). */
export function resolveDbPath(envPath?: string): string {
  if (envPath && envPath.length > 0) return envPath;
  try {
    fs.accessSync("/data", fs.constants.W_OK);
    return path.join("/data", "red-board.db");
  } catch {
    return path.join(process.cwd(), "data", "red-board.db");
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  parent_id TEXT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id);
`;

export function openDatabase(dbPath: string): AppDatabase {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/** Comma-separated admin e-mails, e.g. ADMIN_EMAILS="a@x.org,b@x.org". */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.toLowerCase());
}
