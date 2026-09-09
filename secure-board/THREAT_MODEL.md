# Threat model

## Security goal

Protect message contents between Matrix devices by relying on Matrix's reviewed E2EE protocol implementation in `matrix-js-sdk` Rust/WASM crypto. Secure Board does not implement encryption primitives, key exchange, or its own protocol.

## In scope

- A passive network observer should not read TLS-protected traffic.
- A homeserver storing encrypted room events should not be able to decrypt event bodies without obtaining device keys.
- Accidental plaintext or misdirected posts are blocked: immediately before every send, the client revalidates joined membership, the `invite` join rule, and SDK encryption state, and refuses the send if any check fails.
- Crypto state uses a distinct SDK IndexedDB store derived from the Matrix user and device IDs. The access-token session abstraction also uses IndexedDB and never writes credentials to `localStorage`.
- Only joined, invite-only rooms are presented as boards. `restricted` and `knock_restricted` rooms are not treated as private because their allow rules may make them broadly accessible.

## Explicit limits

### The web-delivery problem

Browser E2EE cannot defend against a malicious or compromised server delivering altered JavaScript. Code served by this application's origin executes with access to plaintext, access tokens, IndexedDB, and the DOM; hostile code can steal messages or keys before encryption or after decryption. HTTPS and a restrictive CSP reduce network injection and third-party-script risk, but they do not make a hostile application host trustworthy. For stronger assurance, distribute a signed, reproducible desktop/mobile client or immutable audited build through an independently verified channel.

### Matrix metadata remains visible

Matrix E2EE does not hide all metadata. Homeservers and relevant infrastructure can observe room IDs, membership and room state—including board names and any existing topics—user/device identifiers, sender and recipient relationships, event timing, frequency and approximate size, IP addresses, and federation routing. The “E2EE-message board” label applies to verified encrypted message events, not room names or other state. Private-room join rules are access control, not metadata anonymity. Secure Board is not an anonymity system and does not protect against traffic analysis.

### Local device and account compromise

E2EE does not protect a device while it is unlocked and running hostile extensions, malware, injected scripts, or a compromised browser profile. IndexedDB data is same-origin accessible. Neither the access-token session record nor Matrix Rust crypto's IndexedDB state and device keys have application-level encryption with a user-held secret. Moving the token out of `localStorage` avoids common accidental access patterns, but it does not protect the token or crypto keys from same-origin script compromise. Logging out asks the homeserver to revoke the current access token, then compare-and-deletes that exact saved session and stops the local client even if revocation fails; an older tab cannot erase a newer tab's login. Transient crypto or sync startup failures preserve validated saved sessions—including newly issued login and registration sessions—for retry. A token stolen before logout remains outside this client's control; revoke suspect devices through another trusted Matrix client or the homeserver.

### Registration and invitations

Browser account creation is deliberately limited to the public Matrix registration API. It accepts success only after this client submits the registration token, when an advertised UIAA flow's remaining stages are `m.login.registration_token` and optional `m.login.dummy`, in the advertised order and in one non-empty, unchanged UIAA session. An uncompleted terms, CAPTCHA, email, SSO, unknown stage, malformed login response, or tokenless success is rejected rather than bypassed; after any response that returns an access token, failure clears local session state and attempts remote token revocation, reporting cleanup failures with the primary error. Registration tokens and passwords are sent to the configured homeserver and must be protected like credentials. Synapse `registration_shared_secret`, admin tokens, and admin APIs must never be exposed to this static client. A board invitation targets an existing exact Matrix user ID; it is room access, not account provisioning.

### Redaction is not erasure

Redaction is submitted with `MatrixClient.redactEvent` and succeeds only when the homeserver's room power levels authorize it. It removes event content from the room history presented by conforming clients, but cannot erase plaintext already decrypted, copied, quoted, screenshotted, notified, logged, backed up, or retained by recipients or infrastructure. Homeserver retention and legal deletion are separate operational concerns.

### Trust and verification gaps in this increment

This UI does not yet expose cross-signing, device verification, key backup/recovery, key-withheld diagnostics, room-member/device trust indicators, or historical pagination. Users cannot use this increment alone to authenticate other devices against key substitution. Until those flows exist, use a mature Matrix client to verify devices, inspect room membership, manage key backup, and revoke devices. The next trust work is verification/cross-signing and recovery UX; the next deployment work is an independently reviewed immutable build, hardened headers, reproducible release process, and separately secured Synapse operations.

## Deployment assumptions

- Serve the static build and `/config.json` from a controlled HTTPS origin.
- Serve no third-party scripts or runtime assets. Pin dependencies through `package-lock.json`, review updates, and rebuild from source.
- Configure CSP and other hardening headers at the static host.
- Operate Synapse separately with timely security updates, restricted registration, backups, monitoring, and appropriate retention policies.
- Keep the application origin and Synapse administration interfaces separated; never place admin credentials in this client.
- An exclusive Web Lock prevents tabs and workers on this origin from concurrently using a given SDK crypto IndexedDB store; browsers without Web Locks fail closed. The lock remains held until the Matrix client has stopped or an in-flight, non-abortable SDK initialization has settled, as required by `matrix-js-sdk`.

## Not promised

Secure Board does not promise protection from endpoint compromise, malicious members who can read and copy plaintext, screenshots, compromised room invitations, denial of service, traffic analysis, malicious application delivery, or future cryptographic breaks.
