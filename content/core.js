/* Reading Coach: shared logic with no Zotero or file-system calls.
   Loaded by the plugin, by the dialogs, and by tests in Node. */
var RC = (function () {
  "use strict";

  const STANCE = {
    supports: "Supports my position",
    challenges: "Challenges my position",
    extends: "Extends my position",
    unclear: "Unclear for me"
  };
  const EVIDENCE = {
    experiment: "Experiment",
    quasi: "Quasi-experiment",
    survey: "Survey",
    qualitative: "Qualitative",
    mixed: "Mixed methods",
    review: "Review or meta-analysis",
    design: "Design or development",
    theory: "Theory or position",
    other: "Other"
  };
  const STEPS = [
    ["guess", "Guess"],
    ["abstract", "Abstract"],
    ["questions", "Questions"],
    ["evidence", "Figure and limit"],
    ["discuss", "Discuss"],
    ["close", "Takeaway"]
  ];

  /* ---------- Small helpers ---------- */
  function clip(s, n) {
    s = String(s || "");
    if (s.length <= n) return s;
    const head = Math.round(n * 0.6), tail = n - head;
    return s.slice(0, head) + "\n\n[…middle of the paper left out to keep this quick…]\n\n" + s.slice(-tail);
  }
  function split(t) {
    return String(t || "").replace(/\s+/g, " ").trim()
      .split(/(?<![Ee]t al\.|e\.g\.|i\.e\.|Fig\.|vs\.|cf\.|pp\.|\b[A-Z]\.)(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/)
      .map(x => x.trim()).filter(Boolean);
  }
  function clipSource(c) {
    if (c.from === "abstract") return "abstract";
    if (c.from === "pdf") return "PDF" + (c.page ? ", p. " + c.page : "");
    return c.from === "paste" ? "pasted from the paper" : "dragged in";
  }
  function oneLine(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function today(d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function lastName(full) {
    full = oneLine(full);
    if (!full) return "";
    if (full.includes(",")) return full.split(",")[0].trim();
    const parts = full.split(" ");
    return parts[parts.length - 1];
  }

  /* ---------- Model output ---------- */
  function parseJSON(text) {
    const t = String(text || "").trim();
    const tries = [t];
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) tries.push(fence[1].trim());
    const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
    if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
    for (const x of tries) {
      try { return JSON.parse(x); } catch (e) { /* try the next form */ }
    }
    throw new Error("The model's reply was not in the expected format.");
  }
  function cleanQuestions(raw) {
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.questions) ? raw.questions : [];
    const out = list.filter(x => x && x.q).slice(0, 3).map(x => ({
      q: oneLine(x.q), answer: oneLine(x.answer), where: oneLine(x.where), mine: "", verdict: "", feedback: ""
    }));
    if (!out.length) throw new Error("The model did not return any questions.");
    return out;
  }
  function cleanResults(raw, n) {
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.results) ? raw.results : [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = list[i] || {};
      let v = String(r.verdict || "").toLowerCase();
      if (!["right", "partly", "wrong"].includes(v)) v = v.startsWith("r") ? "right" : v.startsWith("p") ? "partly" : "wrong";
      out.push({ verdict: v, feedback: oneLine(r.feedback) });
    }
    return out;
  }

  /* ---------- Prompts (OpenAI-style messages) ---------- */
  function context(paper, settings) {
    return [
      "Researcher's field: " + (settings.field || "not given") + ".",
      "Researcher's current position: " + (settings.position || "not given") + ".",
      "",
      "Paper: " + paper.title,
      "Authors: " + (paper.authors || []).join(", ") + (paper.year ? " (" + paper.year + ")" : ""),
      paper.fulltext ? "Full text of the paper:" : "Only the abstract is available:",
      "<<<",
      clip(paper.fulltext || paper.abstract || "(no text available)", settings.maxChars || 100000),
      ">>>"
    ].join("\n");
  }
  const SYSTEM = "You help a researcher read papers actively. You never write summaries. You ask, check and point back to the text.";

  /* What the model will read, in plain words, for the screen. */
  function sourceInfo(paper, settings) {
    const n = (paper.fulltext || "").trim().length, max = settings.maxChars || 100000;
    const k = x => Math.round(x / 1000) + ",000";
    if (n > 0 && n <= max) return { kind: "full", text: "The AI reads the full text of the PDF (about " + k(n) + " characters)." };
    if (n > max) return { kind: "part", text: "The AI reads most of the PDF: the first and last parts, " + k(max) + " of about " + k(n) + " characters. You can raise the limit in Zotero Settings → Reading Coach." };
    if (paper.hasPDF) return { kind: "abstract", text: "Zotero couldn't get any text from this PDF (it may be a scanned image), so the AI reads the abstract only." };
    return { kind: "abstract", text: "This paper has no PDF attached, so the AI reads the abstract only." };
  }
  function questionsMessages(paper, settings) {
    return [
      { role: "system", content: SYSTEM },
      { role: "user", content: context(paper, settings) + "\n\n" + [
        "Write exactly 3 questions whose answers are stated in this paper:",
        "1. the main finding or claim;",
        "2. the evidence or method behind it;",
        "3. a limitation, boundary condition or what the finding does not show.",
        "Where the researcher's position is given, prefer questions that bear on it. Avoid trivia such as sample size alone.",
        "For each, give a reference answer of one or two sentences and where in the paper to look (section, page, figure or table).",
        'Reply with only JSON: {"questions":[{"q":"...","answer":"...","where":"..."}]}'
      ].join("\n") }
    ];
  }
  function predictMessages(paper, settings) {
    return [
      { role: "system", content: SYSTEM },
      { role: "user", content: [
        "Researcher's field: " + (settings.field || "not given") + ". Their position: " + (settings.position || "not given") + ".",
        "Paper: " + paper.title,
        "Abstract (the researcher has NOT seen it yet):",
        "<<<", clip(paper.abstract || paper.fulltext || "", 6000), ">>>",
        "",
        "Write 1 to 3 short questions that help the researcher predict what this paper found, before they read the abstract.",
        "Each question must be answerable as a guess from the title and general knowledge. It must not reveal, hint at or contain the answer, the direction of a result, or any number from the abstract.",
        "Good: \"Which group do you expect performed better, and for which students?\" Bad: \"Why did the checking group score 8 points higher?\"",
        'Reply with only JSON: {"prompts":["...","..."]}'
      ].join("\n") }
    ];
  }
  function cleanPrompts(raw) {
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.prompts) ? raw.prompts : [];
    const out = list.map(x => oneLine(typeof x === "string" ? x : x && (x.q || x.question))).filter(Boolean).slice(0, 3);
    if (!out.length) throw new Error("The model did not suggest any questions.");
    return out.map(q => ({ q, a: "" }));
  }
  function checkMessages(paper, settings, questions) {
    const items = questions.map((x, i) => ({ n: i + 1, question: x.q, reference_answer: x.answer, where: x.where, researcher_answer: x.mine }));
    return [
      { role: "system", content: SYSTEM },
      { role: "user", content: context(paper, settings) + "\n\n" + [
        "The researcher answered these questions before looking anything up:",
        JSON.stringify(items, null, 1),
        "",
        "Judge each answer against the paper itself, not the exact wording of the reference answer.",
        'verdict is "right", "partly" or "wrong".',
        'feedback is one or two sentences addressed to the researcher as "you": say what was right, what was missing or mistaken, and where in the paper to look.',
        'Reply with only JSON: {"results":[{"verdict":"...","feedback":"..."}]} in the same order.'
      ].join("\n") }
    ];
  }
  function discussMessages(paper, settings, rec, turns) {
    const notes = [
      "Their guess before reading: " + (rec.guess || "none") + ((rec.predict || []).filter(p => p.a).length ? " | " + rec.predict.filter(p => p.a).map(p => p.q + " → " + p.a).join(" | ") : ""),
      "Their answers: " + rec.questions.map((x, i) => (i + 1) + ". " + x.q + " → " + (x.mine || "") + " [" + (x.verdict || "unchecked") + "]").join(" | "),
      "Their note on the key figure: " + (rec.figure || "none"),
      "Their note on a limitation: " + (rec.limit || "none"),
      "Passages they clipped from the paper: " + ((rec.clips || []).map(c => "\"" + oneLine(c.text).slice(0, 300) + "\"" + (c.note ? " (their note: " + oneLine(c.note) + ")" : "")).join(" | ") || "none")
    ].join("\n");
    const head = {
      role: "user",
      content: context(paper, settings) + "\n\n" + notes + "\n\n" + [
        "Act as a sceptical, friendly colleague who has read this paper closely. Your job is to make the researcher think, not to explain.",
        "Ask one question at a time about the argument, the evidence, the limits, or how the paper bears on their position.",
        "Keep each of your turns under 80 words.",
        "If their answer is wrong or vague, point them to the relevant part of the paper instead of giving the answer. Explain directly only if they say they are stuck.",
        "Start now with your first question."
      ].join("\n")
    };
    return [{ role: "system", content: SYSTEM }, head].concat(turns.slice(-16));
  }
  function trendMessages(rows, guess, settings) {
    const notes = rows.map((r, i) => "[" + (i + 1) + "] " + (r.year || "n.d.") + " · " + r.title +
      "\nTakeaway: " + r.takeaway + "\nEvidence: " + (EVIDENCE[r.evidence] || r.evidence || "not noted") +
      " · Stance: " + (STANCE[r.stance] || r.stance || "not noted") + (r.limit ? "\nLimit: " + r.limit : "")).join("\n\n");
    return [
      { role: "system", content: "You help a researcher see trends in their own reading notes. Use only the notes given, not outside knowledge." },
      { role: "user", content: [
        "Field: " + (settings.field || "not given") + ". Their position: " + (settings.position || "not given") + ".",
        "Their own reading of the trend: " + (oneLine(guess) || "(none written)"),
        "",
        "Reply in Markdown with four short parts, each two or three sentences, cite notes like [3]:",
        "**Where your notes support your reading**",
        "**Where they don't**",
        "**A pattern you may have missed** (for example by year or kind of evidence)",
        "**What to read next to test it**",
        "",
        "Notes on " + rows.length + " papers:",
        notes
      ].join("\n") }
    ];
  }

  /* ---------- Obsidian note ---------- */
  function yamlStr(s) { return JSON.stringify(oneLine(s)); }
  /* Note names come from a pattern such as "{{citekey}}" or "@{{citekey}}".
     Without a citekey, the pattern falls back to "Author Year - Short title". */
  function fileName(paper) {
    const who = lastName((paper.authors || [])[0]) || "Unknown";
    const short = oneLine(paper.title).split(/[:?.!]/)[0].split(" ").slice(0, 8).join(" ");
    let pattern = String(paper.notePattern || "{{citekey}}");
    if (/\{\{citekey\}\}/.test(pattern) && !paper.citekey) pattern = "{{author}} {{year}} - {{title}}";
    const name = pattern
      .replace(/\{\{citekey\}\}/g, paper.citekey || "")
      .replace(/\{\{author\}\}/g, who)
      .replace(/\{\{year\}\}/g, paper.year || "n.d.")
      .replace(/\{\{title\}\}/g, short);
    return (name.replace(/[\\/:*?"<>|#^\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled") + ".md";
  }
  function cardSafe(s) { return oneLine(s).replace(/::/g, ":"); }
  function buildNote(paper, rec) {
    const fm = [
      "---",
      "reading_coach: true",
      "title: " + yamlStr(paper.title),
      "citekey: " + yamlStr(paper.citekey),
      "aliases: [" + yamlStr(paper.title) + "]",
      "authors: [" + (paper.authors || []).map(yamlStr).join(", ") + "]",
      "year: " + (paper.year ? yamlStr(paper.year) : '""'),
      "venue: " + yamlStr(paper.venue),
      "doi: " + yamlStr(paper.doi),
      "zotero: " + yamlStr(paper.zoteroURI),
      "status: done",
      "read_on: " + today(rec.finishedAt ? new Date(rec.finishedAt) : undefined),
      "stance: " + (rec.stance || '""'),
      "evidence: " + (rec.evidence || '""'),
      "takeaway: " + yamlStr(rec.takeaway),
      "limit: " + yamlStr(rec.limit),
      "guess_match: " + (rec.guessMark || '""'),
      "score: " + yamlStr(rec.questions.filter(q => q.verdict === "right").length + "/" + rec.questions.length),
      "tags: [paper]",
      "---"
    ].join("\n");
    const body = [];
    body.push("# " + oneLine(paper.title), "");
    body.push("[Open in Zotero](" + paper.zoteroURI + ")" + (paper.doi ? " · [DOI](https://doi.org/" + paper.doi + ")" : ""), "");
    body.push("## My takeaway", rec.takeaway.trim(), "");
    body.push("- Stance: " + (STANCE[rec.stance] || "not set"));
    body.push("- Evidence: " + (EVIDENCE[rec.evidence] || "not set"));
    if (rec.linkTo) body.push("- Connects to [[" + rec.linkTo.replace(/\.md$/, "") + "]]" + (rec.linkNote ? ": " + oneLine(rec.linkNote) : ""));
    body.push("");
    body.push("## Before reading", "My guess: " + (oneLine(rec.guess) || "none") + (rec.guessMark ? " (close? " + rec.guessMark + ")" : ""));
    (rec.predict || []).filter(p => p.a && p.a.trim()).forEach(p => body.push("- " + oneLine(p.q) + " → " + oneLine(p.a)));
    body.push("");
    if (rec.clips && rec.clips.length) {
      body.push("## What the paper actually says");
      rec.clips.forEach(c => {
        body.push("> " + oneLine(c.text), "> — " + clipSource(c));
        if (c.note) body.push("", "My note: " + oneLine(c.note));
        body.push("");
      });
    }
    body.push("## Questions");
    rec.questions.forEach((q, i) => {
      body.push((i + 1) + ". **" + q.q + "**");
      body.push("   - My answer: " + (oneLine(q.mine) || "—") + (q.verdict ? " (" + q.verdict + ")" : ""));
      if (q.feedback) body.push("   - Feedback: " + q.feedback);
      body.push("   - In the paper: " + q.answer + (q.where ? " (" + q.where + ")" : ""));
    });
    body.push("");
    body.push("## Key figure", oneLine(rec.figure) || "—", "", "## Limitation", oneLine(rec.limit) || "—", "");
    if (rec.turns && rec.turns.length) {
      body.push("> [!quote]- Discussion");
      rec.turns.forEach(t => {
        const who = t.role === "user" ? "**Me:** " : "**Colleague:** ";
        String(t.content).split("\n").forEach((line, k) => body.push("> " + (k === 0 ? who : "") + line));
        body.push(">");
      });
      body.push("");
    }
    body.push("## Flashcards #flashcards");
    rec.questions.forEach(q => body.push(cardSafe(q.q) + "::" + cardSafe(q.answer)));
    body.push(cardSafe("What did " + (lastName((paper.authors || [])[0]) || "this paper") + " " + (paper.year || "") + " show, and what does it mean for my work?") + "::" + cardSafe(rec.takeaway));
    body.push("");
    if (paper.abstract) body.push("> [!abstract]- Abstract", "> " + oneLine(paper.abstract), "");
    return fm + "\n\n" + body.join("\n");
  }
  function zoteroNoteHTML(rec, obsidianURL) {
    const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return "<h2>Reading Coach</h2><p><strong>My takeaway:</strong> " + esc(rec.takeaway) + "</p>" +
      "<p>" + esc(STANCE[rec.stance] || "") + (rec.evidence ? " · " + esc(EVIDENCE[rec.evidence]) : "") +
      " · Questions right: " + rec.questions.filter(q => q.verdict === "right").length + "/" + rec.questions.length + "</p>" +
      (obsidianURL ? '<p><a href="' + esc(obsidianURL) + '">Open the full note in Obsidian</a></p>' : "");
  }

  /* ---------- Reading table ---------- */
  function parseFrontmatter(md) {
    const m = String(md || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const out = {};
    m[1].split(/\r?\n/).forEach(line => {
      const k = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!k) return;
      let v = k[2].trim();
      if (v.startsWith('"')) { try { v = JSON.parse(v); } catch (e) { v = v.replace(/^"|"$/g, ""); } }
      else if (v.startsWith("[")) {
        try { v = JSON.parse(v); } catch (e) { v = v.slice(1, -1).split(",").map(x => x.trim().replace(/^"|"$/g, "")).filter(Boolean); }
      }
      out[k[1]] = v;
    });
    return out;
  }
  function cell(s) { return oneLine(s).replace(/\|/g, "\\|"); }
  function buildTable(notes, settings) {
    const rows = notes.filter(n => n.fm && n.fm.reading_coach && String(n.fm.reading_coach) !== "false")
      .map(n => ({ file: n.name.replace(/\.md$/, ""), title: n.fm.title || n.name, year: String(n.fm.year || ""), takeaway: n.fm.takeaway || "", limit: n.fm.limit || "", stance: n.fm.stance || "", evidence: n.fm.evidence || "", read_on: n.fm.read_on || "" }))
      .sort((a, b) => (b.year || "0").localeCompare(a.year || "0") || a.title.localeCompare(b.title));
    const years = Array.from(new Set(rows.map(r => r.year || "n.d."))).sort();
    const count = (ys, s) => rows.filter(r => (r.year || "n.d.") === ys && r.stance === s).length;
    const out = [];
    out.push("---", "reading_coach_table: true", "updated: " + today(), "---", "");
    out.push("# Reading table", "");
    out.push("Rebuilt by Reading Coach each time you finish a paper. Edits here are overwritten; change the paper notes instead.", "");
    if (settings.position) out.push("**My position:** " + oneLine(settings.position), "");
    out.push("## By year", "", "| Year | Supports | Challenges | Extends | Unclear | Total |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    years.forEach(y => out.push("| " + y + " | " + count(y, "supports") + " | " + count(y, "challenges") + " | " + count(y, "extends") + " | " + count(y, "unclear") + " | " + rows.filter(r => (r.year || "n.d.") === y).length + " |"));
    out.push("", "## Papers", "", "| Year | Paper | My takeaway | Evidence | Stance |", "| --- | --- | --- | --- | --- |");
    rows.forEach(r => out.push("| " + cell(r.year) + " | [[" + cell(r.file) + "]] | " + cell(r.takeaway) + " | " + cell(EVIDENCE[r.evidence] || r.evidence) + " | " + cell((STANCE[r.stance] || r.stance).split(" ")[0]) + " |"));
    if (!rows.length) out.push("| | No papers yet | | | |");
    out.push("");
    return { text: out.join("\n"), rows };
  }
  function trendNote(rows, guess, aiText, settings) {
    return [
      "---", "reading_coach_trend: true", "date: " + today(), "papers: " + rows.length, "---", "",
      "# Trend check " + today(), "",
      settings.position ? "**My position:** " + oneLine(settings.position) + "\n" : "",
      "## My reading", "", guess.trim(), "",
      "## Papers in this check", "",
      rows.map((r, i) => "[" + (i + 1) + "] [[" + r.file + "]]").join("\n"), "",
      "> [!note]- What the AI saw in my notes",
      String(aiText || "").split("\n").map(l => "> " + l).join("\n"), "",
      "## My revised reading", "", "(Rewrite your reading here in your own words.)", ""
    ].join("\n");
  }

  return { sourceInfo, predictMessages, cleanPrompts, split, clipSource, STANCE, EVIDENCE, STEPS, parseJSON, cleanQuestions, cleanResults, questionsMessages, checkMessages, discussMessages, trendMessages, fileName, buildNote, zoteroNoteHTML, parseFrontmatter, buildTable, trendNote, today, oneLine };
})();
if (typeof module === "object" && module.exports) module.exports = RC;
