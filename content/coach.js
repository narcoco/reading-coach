/* Reading Coach: the step-by-step reading window. Built with DOM calls because XHTML rejects loose HTML. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/1999/xhtml";
  let io, paper, settings, rec, app, saveTimer, notesCache = null, pane = false, clipsOpen = true, resizeObs = null;
  const busy = { questions: false, check: false, chat: false, save: false, predict: false, preview: false, ask: false };
  let askOpen = true;
  let started = 0, ticker = null, runID = 0;
  function startClock() {
    started = Date.now();
    clearInterval(ticker);
    ticker = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      document.querySelectorAll(".elapsed").forEach(el => { el.textContent = s + " s"; });
      if (!busy.questions && !busy.check && !busy.chat && !busy.predict && !busy.preview && !busy.ask) clearInterval(ticker);
    }, 1000);
  }
  const elapsed = () => h("span", { class: "elapsed small" }, Math.round((Date.now() - started) / 1000) + " s");
  const err = {};

  function h(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? k : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const btn = (label, fn, cls, disabled) => h("button", { class: "btn " + (cls || ""), disabled: !!disabled, on: { click: fn } }, label);
  const fbox = (text, cls) => h("p", { class: "fb " + cls, role: "status" }, text);

  function blank() {
    return { step: "guess", guess: "", guessMark: "", questions: [], checked: false, figure: "", limit: "", turns: [], takeaway: "", stance: "", evidence: "", linkTo: "", linkNote: "", savedPath: "", clips: [], predict: [], focus: null, rq: "", glance: null, preview: null, aiNoteID: 0, includeAI: true, asks: [] };
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { io.saveDraft(paper.key, rec).catch(() => {}); }, 500);
  }
  const ORDER = RC.STEPS.map(s => s[0]);
  const visited = s => ORDER.indexOf(s) <= ORDER.indexOf(rec.maxStep || rec.step);
  function go(step) {
    rec.step = step;
    if (ORDER.indexOf(step) > ORDER.indexOf(rec.maxStep || "guess")) rec.maxStep = step;
    persist();
    render();
    window.scrollTo(0, 0);
    if (pane && io.scrollIntoView) io.scrollIntoView();
    if (step === "close" && !rec.glanceFilled) { rec.glance = RC.prefillGlance(rec); rec.glanceFilled = true; persist(); render(); }
    if (step === "abstract" && aiNote() && !rec.preview && !busy.preview) makePreview();
  }

  /* ---------- Model calls ---------- */
  async function makeQuestions() {
    const my = ++runID;
    busy.questions = true; err.questions = ""; startClock(); render();
    try {
      const reply = await io.llm(RC.questionsMessages(paper, settings, rec.focus));
      if (my !== runID) return;
      const parsed = RC.parseJSON(reply);
      rec.questions = RC.cleanQuestions(parsed);
      rec.rq = RC.oneLine(parsed && parsed.research_question) || rec.rq;
      rec.checked = false;
      persist();
    } catch (e) { if (my !== runID) return; err.questions = e.message; }
    busy.questions = false; render();
  }
  /* ---------- Zotero One's note: preview and detailed reading ---------- */
  function aiNote() {
    const list = paper.aiNotes || [];
    return list.find(n => n.id === rec.aiNoteID) || list[0] || null;
  }
  async function makePreview() {
    const n = aiNote();
    if (!n) return;
    busy.preview = true; err.preview = ""; startClock(); render();
    try {
      const md = RC.htmlToMarkdown(n.html);
      const byHead = RC.glanceFromHeadings(md);
      if (byHead.found >= 3) { rec.preview = byHead.fields; rec.previewFrom = "headings"; }
      else {
        const r = RC.parseJSON(await io.llm(RC.glanceMessages(md, settings)));
        rec.preview = { rq: RC.oneLine(r.rq), theory: RC.oneLine(r.theory), methods: RC.oneLine(r.methods), findings: RC.oneLine(r.findings), limits: RC.oneLine(r.limits) };
        rec.previewFrom = "ai";
      }
      rec.previewNote = n.id;
      persist();
    } catch (e) { err.preview = e.message; }
    busy.preview = false; render();
  }
  function noteChooser(onChange) {
    const list = paper.aiNotes || [];
    if (list.length < 2) return list.length ? h("span", { class: "small" }, "From your note: " + list[0].title) : null;
    return h("label", { class: "row small" }, "From your note:",
      h("select", { "aria-label": "Which note", on: { change: e => { rec.aiNoteID = Number(e.target.value); persist(); if (onChange) onChange(); else render(); } } },
        list.map(n => h("option", { value: n.id, selected: aiNote() && aiNote().id === n.id ? "selected" : null }, n.title + " (" + Math.round(n.chars / 1000) + "k)"))));
  }
  function previewBox() {
    if (!(paper.aiNotes || []).length) return null;
    const pv = rec.preview;
    return h("div", { class: "q preview" },
      h("div", { class: "between" }, h("p", { class: "eyebrow" }, "Paper at a glance · from Zotero One"), noteChooser(() => { rec.preview = null; makePreview(); })),
      busy.preview ? h("p", { class: "busy" }, "Reading your Zotero One note… ", elapsed())
      : err.preview ? [h("p", { class: "fb error" }, err.preview), btn("Try again", makePreview, "small")]
      : pv ? [
          h("dl", { class: "glance" }, RC.GLANCE.filter(([k]) => pv[k]).map(([k, label]) => [h("dt", {}, label), h("dd", {}, String(pv[k]).replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/^\s*[-*] /gm, "• "))])),
          h("p", { class: "small" }, (rec.previewFrom === "ai" ? "Condensed from your note by the model. " : "Taken from your note's headings. ") + "These fields pre-fill your note's Paper at a glance, for you to edit when you save."),
          btn("Rebuild the preview", () => { rec.preview = null; makePreview(); }, "quiet small")]
      : btn("Preview the paper at a glance", makePreview, "small"));
  }

  /* ---------- Ask the paper ---------- */
  async function askPaper(question) {
    question = RC.oneLine(question);
    if (!question || busy.ask) return;
    const a = { id: Date.now().toString(36), q: question, answer: "", where: "", page: 0, quote: "", found: true, section: "" };
    rec.asks.unshift(a);
    busy.ask = true; err.ask = ""; askOpen = true; startClock(); render();
    try {
      const r = RC.parseJSON(await io.llm(RC.askMessages(paper, settings, question)));
      Object.assign(a, { answer: RC.oneLine(r.answer), where: RC.oneLine(r.where), page: Number(r.page) || 0, quote: RC.oneLine(r.quote), found: r.found !== false });
      if (!a.answer) throw new Error("The model didn't return an answer.");
      persist();
    } catch (e) { err.ask = e.message; rec.asks = rec.asks.filter(x => x !== a); }
    busy.ask = false; render();
  }
  function askBox() {
    const chips = (settings.askChips && settings.askChips.length ? settings.askChips : RC.ASK_DEFAULTS);
    const send = () => { const el = document.getElementById("ask"); if (el && el.value.trim()) { const v = el.value; el.value = ""; askPaper(v); } };
    return h("details", { class: "clips ask", open: askOpen ? "open" : null, on: { toggle: e => { askOpen = e.target.open; } } },
      h("summary", {}, "Ask the paper" + (rec.asks.length ? " (" + rec.asks.length + ")" : "")),
      h("div", { class: "chiprow" }, chips.map(c => h("button", { class: "pick", disabled: busy.ask ? "disabled" : null, on: { click: () => askPaper(c) } }, c))),
      h("div", { class: "row paste" },
        h("input", { type: "text", id: "ask", placeholder: "Ask anything, e.g. How long was the intervention?", "aria-label": "Your question", on: { keydown: e => { if (e.key === "Enter") { e.preventDefault(); send(); } } } }),
        btn(busy.ask ? "Asking…" : "Ask", send, "small primary", busy.ask)),
      busy.ask ? h("p", { class: "busy" }, "Looking in the paper… ", elapsed()) : null,
      err.ask ? h("p", { class: "fb error" }, err.ask) : null,
      rec.asks.filter(a => a.answer).map(a => h("div", { class: "answer" },
        h("p", {}, h("b", {}, a.q)),
        h("p", { class: a.found ? "" : "small" }, a.answer),
        whereRow(a),
        h("div", { class: "row" },
          h("select", { "aria-label": "Where this goes in your note", on: { change: e => { a.section = e.target.value; persist(); } } },
            [h("option", { value: "" }, "Note: My questions"), h("option", { value: "skip", selected: a.section === "skip" ? "selected" : null }, "Leave out of the note")]
              .concat(RC.GLANCE.map(([k, label]) => h("option", { value: k, selected: a.section === k ? "selected" : null }, "Note: " + label)))),
          btn("Remove", () => { rec.asks = rec.asks.filter(x => x !== a); persist(); render(); }, "quiet small")))));
  }
  function extras() { return [askBox(), clipsBox()]; }

  async function suggestPrompts() {
    busy.predict = true; err.predict = ""; startClock(); render();
    try {
      rec.predict = RC.cleanPrompts(RC.parseJSON(await io.llm(RC.predictMessages(paper, settings))));
      persist();
    } catch (e) { err.predict = e.message; }
    busy.predict = false; render();
  }
  const guessed = () => !!(rec.guess.trim() || (rec.predict || []).some(p => p.a.trim()));
  async function checkAnswers() {
    busy.check = true; err.check = ""; startClock(); render();
    try {
      const res = RC.cleanResults(RC.parseJSON(await io.llm(RC.checkMessages(paper, settings, rec.questions))), rec.questions.length);
      res.forEach((r, i) => Object.assign(rec.questions[i], { verdict: r.verdict, feedback: r.feedback, readPage: r.page || 0, readQuote: r.quote || "" }));
      rec.checked = true;
      persist();
    } catch (e) { err.check = e.message; }
    busy.check = false; render();
  }
  async function chat(text) {
    if (text) rec.turns.push({ role: "user", content: text });
    busy.chat = true; err.chat = ""; startClock(); render();
    try {
      const reply = await io.llm(RC.discussMessages(paper, settings, rec, rec.turns));
      rec.turns.push({ role: "assistant", content: reply.trim() });
      persist();
    } catch (e) {
      err.chat = e.message;
      if (text) rec.turns.pop();
    }
    busy.chat = false; render();
    const c = document.getElementById("chat");
    if (c) c.scrollTop = c.scrollHeight;
    const box = document.getElementById("say");
    if (box && !err.chat) box.focus();
  }
  async function save(mode) {
    busy.save = true; err.save = ""; render();
    try {
      rec.finishedAt = Date.now();
      const n = aiNote();
      rec.aiMarkdown = rec.includeAI && n ? RC.htmlToMarkdown(n.html) : "";
      rec.aiTitle = rec.includeAI && n ? n.title : "";
      const r = await io.savePaperNote(paper, rec, mode);
      rec.savedPath = r.path; rec.savedName = r.name; rec.tableCount = r.count;
      rec.step = "saved";
      await io.clearDraft(paper.key);
    } catch (e) { err.save = e.message; }
    busy.save = false; render();
  }

  /* ---------- Views ---------- */
  function header() {
    return h("div", {},
      h("p", { class: "title" }, paper.title || "Untitled"),
      h("p", { class: "meta" }, [(paper.authors || []).slice(0, 4).join(", ") + ((paper.authors || []).length > 4 ? " et al." : ""), paper.year, paper.venue].filter(Boolean).join(" · ")));
  }
  function stepsBar() {
    return h("nav", { class: "steps", "aria-label": "Steps" }, RC.STEPS.map(([k, label], i) => {
      const cur = rec.step === k;
      return h("button", { class: cur ? "cur" : visited(k) ? "done" : "open", "aria-current": cur ? "step" : null, on: { click: () => { if (!cur) go(k); } } }, (i + 1) + ". " + label);
    }).concat(pane || !paper.pdfID ? [] : [h("button", { class: "open pdf", on: { click: openPDF } }, "Open the PDF")]));
  }
  async function openPDF() {
    clearTimeout(saveTimer);
    try {
      await io.saveDraft(paper.key, rec);
      await io.openReader();
      window.close();
    } catch (e) { err.reader = e.message; render(); }
  }
  function nav(back, nextLabel, next, nextOK, extra) {
    return h("div", { class: "between" },
      back ? btn("Back", () => go(back)) : h("span"),
      h("span", { class: "row" }, extra || null, next ? btn(nextLabel, next, "primary", !nextOK) : null));
  }
  function textField(label, key, placeholder, onChange) {
    return h("label", { class: "f" }, label,
      h("textarea", { id: "f-" + key, placeholder: placeholder || "", value: rec[key] || "", on: { input: e => { rec[key] = e.target.value; persist(); if (onChange) onChange(); } } }));
  }
  function liveEnable(id, test) { const b = document.getElementById(id); if (b) b.disabled = !test(); }

  function promptsBlock() {
    const canSuggest = paper.abstract || paper.fulltext;
    if (busy.predict) return h("p", { class: "busy" }, "Reading the abstract for you, without showing it… ", elapsed());
    if (rec.predict.length) return h("div", { class: "q" },
      h("p", { class: "eyebrow" }, "Questions to guide your guess"),
      rec.predict.map((p, i) => h("label", { class: "f" }, p.q,
        h("input", { type: "text", id: "pred-" + i, value: p.a, placeholder: "Your guess", on: { input: e => { p.a = e.target.value; persist(); liveEnable("next-guess", guessed); } } }))),
      h("div", { class: "row" }, btn("Suggest different questions", suggestPrompts, "quiet small")));
    if (!canSuggest) return null;
    return h("div", { class: "row" }, btn("Suggest 1 to 3 questions to guide my guess", suggestPrompts, "small"), err.predict ? h("span", { class: "fb error" }, err.predict) : null);
  }
  function sourceLine() {
    const s = RC.sourceInfo(paper, settings);
    return h("p", { class: s.kind === "full" ? "small" : "note" }, s.text);
  }
  function viewGuess() {
    return h("section", { class: "card" }, header(),
      textField("From the title alone, what do you expect they found?", "guess", "One line is enough. A guess is fine.", () => liveEnable("next-guess", guessed)),
      promptsBlock(),
      h("p", { class: "small" }, "The abstract stays hidden until you've guessed. Guessing first makes the real finding stick. The suggested questions come from the abstract but don't give its findings away."),
      sourceLine(),
      h("div", { class: "row", style: "justify-content:flex-end" }, h("button", { id: "next-guess", class: "btn primary", on: { click: () => go("abstract") } }, "Show the abstract")));
  }
  function viewAbstract() {
    const marks = [["yes", "Yes"], ["partly", "Partly"], ["no", "No"]];
    return h("section", { class: "card" }, header(),
      rec.guess.trim() || rec.predict.some(p => p.a.trim()) ? h("div", { class: "fb plain" }, rec.guess.trim() ? h("p", {}, h("b", {}, "You guessed: "), rec.guess) : null,
        rec.predict.filter(p => p.a.trim()).map(p => h("p", {}, h("b", {}, p.q + " "), p.a))) : null,
      h("div", {}, h("p", { class: "eyebrow" }, "Abstract"),
        paper.abstract ? [h("p", { class: "reading" }, abstractSentences()), h("p", { class: "small" }, "Click a sentence, or drag it into My clips, to keep what the paper actually says.")]
          : h("p", { class: "small" }, "Zotero has no abstract for this paper. Open the PDF and read its abstract now.")),
      h("div", { class: "row" }, h("span", {}, "Was your guess close?"),
        h("span", { class: "seg", role: "group" }, marks.map(([v, t]) => h("button", { "aria-pressed": rec.guessMark === v ? "true" : "false", on: { click: () => { rec.guessMark = v; persist(); render(); } } }, t)))),
      h("div", { class: "between" }, btn("Back", () => go("guess")),
        h("span", { class: "row" },
          btn("Skip this paper", () => decide("rc-skipped"), "quiet"),
          btn("Keep for later", () => decide("rc-later")),
          btn(pane ? "Study it now" : "Study it with the PDF", studyNow, "primary"))),
      err.reader ? h("p", { class: "note" }, err.reader) : null,
      previewBox(),
      ...extras());
  }
  async function decide(tag) {
    try { await io.addTag(tag); } catch (e) { /* tagging is a convenience */ }
    rec.guessDecision = tag;
    await io.saveDraft(paper.key, rec).catch(() => {});
    if (pane) { err.reader = tag === "rc-skipped" ? "Tagged rc-skipped in Zotero." : "Tagged rc-later in Zotero."; render(); }
    else window.close();
  }
  async function studyNow() {
    if (pane) { go("questions"); return; }
    rec.step = "questions";
    if (ORDER.indexOf("questions") > ORDER.indexOf(rec.maxStep || "guess")) rec.maxStep = "questions";
    clearTimeout(saveTimer);
    try {
      await io.saveDraft(paper.key, rec);
      await io.openReader();
      window.close();
    } catch (e) {
      err.reader = (e && e.message ? e.message + " " : "") + "Carrying on in this window instead.";
      go("questions");
    }
  }

  /* ---------- Clips ---------- */
  const norm = t => RC.oneLine(t).toLowerCase();
  function addClip(text, from, page) {
    text = RC.oneLine(text).slice(0, 1500);
    if (!text) return false;
    if (rec.clips.some(c => norm(c.text) === norm(text))) return false;
    rec.clips.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, from, page: page || "", step: rec.step, note: "" });
    clipsOpen = true;
    persist();
    return true;
  }
  function abstractSentences() {
    const kept = new Set(rec.clips.map(c => norm(c.text)));
    return RC.split(paper.abstract).map(s => [h("span", {
      class: "sent" + (kept.has(norm(s)) ? " kept" : ""), draggable: "true", tabindex: "0", role: "button",
      title: kept.has(norm(s)) ? "In My clips. Click to remove." : "Click or drag to keep this sentence",
      on: {
        click: () => toggleSentence(s),
        keydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSentence(s); } },
        dragstart: e => { e.dataTransfer.setData("text/plain", s); e.dataTransfer.setData("application/x-readingcoach", "abstract"); e.dataTransfer.effectAllowed = "copy"; }
      }
    }, s), " "]);
  }
  function toggleSentence(s) {
    const i = rec.clips.findIndex(c => norm(c.text) === norm(s));
    if (i >= 0) { rec.clips.splice(i, 1); persist(); } else addClip(s, "abstract");
    render();
  }
  function onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("over");
    const dt = e.dataTransfer;
    let added = 0;
    const ann = dt.getData("zotero/annotation");
    if (ann) {
      try {
        const list = JSON.parse(ann);
        (Array.isArray(list) ? list : [list]).forEach(a => { if (addClip(a.text || a.comment || "", "pdf", a.pageLabel)) added++; });
      } catch (x) { /* fall back to plain text */ }
    }
    if (!added) {
      const t = dt.getData("text/plain");
      const src = dt.getData("application/x-readingcoach") === "abstract" ? "abstract" : (pane ? "pdf" : "drop");
      if (t) addClip(t, src);
    }
    render();
  }
  function clipsBox() {
    const n = rec.clips.length;
    const box = h("details", { class: "clips", open: clipsOpen ? "open" : null, on: { toggle: e => { clipsOpen = e.target.open; } } },
      h("summary", {}, "My clips" + (n ? " (" + n + ")" : "")),
      h("div", { class: "drop", on: { dragover: e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; e.currentTarget.classList.add("over"); }, dragleave: e => e.currentTarget.classList.remove("over"), drop: onDrop } },
        n ? null : h("p", { class: "small" }, pane ? "Drag text or highlights here from the PDF, or paste below." : "Drag sentences here, or click them in the abstract."),
        rec.clips.map((c, i) => h("div", { class: "clip" },
          h("p", { class: "quote" }, c.text),
          h("div", { class: "between" }, h("span", { class: "small" }, RC.clipSource(c)), btn("Remove", () => { rec.clips.splice(i, 1); persist(); render(); }, "quiet small")),
          h("div", { class: "row clipmeta" },
            h("select", { "aria-label": "Section in your note", on: { change: e => { c.section = e.target.value; persist(); } } },
              [h("option", { value: "" }, "Section: none")].concat(RC.GLANCE.map(([k, label]) => h("option", { value: k, selected: c.section === k ? "selected" : null }, label)))),
            h("input", { type: "text", "aria-label": "Your note on this clip", placeholder: "Why it matters (optional)", value: c.note, on: { input: e => { c.note = e.target.value; persist(); } } }))))),
      h("div", { class: "row paste" },
        h("input", { type: "text", id: "paste", placeholder: "Paste a passage from the PDF", "aria-label": "Paste a passage", on: { keydown: e => { if (e.key === "Enter") { e.preventDefault(); pasteClip(); } } } }),
        btn("Add", pasteClip, "small")));
    return box;
  }
  function pasteClip() {
    const el = document.getElementById("paste");
    if (el && el.value.trim() && addClip(el.value, "paste")) render();
    else if (el) el.value = "";
  }
  function viewQuestions() {
    const parts = [header()];
    if (err.reader) parts.push(h("p", { class: "note" }, err.reader));
    parts.push(sourceLine());
    if (busy.questions) parts.push(
      h("p", { class: "busy" }, "Writing three questions about this paper… ", elapsed()),
      h("p", { class: "small" }, "Your answer boxes appear when the questions arrive. Long papers can take up to a minute."),
      h("div", { class: "row" }, btn("Stop waiting", () => { runID++; busy.questions = false; err.questions = "Stopped. Try again, or switch to a faster model in Zotero Settings → Reading Coach."; render(); }, "quiet")));
    else if (err.questions) parts.push(fbox(err.questions, "error"), h("div", { class: "row" }, btn("Try again", makeQuestions, "primary"), btn("Open settings", () => io.openPrefs())));
    else if (!rec.questions.length) parts.push(focusPicker());
    else {
      parts.push(h("p", { class: "small" }, rec.checked ? "Read the feedback, then go back to the parts of the paper it points to." : "Answer from what you know or a quick look at the paper. Don't open a summary yet."));
      rec.questions.forEach((q, i) => {
        parts.push(h("div", { class: "q" },
          h("b", {}, q.focus ? h("span", { class: "chip focus" }, RC.FOCUS[q.focus][0]) : null, " ", (i + 1) + ". " + q.q),
          h("textarea", { id: "ans-" + i, "aria-label": "Your answer to question " + (i + 1), readonly: rec.checked ? "readonly" : null, value: q.mine, placeholder: "Your answer", on: { input: e => { q.mine = e.target.value; persist(); liveEnable("check", () => rec.questions.every(x => x.mine.trim())); } } }),
          !rec.checked && (q.quote || q.page) ? (q.showWhere ? h("div", { class: "fb plain" }, whereRow(q)) : btn("Show me where", () => { q.showWhere = true; persist(); render(); }, "quiet small")) : null,
          rec.checked ? [
            h("p", { class: "fb " + q.verdict }, h("span", { class: "chip " + q.verdict }, q.verdict), " ", q.feedback),
            h("div", { class: "fb plain" }, h("p", {}, h("b", {}, "In the paper: "), q.answer), whereRow(q))
          ] : null));
      });
      if (err.check) parts.push(fbox(err.check, "error"));
      if (!rec.checked) parts.push(h("div", { class: "row" },
        h("button", { id: "check", class: "btn primary", disabled: busy.check || !rec.questions.every(x => x.mine.trim()), on: { click: checkAnswers } }, busy.check ? ["Checking… ", elapsed()] : "Check my answers"),
        btn("Choose a different focus", () => { rec.questions = []; persist(); render(); }, "quiet", busy.check)));
    }
    parts.push(nav("abstract", "Next", () => go("evidence"), true), ...extras());
    return h("section", { class: "card" }, parts);
  }
  function focusPicker() {
    if (!Array.isArray(rec.focus)) rec.focus = (settings.focus && settings.focus.length ? settings.focus : RC.FOCUS_ORDER).filter(k => RC.FOCUS[k]);
    const toggle = k => {
      rec.focus = rec.focus.includes(k) ? rec.focus.filter(x => x !== k) : RC.FOCUS_ORDER.filter(x => x === k || rec.focus.includes(x));
      persist();
      try { io.saveFocus(rec.focus); } catch (e) { /* remembering is a convenience */ }
      render();
    };
    return h("div", { class: "q" },
      h("p", { class: "eyebrow" }, "What should the questions focus on?"),
      h("div", { class: "row" }, RC.FOCUS_ORDER.map(k => h("button", { class: "pick", "aria-pressed": rec.focus.includes(k) ? "true" : "false", on: { click: () => toggle(k) } }, RC.FOCUS[k][0]))),
      h("p", { class: "small" }, "One question for each. Your choice is remembered for the next paper."),
      h("div", { class: "row" }, btn("Write my questions", makeQuestions, "primary", !rec.focus.length)));
  }
  /* Where to look: section, PDF page, an exact quote, and buttons to jump or copy. */
  function whereRow(q) {
    const quote = q.readQuote || q.quote;
    q.loc = RC.locate(paper, quote, q.readPage || q.page) || 0;
    const bits = [q.where, q.loc ? "PDF page " + q.loc : ""].filter(Boolean).join(" · ");
    return [
      quote ? h("p", { class: "quote" }, "\u201c" + quote + "\u201d") : null,
      h("div", { class: "row" },
        bits ? h("span", { class: "small" }, bits) : null,
        q.loc && paper.pdfID ? btn("Go to page " + q.loc, () => { io.goToPage(paper.pdfID, q.loc).catch(e => { err.reader = "Couldn't open the page: " + e.message; render(); }); }, "small") : null,
        quote ? btn("Copy the quote", e => { io.copy(quote); e.target.textContent = "Copied. Use Cmd+F in the PDF"; }, "quiet small") : null)
    ];
  }
  function glanceEditor() {
    if (!rec.glance) rec.glance = RC.prefillGlance(rec);
    return h("div", { class: "q" },
      h("p", { class: "eyebrow" }, "Paper at a glance"),
      h("p", { class: "small" }, "This opens your Obsidian note. It's filled in from your answers and the paper; rewrite it in your own words."),
      RC.GLANCE.map(([k, label]) => h("label", { class: "f" }, label,
        h("textarea", { id: "g-" + k, rows: "2", value: rec.glance[k] || "", on: { input: e => { rec.glance[k] = e.target.value; persist(); } } }))));
  }
  function viewEvidence() {
    const ok = () => rec.figure.trim() && rec.limit.trim();
    return h("section", { class: "card" }, header(),
      textField("Open the figure or table with the main result. What does it show, in one line?", "figure", "e.g. Table 2: prompt group ahead at delayed test, largest gap for low prior knowledge", () => liveEnable("next-ev", ok)),
      textField("What can this study not tell you?", "limit", "e.g. one course, one semester, no follow-up", () => liveEnable("next-ev", ok)),
      h("div", { class: "between" }, btn("Back", () => go("questions")), h("button", { id: "next-ev", class: "btn primary", on: { click: () => go("discuss") } }, "Next")),
      ...extras());
  }
  function viewDiscuss() {
    const parts = [header(), h("p", { class: "small" }, "A sceptical colleague asks you one question at a time. It points you back to the paper instead of explaining. This step is optional.")];
    if (rec.turns.length || busy.chat) {
      parts.push(h("div", { id: "chat", class: "chat" }, rec.turns.map(t => h("div", { class: "msg " + (t.role === "user" ? "me" : "ai") }, h("b", {}, t.role === "user" ? "You" : "Colleague"), t.content)), busy.chat ? h("p", { class: "busy" }, "Thinking… ", elapsed()) : null));
      parts.push(h("label", { class: "f" }, "Your reply",
        h("textarea", { id: "say", placeholder: "Answer in your own words. Ctrl+Enter to send.", on: { keydown: e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }, input: () => liveEnable("send", () => document.getElementById("say").value.trim() && !busy.chat) } })));
      parts.push(h("div", { class: "row" }, h("button", { id: "send", class: "btn primary", disabled: true, on: { click: send } }, "Send"), btn("I'm stuck", () => chat("I'm stuck on this. Explain briefly, then ask me a simpler question."), "", busy.chat)));
    } else {
      parts.push(h("div", { class: "row" }, btn("Start the discussion", () => chat(""), "primary")));
    }
    if (err.chat) parts.push(fbox(err.chat, "error"));
    parts.push(nav("evidence", rec.turns.length ? "Finish and write my takeaway" : "Skip to my takeaway", () => go("close"), !busy.chat), ...extras());
    return h("section", { class: "card" }, parts);
  }
  function send() {
    const box = document.getElementById("say");
    const t = box && box.value.trim();
    if (!t || busy.chat) return;
    chat(t);
  }
  function viewClose() {
    const ok = () => true;
    const opts = (map, cur) => [h("option", { value: "" }, "Choose one")].concat(Object.entries(map).map(([k, v]) => h("option", { value: k, selected: cur === k ? "selected" : null }, v)));
    const sel = (label, key, map) => h("label", { class: "f" }, label, h("select", { id: "f-" + key, on: { change: e => { rec[key] = e.target.value; persist(); liveEnable("save", ok); liveEnable("save-new", ok); } } }, opts(map, rec[key])));
    const notes = (notesCache || []).filter(n => n.fm && n.fm.reading_coach && n.name !== RC.fileName(paper));
    const parts = [header(), glanceEditor(),
      textField("In your own words, what does this paper mean for your work?", "takeaway", "One or two sentences.", () => { liveEnable("save", ok); liveEnable("save-new", ok); }),
      sel("Compared with your position" + (settings.position ? " (" + RC.oneLine(settings.position).slice(0, 80) + ")" : "") + ", this paper…", "stance", RC.STANCE),
      sel("Kind of evidence", "evidence", RC.EVIDENCE)];
    if (notes.length) {
      parts.push(h("label", { class: "f" }, "Which paper you've already read does it connect to?",
        h("select", { id: "f-link", on: { change: e => { rec.linkTo = e.target.value; persist(); } } },
          [h("option", { value: "" }, "None")].concat(notes.map(n => h("option", { value: n.name, selected: rec.linkTo === n.name ? "selected" : null }, (n.fm.title || n.name).slice(0, 90)))))));
      parts.push(h("label", { class: "f" }, "How do they connect?", h("input", { type: "text", id: "f-linknote", value: rec.linkNote, placeholder: "e.g. same effect, but in writing rather than maths", on: { input: e => { rec.linkNote = e.target.value; persist(); } } })));
    } else if (notesCache === null) {
      parts.push(h("p", { class: "small" }, "Loading your earlier notes…"));
    }
    if (err.save) parts.push(fbox(err.save, "error"), h("div", { class: "row" }, btn("Open settings", () => io.openPrefs())));
    if ((paper.aiNotes || []).length) parts.push(h("div", { class: "row" },
      h("label", { class: "row" }, h("input", { type: "checkbox", id: "f-ai", checked: rec.includeAI ? "checked" : null, on: { change: e => { rec.includeAI = e.target.checked; persist(); } } }), "Add the detailed reading from Zotero One (folded, at the end)"),
      noteChooser()));
        if (rec.exists) parts.push(h("p", { class: "note" }, "You already have a note for this paper in Obsidian. Replace it, or save this reading as a separate note."));
    parts.push(h("div", { class: "between" }, btn("Back", () => go("discuss")),
      h("span", { class: "row" },
        rec.exists ? h("button", { id: "save-new", class: "btn", disabled: !ok() || busy.save, on: { click: () => save("new") } }, "Save as a new note") : null,
        h("button", { id: "save", class: "btn primary", disabled: !ok() || busy.save, on: { click: () => save("replace") } }, busy.save ? "Saving…" : rec.exists ? "Replace the note" : "Save to Obsidian"))));
    parts.push(h("p", { class: "small" }, "Saves the note with your clips and flashcards, adds a short note in Zotero, and rebuilds your reading table."), ...extras());
    return h("section", { class: "card" }, parts);
  }
  function viewSaved() {
    return h("section", { class: "card" }, header(),
      fbox("Saved to Obsidian as " + rec.savedName + ". Your reading table now lists " + rec.tableCount + (rec.tableCount === 1 ? " paper." : " papers."), "right"),
      h("p", {}, "Your questions are in the note as flashcards, so they'll come back for review."),
      h("div", { class: "row" }, btn("Open in Obsidian", () => io.openInObsidian(rec.savedPath), "primary"), pane ? btn("Read it again", () => { const key = paper.key; rec = blank(); io.clearDraft(key); render(); }, "quiet") : btn("Close", () => window.close())));
  }

  function render() {
    const v = { guess: viewGuess, abstract: viewAbstract, questions: viewQuestions, evidence: viewEvidence, discuss: viewDiscuss, close: viewClose, saved: viewSaved }[rec.step] || viewGuess;
    const kids = [];
    if (rec.step !== "saved") kids.push(stepsBar());
    if (rec.resumed && rec.step !== "saved") kids.push(h("p", { class: "note" }, "Picked up where you left off. ", h("button", { class: "btn quiet", on: { click: () => { const key = paper.key; rec = blank(); io.clearDraft(key); render(); } } }, "Start this paper again")));
    kids.push(v());
    app.replaceChildren(...kids);
    reportHeight();
    if (rec.step === "close" && notesCache === null) loadNotes();
  }
  async function loadNotes() {
    notesCache = [];
    try { notesCache = await io.listNotes(); rec.exists = await io.noteExists(paper); } catch (e) { err.save = e.message; }
    render();
  }

  function reportHeight() {
    if (pane && io.resize) io.resize(Math.ceil(document.documentElement.scrollHeight));
  }
  async function startWith(ioArg) {
    io = ioArg;
    app = document.getElementById("app");
    pane = !!io.pane;
    document.body.classList.toggle("pane", pane);
    notesCache = null; runID++; Object.keys(busy).forEach(k => { busy[k] = false; }); Object.keys(err).forEach(k => { delete err[k]; });
    if (pane && !resizeObs && window.ResizeObserver) { resizeObs = new ResizeObserver(reportHeight); resizeObs.observe(document.body); }
    try {
      settings = io.settings();
      paper = await io.getPaper();
      document.title = "Reading Coach: " + (paper.title || "").slice(0, 60);
      const d = await io.loadDraft(paper.key);
      rec = Object.assign(blank(), d || {});
      if (d && d.step && d.step !== "guess") rec.resumed = true;
      if (rec.step === "saved") rec.step = "close";
      if (!Array.isArray(rec.clips)) rec.clips = [];
      if (!Array.isArray(rec.predict)) rec.predict = [];
      if (!Array.isArray(rec.asks)) rec.asks = [];
      if (rec.step === "abstract" && aiNote() && !rec.preview) makePreview();
      render();
    } catch (e) {
      app.replaceChildren(fbox("Couldn't open this paper: " + e.message, "error"));
    }
  }
  window.RCStart = startWith;
  window.addEventListener("load", () => {
    const a = window.arguments && window.arguments[0];
    const found = (a && a.wrappedJSObject) || a || window.__readingCoachIO;
    if (found) startWith(found);
    else if (!/[?&]pane=1/.test(location.search)) document.getElementById("app").textContent = "Open Reading Coach from a paper in your Zotero library.";
  });
})();
