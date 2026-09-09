# Secure Board

A static React/TypeScript/Vite client that presents private Matrix rooms as message boards. It uses `matrix-js-sdk` and its supported Rust/WASM cryptography via `initRustCrypto()`; it contains no custom cryptography and no application server.

## Usable board increment

- Matrix password login, registration-token account creation, and IndexedDB-backed session restore
- registration uses the public Matrix `/register` UIAA endpoint through `matrix-js-sdk`; it accepts success only after submitting the registration token in one non-empty, unchanged UIAA session, and only when an advertised flow's remaining stages are `m.login.registration_token` and optional `m.login.dummy`. An uncompleted terms, CAPTCHA, email, SSO, unknown stage, malformed login session, or tokenless success fails closed; when a failure response includes a usable access token, remote revocation is attempted and local session state is cleared. The browser never uses Synapse's registration shared secret or admin API
- authenticated Matrix client creation, with Rust crypto initialized **before** sync starts
- SDK crypto state persisted in a stable, distinct IndexedDB store for each Matrix user and device, with process-wide ownership guards preventing concurrent clients from opening the same store. Disposal rejects pending connection attempts immediately, and SDK initialization/startup times out visibly after 20 seconds, but the crypto-store claim remains held until the non-abortable SDK promise settles; reload the page if SDK cleanup itself never settles
- joined, invite-only rooms mapped to boards; `restricted` and `knock_restricted` rooms are excluded because their allow rules may grant broad access
- decrypted text events rendered as live root posts and `m.thread` replies, with stable event-ID/timestamp ordering and listener cleanup
- atomic board creation: rooms are private/invite-only and include Megolm `m.room.encryption` in `initial_state`; no plaintext topic is created
- exact Matrix-user-ID room invitations, root posting, latest-event fallback thread replies, and server-authorized redaction
- immediately before every send, invite, or redaction, relevant paths revalidate joined membership, the `invite` join rule, and SDK encryption state, rejecting if any check fails
- progress/error states and duplicate-submission guards in the UI
- no third-party runtime scripts, fonts, analytics, or assets

Device verification, cross-signing, key backup/recovery, member/device trust indicators, pagination, and production deployment hardening remain future work.

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

Tests cover private-board mapping and policy changes, decrypted live timelines and listener teardown, local-echo replacement/cancellation, malformed/redacted event filtering, latest-event thread fallbacks, atomic encrypted room creation, strict Matrix user/session validation (including ports, IPv6, malformed server names, and control characters), token-authenticated registration UIAA with immutable non-empty sessions and tokenless-success rejection, login/restore/registration revocation and cleanup-error aggregation, per-user/device crypto-store isolation and exclusive ownership, throwing factories and post-start setup, bounded non-abortable crypto/startup cancellation, StrictMode-like restore/dispose/remount serialization, crypto/startup/initial-sync sequencing, duplicate authentication/action blocking, remote logout with unconditional local cleanup, send-time room-access and encryption revalidation, moderation/error surfacing, path-prefixed homeserver URLs, and the complete account/board/thread UI path.

## Deployment direction

The output in `dist/` is static and can be hosted by a small web server in Coolify. A future self-hosted Synapse deployment should be a separate service and database, exposed over HTTPS. Replace `/config.json` during deployment with that Synapse public base URL. Do not add secrets or access tokens to the runtime config.

Recommended response headers include a restrictive Content Security Policy (`default-src 'self'; connect-src 'self' https://your-matrix-host; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'`), `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

## Security limits

Read [THREAT_MODEL.md](./THREAT_MODEL.md) before deployment. Most importantly, browser E2EE **cannot defend against a malicious or compromised web server that delivers altered JavaScript**. Matrix also exposes metadata even when event bodies are encrypted. Both the access token and Matrix Rust crypto's IndexedDB state/device keys lack application-level encryption with a user-held secret; same-origin JavaScript can access them.
