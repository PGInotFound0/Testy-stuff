# Secure Board homeserver (Synapse)

A single-server Matrix homeserver for Secure Board: stock Synapse
(`matrixdotorg/synapse:v1.160.0`) plus a first-boot entrypoint that renders
`homeserver.yaml` and persists secrets/keys in `/data`. No federation, no
guest access, registration by admin-minted token only.

## Deploy on Coolify

**Option A — compose (recommended):** create a **Docker Compose** application
from this repo (`PGInotFound0/Testy-stuff`, branch
`feat/e2ee-board-foundation`) pointing at `/synapse/docker-compose.yml`.
The `/data` volume is declared in the file. Then:

1. Coolify assigns a domain like
   `https://synapse-abc123.79.205.122.103.sslip.io`. Copy the **hostname**
   (no `https://`).
2. Set environment variable **before the first deploy**:
   `SYNAPSE_SERVER_NAME=<that hostname>` — permanent, becomes part of every
   user ID (`@user:<hostname>`). Cannot change later. (`PUBLIC_BASEURL`
   defaults to `https://<that hostname>`.)
3. Attach the Coolify domain to port `8008` with HTTPS. Do **not** expose
   8448 (no federation listener exists).
4. Deploy. Healthy when `/health` on port 8008 returns `OK` and
   `https://<hostname>/_matrix/client/versions` lists versions.

**Option B — manual Dockerfile app:** same repo/branch, Dockerfile at
`/synapse/Dockerfile`, and add the persistent volume (container path
`/data`) plus env vars by hand as described above.

## Point the board at it

In the board app's Coolify environment:

- `SECURE_BOARD_HOMESERVER_URL=https://<synapse hostname>`
- `MATRIX_CONNECT_SRC=https://<synapse hostname>` (or leave unset to
  auto-derive)

Relaunch the board deployment afterwards.

## Create accounts

Account signup in the board needs a **registration token**:

```sh
SYNAPSE_URL=https://<synapse hostname> ./scripts/mint-registration-token.sh
```

First run bootstraps the admin user via the registration shared secret
(read it with `cat /data/registration.key` in the Coolify terminal), then
mints the token. Hand the token string to the user for the board signup
form. Mint one token per user (`uses allowed: 1`) or one shared token —
your call.

## Operations

- **Backups**: `/data` contains `homeserver.db`, `media/`, `*.signing.key`,
  `macaroon.key`, `registration.key`, `pepper.key`. Losing the signing key
  forces new device identities; losing the DB loses accounts and rooms.
- **Updates**: bump the image tag in `Dockerfile`, redeploy, check
  `https://<hostname>/_matrix/client/versions`.
- **Logs**: `docker logs` / Coolify log viewer; the entrypoint writes a
  static console-only log config to `/data/log.config` at boot (the stock
  `/conf/log.config` is a Jinja template, not directly usable).
- **No admin API is exposed to the board client.** Admin calls (user/token
  management) run from your machine with the shared secret or an admin
  token — never from the browser.

## Security posture

Matches `../secure-board/THREAT_MODEL.md` deployment assumptions: separate
service + database host, restricted (token) registration, no federation
attack surface, HTTPS terminated at the Coolify proxy, no guest access, no
user-directory harvesting, authenticated profile lookups, 7-day IP metadata
retention. SQLite is fine for a small private server; move to Postgres
(database section of the rendered `/data/homeserver.yaml`) if usage grows.
