# Campus News — PoC

Nachrichten-Website als Machbarkeitsstudie für den **Campus Technicus Bernburg (Saale)**
(Sekundarschule/Ganztagsschule, Standorte Käthe-Kollwitz-Str. 12–14 und Leipziger Straße).

> **Proof of Concept.** Alle Artikel in `assets/js/data.js` sind **fiktive Platzhalter** —
> keine echten Meldungen, keine echten Personen, nicht redaktionell geprüft. Der PoC zeigt
> Layout, Informationsarchitektur und Interaktion, nicht Inhalte.

## Was drin ist

- **Startseite** mit Aufmacher (Hero), vier Ressort-Schlagzeilen, Kartenraster
- **Eilmeldungs-Ticker** für Artikel mit `breaking: true`
- **Ressort-Navigation** mit Live-Zählern: Schule, Technik, Projekte, Sport, Kultur, Bernburg
- **Suche** über Titel, Teaser, Tags und Volltext (`/` fokussiert das Suchfeld)
- **Artikelansicht** als eigene Route (`#/artikel/<slug>`) mit Lesemodus, Tags und verwandten Beiträgen
- **„Mehr laden"-Pagination** (6 pro Seite)
- **Dark/Light-Umschaltung**, persistiert in `localStorage`, Standard dunkel
- **Barrierearm**: Skip-Link, `aria-current`, Fokusringe, `prefers-reduced-motion`, Print-Styles
- **Responsive** bis 320 px, ohne Framework, ohne externe Fonts, **ohne CDN** (offline lauffähig)

## Struktur

```
campus-news/
├── index.html              # Shell, semantisch, ohne Framework
├── assets/css/style.css    # Design-System (CSS-Variablen), brutalist-dark
├── assets/js/data.js       # Demo-Content-Bestand (← hier Inhalte ersetzen)
├── assets/js/app.js        # Rendering, Filter, Suche, Hash-Routing
├── nginx.conf              # Static-Serving, gzip, Cache- und Security-Header
└── Dockerfile              # nginx:alpine, für Coolify/Container-Deploy
```

## Lokal starten

Reines Static-Site — jeder Webserver reicht:

```bash
cd campus-news
python3 -m http.server 8080     # -> http://localhost:8080
```

Oder als Container:

```bash
docker build -t campus-news .
docker run --rm -p 8080:80 campus-news
```

## Deploy (Coolify)

1. Neue Resource → *Dockerfile* → Repository `PGInotFound0/Testy-stuff`, Branch wählen
2. **Base Directory:** `/campus-news`
3. Port `80`, Domain zuweisen, Health Check ist im Image definiert

## Inhalte austauschen

`assets/js/data.js` ist der einzige Datenlayer. Für einen echten Betrieb ersetzt ihn ein
`fetch()` auf eine API — die Feldstruktur ist bewusst CMS- und SQL-freundlich:

```js
{
  slug, title, teaser, body: [ "absatz", ... ],
  category, kicker, date: "JJJJ-MM-TT",
  author, readingMinutes, tags: [],
  featured, breaking
}
```

Anzupassen in `app.js`:
- `PAGE_SIZE` — Karten pro Ladung
- `articleUrl()` / `renderRoute()` — falls statt Hash echte Pfade (`/artikel/slug`) gewünscht sind
- `renderHero()` — Anzahl der Seiten-Schlagzeilen ist dort auf `slice(1, 4)` gesetzt

## Nächste sinnvolle Schritte (kein PoC-Umfang)

- Redaktions-Login mit Rollen (Schülerredaktion / Lehrkraft / Freigabe)
- Bezug echter Inhalte aus einem Headless-CMS, Bild-Uploads mit Rechteprüfung
- Impressum, Datenschutzerklärung, Bildnachweise, Löschkonzept für Personenbezug
- RSS/JSON-Feed, Termin-Kalender, Newsletter
- Automatisierte Tests (Playwright-Smoke: Routing, Suche, Filter)
