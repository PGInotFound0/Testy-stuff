import { randomUUID } from "node:crypto";
import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import type { Auth } from "./auth.js";
import { isAdminEmail, type AppDatabase } from "./db.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface AppOptions {
  db: AppDatabase;
  auth: Auth;
  publicDir?: string;
  viteDev?: boolean;
}

interface Board {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
}

interface Post {
  id: string;
  board_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

async function requireSession(req: Request, auth: Auth): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

function requireAuth(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await requireSession(req, auth);
      if (!user) {
        res.status(401).json({ error: "Login erforderlich — erst anmelden, dann mitreden." });
        return;
      }
      (req as Request & { user: SessionUser }).user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function currentUser(req: Request): SessionUser {
  return (req as Request & { user: SessionUser }).user;
}

export function createApp(opts: AppOptions): express.Express {
  const { db, auth, publicDir, viteDev } = opts;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "red-board" });
  });

  // --- BetterAuth (Login / Registrierung / Session-Cookies) ---
  app.all("/api/auth/*", toNodeHandler(auth));

  const authed = requireAuth(auth);

  // --- Aktuelle Nutzer:in ---
  app.get("/api/me", authed, (req, res) => {
    const u = currentUser(req);
    res.json({ id: u.id, email: u.email, name: u.name, admin: isAdminEmail(u.email) });
  });

  // --- Tafeln (Boards / Kanäle) ---
  app.get("/api/boards", authed, (_req, res) => {
    const rows = db.prepare("SELECT * FROM boards ORDER BY name ASC").all() as Board[];
    res.json(rows);
  });

  app.post("/api/boards", authed, (req, res) => {
    const u = currentUser(req);
    const name = String(req.body?.name ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    if (name.length < 2 || name.length > 80) {
      res.status(400).json({ error: "Name braucht 2–80 Zeichen." });
      return;
    }
    const exists = db.prepare("SELECT 1 FROM boards WHERE name = ?").get(name);
    if (exists) {
      res.status(409).json({ error: "Diese Tafel gibt es schon." });
      return;
    }
    const board: Board = {
      id: randomUUID(),
      name,
      description: description.slice(0, 500),
      created_by: u.id,
      created_at: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO boards (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(board.id, board.name, board.description, board.created_by, board.created_at);
    res.status(201).json(board);
  });

  // --- Beiträge ---
  app.get("/api/boards/:id/posts", authed, (req, res) => {
    const board = db.prepare("SELECT id FROM boards WHERE id = ?").get(req.params.id);
    if (!board) {
      res.status(404).json({ error: "Tafel nicht gefunden." });
      return;
    }
    const rows = db
      .prepare("SELECT * FROM posts WHERE board_id = ? ORDER BY created_at ASC")
      .all(req.params.id) as Post[];
    res.json(rows);
  });

  app.post("/api/boards/:id/posts", authed, (req, res) => {
    const u = currentUser(req);
    const boardId = String(req.params.id);
    const board = db.prepare("SELECT id FROM boards WHERE id = ?").get(boardId);
    if (!board) {
      res.status(404).json({ error: "Tafel nicht gefunden." });
      return;
    }
    const body = String(req.body?.body ?? "").trim();
    const parentId = req.body?.parentId == null ? null : String(req.body.parentId);
    if (body.length < 1 || body.length > 5000) {
      res.status(400).json({ error: "Beitrag braucht 1–5000 Zeichen." });
      return;
    }
    if (parentId !== null) {
      const parent = db
        .prepare("SELECT id, board_id FROM posts WHERE id = ?")
        .get(parentId) as Pick<Post, "id" | "board_id"> | undefined;
      if (!parent || parent.board_id !== boardId) {
        res.status(400).json({ error: "Antwort-Ziel ungültig." });
        return;
      }
    }
    const post: Post = {
      id: randomUUID(),
      board_id: boardId,
      parent_id: parentId,
      author_id: u.id,
      author_name: u.name,
      body,
      created_at: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO posts (id, board_id, parent_id, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      post.id,
      post.board_id,
      post.parent_id,
      post.author_id,
      post.author_name,
      post.body,
      post.created_at,
    );
    res.status(201).json(post);
  });

  // --- Eigene Beiträge löschen (Autor:in oder Admin) ---
  app.delete("/api/posts/:id", authed, (req, res) => {
    const u = currentUser(req);
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id) as
      | Post
      | undefined;
    if (!post) {
      res.status(404).json({ error: "Beitrag nicht gefunden." });
      return;
    }
    if (post.author_id !== u.id && !isAdminEmail(u.email)) {
      res.status(403).json({ error: "Nur eigene Beiträge (oder Admins) können löschen." });
      return;
    }
    db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // --- Mitgliederliste ---
  app.get("/api/members", authed, (req, res) => {
    const u = currentUser(req);
    const admin = isAdminEmail(u.email);
    const rows = db
      .prepare("SELECT id, name, email, createdAt FROM \"user\" ORDER BY createdAt ASC")
      .all() as { id: string; name: string; email: string; createdAt: Date | string }[];
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: admin || r.id === u.id ? r.email : null,
        joinedAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        admin: isAdminEmail(r.email),
      })),
    );
  });

  // --- Frontend ---
  if (!viteDev && publicDir) {
    app.use(express.static(publicDir, { maxAge: "1h" }));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[red-board] Fehler:", err);
    res.status(500).json({ error: "Da ist was schiefgelaufen. Nochmal versuchen." });
  });

  return app;
}
