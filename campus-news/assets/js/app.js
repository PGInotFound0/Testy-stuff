/* Campus News — PoC frontend
 *
 * Vanilla JS, kein Build-Step. Hash-Routing: #/ (Start), #/artikel/<slug>.
 * Alle Inhalte kommen aus window.CAMPUS_NEWS (data.js) — austauschbar gegen
 * einen API-Fetch, ohne dass die Render-Funktionen angefasst werden müssen.
 */
(function () {
  "use strict";

  var DATA = window.CAMPUS_NEWS || { articles: [], categories: [] };
  var PAGE_SIZE = 6;

  var state = {
    category: "alle",
    query: "",
    shown: PAGE_SIZE
  };

  var el = {
    nav: document.getElementById("nav-list"),
    navDate: document.getElementById("nav-date"),
    ticker: document.getElementById("ticker"),
    tickerTrack: document.getElementById("ticker-track"),
    hero: document.getElementById("hero"),
    grid: document.getElementById("grid"),
    gridTitle: document.getElementById("grid-title"),
    gridCount: document.getElementById("grid-count"),
    empty: document.getElementById("empty"),
    more: document.getElementById("more"),
    viewHome: document.getElementById("view-home"),
    viewArticle: document.getElementById("view-article"),
    article: document.getElementById("article"),
    back: document.getElementById("back"),
    searchForm: document.getElementById("search-form"),
    searchInput: document.getElementById("q"),
    themeToggle: document.getElementById("theme-toggle"),
    year: document.getElementById("year")
  };

  /* ── Helpers ─────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  }

  function fmtShort(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  function catLabel(id) {
    var hit = (DATA.categories || []).filter(function (c) { return c.id === id; })[0];
    return hit ? hit.label : id;
  }

  function articleUrl(slug) { return "#/artikel/" + encodeURIComponent(slug); }

  function bySlug(slug) {
    return DATA.articles.filter(function (a) { return a.slug === slug; })[0];
  }

  function sorted() {
    return DATA.articles.slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });
  }

  /* ── Filtering ───────────────────────────────────────── */

  function matches(article) {
    if (state.category !== "alle" && article.category !== state.category) return false;
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    var haystack = [
      article.title, article.teaser, catLabel(article.category), article.kicker,
      (article.tags || []).join(" "),
      (article.body || []).join(" ")
    ].join(" ").toLowerCase();
    return haystack.indexOf(q) !== -1;
  }

  function filtered() { return sorted().filter(matches); }

  /* ── Render: navigation ──────────────────────────────── */

  function renderNav() {
    el.nav.innerHTML = (DATA.categories || []).map(function (c) {
      var count = c.id === "alle"
        ? DATA.articles.length
        : DATA.articles.filter(function (a) { return a.category === c.id; }).length;
      return '<li><button type="button" data-cat="' + esc(c.id) + '"' +
        (state.category === c.id ? ' aria-current="true"' : "") + '>' +
        esc(c.label) + " <span style=\"opacity:.5\">" + count + "</span></button></li>";
    }).join("");
  }

  function renderTicker() {
    var breaking = sorted().filter(function (a) { return a.breaking; });
    if (!breaking.length) { el.ticker.hidden = true; return; }
    el.ticker.hidden = false;
    el.tickerTrack.innerHTML = breaking.map(function (a) {
      return '<a class="ticker__link" href="' + articleUrl(a.slug) + '" ' +
        'style="color:inherit;font-weight:600;text-decoration:none">' +
        esc(catLabel(a.category)) + ": " + esc(a.title) + "</a>";
    }).join(' <span style="opacity:.45">◆</span> ');
  }

  /* ── Render: hero + grid ─────────────────────────────── */

  function miniCard(a) {
    return '<a class="mini" href="' + articleUrl(a.slug) + '">' +
      '<span class="mini__cat">' + esc(catLabel(a.category)) + "</span>" +
      '<span class="mini__title">' + esc(a.title) + "</span>" +
      '<span class="mini__meta">' + esc(fmtShort(a.date)) + " · " +
      esc(a.readingMinutes || 2) + " Min. Lesezeit</span>" +
      "</a>";
  }

  function renderHero() {
    var pool = sorted().filter(matches);
    var lead = pool[0];
    if (!lead) { el.hero.innerHTML = ""; return; }
    var side = pool.slice(1, 4);

    el.hero.innerHTML =
      '<div class="hero__grid">' +
        '<div class="hero__lead">' +
          '<span class="hero__cat">' + esc((lead.kicker || catLabel(lead.category)).toUpperCase()) + "</span>" +
          '<h1 class="hero__title"><a href="' + articleUrl(lead.slug) + '">' + esc(lead.title) + "</a></h1>" +
          '<p class="hero__teaser">' + esc(lead.teaser) + "</p>" +
          '<span class="mini__meta">' + esc(fmtDate(lead.date)) + " · " + esc(lead.author || "Redaktion") + " · " +
            esc(lead.readingMinutes || 3) + " Min.</span>" +
        "</div>" +
        '<div class="hero__side">' + side.map(miniCard).join("") + "</div>" +
      "</div>";
  }

  function card(a) {
    return '<a class="card" href="' + articleUrl(a.slug) + '">' +
      '<span class="card__thumb card__thumb--' + esc(a.category) + '"><span>' +
        esc(catLabel(a.category).slice(0, 2).toUpperCase()) + "</span></span>" +
      '<span class="card__body">' +
        '<span class="card__cat">' + esc(catLabel(a.category)) +
          (a.breaking ? ' <span class="badge-eil">EIL</span>' : "") + "</span>" +
        '<span class="card__title">' + esc(a.title) + "</span>" +
        '<span class="card__teaser">' + esc(a.teaser) + "</span>" +
        '<span class="card__meta"><span>' + esc(fmtShort(a.date)) + "</span><span>·</span><span>" +
          esc(a.readingMinutes || 2) + " Min.</span><span>·</span><span>" + esc(a.author || "Redaktion") + "</span></span>" +
      "</span></a>";
  }

  function renderGrid() {
    var list = filtered();
    var visible = list.slice(0, state.shown);

    el.grid.innerHTML = visible.map(card).join("");
    el.empty.hidden = list.length !== 0;
    el.more.hidden = list.length <= state.shown;

    el.gridTitle.textContent = state.query
      ? 'Suche: "' + state.query + '"'
      : (state.category === "alle" ? "Neueste Meldungen" : catLabel(state.category));
    el.gridCount.textContent = list.length + (list.length === 1 ? " Artikel" : " Artikel") +
      (state.category === "alle" ? "" : " · Ressort " + catLabel(state.category));
  }

  function renderHome() {
    renderNav();
    renderTicker();
    renderHero();
    renderGrid();
  }

  /* ── Render: article ────────────────────────────────── */

  function renderArticle(slug) {
    var a = bySlug(slug);
    if (!a) {
      el.article.innerHTML =
        "<h1 class=\"article__title\">Artikel nicht gefunden</h1>" +
        "<p class=\"article__teaser\">Der angeforderte Beitrag existiert in diesem Demo-Bestand nicht.</p>";
    } else {
      var related = sorted().filter(function (x) {
        return x.slug !== a.slug && x.category === a.category;
      }).slice(0, 3);

      el.article.innerHTML =
        '<span class="article__cat">' + esc(catLabel(a.category)) +
          (a.breaking ? ' · <span class="badge-eil">EIL</span>' : "") + "</span>" +
        '<h1 class="article__title">' + esc(a.title) + "</h1>" +
        '<p class="article__teaser">' + esc(a.teaser) + "</p>" +
        '<div class="article__meta"><span>' + esc(fmtDate(a.date)) + "</span><span>" +
          esc(a.author || "Redaktion") + "</span><span>" + esc(a.readingMinutes || 3) +
          " Min. Lesezeit</span><span>Ressort: " + esc(catLabel(a.category)) + "</span></div>" +
        '<div class="article__body">' +
          (a.body || []).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") +
        "</div>" +
        '<div class="article__tags">' +
          (a.tags || []).map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") +
        "</div>" +
        (related.length
          ? '<div class="article__related"><h3>Mehr aus ' + esc(catLabel(a.category)) + "</h3>" +
            '<div class="grid">' + related.map(card).join("") + "</div></div>"
          : "");
    }
    el.viewHome.hidden = true;
    el.viewArticle.hidden = false;
    window.scrollTo({ top: 0, behavior: "auto" });
    document.title = (a ? a.title + " — " : "") + "Campus News";
  }

  function renderRoute() {
    var hash = window.location.hash || "#/";
    var m = hash.match(/^#\/artikel\/(.+)$/);
    if (m) {
      renderArticle(decodeURIComponent(m[1]));
    } else {
      el.viewArticle.hidden = true;
      el.viewHome.hidden = false;
      renderHome();
      document.title = "Campus News — Campus Technicus Bernburg";
    }
  }

  /* ── Events ─────────────────────────────────────────── */

  el.nav.addEventListener("click", function (ev) {
    var btn = ev.target.closest("button[data-cat]");
    if (!btn) return;
    state.category = btn.dataset.cat;
    state.shown = PAGE_SIZE;
    if (window.location.hash.indexOf("#/artikel/") === 0) window.location.hash = "#/";
    renderHome();
  });

  el.searchForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    state.query = el.searchInput.value;
    state.category = "alle";
    state.shown = PAGE_SIZE;
    if (window.location.hash.indexOf("#/artikel/") === 0) window.location.hash = "#/";
    renderHome();
    el.grid.scrollIntoView({ block: "start" });
  });

  el.searchInput.addEventListener("input", function () {
    if (el.searchInput.value === "" && state.query !== "") {
      state.query = "";
      state.shown = PAGE_SIZE;
      renderHome();
    }
  });

  el.more.addEventListener("click", function () {
    state.shown += PAGE_SIZE;
    renderGrid();
  });

  el.back.addEventListener("click", function () {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = "#/";
  });

  window.addEventListener("hashchange", renderRoute);

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && window.location.hash.indexOf("#/artikel/") === 0) {
      window.location.hash = "#/";
    }
    if (ev.key === "/" && document.activeElement !== el.searchInput) {
      ev.preventDefault();
      el.searchInput.focus();
    }
  });

  /* Theme (dark default, persisted) */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    try { localStorage.setItem("campusnews.theme", theme); } catch (e) {}
  }

  el.themeToggle.addEventListener("click", function () {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  var saved = null;
  try { saved = localStorage.getItem("campusnews.theme"); } catch (e) {}

  /* ── Boot ───────────────────────────────────────────── */

  applyTheme(saved === "light" ? "light" : "dark");
  el.year.textContent = new Date().getFullYear();
  el.navDate.textContent = fmtDate(DATA.meta && DATA.meta.updated ? DATA.meta.updated : new Date().toISOString().slice(0, 10));
  renderRoute();
})();
