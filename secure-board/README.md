# Secure Board

A static React/TypeScript/Vite client that presents private Matrix rooms as message boards. It uses `matrix-js-sdk` and its supported Rust/WASM cryptography via `initRustCrypto()`; it contains no custom cryptography and no application server.

## First increment

- Matrix password login and IndexedDB-backed session restore abstraction
- authenticated Matrix client creation, with Rust crypto initialized **before** sync starts
- SDK crypto state persisted in a stable, distinct IndexedDB store for each Matrix user and device
- joined, invite-only rooms mapped to boards; `restricted` and `knock_restricted` rooms are excluded because their allow rules may grant broad access
- root `m.room.message` events modeled as posts
- replies built and parsed as `m.thread` relations with the Matrix fallback reply shape
- immediately before every send, all send paths revalidate joined membership, the `invite` join rule, and `CryptoApi.isEncryptionEnabledInRoom()`, rejecting if any check fails
- responsive red/dark poster-style login, board list, and thread/composer shell
- no third-party runtime scripts, fonts, analytics, or assets

The first increment does not yet render live timelines, device-verification flows, moderation tools, room creation, or recovery/key-backup UI.

## Run locally

Requirements: Node.js 22+.

```sh
npm ci
cp public/config.example.json public/config.json
# edit public/config.json
npm run dev
```

`/config.json` is fetched from the client origin at startup. It is intentionally not baked into a Vite environment variable, so the same static build can be configured at deployment time:

```json
{
  "homeserverUrl": "https://matrix.example.org"
}
```

The homeserver must allow this web origin through its Matrix CORS policy. Use HTTPS outside local development.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm audit
```

Tests cover invite-only board mapping, latest-event thread fallbacks, session persistence and restore cleanup, per-user/device crypto-store isolation, crypto/startup/initial-sync sequencing, `PREPARED` initial sync, duplicate-login blocking, failed-login cleanup, remote logout with unconditional local cleanup, send-time room-access and encryption revalidation, path-prefixed homeserver URLs, and the login/board/thread UI path.

## Deployment direction

The output in `dist/` is static and can be hosted by a small web server in Coolify. A future self-hosted Synapse deployment should be a separate service and database, exposed over HTTPS. Replace `/config.json` during deployment with that Synapse public base URL. Do not add secrets or access tokens to the runtime config.

Recommended response headers include a restrictive Content Security Policy (`default-src 'self'; connect-src 'self' https://your-matrix-host; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'`), `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

## Security limits

Read [THREAT_MODEL.md](./THREAT_MODEL.md) before deployment. Most importantly, browser E2EE **cannot defend against a malicious or compromised web server that delivers altered JavaScript**. Matrix also exposes metadata even when event bodies are encrypted. Both the access token and Matrix Rust crypto's IndexedDB state/device keys lack application-level encryption with a user-held secret; same-origin JavaScript can access them.
