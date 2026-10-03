// TI4 Rules Drawer: a slide-out rules reference injected into TI Assistant.
//
// Everything lives inside a shadow root so TI Assistant's styles can't reach
// the drawer and ours can't leak onto the game. Rules come from rules.json
// (built from tirules-search by scripts/build-rules.mjs) and are searched
// entirely in the browser.
(() => {
  if (window.__tiRulesDrawer) return;
  window.__tiRulesDrawer = true;

  // Safari exposes the WebExtension API as `browser`; Chrome as `chrome`.
  const ext = globalThis.browser ?? globalThis.chrome;

  const STORE_KEY = "tiRulesDrawer";
  const MAX_RECENT_SEARCHES = 20;
  const MAX_RECENT_PAGES = 10;
  const SNIPPETS_SHOWN = 3;
  const FONT_MIN = 14,
    FONT_MAX = 34;
  const WIDTH_MIN = 25,
    WIDTH_MAX = 90;

  const settings = {
    fontSize: 20,
    width: 42,
    recentSearches: [],
    recentPages: [],
  };

  async function loadSettings() {
    try {
      const stored = (await ext.storage.local.get(STORE_KEY))[STORE_KEY];
      Object.assign(settings, stored);
    } catch {}
  }

  function saveSettings() {
    try {
      ext.storage.local.set({ [STORE_KEY]: settings });
    } catch {}
  }

  // ── Text helpers ──────────────────────────────────────────────────────────

  const esc = (s) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  // One-for-one character swaps, so offsets in normalised text line up with
  // offsets in the original text.
  const normChars = (s) =>
    s
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐‑–—]/g, "-");

  function queryRegex(q) {
    const words = normChars(q.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return new RegExp(
      words
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
        .join(String.raw`\s+`),
      "gi",
    );
  }

  function findMatches(text, re) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
    return out;
  }

  // Concatenates a page's visible text nodes. Each page carries a <style> tag
  // with its rule number, which must not be searchable. Both the search index
  // and the highlighter use this, so match N in results is match N on the page.
  function textOf(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentNode.nodeName === "STYLE"
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [],
      starts = [];
    let text = "";
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
      starts.push(text.length);
      text += walker.currentNode.nodeValue;
    }
    return { text, nodes, starts };
  }

  // Offsets of each <h2> so a snippet can say which section (or card) it's in.
  function headingsOf(root, nodes, starts) {
    const startOf = new Map(nodes.map((n, i) => [n, starts[i]]));
    const out = [];
    for (const h of root.querySelectorAll("h2")) {
      const first = document
        .createTreeWalker(h, NodeFilter.SHOW_TEXT)
        .nextNode();
      const label = h.textContent.replace(/\s+/g, " ").trim();
      if (first && label && startOf.has(first))
        out.push({ at: startOf.get(first), label });
    }
    return out;
  }

  function sectionAt(page, pos) {
    let label = "";
    for (const h of page.headings) {
      if (h.at > pos) break;
      label = h.label;
    }
    return label;
  }

  function snippetHtml(text, [s, e], radius = 90) {
    let a = Math.max(0, s - radius),
      b = Math.min(text.length, e + radius);
    while (a > 0 && /\S/.test(text[a - 1]) && s - a < radius + 20) a--;
    while (b < text.length && /\S/.test(text[b]) && b - e < radius + 20) b++;
    const clean = (t) => esc(t.replace(/\s+/g, " "));
    return (
      (a > 0 ? "…" : "") +
      clean(text.slice(a, s)).trimStart() +
      "<mark>" +
      clean(text.slice(s, e)) +
      "</mark>" +
      clean(text.slice(e, b)).trimEnd() +
      (b < text.length ? "…" : "")
    );
  }

  // Wraps every match in <mark>, splitting across element boundaries when a
  // match spans e.g. "the <b>Move Ships</b> step". Returns marks grouped by match.
  function highlight(root, re) {
    const { text, nodes, starts } = textOf(root);
    const matches = findMatches(normChars(text), re);
    const groups = matches.map(() => []);
    let m = 0;
    nodes.forEach((node, k) => {
      const ns = starts[k],
        ne = ns + node.nodeValue.length;
      while (m < matches.length && matches[m][1] <= ns) m++;
      const segs = [];
      for (let j = m; j < matches.length && matches[j][0] < ne; j++) {
        segs.push([
          Math.max(matches[j][0], ns) - ns,
          Math.min(matches[j][1], ne) - ns,
          j,
        ]);
      }
      if (!segs.length) return;
      const v = node.nodeValue,
        frag = document.createDocumentFragment();
      let last = 0;
      for (const [s, e, idx] of segs) {
        if (s > last) frag.append(v.slice(last, s));
        const mark = document.createElement("mark");
        mark.textContent = v.slice(s, e);
        groups[idx].push(mark);
        frag.append(mark);
        last = e;
      }
      if (last < v.length) frag.append(v.slice(last));
      node.replaceWith(frag);
    });
    return groups;
  }

  // ── Rules data ────────────────────────────────────────────────────────────

  let rulesPromise = null;

  function loadRules() {
    rulesPromise ??= fetch(ext.runtime.getURL("rules.json"))
      .then((r) => r.json())
      .then((data) => {
        const tpl = document.createElement("template");
        for (const page of data.pages) {
          tpl.innerHTML = page.html;
          const { text, nodes, starts } = textOf(tpl.content);
          page.text = text;
          page.normText = normChars(text);
          page.normTitle = normChars(page.title).toLowerCase();
          page.headings = headingsOf(tpl.content, nodes, starts);
        }
        data.byId = new Map(data.pages.map((p) => [p.id, p]));
        return data;
      });
    return rulesPromise;
  }

  function search(rules, q) {
    const re = queryRegex(q);
    if (!re) return [];
    const nq = normChars(q.trim()).toLowerCase();
    const results = [];
    for (const page of rules.pages) {
      const matches = findMatches(page.normText, re);
      if (matches.length)
        results.push({ page, matches, titleHit: page.normTitle.includes(nq) });
    }
    // Pages named after the query first, then pages that mention it most.
    return results.sort(
      (a, b) =>
        b.titleHit - a.titleHit ||
        b.matches.length - a.matches.length ||
        a.page.title.localeCompare(b.page.title),
    );
  }

  function suggestTitles(rules, q) {
    const nq = normChars(q.trim()).toLowerCase();
    if (!nq) return [];
    const hits = rules.pages.filter((p) => p.normTitle.includes(nq));
    const starts = (p) =>
      p.normTitle.replace(/^[^a-z0-9]*(the )?/, "").startsWith(nq);
    return hits.sort((a, b) => starts(b) - starts(a)).slice(0, 6);
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  // Option on a Mac, Alt elsewhere. Used in tooltips only; the shortcuts
  // themselves check e.altKey, which is true for both.
  const ALT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥" : "Alt+";

  const host = document.createElement("div");
  host.id = "ti-rules-drawer";
  host.style.cssText = "all: initial; display: none;";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <link rel="stylesheet" href="${ext.runtime.getURL("drawer.css")}">
    <button class="tab" title="Rules (/ or ${ALT}R)">Rules</button>
    <aside class="drawer" aria-label="Rules reference">
      <div class="resize" title="Drag to resize"></div>
      <div class="bar">
        <div class="row">
          <button data-act="back" title="Back (${ALT}←)" aria-label="Back">‹</button>
          <button data-act="forward" title="Forward (${ALT}→)" aria-label="Forward">›</button>
          <button data-act="home" title="Home: recent searches and all rules (${ALT}H)">Home</button>
          <span class="spacer"></span>
          <button data-act="smaller" title="Smaller text" aria-label="Smaller text">A−</button>
          <button data-act="larger" title="Larger text" aria-label="Larger text">A+</button>
          <button data-act="close" title="Close (Esc)" aria-label="Close">✕</button>
        </div>
        <form class="search" autocomplete="off">
          <input type="search" placeholder="Search rules…" spellcheck="false" aria-label="Search rules">
          <button type="submit">Search</button>
        </form>
        <div class="suggest" role="listbox" hidden></div>
      </div>
      <div class="matchbar" hidden>
        <span class="matchcount"></span>
        <span class="spacer"></span>
        <button data-act="prev-match" title="Previous match (Shift+N)" aria-label="Previous match">▲</button>
        <button data-act="next-match" title="Next match (N)" aria-label="Next match">▼</button>
        <button data-act="clear-match" title="Clear highlights" aria-label="Clear highlights">✕</button>
      </div>
      <main class="view" tabindex="-1"></main>
    </aside>
  `;

  const $ = (sel) => shadow.querySelector(sel);
  const drawer = $(".drawer"),
    view = $(".view"),
    input = $(".search input");
  const suggestBox = $(".suggest"),
    matchbar = $(".matchbar");

  shadow
    .querySelector("link")
    .addEventListener("load", () => (host.style.display = ""));

  function applySettings() {
    drawer.style.setProperty("--fs", settings.fontSize + "px");
    drawer.style.setProperty("--w", settings.width + "vw");
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  let isOpen = false;

  async function open(focusSearch = true) {
    isOpen = true;
    host.classList.add("open");
    drawer.classList.add("open");
    if (focusSearch) {
      input.focus();
      input.select();
    }
    if (current < 0) navigate({ type: "home" });
  }

  function close() {
    isOpen = false;
    host.classList.remove("open");
    drawer.classList.remove("open");
    hideSuggest();
    if (shadow.activeElement) shadow.activeElement.blur();
  }

  // Alt+R can arrive twice (Chrome's command and our own key listener), so
  // ignore a second toggle that lands right after the first.
  let lastToggle = 0;
  function toggle() {
    const now = Date.now();
    if (now - lastToggle < 300) return;
    lastToggle = now;
    isOpen ? close() : void open();
  }

  // ── History ───────────────────────────────────────────────────────────────

  // Entries: {type: "home"} | {type: "results", q} | {type: "page", id, q?, occ?}
  let stack = [],
    current = -1;

  function navigate(entry) {
    if (current >= 0) stack[current].scroll = view.scrollTop;
    stack = stack.slice(0, current + 1);
    stack.push(entry);
    current = stack.length - 1;
    void render(entry, false);
  }

  function go(delta) {
    const next = current + delta;
    if (next < 0 || next >= stack.length) return;
    stack[current].scroll = view.scrollTop;
    current = next;
    void render(stack[current], true);
  }

  function updateNavButtons() {
    $('[data-act="back"]').disabled = current <= 0;
    $('[data-act="forward"]').disabled = current >= stack.length - 1;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  let marks = [],
    activeMatch = -1;

  // Uses textContent rather than esc() so it still works if a helper is broken.
  function showError(message, err) {
    console.error("[TI4 Rules Drawer]", message, err);
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = `${message}: ${err?.message ?? err}`;
    view.replaceChildren(p);
  }

  async function render(entry, restoring) {
    updateNavButtons();
    hideSuggest();
    matchbar.hidden = true;
    marks = [];

    let rules;
    try {
      if (!rulesPromise) view.innerHTML = `<p class="muted">Loading rules…</p>`;
      rules = await loadRules();
    } catch (err) {
      showError("Couldn't load the rules data", err);
      return;
    }
    if (stack[current] !== entry) return; // user moved on while loading

    try {
      if (entry.type === "home") renderHome(rules);
      else if (entry.type === "results") renderResults(rules, entry.q);
      else if (entry.type === "page") renderPage(rules, entry, restoring);
    } catch (err) {
      showError("Something went wrong showing this view", err);
      return;
    }

    if (entry.type !== "page" || !entry.q)
      view.scrollTop = restoring ? (entry.scroll ?? 0) : 0;
    if (entry.type !== "page") input.value = entry.q ?? input.value;
    // Clicking a result replaces the element that had focus; keep focus in
    // the drawer so keyboard shortcuts (Alt+←, N) keep working.
    if (isOpen && !shadow.activeElement) view.focus({ preventScroll: true });
  }

  function kindLabel(page) {
    return page.subtitle ? `${page.kind} · ${page.subtitle}` : page.kind;
  }

  function renderHome(rules) {
    const recentSearches = settings.recentSearches;
    const recentPages = settings.recentPages
      .map((id) => rules.byId.get(id))
      .filter(Boolean);
    const groups = ["Rules", "Factions", "Components"].map((kind) => {
      const pages = rules.pages.filter((p) => p.kind === kind);
      return `
        <section class="browse">
          <h2>${kind} <span class="muted">${pages.length}</span></h2>
          <ul class="browse-list">
            ${pages.map((p) => `<li><a href="#" data-page="${p.id}">${esc(p.title)}</a></li>`).join("")}
          </ul>
        </section>`;
    });

    view.innerHTML = `
      ${
        recentSearches.length
          ? `
        <section class="recent">
          <h2>Recent searches <button class="link" data-act="clear-recent">clear</button></h2>
          <div class="chips">${recentSearches.map((q) => `<button class="chip" data-search="${esc(q)}">${esc(q)}</button>`).join("")}</div>
        </section>`
          : ""
      }
      ${
        recentPages.length
          ? `
        <section class="recent">
          <h2>Recently viewed</h2>
          <div class="chips">${recentPages.map((p) => `<button class="chip" data-page="${p.id}">${esc(p.title)}</button>`).join("")}</div>
        </section>`
          : ""
      }
      ${groups.join("")}
      <footer class="credits">
        <p><span class="ruling">Highlighted like this</span> = official ruling from Dane, not part of the Living Rules Reference.</p>
        <p>Rules from <a href="${rules.source.repo}" target="_blank" rel="noopener">tirules-search</a> (${esc(rules.source.commit)}),
        a fork of <a href="https://github.com/dangothemango/tirules" target="_blank" rel="noopener">dangothemango/tirules</a>.
        <i>Twilight Imperium</i> © Fantasy Flight Games. Not affiliated.</p>
      </footer>`;
  }

  function renderResults(rules, q) {
    const results = search(rules, q);
    const total = results.reduce((n, r) => n + r.matches.length, 0);
    if (!results.length) {
      view.innerHTML = `<h2 class="results-head">No results for “${esc(q)}”</h2>
        <p class="muted">Try fewer words, or a different spelling.</p>`;
      return;
    }

    const snippet = (r, i) => {
      const section = sectionAt(r.page, r.matches[i][0]);
      return `<button class="snippet" data-page="${r.page.id}" data-occ="${i}">
          ${section ? `<span class="section">${esc(section)}</span>` : ""}
          <span class="snip-text">${snippetHtml(r.page.text, r.matches[i])}</span>
        </button>`;
    };

    view.innerHTML = `
      <h2 class="results-head">“${esc(q)}” <span class="muted">· ${total} match${total === 1 ? "" : "es"} on ${results.length} page${results.length === 1 ? "" : "s"}</span></h2>
      <ol class="results">
        ${results
          .map(
            (r) => `
          <li class="result">
            <button class="result-title" data-page="${r.page.id}" data-occ="0">
              <span class="title">${esc(r.page.title)}</span>
              <span class="meta">${esc(kindLabel(r.page))} · ${r.matches.length} match${r.matches.length === 1 ? "" : "es"}</span>
            </button>
            ${r.matches
              .slice(0, SNIPPETS_SHOWN)
              .map((_, i) => snippet(r, i))
              .join("")}
            ${
              r.matches.length > SNIPPETS_SHOWN
                ? `
              <div class="more-snippets" hidden>${r.matches
                .slice(SNIPPETS_SHOWN)
                .map((_, i) => snippet(r, i + SNIPPETS_SHOWN))
                .join("")}</div>
              <button class="link more" data-act="more">Show ${r.matches.length - SNIPPETS_SHOWN} more on this page</button>`
                : ""
            }
          </li>`,
          )
          .join("")}
      </ol>`;
  }

  function renderPage(rules, entry, restoring) {
    const page = rules.byId.get(entry.id);
    if (!page) {
      view.innerHTML = `<p class="error">Page not found: ${esc(entry.id)}</p>`;
      return;
    }
    view.innerHTML = `<div class="page"></div>`;
    const el = view.firstElementChild;
    el.innerHTML = page.html;
    for (const a of el.querySelectorAll("a[href^='http']")) {
      a.target = "_blank";
      a.rel = "noopener";
    }

    settings.recentPages = [
      page.id,
      ...settings.recentPages.filter((id) => id !== page.id),
    ].slice(0, MAX_RECENT_PAGES);
    saveSettings();

    const re = entry.q && queryRegex(entry.q);
    if (!re) return;
    marks = highlight(el, re);
    if (!marks.length) return;
    matchbar.hidden = false;
    if (restoring && entry.scroll != null) {
      setActiveMatch(entry.occ ?? 0, false);
      view.scrollTop = entry.scroll;
    } else {
      setActiveMatch(entry.occ ?? 0, true);
    }
  }

  function setActiveMatch(i, scroll = true) {
    if (!marks.length) return;
    i = (i + marks.length) % marks.length;
    for (const m of marks[activeMatch] ?? []) m.classList.remove("current");
    activeMatch = i;
    for (const m of marks[i]) m.classList.add("current");
    const entry = stack[current];
    if (entry?.type === "page") entry.occ = i;
    $(".matchcount").innerHTML =
      `Match <b>${i + 1}</b> of ${marks.length} for “${esc(entry?.q ?? "")}”`;
    if (scroll) {
      // Scroll manually; scrollIntoView could also scroll TI Assistant's page.
      const r = marks[i][0].getBoundingClientRect(),
        c = view.getBoundingClientRect();
      view.scrollTo({
        top: view.scrollTop + r.top - c.top - c.height / 3,
        behavior: "smooth",
      });
    }
  }

  function clearHighlights() {
    const entry = stack[current];
    if (entry?.type !== "page" || !entry.q) return;
    const scroll = view.scrollTop;
    delete entry.q;
    delete entry.occ;
    void render(entry, true).then(() => (view.scrollTop = scroll));
  }

  // ── Search box & title suggestions ────────────────────────────────────────

  let suggestions = [],
    suggestIndex = -1;

  function runSearch(q) {
    q = q.trim();
    if (!q) return;
    settings.recentSearches = [
      q,
      ...settings.recentSearches.filter(
        (s) => s.toLowerCase() !== q.toLowerCase(),
      ),
    ].slice(0, MAX_RECENT_SEARCHES);
    saveSettings();
    input.value = q;
    navigate({ type: "results", q });
    view.focus({ preventScroll: true });
  }

  function hideSuggest() {
    suggestBox.hidden = true;
    suggestions = [];
    suggestIndex = -1;
  }

  function renderSuggest() {
    if (!suggestions.length) return hideSuggest();
    suggestBox.hidden = false;
    suggestBox.innerHTML =
      `<div class="suggest-hint">Jump to page · Enter searches all text</div>` +
      suggestions
        .map(
          (
            p,
            i,
          ) => `<button class="suggestion${i === suggestIndex ? " active" : ""}" data-page="${p.id}" role="option">
            <span>${esc(p.title)}</span><span class="muted">${esc(kindLabel(p))}</span></button>`,
        )
        .join("");
  }

  input.addEventListener("input", async () => {
    const rules = await loadRules();
    suggestions = suggestTitles(rules, input.value);
    suggestIndex = -1;
    renderSuggest();
  });

  input.addEventListener("keydown", (e) => {
    if (suggestBox.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = suggestions.length + 1; // +1 for "no selection" (full-text search)
      suggestIndex =
        ((suggestIndex + 1 + (e.key === "ArrowDown" ? 1 : -1) + n) % n) - 1;
      renderSuggest();
    }
  });

  input.addEventListener("blur", () =>
    setTimeout(
      () => !shadow.activeElement?.closest?.(".suggest") && hideSuggest(),
      150,
    ),
  );

  $(".search").addEventListener("submit", (e) => {
    e.preventDefault();
    if (suggestIndex >= 0 && suggestions[suggestIndex]) {
      const id = suggestions[suggestIndex].id;
      hideSuggest();
      navigate({ type: "page", id });
      view.focus({ preventScroll: true });
    } else {
      runSearch(input.value);
    }
  });

  // ── Clicks ────────────────────────────────────────────────────────────────

  shadow.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;

    if (t.classList.contains("tab")) return open();

    const act = t.dataset.act;
    if (act) {
      e.preventDefault();
      switch (act) {
        case "back":
          return go(-1);
        case "forward":
          return go(1);
        case "home":
          return navigate({ type: "home" });
        case "close":
          return close();
        case "smaller":
        case "larger":
          settings.fontSize = Math.min(
            FONT_MAX,
            Math.max(FONT_MIN, settings.fontSize + (act === "larger" ? 2 : -2)),
          );
          applySettings();
          return saveSettings();
        case "prev-match":
          return setActiveMatch(activeMatch - 1);
        case "next-match":
          return setActiveMatch(activeMatch + 1);
        case "clear-match":
          return clearHighlights();
        case "clear-recent":
          settings.recentSearches = [];
          saveSettings();
          return render(stack[current], true);
        case "more":
          t.previousElementSibling.hidden = false;
          return t.remove();
      }
    }

    if (t.dataset.search) {
      e.preventDefault();
      return runSearch(t.dataset.search);
    }

    if (t.dataset.page) {
      e.preventDefault();
      hideSuggest();
      const q = t.dataset.occ != null ? stack[current]?.q : undefined;
      return navigate({
        type: "page",
        id: t.dataset.page,
        q,
        occ: Number(t.dataset.occ ?? 0),
      });
    }

    // Cross-links inside rule pages look like href="/R_movement".
    if (t.nodeName !== "A") return;
    const href = t.getAttribute("href") ?? "";
    const link = href.match(/^\/([RFC]_\w+)\/?$/);
    if (link) {
      e.preventDefault();
      return navigate({ type: "page", id: link[1] });
    }
    if (href === "/" || href === "") {
      e.preventDefault();
      return navigate({ type: "home" });
    }
  });

  // ── Keyboard ──────────────────────────────────────────────────────────────

  const isEditable = (el) =>
    el &&
    (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.nodeName));

  // Alt/Option shortcuts work wherever focus is. They match on e.code (the
  // physical key) because on a Mac Option+R types "®", so e.key isn't "r".
  function altShortcut(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return false;
    if (e.code === "KeyR") toggle();
    else if (!isOpen) return false;
    else if (e.code === "KeyH") {
      navigate({ type: "home" });
      view.focus({ preventScroll: true });
    } else if (e.code === "ArrowLeft") go(-1);
    else if (e.code === "ArrowRight") go(1);
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  // Keys pressed on TI Assistant itself.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.composedPath().includes(host)) return;
      if (altShortcut(e)) return;
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isEditable(e.target)
      ) {
        e.preventDefault();
        void open();
      } else if (e.key === "Escape" && isOpen && !isEditable(e.target)) {
        close();
      }
    },
    true,
  );

  // Keys pressed inside the drawer. We stop them here so TI Assistant's own
  // shortcuts don't fire while someone is typing a search.
  shadow.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (altShortcut(e)) return;
    const typing = isEditable(shadow.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      if (!suggestBox.hidden) hideSuggest();
      else close();
    } else if (!typing && e.key === "/") {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (!typing && (e.key === "n" || e.key === "N") && marks.length) {
      e.preventDefault();
      setActiveMatch(activeMatch + (e.shiftKey ? -1 : 1));
    } else if (!typing && e.key === "Backspace") {
      e.preventDefault();
      go(-1);
    }
  });
  for (const type of ["keyup", "keypress"])
    shadow.addEventListener(type, (e) => e.stopPropagation());

  // ── Resize ────────────────────────────────────────────────────────────────

  const handle = $(".resize");
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drawer.classList.add("resizing");
    const move = (ev) => {
      settings.width = Math.min(
        WIDTH_MAX,
        Math.max(WIDTH_MIN, ((innerWidth - ev.clientX) / innerWidth) * 100),
      );
      applySettings();
    };
    const up = () => {
      drawer.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      saveSettings();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  ext.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "toggle") toggle();
  });

  void loadSettings().then(() => {
    applySettings();
    // Appended to <html> rather than <body> so React re-renders of the body
    // in TI Assistant can't remove it.
    document.documentElement.append(host);
  });
})();
