/* Reading Coach: trend check across finished papers. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/1999/xhtml";
  let io, settings, rows = [], guess = "", ai = "", busy = false, err = "", saved = "", app;
  function h(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? k : String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    return el;
  }
  const btn = (label, fn, cls, dis, id) => h("button", { id: id || null, class: "btn " + (cls || ""), disabled: !!dis, on: { click: fn } }, label);

  async function compare() {
    busy = true; err = ""; saved = ""; render();
    try { ai = (await io.llm(RC.trendMessages(rows, guess, settings))).trim(); }
    catch (e) { err = e.message; }
    busy = false; render();
  }
  async function save() {
    try { saved = await io.saveTrend(rows, guess, ai); render(); }
    catch (e) { err = e.message; render(); }
  }
  async function rebuild() {
    try { const n = await io.rebuildTable(); err = ""; saved = ""; render(); app.prepend(h("p", { class: "fb right" }, "Reading table rebuilt with " + n + (n === 1 ? " paper." : " papers."))); }
    catch (e) { err = e.message; render(); }
  }

  function render() {
    const years = Array.from(new Set(rows.map(r => r.year || "n.d."))).sort();
    const card = h("section", { class: "card" },
      h("div", { class: "between" }, h("h1", { class: "title" }, "Trend check"), h("span", { class: "small" }, rows.length + (rows.length === 1 ? " paper read" : " papers read"))),
      settings.position ? h("p", { class: "fb plain" }, h("b", {}, "Your position: "), settings.position) : h("p", { class: "note" }, "Add your research position in Zotero Settings → Reading Coach so the comparison has something to test."),
      rows.length ? h("p", { class: "small" }, "By year: " + years.map(y => y + " (" + rows.filter(r => (r.year || "n.d.") === y).length + ")").join(", ")) : null,
      h("label", { class: "f" }, "First, your own reading: where is the field moving, based on what you've read?",
        h("textarea", { id: "guess", style: "min-height:96px", value: guess, placeholder: "Two or three sentences.", on: { input: e => { guess = e.target.value; const b = document.getElementById("cmp"); if (b) b.disabled = busy || rows.length < 3 || !guess.trim(); } } })),
      h("div", { class: "row" },
        btn(busy ? "Comparing…" : "Compare with my notes", compare, "primary", busy || rows.length < 3 || !guess.trim(), "cmp"),
        rows.length < 3 ? h("span", { class: "small" }, "Finish at least 3 papers first.") : h("span", { class: "small" }, "The model sees only your takeaways, stances and evidence types.")),
      err ? h("p", { class: "fb error" }, err) : null,
      ai ? [h("div", { class: "out" }, ai), h("div", { class: "row" }, saved ? h("span", { class: "fb right" }, "Saved to your vault.") : btn("Save to Obsidian", save, "primary"), saved ? btn("Open in Obsidian", () => io.openInObsidian(saved)) : null)] : null);
    const tools = h("section", { class: "card" }, h("p", { class: "eyebrow" }, "Reading table"),
      h("p", { class: "small" }, "The table in your vault is rebuilt each time you finish a paper. Rebuild it by hand if you've edited notes in Obsidian."),
      h("div", { class: "row" }, btn("Rebuild the table", rebuild), btn("Open the table in Obsidian", () => { try { io.openInObsidian(io.tablePath()); } catch (e) { err = e.message; render(); } }, "quiet")));
    app.replaceChildren(card, tools);
  }
  async function start() {
    app = document.getElementById("app");
    const a = window.arguments && window.arguments[0];
    io = (a && a.wrappedJSObject) || a || window.__readingCoachIO;
    if (!io) { app.textContent = "Open this from Zotero's Tools menu."; return; }
    settings = io.settings();
    try { rows = RC.buildTable(await io.listNotes(), settings).rows; }
    catch (e) { err = e.message; }
    render();
  }
  window.addEventListener("load", start);
})();
