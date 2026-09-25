/**
 * End-to-End-Test des Redaktionsbereichs gegen eine laufende Campus-News-Instanz.
 * Steuert echtes Chromium über das DevTools-Protokoll (WebSocket aus Node-Bordmitteln) —
 * unabhängig von Browser-Automatisierungsframeworks.
 *
 *   CHROME_BIN=/pfad/zu/chromium node tests/e2e-admin.mjs <baseUrl> <bild.png> <shotDir>
 *
 * Voraussetzung: die Instanz ist noch nicht eingerichtet (leere users-Tabelle),
 * damit der Test die Ersteinrichtung durchlaufen kann.
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const IMAGE = process.argv[3] || "/tmp/cn-artikelbild.png";
const SHOTS = process.argv[4] || "/tmp/cn-shots";
const PORT = Number(process.env.CDP_PORT || 9333);
const CHROME = process.env.CHROME_BIN || "chromium";

mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Chromium starten ───────────────────────────────────────────────────── */

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1440,1200",
  `--user-data-dir=/tmp/cn-e2e-chrome`,
  "about:blank"
], { stdio: "ignore" });

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* noch nicht da */ }
    await sleep(250);
  }
  throw new Error("Chromium DevTools nicht erreichbar");
}

/* ── Minimaler CDP-Client ───────────────────────────────────────────────── */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 20000);
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error("JS-Fehler: " + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }
  async waitFor(expression, timeoutMs = 15000, label = expression) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (await this.eval(expression)) return true; } catch { /* weiter */ }
      await sleep(200);
    }
    throw new Error("Warten fehlgeschlagen: " + label);
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const file = path.join(SHOTS, name);
    writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }
}

/* ── Testablauf ─────────────────────────────────────────────────────────── */

