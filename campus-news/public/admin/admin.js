/* Campus News — Redaktionsbereich (Vanilla JS, kein Build-Step)
 *
 * Ablauf: /api/auth/me fragen
 *   -> Konto vorhanden?  Anmeldung anzeigen
 *   -> kein Konto?       Ersteinrichtung anzeigen ("Redaktionskonto anlegen")
 *   -> angemeldet        Übersicht + Editor
 *
 * Alle Fehlermeldungen sind für Menschen geschrieben und werden dem Feld
 * zugeordnet, das der Server zurückmeldet (Feld "field").
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var AUTOSAVE_KEY = "campusnews.editor.autosave";

  var state = {
    user: null,
    needsSetup: false,
    articles: [],
    categories: [],
    filter: "alle",
    query: "",
    editing: null,
    image: null,
    dirty: false,
    pendingDelete: null
  };

  /* ── Kleine Helfer ─────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    var d = new Date(String(iso || "") + "T00:00:00");
    if (isNaN(d)) return String(iso || "");
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  function catLabel(id) {
    var hit = state.categories.filter(function (c) { return c.id === id; })[0];
    return hit ? hit.label : id;
  }

  function toast(message, kind) {
    var node = document.createElement("div");
    node.className = "toast toast--" + (kind || "ok");
    node.textContent = message;
    $("toasts").appendChild(node);
    setTimeout(function () {
      node.style.opacity = "0";
      node.style.transition = "opacity .3s ease";
      setTimeout(function () { node.remove(); }, 320);
    }, kind === "err" ? 6000 : 3200);
  }

  async function api(path, options) {
    var opts = options || {};
    var res = await fetch(path, {
      credentials: "same-origin",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      method: opts.method || (opts.body ? "POST" : "GET"),
      body: opts.body
    });
    var data = null;
    try { data = await res.json(); } catch (e) { /* leer */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || "Es ist ein Fehler aufgetreten (" + res.status + ").");
      err.status = res.status;
      err.data = data || {};
      throw err;
    }
    return data || {};
  }

  function showView(name) {
    $("view-auth").hidden = name !== "auth";
    $("view-dash").hidden = name !== "dash";
    $("view-editor").hidden = name !== "editor";
    $("topbar-right").hidden = name === "auth";
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function alertBox(id, message, kind) {
    var box = $(id);
    if (!message) { box.hidden = true; box.innerHTML = ""; return; }
    box.className = "alert" + (kind ? " alert--" + kind : "");
    box.innerHTML = message;
    box.hidden = false;
  }

  function clearFieldErrors() {
    document.querySelectorAll(".field.has-error").forEach(function (f) {
      f.classList.remove("has-error");
      var msg = f.querySelector(".field__error");
      if (msg) msg.remove();
    });
  }

  function fieldError(id, message) {
    var input = $(id);
    var field = input.closest(".field");
    field.classList.add("has-error");
    var msg = document.createElement("span");
    msg.className = "field__error";
    msg.textContent = message;
    field.appendChild(msg);
    input.focus();
  }

  function applyServerError(err) {
    if (err.status === 401 && err.data && err.data.needsLogin) {
      state.user = null;
      toast("Die Sitzung ist abgelaufen. Bitte neu anmelden.", "err");
      showView("auth");
      return true;
    }
    return false;
  }

  /* ── Anmeldung / Ersteinrichtung ───────────────────────── */

  function configureAuthView() {
    var setup = state.needsSetup;
    $("auth-kicker").textContent = setup ? "Ersteinrichtung" : "Redaktion";
    $("auth-title").textContent = setup ? "Redaktionskonto anlegen" : "Anmelden";
    $("auth-hint").textContent = setup
      ? "Es ist noch kein Zugang vorhanden. Lege jetzt das Konto an, mit dem Artikel veröffentlicht werden. Das Passwort wird verschlüsselt gespeichert und lässt sich hier jederzeit ändern."
      : "Melde dich an, um Artikel zu schreiben, zu bearbeiten und zu veröffentlichen.";
    $("wrap-confirm").hidden = !setup;
    $("wrap-remember").hidden = setup;
    $("pw-meter").hidden = !setup;
    $("auth-submit").textContent = setup ? "Konto anlegen" : "Anmelden";
    $("username").placeholder = setup ? "redaktion" : "";
    $("password").setAttribute("autocomplete", setup ? "new-password" : "current-password");
    $("auth-alert").hidden = true;
  }

  function pwScore(pw) {
    var score = 0;
    if (pw.length >= 10) score++;
    if (pw.length >= 14) score++;
    if (/[A-ZÄÖÜ]/.test(pw) && /[a-zäöüß]/.test(pw)) score++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(3, Math.max(1, score));
  }

  function updatePwMeter() {
    if ($("pw-meter").hidden) return;
    var pw = $("password").value;
    var score = pw ? pwScore(pw) : 0;
    var labels = ["", "schwach", "solide", "stark"];
    $("pw-meter").className = "pw-meter pw-meter--" + score;
    $("pw-meter").querySelector("i").style.width = [0, 34, 67, 100][score] + "%";
    $("pw-meter").querySelector(".pw-meter__label").textContent =
      pw.length < 10 ? "mindestens 10 Zeichen" : (labels[score] + " · " + pw.length + " Zeichen");
  }

  $("pw-toggle").addEventListener("click", function () {
    var input = $("password");
    var show = input.type === "password";
    input.type = show ? "text" : "password";
    this.textContent = show ? "🙈" : "👁";
    this.setAttribute("aria-pressed", show ? "true" : "false");
    this.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
  });

  $("password").addEventListener("input", updatePwMeter);

  $("form-auth").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    clearFieldErrors();
    alertBox("auth-alert", "");

    var username = $("username").value.trim();
    var password = $("password").value;
    if (!username) return fieldError("username", "Bitte den Benutzernamen eingeben.");
    if (!password) return fieldError("password", "Bitte das Passwort eingeben.");

    if (state.needsSetup) {
      if (password.length < 10) return fieldError("password", "Das Passwort braucht mindestens 10 Zeichen.");
      if (password !== $("password2").value) return fieldError("password2", "Die beiden Passwörter sind nicht gleich.");
    }

    var submit = $("auth-submit");
    submit.disabled = true;
    submit.textContent = state.needsSetup ? "Konto wird angelegt …" : "Anmeldung läuft …";

    try {
      var payload = state.needsSetup
        ? await api("/api/setup", { body: JSON.stringify({ username: username, password: password }) })
        : await api("/api/auth/login", {
            body: JSON.stringify({ username: username, password: password, remember: $("remember").checked })
          });
      state.user = payload.user;
      $("password").value = "";
      if ($("password2")) $("password2").value = "";
      toast(state.needsSetup ? "Konto angelegt. Willkommen!" : "Angemeldet als " + state.user.username + ".", "ok");
      await enterApp();
    } catch (err) {
      var msg = err.message;
      if (err.data && err.data.remainingAttempts !== undefined && err.status === 401) {
        msg += err.data.remainingAttempts > 0
          ? " Noch " + err.data.remainingAttempts + " Versuch(e), dann wird kurz gesperrt."
          : "";
      }
      alertBox("auth-alert", esc(msg));
    } finally {
      submit.disabled = false;
      submit.textContent = state.needsSetup ? "Konto anlegen" : "Anmelden";
    }
  });

  $("btn-logout").addEventListener("click", async function () {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (e) { /* egal */ }
    state.user = null;
    state.articles = [];
    $("who").textContent = "";
    showView("auth");
    configureAuthView();
    toast("Abgemeldet.", "ok");
  });

  /* ── Übersicht ─────────────────────────────────────────── */

  async function enterApp() {
    $("who").textContent = "@" + (state.user.username || "");
    showView("dash");
    await loadArticles();
  }

  async function loadArticles() {
    try {
      var data = await api("/api/admin/articles");
      state.articles = data.articles || [];
      state.categories = data.categories || [];
      state.user = data.user || state.user;
      $("who").textContent = "@" + (state.user.username || "");
      renderStats(data.stats);
      renderList();
      $("dash-sub").textContent = state.articles.length
        ? "Alle Beiträge im Überblick. Mit \u201EBearbeiten\u201C lässt sich alles ändern."
        : "";
    } catch (err) {
      if (applyServerError(err)) return;
      alertBox("dash-alert", "Die Artikel konnten nicht geladen werden: " + esc(err.message), null);
    }
  }

  function renderStats(stats) {
    var s = stats || {};
    $("stats").innerHTML =
      '<div class="stat"><span class="stat__n">' + (s.total || 0) + '</span><span class="stat__l">Artikel gesamt</span></div>' +
      '<div class="stat stat--ok"><span class="stat__n">' + (s.published || 0) + '</span><span class="stat__l">Veröffentlicht</span></div>' +
      '<div class="stat stat--accent"><span class="stat__n">' + (s.drafts || 0) + '</span><span class="stat__l">Entwürfe</span></div>';
  }

  function visibleArticles() {
    var q = state.query.trim().toLowerCase();
    return state.articles.filter(function (a) {
      if (state.filter !== "alle" && a.status !== state.filter) return false;
      if (!q) return true;
      return [a.title, a.teaser, a.author, (a.tags || []).join(" "), catLabel(a.category)]
        .join(" ").toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderList() {
    var list = visibleArticles();
    var box = $("list");

    if (!list.length) {
      box.innerHTML = '<p class="empty-state">' + (state.articles.length
        ? "Kein Artikel passt zu dieser Auswahl."
        : 'Noch keine Artikel vorhanden. Klick oben rechts auf <strong>+ Neuer Artikel</strong>, um den ersten Beitrag zu schreiben.') + "</p>";
      return;
    }

    box.innerHTML = list.map(function (a) {
      var thumb = a.image
        ? '<span class="row__thumb"><img src="' + esc(a.image) + '" alt="" loading="lazy"></span>'
        : '<span class="row__thumb">' + esc(catLabel(a.category).slice(0, 2).toUpperCase()) + "</span>";
      var viewLink = a.status === "published"
        ? '<a class="ghost" href="/#/artikel/' + encodeURIComponent(a.slug) + '" target="_blank" rel="noopener">Ansehen ↗</a>'
        : "";
      return '<div class="row">' +
        thumb +
        "<div>" +
          '<div class="row__title">' + esc(a.title) + "</div>" +
          '<div class="row__meta">' +
            '<span class="badge badge--' + esc(a.status) + '">' + (a.status === "published" ? "Veröffentlicht" : "Entwurf") + "</span>" +
            (a.breaking ? '<span class="badge badge--eil">EIL</span>' : "") +
            (a.featured ? '<span class="badge badge--top">Aufmacher</span>' : "") +
            "<span>" + esc(catLabel(a.category)) + "</span>" +
            "<span>" + esc(fmtDate(a.date)) + "</span>" +
            "<span>" + esc(a.readingMinutes || 2) + " Min.</span>" +
            "<span>@" + esc(a.author || "Redaktion") + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="row__actions">' +
          '<button class="btn" type="button" data-edit="' + a.id + '">Bearbeiten</button>' +
          viewLink +
          '<button class="ghost ghost--warn" type="button" data-del="' + a.id + '">Löschen</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  $("filters").addEventListener("click", function (ev) {
    var btn = ev.target.closest("button[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    this.querySelectorAll(".chip").forEach(function (c) { c.classList.toggle("is-active", c === btn); });
    renderList();
  });

  $("list-q").addEventListener("input", function () {
    state.query = this.value;
    renderList();
  });

  $("list").addEventListener("click", function (ev) {
    var edit = ev.target.closest("button[data-edit]");
    if (edit) {
      var article = state.articles.filter(function (a) { return String(a.id) === edit.dataset.edit; })[0];
      if (article) openEditor(article);
      return;
    }
    var del = ev.target.closest("button[data-del]");
    if (del) {
      var target = state.articles.filter(function (a) { return String(a.id) === del.dataset.del; })[0];
      if (!target) return;
      state.pendingDelete = target;
      $("del-name").textContent = "\u201E" + target.title + "\u201C";
      $("modal-delete").hidden = false;
      $("del-confirm").focus();
    }
  });

  $("del-confirm").addEventListener("click", async function () {
    var target = state.pendingDelete;
    if (!target) return;
    this.disabled = true;
    try {
      await api("/api/admin/articles/" + target.id, { method: "DELETE" });
      toast("Artikel gelöscht.", "ok");
      $("modal-delete").hidden = true;
      state.pendingDelete = null;
      await loadArticles();
    } catch (err) {
      if (!applyServerError(err)) toast(err.message, "err");
    } finally {
      this.disabled = false;
    }
  });

  document.querySelectorAll("[data-close]").forEach(function (node) {
    node.addEventListener("click", function () {
      node.closest(".modal").hidden = true;
      state.pendingDelete = null;
    });
  });

  /* ── Editor ────────────────────────────────────────────── */

  function fillCategories(selected) {
    $("f-category").innerHTML = state.categories
      .filter(function (c) { return c.id !== "alle"; })
      .map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === selected ? " selected" : "") + ">" +
          esc(c.label) + "</option>";
      }).join("");
  }

  function setImage(url) {
    state.image = url || null;
    if (url) {
      $("drop").hidden = true;
      $("drop-preview").hidden = false;
      $("drop-img").src = url;
      $("drop-name").textContent = "Bild hinterlegt · " + url.split("/").pop();
    } else {
      $("drop").hidden = false;
      $("drop-preview").hidden = true;
      $("drop-img").removeAttribute("src");
      $("drop-name").textContent = "";
    }
    renderPreview();
  }

  function openEditor(article) {
    state.editing = article || null;
    state.dirty = false;
    clearFieldErrors();
    alertBox("editor-alert", "");
    fillCategories(article ? article.category : "schule");
    $("editor-title").textContent = article ? "Artikel bearbeiten" : "Neuer Artikel";
    $("editor-sub").textContent = article
      ? "Zuletzt geändert: " + new Date(article.updatedAt).toLocaleString("de-DE")
      : "Leerzeile im Text trennt Absätze.";

    $("f-title").value = article ? article.title : "";
    $("f-teaser").value = article ? article.teaser : "";
    $("f-body").value = article ? (article.body || []).join("\n\n") : "";
    $("f-date").value = article ? article.date : today();
    $("f-author").value = article ? article.author : "";
    $("f-author").placeholder = state.user ? state.user.displayName : "Redaktion";
    $("f-kicker").value = article ? article.kicker : "";
    $("f-tags").value = article ? (article.tags || []).join(", ") : "";
    $("f-status").value = article ? article.status : "draft";
    $("f-breaking").checked = !!(article && article.breaking);
    $("f-featured").checked = !!(article && article.featured);
    setImage(article ? article.image : null);

    updateCounters();
    renderPreview();
    showView("editor");
    $("f-title").focus();

    if (!article) offerAutosave();
  }

  function collect(status) {
    return {
      title: $("f-title").value.trim(),
      teaser: $("f-teaser").value.trim(),
      body: $("f-body").value,
      category: $("f-category").value,
      date: $("f-date").value || today(),
      author: $("f-author").value.trim() || (state.user ? state.user.username : "Redaktion"),
      kicker: $("f-kicker").value.trim(),
      tags: $("f-tags").value,
      image: state.image,
      breaking: $("f-breaking").checked,
      featured: $("f-featured").checked,
      status: status || $("f-status").value
    };
  }

  function bodyParagraphs() {
    return $("f-body").value.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  function updateCounters() {
    var teaser = $("f-teaser").value.length;
    var paras = bodyParagraphs();
    var words = paras.join(" ").split(/\s+/).filter(Boolean).length;
    $("teaser-count").textContent = teaser;
    $("body-count").textContent = paras.length;
    $("body-words").textContent = words;
    $("body-min").textContent = Math.max(1, Math.round(words / 200));
  }

  function renderPreview() {
    var d = collect();
    var label = catLabel(d.category);
    var image = state.image
      ? '<img class="preview__img" src="' + esc(state.image) + '" alt="">'
      : "";
    $("preview-card").innerHTML = image +
      '<div class="preview__body">' +
        '<span class="preview__cat">' + esc((d.kicker || label).toUpperCase()) +
          (d.breaking ? ' · <span class="badge badge--eil">EIL</span>' : "") + "</span>" +
        '<span class="preview__t">' + (esc(d.title) || '<span style="color:var(--ink-mute)">Ohne Titel</span>') + "</span>" +
        '<span class="preview__x">' + (esc(d.teaser) || '<span style="color:var(--ink-mute)">Noch kein Teaser</span>') + "</span>" +
        '<span class="preview__m">' + esc(fmtDate(d.date)) + " · " + esc(d.author || "Redaktion") +
          " · " + esc(d.readingMinutes || 2) + " Min. · " + esc(label) + "</span>" +
      "</div>";

    var published = $("f-status").value === "published";
    var slugSource = state.editing ? state.editing.slug : null;
    var btn = $("btn-preview");
    if (published && slugSource) {
      btn.disabled = false;
      btn.dataset.href = "/#/artikel/" + encodeURIComponent(slugSource);
      $("preview-hint").textContent = "So erscheint der Artikel auf der Startseite.";
    } else {
      btn.disabled = true;
      delete btn.dataset.href;
      $("preview-hint").textContent = published
        ? "Nach dem ersten Speichern lässt sich der Artikel auf der Website öffnen."
        : "Entwurf — auf der Website noch nicht sichtbar.";
    }
  }

  $("btn-preview").addEventListener("click", function () {
    if (this.dataset.href) window.open(this.dataset.href, "_blank", "noopener");
  });

  ["f-title", "f-teaser", "f-body", "f-date", "f-author", "f-kicker", "f-tags", "f-category", "f-status"]
    .forEach(function (id) {
      $(id).addEventListener("input", onFormChange);
      $(id).addEventListener("change", onFormChange);
    });
  ["f-breaking", "f-featured"].forEach(function (id) {
    $(id).addEventListener("change", onFormChange);
  });

  function onFormChange() {
    state.dirty = true;
    clearFieldErrors();
    updateCounters();
    renderPreview();
    if (!state.editing) scheduleAutosave();
  }

  window.addEventListener("beforeunload", function (ev) {
    if (state.dirty && !$("view-editor").hidden) {
      saveAutosave();
      ev.preventDefault();
      ev.returnValue = "";
    }
  });

  /* Lokale Sicherung: verhindert, dass ein angefangener Artikel beim
     versehentlichen Schließen des Tabs verloren geht. */
  var autosaveTimer = null;

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () { saveAutosave(true); }, 900);
  }

  function saveAutosave(quiet) {
    try {
      var d = collect();
      if (!d.title && !d.teaser && !d.body) { localStorage.removeItem(AUTOSAVE_KEY); return; }
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: d }));
      if (quiet) $("editor-sub").textContent = "Lokal gesichert um " + new Date().toLocaleTimeString("de-DE") + " · Leerzeile trennt Absätze.";
    } catch (e) { /* Speicher voll oder gesperrt — unkritisch */ }
  }

  function offerAutosave() {
    var raw = null;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) {}
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { localStorage.removeItem(AUTOSAVE_KEY); return; }
    if (!saved || !saved.data || !saved.data.title) return;

    alertBox("editor-alert",
      "Es gibt einen lokal gesicherten Entwurf von " +
      new Date(saved.savedAt).toLocaleString("de-DE") + ": <strong>" + esc(saved.data.title) + "</strong>." +
      ' <button class="btn" type="button" id="autosave-restore" style="margin-left:8px">Wiederherstellen</button>' +
      ' <button class="ghost" type="button" id="autosave-drop">Verwerfen</button>', "soft");

    $("autosave-restore").addEventListener("click", function () {
      var d = saved.data;
      $("f-title").value = d.title || "";
      $("f-teaser").value = d.teaser || "";
      $("f-body").value = d.body || "";
      $("f-tags").value = typeof d.tags === "string" ? d.tags : (d.tags || []).join(", ");
      $("f-kicker").value = d.kicker || "";
      $("f-author").value = d.author || "";
      if (d.date) $("f-date").value = d.date;
      if (d.category) fillCategories(d.category);
      setImage(d.image || null);
      state.dirty = true;
      updateCounters();
      renderPreview();
      alertBox("editor-alert", "");
      toast("Entwurf wiederhergestellt.", "ok");
    });

    $("autosave-drop").addEventListener("click", function () {
      localStorage.removeItem(AUTOSAVE_KEY);
      alertBox("editor-alert", "");
    });
  }

  /* ── Bild hochladen ────────────────────────────────────── */

  var drop = $("drop");
  var fileInput = $("f-file");

  drop.addEventListener("click", function () { fileInput.click(); });
  drop.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach(function (type) {
    drop.addEventListener(type, function (ev) { ev.preventDefault(); drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (type) {
    drop.addEventListener(type, function (ev) { ev.preventDefault(); drop.classList.remove("is-over"); });
  });
  drop.addEventListener("drop", function (ev) {
    var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (file) uploadFile(file);
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) uploadFile(fileInput.files[0]);
  });

  $("btn-image-remove").addEventListener("click", function () {
    setImage(null);
    fileInput.value = "";
    state.dirty = true;
    toast("Bild entfernt. Beim Speichern wird es aus dem Artikel genommen.", "ok");
  });

  async function uploadFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      toast("Das Bild ist größer als 5 MB. Bitte vorher verkleinern.", "err");
      return;
    }
    $("drop-progress").hidden = false;
    try {
      var res = await fetch("/api/admin/uploads", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": file.type },
        body: file
      });
      var data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw new Error((data && data.error) || "Upload fehlgeschlagen.");
      setImage(data.url);
      state.dirty = true;
      toast("Bild hochgeladen (" + Math.round(data.bytes / 1024) + " KB).", "ok");
    } catch (err) {
      toast(err.message, "err");
    } finally {
      $("drop-progress").hidden = true;
      fileInput.value = "";
    }
  }

  /* ── Speichern ─────────────────────────────────────────── */

  async function save(status) {
    clearFieldErrors();
    alertBox("editor-alert", "");
    var payload = collect(status);

    if (payload.title.length < 4) return fieldError("f-title", "Bitte einen Titel mit mindestens 4 Zeichen angeben.");
    if (!payload.teaser) return fieldError("f-teaser", "Bitte einen Teaser angeben — er erscheint auf der Startseite.");
    if (!payload.body.trim()) return fieldError("f-body", "Bitte etwas Text schreiben.");
    if (!$("f-date").value) return fieldError("f-date", "Bitte ein Datum wählen.");

    var buttons = ["btn-draft", "btn-publish"];
    buttons.forEach(function (id) { $(id).disabled = true; });

    try {
      var result = state.editing
        ? await api("/api/admin/articles/" + state.editing.id, { method: "PUT", body: JSON.stringify(payload) })
        : await api("/api/admin/articles", { method: "POST", body: JSON.stringify(payload) });

      state.dirty = false;
      try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
      var saved = result.article;
      toast(status === "published" ? "Artikel veröffentlicht." : "Entwurf gespeichert.", "ok");
      state.editing = saved;
      await loadArticles();
      showView("dash");
    } catch (err) {
      if (applyServerError(err)) return;
      if (err.data && err.data.field && $(err.data.field)) fieldError(err.data.field, err.message);
      else alertBox("editor-alert", esc(err.message));
    } finally {
      buttons.forEach(function (id) { $(id).disabled = false; });
    }
  }

  $("btn-draft").addEventListener("click", function () { $("f-status").value = "draft"; save("draft"); });
  $("btn-publish").addEventListener("click", function () { $("f-status").value = "published"; save("published"); });
  $("btn-new").addEventListener("click", function () { openEditor(null); });

  $("btn-cancel").addEventListener("click", function () {
    if (state.dirty && !window.confirm("Änderungen verwerfen? Nicht gespeicherte Eingaben gehen verloren.")) return;
    state.dirty = false;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
    showView("dash");
    loadArticles();
  });

  document.addEventListener("keydown", function (ev) {
    if ($("view-editor").hidden) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      save($("f-status").value);
    }
    if (ev.key === "Escape" && !$("modal-password").hidden) {
      $("modal-password").hidden = true;
    }
  });

  /* ── Passwort ändern ───────────────────────────────────── */

  $("btn-password").addEventListener("click", function () {
    $("pw-current").value = "";
    $("pw-next").value = "";
    $("pw-next2").value = "";
    alertBox("pw-alert", "");
    $("modal-password").hidden = false;
    $("pw-current").focus();
  });

  $("pw-save").addEventListener("click", async function () {
    alertBox("pw-alert", "");
    if (!$("pw-current").value) return alertBox("pw-alert", "Bitte das aktuelle Passwort eingeben.");
    if ($("pw-next").value.length < 10) return alertBox("pw-alert", "Das neue Passwort braucht mindestens 10 Zeichen.");
    if ($("pw-next").value !== $("pw-next2").value) return alertBox("pw-alert", "Die beiden neuen Passwörter sind nicht gleich.");

    this.disabled = true;
    try {
      await api("/api/auth/password", {
        body: JSON.stringify({
          currentPassword: $("pw-current").value,
          nextPassword: $("pw-next").value
        })
      });
      $("modal-password").hidden = true;
      toast("Passwort geändert. Andere Anmeldungen wurden abgemeldet.", "ok");
    } catch (err) {
      if (!applyServerError(err)) alertBox("pw-alert", esc(err.message));
    } finally {
      this.disabled = false;
    }
  });

  /* ── Start ─────────────────────────────────────────────── */

  (async function boot() {
    try {
      var me = await api("/api/auth/me");
      state.needsSetup = !!me.needsSetup;
      if (me.user) {
        state.user = me.user;
        await enterApp();
        return;
      }
    } catch (err) {
      alertBox("auth-alert", "Der Server antwortet nicht wie erwartet. Bitte Seite neu laden.");
    }
    configureAuthView();
    showView("auth");
    (state.needsSetup ? $("username") : $("username")).focus();
  })();
})();
