# Interviewleitfaden: Handynutzung an Schulen

Gesprächsleitfaden für leitfadengestützte Interviews zum Handyverbot an Schulen —
drei Rollen (Lehrkräfte, Schulleitung, Schüler:innen) mit offenen Kernfragen und
geschlossenen Einstiegs- und Filterblöcken.

## Dateien

| Datei | Inhalt |
|---|---|
| `interviewleitfaden-handyverbot-schulen.md` | Quelle, versionskontrollierbar |
| `interviewleitfaden-handyverbot-schulen.docx` | druckfertige Fassung |
| `build-docx.py` | erzeugt die .docx aus der .md neu |

## Aufbau des Leitfadens

- **Block 0** — Ablauf, Anonymisierung, Einwilligung, Aufzeichnung (alle Rollen wortgleich)
- **Teil A/B/C** je Rolle: Einstieg (geschlossen) → Kern (offen, ★) → Vertiefung → Abschluss
- **Anhang 1** — Nachfrage-Bausteine
- **Anhang 2** — Kontextbogen pro Schule (10 Felder)
- **Anhang 3** — Auswertungsmatrix für den Schulvergleich

## Markierung

- `[O]` offene Frage
- `[G]` geschlossene Frage (Ja / Nein / weiß nicht) — immer mit Warum-Nachfrage
- `[S]` Skala, `[Zahl]` numerische Angabe
- ★ Kernfrage: bleibt über alle Schulen wortgleich, damit Vergleiche möglich sind

## .docx neu bauen

```bash
uv run --with python-docx build-docx.py \
  interviewleitfaden-handyverbot-schulen.md \
  interviewleitfaden-handyverbot-schulen.docx
```

## Hinweis zur Erweiterung auf weitere Schulen

Erhebungen an Schulen sind länderspezifisch genehmigungspflichtig; bei minderjährigen
Befragten ist zusätzlich die schriftliche Einwilligung der Erziehungsberechtigten
erforderlich. Schulen im veröffentlichten Material pseudonymisieren („Schule A" …).
