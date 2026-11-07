/* Reading Coach: the step-by-step reading window. Built with DOM calls because XHTML rejects loose HTML. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/1999/xhtml";
  let io, paper, settings, rec, app, saveTimer, notesCache = null, pane = false, clipsOpen = true, resizeObs = null;
  const busy = { questions: false, check: false, chat: false, save: false, predict: false };
  let started = 0, ticker = null, runID = 0;
  function startClock() {
    started = Date.now();
    clearInterval(ticker);
    ticker = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      document.querySelectorAll(".elapsed").forEach(el => { el.textContent = s + " s"; });
      if (!busy.questions && !busy.check && !busy.chat && !busy.predict) clearInterval(ticker);
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
    return { step: "guess", guess: "", guessMark: "", questions: [], checked: false, figure: "", limit: "", turns: [], takeaway: "", stance: "", evidence: "", linkTo: "", linkNote: "", savedPath: "", clips: [], predict: [] };
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { io.saveDraft(paper.key, rec).catch(() => {}); }, 500);
  }
  const ORDER = RC.STEPS.map(s => s[0]);
  const reached = s => ORDER.indexOf(s) <= ORDER.indexOf(rec.maxStep || rec.step);
  function go(step) {
    rec.step = step;
    if (ORDER.indexOf(step) > ORDER.indexOf(rec.maxStep || "guess")) rec.maxStep = step;
    persist();
    render();
    window.scrollTo(0, 0);
    if (pane && io.scrollIntoView) io.scrollIntoView();
    if (step === "questions" && !rec.questions.length && !busy.questions) makeQuestions();
  }

  /* ---------- Model calls ---------- */
  async function makeQuestions() {
    const my = ++runID;
    busy.questions = true; err.questions = ""; startClock(); render();
    try {
      const reply = await io.llm(RC.questionsMessages(paper, settings));
      if (my !== runID) return;
      rec.questions = RC.cleanQuestions(RC.parseJSON(reply));
      rec.checked = false;
      persist();
    } catch (e) { if (my !== runID) return; err.questions = e.message; }
    busy.questions = false; render();
  }
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
      res.forEach((r, i) => Object.assign(rec.questions[i], r));
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
      const cur = rec.step === k, can = reached(k) && !cur;
      return h("button", { class: cur ? "cur" : can ? "done" : "", disabled: !can && !cur, "aria-current": cur ? "step" : null, on: { click: () => { if (can) go(k); } } }, (i + 1) + ". " + label);
    }));
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
      h("div", { class: "row", style: "justify-content:flex-end" }, h("button", { id: "next-guess", class: "btn primary", disabled: !guessed(), on: { click: () => go("abstract") } }, "Show the abstract")));
  }
  function viewAbstract() {
    const marks = [["yes", "Yes"], ["partly", "Partly"], ["no", "No"]];
    return h("section", { class: "card" }, header(),
      h("div", { class: "fb plain" }, rec.guess.trim() ? h("p", {}, h("b", {}, "You guessed: "), rec.guess) : null,
        rec.predict.filter(p => p.a.trim()).map(p => h("p", {}, h("b", {}, p.q + " "), p.a))),
      h("div", {}, h("p", { class: "eyebrow" }, "Abstract"),
        paper.abstract ? [h("p", { class: "reading" }, abstractSentences()), h("p", { class: "small" }, "Click a sentence, or drag it into My clips, to keep what the paper actually says.")]
          : h("p", { class: "small" }, "Zotero has no abstract for this paper. Open the PDF and read its abstract now.")),
      h("div", { class: "row" }, h("span", {}, "Was your guess close?"),
        h("span", { class: "seg", role: "group" }, marks.map(([v, t]) => h("button", { "aria-pressed": rec.guessMark === v ? "true" : "false", on: { click: () => { rec.guessMark = v; persist(); render(); } } }, t)))),
      h("div", { class: "between" }, btn("Back", () => go("guess")),
        h("span", { class: "row" },
          btn("Skip this paper", () => decide("rc-skipped"), "quiet", !rec.guessMark),
          btn("Keep for later", () => decide("rc-later"), "", !rec.guessMark),
          btn(pane ? "Study it now" : "Study it with the PDF", studyNow, "primary", !rec.guessMark))),
      rec.guessMark ? null : h("p", { class: "small" }, "Mark how close your guess was, then decide what to do with this paper."),
      err.reader ? h("p", { class: "note" }, err.reader) : null,
      clipsBox());
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
          h("input", { type: "text", "aria-label": "Your note on this clip", placeholder: "Why it matters (optional)", value: c.note, on: { input: e => { c.note = e.target.value; persist(); } } })))),
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
    else if (!rec.questions.length) parts.push(btn("Write my questions", makeQuestions, "primary"));
    else {
      parts.push(h("p", { class: "small" }, rec.checked ? "Read the feedback, then go back to the parts of the paper it points to." : "Answer from what you know or a quick look at the paper. Don't open a summary yet."));
      rec.questions.forEach((q, i) => {
        parts.push(h("div", { class: "q" },
          h("b", {}, (i + 1) + ". " + q.q),
          h("textarea", { id: "ans-" + i, "aria-label": "Your answer to question " + (i + 1), readonly: rec.checked ? "readonly" : null, value: q.mine, placeholder: "Your answer", on: { input: e => { q.mine = e.target.value; persist(); liveEnable("check", () => rec.questions.every(x => x.mine.trim())); } } }),
          rec.checked ? [
            h("p", { class: "fb " + q.verdict }, h("span", { class: "chip " + q.verdict }, q.verdict), " ", q.feedback),
            h("p", { class: "fb plain" }, h("b", {}, "In the paper: "), q.answer, q.where ? " (" + q.where + ")" : "")
          ] : null));
      });
      if (err.check) parts.push(fbox(err.check, "error"));
      if (!rec.checked) parts.push(h("div", { class: "row" },
        h("button", { id: "check", class: "btn primary", disabled: busy.check || !rec.questions.every(x => x.mine.trim()), on: { click: checkAnswers } }, busy.check ? ["Checking… ", elapsed()] : "Check my answers"),
        btn("Ask different questions", () => { rec.questions = []; makeQuestions(); }, "quiet", busy.check)));
    }
    parts.push(nav("abstract", "Next", () => go("evidence"), rec.checked), clipsBox());
    return h("section", { class: "card" }, parts);
  }
  function viewEvidence() {
    const ok = () => rec.figure.trim() && rec.limit.trim();
    return h("section", { class: "card" }, header(),
      textField("Open the figure or table with the main result. What does it show, in one line?", "figure", "e.g. Table 2: prompt group ahead at delayed test, largest gap for low prior knowledge", () => liveEnable("next-ev", ok)),
      textField("What can this study not tell you?", "limit", "e.g. one course, one semester, no follow-up", () => liveEnable("next-ev", ok)),
      h("div", { class: "between" }, btn("Back", () => go("questions")), h("button", { id: "next-ev", class: "btn primary", disabled: !ok(), on: { click: () => go("discuss") } }, "Next")),
      clipsBox());
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
    parts.push(nav("evidence", rec.turns.length ? "Finish and write my takeaway" : "Skip to my takeaway", () => go("close"), !busy.chat), clipsBox());
    return h("section", { class: "card" }, parts);
  }
  function send() {
    const box = document.getElementById("say");
    const t = box && box.value.trim();
    if (!t || busy.chat) return;
    chat(t);
  }
  function viewClose() {
    const ok = () => rec.takeaway.trim() && rec.stance;
    const opts = (map, cur) => [h("option", { value: "" }, "Choose one")].concat(Object.entries(map).map(([k, v]) => h("option", { value: k, selected: cur === k ? "selected" : null }, v)));
    const sel = (label, key, map) => h("label", { class: "f" }, label, h("select", { id: "f-" + key, on: { change: e => { rec[key] = e.target.value; persist(); liveEnable("save", ok); liveEnable("save-new", ok); } } }, opts(map, rec[key])));
    const notes = (notesCache || []).filter(n => n.fm && n.fm.reading_coach && n.name !== RC.fileName(paper));
    const parts = [header(),
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
    if (rec.exists) parts.push(h("p", { class: "note" }, "You already have a note for this paper in Obsidian. Replace it, or save this reading as a separate note."));
    parts.push(h("div", { class: "between" }, btn("Back", () => go("discuss")),
      h("span", { class: "row" },
        rec.exists ? h("button", { id: "save-new", class: "btn", disabled: !ok() || busy.save, on: { click: () => save("new") } }, "Save as a new note") : null,
        h("button", { id: "save", class: "btn primary", disabled: !ok() || busy.save, on: { click: () => save("replace") } }, busy.save ? "Saving…" : rec.exists ? "Replace the note" : "Save to Obsidian"))));
    parts.push(h("p", { class: "small" }, "Saves the note with your clips and flashcards, adds a short note in Zotero, and rebuilds your reading table."), clipsBox());
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
      render();
      if (rec.step === "questions" && !rec.questions.length) makeQuestions();
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
