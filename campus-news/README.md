# Campus News — PoC mit Redaktionsbereich

Nachrichten-Website als Machbarkeitsstudie für den **Campus Technicus Bernburg (Saale)**
(Sekundarschule/Ganztagsschule, Standorte Käthe-Kollwitz-Str. 12–14 und Leipziger Straße).

> **Proof of Concept.** Die 12 mitgelieferten Artikel sind **fiktive Platzhalter** — keine
> echten Meldungen, keine echten Personen, nicht redaktionell geprüft. Sie werden beim
> ersten Start als Beispielinhalte in die Datenbank gespielt und können im
> Redaktionsbereich gelöscht werden.

## Was drin ist

**Öffentliche Website**

- Startseite mit Aufmacher (Hero), Nebenschlagzeilen und Kartenraster (6 pro Seite, „Mehr laden")
- Eilmeldungs-Ticker für Artikel mit Eilmeldungs-Kennzeichnung
- Ressort-Navigation mit Live-Zählern: Schule, Technik, Projekte, Sport, Kultur, Bernburg
- Volltextsuche (`/` fokussiert das Feld), Artikelansicht als Route `#/artikel/<slug>`
  mit Tags, Beitragsbild und verwandten Beiträgen
- Dark/Light-Umschaltung (dunkel als Standard, in `localStorage` gemerkt)
- Responsiv bis 320 px, Skip-Link, `aria-current`, Fokusringe, Druck-Styles, kein Tracking, keine Cookies

**Redaktionsbereich unter `/admin/`**

- **Ersteinrichtung**: Solange kein Konto existiert, führt die Seite durch das Anlegen des
  Redaktionskontos. Es gibt **kein Standardpasswort im Repository**.
- **Anmeldung**: Benutzername + Passwort, Anzeigen/Verbergen des Passworts, Passwortstärke-Anzeige,
  „Angemeldet bleiben" (30 Tage), Fehlermeldungen in klarer Sprache, Restversuche werden genannt
- **Artikelverwaltung**: Liste mit Status (Entwurf/Veröffentlicht), Filter und Suche,
  Bearbeiten, Ansehen, Löschen (mit Rückfrage), Statistik-Kacheln
- **Editor**: Titel, Ressort, Datum, Autor, Rubrik-Zeile, Teaser, Text (Leerzeile trennt Absätze),
  Tags, Eilmeldung/Aufmacher, Entwurf oder Veröffentlichung — mit **Live-Vorschau**,
  Zeichen-/Absatz-/Lesezeitzähler und **lokaler Sicherung** des angefangenen Textes
- **Bild-Upload** per Klick oder Drag & Drop (PNG/JPEG/WEBP/GIF, max. 5 MB)
- **Passwort ändern** (beendet alle anderen Sitzungen)

## Struktur

```
campus-news/
├── public/                     # alles, was ausgeliefert wird
│   ├── index.html              # öffentliche Startseite (kein Framework)
│   ├── assets/css/style.css    # Design-System (CSS-Variablen), brutalist-dark
│   ├── assets/js/app.js        # Rendering, Filter, Suche, Hash-Routing
│   ├── assets/data/articles.json  # Demo-/Fallback-Bestand (auch Seed beim Erststart)
│   └── admin/                  # Redaktionsbereich (index.html, admin.css, admin.js)
├── server/
│   ├── index.js                # HTTP-Server: statische Dateien + Routing
│   ├── api.js                  # JSON-API + Validierung
│   ├── auth.js                 # scrypt-Passwörter, Sessions, Login-Bremse, Policy
│   ├── db.js                   # SQLite-Schema und Abfragen (node:sqlite)
│   ├── uploads.js              # Bild-Upload mit MIME- und Magic-Byte-Prüfung
│   └── http.js                 # Antwort-Helfer, Body-Limit, CSRF-Origin-Prüfung
├── Dockerfile                  # node:24-alpine, Volume /data, Healthcheck
└── package.json                # keine Laufzeit-Abhängigkeiten
```

**Keine externen Abhängigkeiten:** der Server nutzt ausschließlich Node-Bordmittel
(`node:http`, `node:sqlite`, `node:crypto`, `node:zlib`). Kein `npm install` nötig,
kein Build-Schritt, kein CDN.

## Lokal starten

```bash
cd campus-news
npm start                 # -> http://localhost:3000  (Redaktion: /admin/)
npm run dev               # mit automatischem Neustart (node --watch)
```

Daten (SQLite-DB + Uploads) landen in `./data` — über `DATA_DIR` änderbar:

```bash
DATA_DIR=/tmp/campus-news PORT=8080 node server/index.js
```

**Nur die statische Website** (ohne Redaktionsbereich) geht auch:

```bash
python3 -m http.server 8080 --directory public
```

Dann greift automatisch der Fallback auf `assets/data/articles.json`; im Fuß der Seite steht
dann „Quelle: Demo-Daten (statisch)" statt „Quelle: Redaktion (live)".

## Deploy (Coolify)

1. Resource → **Dockerfile**, Repository `PGInotFound0/Testy-stuff`, gewünschter Branch
2. **Base Directory:** `/campus-news`
3. **Port:** `3000`
4. **Volume:** `/data` (enthält SQLite-DB und hochgeladene Bilder — ohne Volume sind
   Artikel und Bilder beim nächsten Deploy weg)
5. Healthcheck ist im Image definiert (`/api/health`)

Optional per Umgebungsvariable: `PUBLIC_ORIGIN=https://campus-news.example.org`
(erlaubt zusätzlich diese Herkunft für schreibende Anfragen), `MAX_UPLOAD_BYTES`.

Nach dem ersten Start `/admin/` öffnen und das Redaktionskonto anlegen.

### Passwort vergessen?

Ohne Zugang zum Redaktionsbereich lässt sich das Konto zurücksetzen, indem die
`users`-Tabelle geleert wird. In Coolify im Terminal der Resource:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/campusnews.db');db.exec('DELETE FROM users; DELETE FROM sessions;');console.log('Redaktionskonto entfernt — /admin/ zeigt wieder die Ersteinrichtung.')"
```

## API (Kurzüberblick)

| Methode | Pfad | Zugang |
|---|---|---|
| GET | `/api/health` | öffentlich |
| GET | `/api/setup-state` | öffentlich (`needsSetup`) |
| POST | `/api/setup` | öffentlich, nur solange kein Konto existiert |
| POST | `/api/auth/login` · `/api/auth/logout` · `/api/auth/me` | öffentlich |
| POST | `/api/auth/password` | Redaktion |
| GET | `/api/articles` · `/api/articles/:slug` | öffentlich (nur Veröffentlichtes) |
| GET/POST/PUT/DELETE | `/api/admin/articles[/:id]` | Redaktion |
| POST | `/api/admin/uploads` | Redaktion (roher Bild-Body, `Content-Type: image/*`) |

`GET /api/articles` liefert exakt die Struktur von `assets/data/articles.json`, damit die
Website zwischen API und statischem Fallback nicht unterscheiden muss.

## Sicherheit (Umfang des PoC)

- Passwörter: **scrypt** mit eigenem Salt, Vergleich über `timingSafeEqual`
- Sitzungen: 256-Bit-Zufallstoken, in der DB nur als SHA-256-Hash, Cookie `HttpOnly`,
  `SameSite=Lax`, `Secure` sobald HTTPS erkannt wird (`X-Forwarded-Proto`)
- **CSRF**: `SameSite=Lax` plus Prüfung von `Origin`/`Referer` gegen den eigenen Host
- **Brute-Force**: 6 Fehlversuche pro IP bzw. Benutzername in 10 Minuten → 429 mit `Retry-After`
- **Upload**: MIME-Allowlist + Magic-Byte-Prüfung, 5-MB-Limit, Zufallsdateiname,
  Ablage außerhalb von `public/`
- **Pfade**: Path-Traversal-Schutz, Servercode und Datenbank werden nicht ausgeliefert
- **Header**: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`
- Passwortregeln: mindestens 10 Zeichen, keine geläufigen Wörter, Mischung aus Zeichensorten

**Nicht** enthalten (bewusst offen für den echten Betrieb): Rollen/Rechte je Redakteur,
Zwei-Faktor-Anmeldung, Wiederherstellung per E-Mail, Impressum und Datenschutzerklärung,
Löschkonzept für personenbezogene Beiträge, Freigabe-Workflow (Vier-Augen-Prinzip).

## Tests

Zwei Ebenen, beide ohne Test-Framework lauffähig (Server vorher starten):

```bash
# 1) API-Smoketest — 51 Prüfungen: Auth, CSRF, Validierung, Upload,
#    Path-Traversal, Slug-Kollisionen, Login-Bremse, Passwortwechsel
B=http://127.0.0.1:3000 bash tests/api-smoke.sh
```

```bash
# 2) Browser-End-to-End-Test — 29 Prüfungen im echten Chromium (über das
#    DevTools-Protokoll, ohne Playwright/Puppeteer): Ersteinrichtung,
#    Login-Fehler, Artikel anlegen, Bild über den echten Dateidialog
#    hochladen, Entwurf -> Veröffentlichung, Anzeige auf der Website, Abmelden.
#    Erwartet eine noch nicht eingerichtete Instanz (leere users-Tabelle).
node tests/make-test-image.mjs /tmp/bild.png
CHROME_BIN=$(which chromium) node tests/e2e-admin.mjs http://127.0.0.1:3000 /tmp/bild.png /tmp/shots
```

Der End-to-End-Test legt unter `/tmp/shots` Screenshots jeder Ansicht ab.

## Nächste sinnvolle Schritte

- Rollen und Freigabe-Workflow (Schülerredaktion schreibt, Lehrkraft gibt frei)
- Termin-Kalender, RSS/JSON-Feed, Newsletter
- Bildnachweise und Nutzungsrechte pro Bild erfassen
- Automatisierte Tests in CI (Playwright) statt lokaler Skripte
- Backups der SQLite-Datei und des Upload-Ordners
