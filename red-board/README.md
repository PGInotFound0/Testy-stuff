# ★ ROTE TAFEL — solidarisches Nachrichtenbrett

Server-gehostetes Message-Board (deutsche UI, dunkler brutalistischer Look):
**Vite + React + TypeScript** vorne, **Express + BetterAuth + better-sqlite3** hinten —
ein deploybarer Node-Service, SQLite als einzige Datenbank.

> **EHRLICHER HINWEIS — BITTE LESEN:** Das ist **Server-gehostetes Messaging mit
> TLS + Login** (Session-Cookies). Es ist **NICHT Ende-zu-Ende-verschlüsselt**:
> Wer den Server betreibt (oder ihn beschlagnahmt), kann alle Beiträge, Namen und
> E-Mails lesen. Sprich offen, aber mit Verstand — für Hochrisiko-Kommunikation
> nimm Signal o. Ä. Es werden **keine E2EE-Eigenschaften** behauptet.

## Funktionen

- **Auth (BetterAuth, E-Mail + Passwort):** Registrieren, Anmelden, Abmelden,
  Session-Cookies, geschützte Routen, Nutzer:in im Header.
- **Tafeln (Kanäle):** anlegen + auflisten (hinter Auth).
- **Beiträge:** schreiben, in Threads antworten, eigene löschen
  (Autor:in oder Admin via `ADMIN_EMAILS`).
- **Mitgliederliste:** alle Genoss:innen; E-Mail-Adressen sieht nur man selbst (oder Admins).
- **Persistenz:** alles in einer SQLite-Datei (BetterAuth-Tabellen + `boards`/`posts`).

## Lokal entwickeln

Voraussetzung: Node ≥ 20.

```sh
cd red-board
npm ci
cp .env.example .env   # BETTER_AUTH_SECRET setzen (mind. 32 Zufallszeichen)!
npm run dev            # ein Prozess: Express + Vite-Middleware auf :3000
```

Nützlich:

```sh
npm run typecheck   # tsc --noEmit
npm test            # Vitest: Auth-Flow + Board/Post-CRUD
npm run build       # Client (dist/public) + Server (dist/server)
npm start           # Produktionsserver (braucht dist/ + Env)
```

## Verifizieren

```sh
npm ci && npm run typecheck && npm test && npm run build
curl -s localhost:3000/api/health   # {"ok":true,"service":"red-board"} (nach npm start)
```

## Umgebungsvariablen

| Variable             | Pflicht | Default                  | Wozu                              |
| -------------------- | ------- | ------------------------ | --------------------------------- |
| `BETTER_AUTH_SECRET` | **ja**  | —                        | Session-Signing (mind. 32 Zeichen)|
| `BETTER_AUTH_URL`    | **ja**  | `http://localhost:PORT`  | Öffentliche Basis-URL             |
| `PORT`               | nein    | `3000`                   | Listen-Port (einziger Port)       |
| `DB_PATH`            | nein    | `/data/red-board.db`     | SQLite-Datei (Fallback `./data/`) |
| `ADMIN_EMAILS`       | nein    | —                        | Kommaliste, darf fremd löschen    |

## Coolify-Deploy

- **Base Directory:** `/red-board`, Build-Typ **Dockerfile** (repo-root `Dockerfile`
  gibt es nicht — nimm das in `red-board/`).
- **Port:** `3000` (einziger Port, Frontend + API aus einem Prozess).
- **Env setzen:** `BETTER_AUTH_SECRET` (generieren!), `BETTER_AUTH_URL`
  (z. B. `https://tafel.deine-domain.org`), `PORT=3000`, optional `ADMIN_EMAILS`.
- **Persistentes Volume:** Host-Pfad → Container-Pfad **`/data`**
  (darin liegt `red-board.db`; ohne Volume ist nach jedem Redeploy alles weg).
- Healthcheck (optional): `GET /api/health` → `{"ok":true,…}`.
