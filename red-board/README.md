# ★ RED BOARD — solidarity message board

Server-hosted message board (English UI, dark brutalist look):
**Vite + React + TypeScript** up front, **Express + BetterAuth + better-sqlite3** in
back — one deployable Node service, SQLite as the only database.

> **HONEST NOTE — PLEASE READ:** This is **server-hosted messaging with
> TLS + login** (session cookies). It is **NOT end-to-end encrypted**:
> whoever runs the server (or seizes it) can read every post, name, and
> email. Speak openly, but with sense — for high-risk communication
> use Signal or similar. **No E2EE properties** are claimed.

## Features

- **Auth (BetterAuth, email + password):** sign up, sign in, sign out,
  session cookies, protected routes, user shown in the header.
- **Boards (channels):** create + list (behind auth).
- **Posts:** write, reply in threads, delete your own
  (author or admin via `ADMIN_EMAILS`).
- **Member list:** all comrades; email addresses visible only to yourself (or admins).
- **Persistence:** everything in one SQLite file (BetterAuth tables + `boards`/`posts`).

## Develop locally

Requirement: Node ≥ 20.

```sh
cd red-board
npm ci
cp .env.example .env   # set BETTER_AUTH_SECRET (at least 32 random chars)!
npm run dev            # one process: Express + Vite middleware on :3000
```

Useful:

```sh
npm run typecheck   # tsc --noEmit
npm test            # Vitest: auth flow + board/post CRUD
npm run build       # Client (dist/public) + server (dist/server)
npm start           # Production server (needs dist/ + env)
```

## Verify

```sh
npm ci && npm run typecheck && npm test && npm run build
curl -s localhost:3000/api/health   # {"ok":true,"service":"red-board"} (after npm start)
```

## Environment variables

| Variable             | Required | Default                  | What for                        |
| -------------------- | -------- | ------------------------ | --------------------------------|
| `BETTER_AUTH_SECRET` | **yes**  | —                        | Session signing (min. 32 chars) |
| `BETTER_AUTH_URL`    | **yes**  | `http://localhost:PORT`  | Public base URL                 |
| `PORT`               | no       | `3000`                   | Listen port (single port)       |
| `DB_PATH`            | no       | `/data/red-board.db`     | SQLite file (fallback `./data/`)|
| `ADMIN_EMAILS`       | no       | —                        | Comma list, may delete others'  |

## Coolify deploy

- **Base Directory:** `/red-board`, build type **Dockerfile** (there is no
  repo-root `Dockerfile` — use the one in `red-board/`).
- **Port:** `3000` (single port, frontend + API from one process).
- **Set env:** `BETTER_AUTH_SECRET` (generate one!), `BETTER_AUTH_URL`
  (e.g. `https://board.your-domain.org`), `PORT=3000`, optional `ADMIN_EMAILS`.
- **Persistent volume:** host path → container path **`/data`**
  (holds `red-board.db`; without a volume everything is gone after each redeploy).
- Healthcheck (optional): `GET /api/health` → `{"ok":true,…}`.