const results = [];
function check(name, expected, actual) {
  const ok = String(expected) === String(actual);
  results.push({ name, ok, expected, actual });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? ` (${actual})` : ` — erwartet [${expected}], bekommen [${actual}]`}`);
  return ok;
}

const FILL = `
function cnSet(sel, val) {
  const el = document.querySelector(sel);
  if (el.tagName === 'SELECT') {
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function cnCheck(sel, on) {
  const el = document.querySelector(sel);
  if (el.checked !== on) el.click();
}
`;

let exitCode = 0;
try {
  const wsUrl = await findTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");

  console.log("\n1) Ersteinrichtung über die Oberfläche");
  await cdp.send("Page.navigate", { url: `${BASE}/admin/` });
  await cdp.waitFor("document.readyState === 'complete' && !!document.getElementById('auth-title')", 15000, "Admin-Seite");
  await cdp.waitFor("document.getElementById('auth-title').textContent.includes('Redaktionskonto')", 8000, "Setup-Ansicht");
  check("Setup-Ansicht wird angezeigt", "Redaktionskonto anlegen", await cdp.eval("document.getElementById('auth-title').textContent"));
  check("Passwort-Wiederholung sichtbar", true, await cdp.eval("!document.getElementById('wrap-confirm').hidden"));

  // Client-Validierung: zu kurzes Passwort
  await cdp.eval(`${FILL} cnSet('#username','redaktion'); cnSet('#password','kurz'); cnSet('#password2','kurz');`);
  await cdp.eval("document.getElementById('auth-submit').click()");
  await sleep(400);
  check("zu kurzes Passwort wird inline gemeldet", "Das Passwort braucht mindestens 10 Zeichen.",
    await cdp.eval("(document.querySelector('#password').closest('.field').querySelector('.field__error')||{}).textContent"));

  // Client-Validierung: ungleiche Passwörter
  await cdp.eval(`${FILL} cnSet('#password','SchnelleZeitung!27'); cnSet('#password2','EtwasAnderes!11');`);
  await cdp.eval("document.getElementById('auth-submit').click()");
  await sleep(400);
  check("ungleiche Passwörter werden gemeldet", "Die beiden Passwörter sind nicht gleich.",
    await cdp.eval("(document.querySelector('#password2').closest('.field').querySelector('.field__error')||{}).textContent"));

  // jetzt korrekt anlegen
  await cdp.eval(`${FILL} cnSet('#password2','SchnelleZeitung!27');`);
  await cdp.eval("document.getElementById('auth-submit').click()");
  await cdp.waitFor("!document.getElementById('view-dash').hidden", 15000, "Übersicht nach Setup");
  check("nach Setup direkt angemeldet", "@redaktion", await cdp.eval("document.getElementById('who').textContent"));
  check("Demo-Artikel werden gelistet", 12, await cdp.eval("document.querySelectorAll('#list .row').length"));
  check("Statistik zeigt 12 veröffentlicht", true, await cdp.eval("document.getElementById('stats').textContent.includes('12')"));
  console.log("   Screenshot:", await cdp.shot("01-uebersicht.png"));

  console.log("\n2) Neuer Artikel mit Bild");
  await cdp.eval("document.getElementById('btn-new').click()");
  await cdp.waitFor("!document.getElementById('view-editor').hidden", 5000, "Editor");
  await cdp.eval(`${FILL}
    cnSet('#f-title','Neue Fahrradwerkstatt öffnet in der alten Heine-Turnhalle');
    cnSet('#f-teaser','Ab Oktober können Schülerinnen und Schüler ihre Räder selbst reparieren — mit Werkzeug, Anleitung und Aufsicht.');
    cnSet('#f-body','Die alte Turnhalle an der Leipziger Straße bekommt eine neue Aufgabe: Auf halber Fläche entsteht eine Fahrradwerkstatt für den Ganztagsbereich.\\n\\nDer Andrang war schon beim ersten Aushang größer als die Zahl der Werkbänke. Deshalb wird der Betrieb in zwei Blöcken laufen und sich an Jahrgänge ab Klasse 7 richten.\\n\\nBetreut wird das Angebot von einer Lehrkraft und zwei Eltern, die beruflich in Zweiradbetrieben arbeiten.\\n\\nOffen ist noch die Finanzierung des Verbrauchsmaterials. Ein Antrag auf Fördermittel läuft.');
    cnSet('#f-date','2026-09-18'); cnSet('#f-author','S. Kessler'); cnSet('#f-kicker','Werkstatt');
    cnSet('#f-tags','Fahrrad, Werkstatt, Ganztag'); cnSet('#f-category','projekte');
    cnCheck('#f-breaking', false); cnCheck('#f-featured', true);
  `);
  check("Live-Vorschau übernimmt den Titel", true,
    await cdp.eval("document.querySelector('.preview__t').textContent.includes('Fahrradwerkstatt')"));
  check("Absatzzähler arbeitet", true,
    await cdp.eval("document.getElementById('body-count').textContent !== '0'"));
  check("Lesezeit-Schätzung sichtbar", true,
    await cdp.eval("Number(document.getElementById('body-min').textContent) >= 1"));

  // Bild über den echten Datei-Dialog einspeisen
  const doc = await cdp.send("DOM.getDocument", { depth: -1 });
  const node = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#f-file" });
  await cdp.send("DOM.setFileInputFiles", { files: [IMAGE], nodeId: node.nodeId });
  await cdp.waitFor("document.getElementById('drop-img').src.startsWith('http')", 15000, "Upload-Vorschau");
  const imgUrl = await cdp.eval("(document.getElementById('drop-img').src.match(/\\/uploads\\/[^/]+$/)||[''])[0]");
  check("Bild wurde hochgeladen", true, imgUrl.startsWith("/uploads/"));
  check("Upload-Zone zeigt statt Auswahl das Bild", true, await cdp.eval("document.getElementById('drop').hidden && !document.getElementById('drop-preview').hidden"));
  console.log("   Screenshot:", await cdp.shot("02-editor.png"));

  console.log("\n3) Speichern");
  await cdp.eval("document.getElementById('btn-draft').click()");
  await cdp.waitFor("!document.getElementById('view-dash').hidden", 15000, "zurück zur Übersicht");
  check("Artikel erscheint als Entwurf", 1,
    await cdp.eval("document.querySelectorAll('#list .row .badge--draft').length"));
  check("Artikelanzahl jetzt 13", 13, await cdp.eval("document.querySelectorAll('#list .row').length"));

  // öffentlich noch nicht sichtbar
  const slug = "neue-fahrradwerkstatt-oeffnet-in-der-alten-heine-turnhalle";
  const publicRes = await fetch(`${BASE}/api/articles/${slug}`);
  check("Entwurf ist öffentlich nicht abrufbar", 404, publicRes.status);

  // Entwurf -> veröffentlichen
  await cdp.eval("document.querySelector('#list .row button[data-edit]').click()");
  await cdp.waitFor("!document.getElementById('view-editor').hidden", 5000, "Editor erneut");
  await cdp.eval("document.getElementById('btn-publish').click()");
  await cdp.waitFor("!document.getElementById('view-dash').hidden", 15000, "Übersicht nach Veröffentlichung");
  check("jetzt als veröffentlicht markiert", "Veröffentlicht",
    await cdp.eval("document.querySelector('#list .row .badge').textContent"));
  check("Aufmacher-Kennzeichnung sichtbar", true,
    await cdp.eval("document.querySelector('#list .row .badge--top') !== null"));

  const published = await (await fetch(`${BASE}/api/articles/${slug}`)).json();
  check("öffentliche API liefert den Artikel", "published", published.article.status);
  check("Bild ist im Artikel hinterlegt", imgUrl, published.article.image);

  console.log("\n4) Öffentliche Website");
  await cdp.send("Page.navigate", { url: `${BASE}/#/artikel/${slug}` });
  await cdp.waitFor("!!document.querySelector('.article__title')", 15000, "Artikelansicht");
  check("Überschrift auf der Website", true,
    await cdp.eval("document.querySelector('.article__title').textContent.includes('Fahrradwerkstatt')"));
  check("Bild wird auf der Website angezeigt", true,
    await cdp.eval("!!document.querySelector('.article__figure img')"));
  check("vier Absätze", 4, await cdp.eval("document.querySelectorAll('.article__body p').length"));
  check("Eilmeldungs-Ticker unverändert", true, await cdp.eval("!document.getElementById('ticker').hidden"));
  console.log("   Screenshot:", await cdp.shot("03-website-artikel.png"));

  await cdp.send("Page.navigate", { url: `${BASE}/` });
  await cdp.waitFor("document.querySelectorAll('#grid .card').length > 0", 15000, "Startseite");
  check("neuer Artikel steht auf der Startseite", true,
    await cdp.eval("document.body.textContent.includes('Fahrradwerkstatt')"));
  console.log("   Screenshot:", await cdp.shot("04-startseite.png"));

  console.log("\n5) Anmeldung gegen falsches Passwort");
  await cdp.eval("fetch('/api/auth/logout',{method:'POST'}).then(()=>1)");
  await cdp.send("Page.navigate", { url: `${BASE}/admin/` });
  await cdp.waitFor("document.getElementById('auth-title').textContent === 'Anmelden'", 15000, "Anmeldemaske");
  check("nach Logout erscheint die Anmeldemaske", "Anmelden", await cdp.eval("document.getElementById('auth-title').textContent"));
  await cdp.eval(`${FILL} cnSet('#username','redaktion'); cnSet('#password','FalschesPasswort1!');`);
  await cdp.eval("document.getElementById('auth-submit').click()");
  await cdp.waitFor("!document.getElementById('auth-alert').hidden", 10000, "Fehlermeldung");
  const msg = await cdp.eval("document.getElementById('auth-alert').textContent");
  check("falsches Passwort wird verständlich gemeldet", true, msg.includes("Benutzername oder Passwort stimmt nicht"));
  check("Restversuche werden genannt", true, /Noch \d+ Versuch/.test(msg));
  console.log("   Screenshot:", await cdp.shot("05-anmeldung-fehler.png"));

  await cdp.eval(`${FILL} cnSet('#password','SchnelleZeitung!27');`);
  await cdp.eval("document.getElementById('auth-submit').click()");
  await cdp.waitFor("!document.getElementById('view-dash').hidden", 15000, "Anmeldung erfolgreich");
  check("Anmeldung mit richtigem Passwort", "@redaktion", await cdp.eval("document.getElementById('who').textContent"));

  console.log("\n6) Abmelden");
  await cdp.eval("document.getElementById('btn-logout').click()");
  await cdp.waitFor("!document.getElementById('view-auth').hidden", 10000, "Anmeldemaske nach Logout");
  check("Abmelden führt zurück zur Maske", true, await cdp.eval("document.getElementById('view-auth').hidden === false"));
} catch (err) {
  console.error("ABBRUCH:", err.message);
  exitCode = 1;
} finally {
  chrome.kill("SIGKILL");
}

const failed = results.filter((r) => !r.ok);
console.log(`\nErgebnis: ${results.length - failed.length} ok, ${failed.length} fehlgeschlagen`);
if (failed.length) failed.forEach((f) => console.log("  fehlgeschlagen:", f.name));
process.exit(exitCode || (failed.length ? 1 : 0));
