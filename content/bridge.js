/* Reading Coach: everything that touches Zotero, the model API or the Obsidian vault.
   Loaded into the plugin's bootstrap scope after core.js. */
var ReadingCoach = {
  id: null,
  rootURI: null,
  chromeHandle: null,
  paneID: null,
  PREF: "extensions.readingcoach.",
  IDS: ["readingcoach-sep", "readingcoach-read", "readingcoach-tools-sep", "readingcoach-trends", "readingcoach-table"],

  init({ id, rootURI }) {
    this.id = id;
    this.rootURI = rootURI;
    const aom = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
    this.chromeHandle = aom.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [["content", "readingcoach", "content/"]]);
    Zotero.ReadingCoach = this;
  },
  registerSection() {
    const self = this;
    this.sectionID = Zotero.ItemPaneManager.registerSection({
      paneID: "readingcoach-section",
      pluginID: this.id,
      header: { l10nID: "readingcoach-section-head", icon: "chrome://readingcoach/content/icon.svg" },
      sidenav: { l10nID: "readingcoach-section-sidenav", icon: "chrome://readingcoach/content/icon.svg" },
      bodyXHTML: '<html:iframe class="readingcoach-frame" src="chrome://readingcoach/content/coach.xhtml?pane=1" style="display:block;width:100%;height:320px;border:0;"/>',
      onItemChange: ({ tabType, setEnabled }) => { setEnabled(tabType === "reader"); return true; },
      onRender: () => {},
      onAsyncRender: async ({ body, item }) => {
        const frame = body.querySelector("iframe.readingcoach-frame");
        if (!frame || !item) return;
        let target = item;
        if ((target.isAttachment() || target.isNote()) && target.parentItem) target = target.parentItem;
        if (frame.dataset.item === String(target.id)) return;
        frame.dataset.item = String(target.id);
        const begin = () => {
          const win = frame.contentWindow;
          if (!win || !win.RCStart) return false;
          const io = self.makeIO(target.id);
          io.pane = true;
          io.resize = px => { frame.style.height = Math.max(160, px) + "px"; };
          io.scrollIntoView = () => self.scrollToSection(frame.ownerGlobal);
          win.RCStart(io);
          return true;
        };
        if (!begin()) frame.addEventListener("load", () => begin(), { once: true });
      }
    });
  },
  scrollToSection(win) {
    try {
      (win || Zotero.getMainWindow()).document.querySelectorAll("item-details").forEach(d => {
        try { d.scrollToPane(this.sectionID); } catch (e) { /* not this pane */ }
      });
    } catch (e) { /* best effort */ }
  },
  async openReader(itemID) {
    let item = Zotero.Items.get(itemID);
    if ((item.isAttachment() || item.isNote()) && item.parentItem) item = item.parentItem;
    const att = item.isAttachment() ? item : await item.getBestAttachment();
    if (!att || !(att.isPDFAttachment() || att.isEPUBAttachment && att.isEPUBAttachment())) throw new Error("This paper has no PDF attached.");
    await Zotero.Reader.open(att.id);
    const win = Zotero.getMainWindow();
    [600, 1500, 3000].forEach(ms => setTimeout(() => this.scrollToSection(win), ms));
  },
  async registerPrefs() {
    this.paneID = await Zotero.PreferencePanes.register({
      pluginID: this.id,
      src: this.rootURI + "content/prefs.xhtml",
      scripts: [this.rootURI + "content/prefs-pane.js"],
      label: "Reading Coach"
    });
  },
  shutdown() {
    this.removeFromAllWindows();
    try { if (this.sectionID) Zotero.ItemPaneManager.unregisterSection(this.sectionID); } catch (e) { Zotero.logError(e); }
    if (this.chromeHandle) this.chromeHandle.destruct();
    delete Zotero.ReadingCoach;
  },

  /* ---------- Settings ---------- */
  pref(k) { return Zotero.Prefs.get(this.PREF + k, true); },
  setPref(k, v) { Zotero.Prefs.set(this.PREF + k, v, true); },
  settings() {
    const p = k => this.pref(k);
    return {
      baseURL: String(p("baseURL") || "").trim(),
      apiKey: String(p("apiKey") || "").trim(),
      model: String(p("model") || "").trim(),
      vaultPath: String(p("vaultPath") || "").trim(),
      papersFolder: String(p("papersFolder") || "Papers").trim(),
      trendsFolder: String(p("trendsFolder") || "Trends").trim(),
      tableFile: String(p("tableFile") || "Reading table.md").trim(),
      noteName: String(p("noteName") || "{{citekey}}").trim(),
      field: String(p("field") || ""),
      position: String(p("position") || ""),
      maxChars: Number(p("maxChars")) || 100000
    };
  },
  openPrefs() { Zotero.Utilities.Internal.openPreferences(this.paneID || undefined); },

  /* ---------- Menus ---------- */
  addToWindow(win) {
    const doc = win.document;
    if (doc.getElementById("readingcoach-read")) return;
    try { win.MozXULElement.insertFTLIfNeeded("readingcoach.ftl"); } catch (e) { Zotero.logError(e); }
    const mk = (tag, id, label, fn) => {
      const el = doc.createXULElement(tag);
      el.id = id;
      if (label) { el.setAttribute("label", label); try { el.label = label; } catch (e) { /* attribute is enough */ } }
      if (fn) el.addEventListener("command", fn);
      return el;
    };
    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu) {
      itemMenu.appendChild(mk("menuseparator", "readingcoach-sep"));
      itemMenu.appendChild(mk("menuitem", "readingcoach-read", "Read with Reading Coach", () => this.openCoach(win)));
    }
    const tools = doc.getElementById("menu_ToolsPopup");
    if (tools) {
      tools.appendChild(mk("menuseparator", "readingcoach-tools-sep"));
      tools.appendChild(mk("menuitem", "readingcoach-trends", "Reading Coach: trend check", () => this.openTrends(win)));
      tools.appendChild(mk("menuitem", "readingcoach-table", "Reading Coach: rebuild reading table", async () => {
        try {
          const n = await this.rebuildTable();
          Zotero.alert(win, "Reading Coach", "The reading table in your vault now lists " + n + (n === 1 ? " paper." : " papers."));
        } catch (e) { Zotero.alert(win, "Reading Coach", e.message); }
      }));
    }
  },
  removeFromWindow(win) {
    const doc = win.document;
    this.IDS.forEach(id => { const el = doc.getElementById(id); if (el) el.remove(); });
    const ftl = doc.querySelector('[href="readingcoach.ftl"]');
    if (ftl) ftl.remove();
  },
  addToAllWindows() { Zotero.getMainWindows().forEach(w => { if (w.ZoteroPane) this.addToWindow(w); }); },
  removeFromAllWindows() { Zotero.getMainWindows().forEach(w => { if (w.ZoteroPane) this.removeFromWindow(w); }); },

  openCoach(win) {
    let item = (win.ZoteroPane.getSelectedItems() || [])[0];
    if (item && (item.isAttachment() || item.isNote()) && item.parentItem) item = item.parentItem;
    if (!item || !item.isRegularItem()) {
      Zotero.alert(win, "Reading Coach", "Select a paper in your library first.");
      return;
    }
    win.openDialog("chrome://readingcoach/content/coach.xhtml", "readingcoach-" + item.key,
      "chrome,centerscreen,resizable,dialog=no,width=800,height=880", this.makeIO(item.id));
  },
  openTrends(win) {
    win.openDialog("chrome://readingcoach/content/trends.xhtml", "readingcoach-trends",
      "chrome,centerscreen,resizable,dialog=no,width=780,height=820", this.makeIO(null));
  },

  /* The object the dialogs receive. They never touch Zotero directly. */
  makeIO(itemID) {
    const self = this;
    const io = {
      itemID,
      settings: () => self.settings(),
      openPrefs: () => self.openPrefs(),
      getPaper: () => self.getPaper(itemID),
      openReader: () => self.openReader(itemID),
      llm: messages => self.llm(messages),
      listNotes: () => self.listNotes(),
      noteExists: paper => self.noteExists(paper),
      savePaperNote: (paper, rec, mode) => self.savePaperNote(paper, rec, mode, itemID),
      addTag: (tag) => self.addTag(itemID, tag),
      rebuildTable: () => self.rebuildTable(),
      tablePath: () => self.vaultFile(self.settings().tableFile),
      saveTrend: (rows, guess, ai) => self.saveTrend(rows, guess, ai),
      saveDraft: (key, data) => self.saveDraft(key, data),
      loadDraft: key => self.loadDraft(key),
      clearDraft: key => self.clearDraft(key),
      openInObsidian: path => Zotero.launchURL(self.obsidianURL(path))
    };
    io.wrappedJSObject = io;
    return io;
  },

  /* ---------- The paper ---------- */
  field(item, name) { try { return item.getField(name) || ""; } catch (e) { return ""; } },
  async getPaper(itemID) {
    let item = Zotero.Items.get(itemID);
    if ((item.isAttachment() || item.isNote()) && item.parentItem) item = item.parentItem;
    const date = this.field(item, "date");
    const parsed = date ? Zotero.Date.strToDate(date) : {};
    const year = String(parsed.year || (date.match(/\d{4}/) || [""])[0] || "");
    const extra = this.field(item, "extra");
    const doi = this.field(item, "DOI") || ((extra.match(/DOI:\s*(\S+)/i) || [])[1] || "");
    const venue = this.field(item, "publicationTitle") || this.field(item, "proceedingsTitle") || this.field(item, "bookTitle") || this.field(item, "websiteTitle") || this.field(item, "publisher");
    const lib = item.library;
    const zoteroURI = lib && lib.isGroup
      ? "zotero://select/groups/" + lib.groupID + "/items/" + item.key
      : "zotero://select/library/items/" + item.key;
    let citekey = "";
    try {
      const bbt = Zotero.BetterBibTeX && Zotero.BetterBibTeX.KeyManager && Zotero.BetterBibTeX.KeyManager.get(item.id);
      if (bbt && bbt.citationKey) citekey = bbt.citationKey;
    } catch (e) { /* Better BibTeX not installed */ }
    if (!citekey) citekey = this.field(item, "citationKey");
    if (!citekey) citekey = ((extra.match(/^Citation Key:\s*(\S+)/im) || [])[1] || "");
    let fulltext = "", hasPDF = false;
    try {
      const atts = item.isAttachment() ? [item] : item.getAttachments().map(id => Zotero.Items.get(id));
      const pdf = atts.find(a => a.isPDFAttachment && a.isPDFAttachment()) || (item.isAttachment() ? null : await item.getBestAttachment());
      if (pdf) {
        hasPDF = !!(pdf.isPDFAttachment && pdf.isPDFAttachment());
        fulltext = (await pdf.attachmentText) || "";
        if (!fulltext.trim() && hasPDF) {
          // Not extracted yet: ask Zotero to index this PDF now, then read again.
          try { await Zotero.Fulltext.indexItems([pdf.id]); } catch (e) { Zotero.logError(e); }
          fulltext = (await pdf.attachmentText) || "";
        }
      }
    } catch (e) { Zotero.logError(e); }
    return {
      key: item.key,
      title: this.field(item, "title"),
      authors: item.getCreators().map(c => c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")).filter(Boolean),
      year, venue, doi,
      abstract: this.field(item, "abstractNote"),
      fulltext,
      zoteroURI,
      citekey,
      hasPDF,
      notePattern: this.settings().noteName
    };
  },
  async addTag(itemID, tag) {
    const item = Zotero.Items.get(itemID);
    item.addTag(tag);
    await item.saveTx();
  },

  /* ---------- Model ---------- */
  async llm(messages) {
    const s = this.settings();
    if (!s.baseURL || !s.model) throw new Error("Add the model's address and name in Zotero Settings → Reading Coach.");
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(s.baseURL);
    if (!s.apiKey && !local) throw new Error("Add your API key in Zotero Settings → Reading Coach.");
    let url = s.baseURL.replace(/\/+$/, "");
    if (!/\/chat\/completions$/.test(url)) url += "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    const body = { model: s.model, messages, temperature: 0.3 };
    // GLM models think at length before answering by default; these tasks don't need it.
    if (/bigmodel\.cn|z\.ai/i.test(url)) body.thinking = { type: "disabled" };
    if (s.apiKey) headers.Authorization = "Bearer " + s.apiKey;
    let xhr;
    try {
      xhr = await Zotero.HTTP.request("POST", url, {
        headers,
        body: JSON.stringify(body),
        responseType: "json",
        timeout: 180000,
        successCodes: false
      });
    } catch (e) {
      throw new Error("Couldn't reach the model at " + url + ". Check the address and your internet connection.");
    }
    let r = xhr.response;
    if (!r || typeof r !== "object") { try { r = JSON.parse(xhr.responseText || "{}"); } catch (e) { r = {}; } }
    if (xhr.status < 200 || xhr.status >= 300) {
      const e = r.error || r;
      const code = String((e && e.code) || "");
      const said = (e && (e.message || e.msg)) || String(xhr.responseText || "").slice(0, 200) || "no details";
      const hint = {
        "1113": "Your account has no balance or no resource package covering " + s.model + ". Top up, or pick a model your package covers.",
        "1311": "Your current plan doesn't include " + s.model + ". Choose a model your plan includes.",
        "1309": "Your GLM Coding Plan has expired.",
        "1308": "You've reached a usage limit for this period. It resets later.",
        "1310": "You've reached your weekly or monthly usage limit.",
        "1302": "Too many requests at once. Wait a moment and try again.",
        "1305": "This model is very busy right now. Try again shortly, or switch to another model.",
        "1211": "The model name " + s.model + " wasn't recognised. Check the spelling in your console's model list.",
        "1220": "Your key doesn't have access to this model or service."
      }[code];
      let msg = hint
        || (xhr.status === 401 || xhr.status === 403 ? "The model service refused your API key. Check it in Zotero Settings → Reading Coach."
        : xhr.status === 402 ? "The model service says your account has no credit left."
        : xhr.status === 429 ? "The model service declined the request: a rate limit, a usage limit, or no balance for this model."
        : "The model service returned an error.");
      throw new Error(msg + " (HTTP " + xhr.status + (code ? ", code " + code : "") + ": " + said + ")");
    }
    const text = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
    if (!text) throw new Error("The model returned an empty reply. Try again.");
    return String(text).replace(/^<think>[\s\S]*?<\/think>\s*/, "");
  },

  /* ---------- Obsidian vault ---------- */
  vaultDir() {
    const v = this.settings().vaultPath;
    if (!v) throw new Error("Choose your Obsidian vault folder in Zotero Settings → Reading Coach.");
    return v;
  },
  vaultFile(rel) { return PathUtils.join(this.vaultDir(), ...String(rel).split(/[\\/]+/).filter(Boolean)); },
  obsidianURL(path) { return "obsidian://open?path=" + encodeURIComponent(path); },
  async listNotes() {
    const dir = this.vaultFile(this.settings().papersFolder);
    if (!(await IOUtils.exists(dir))) return [];
    const out = [];
    const dec = new TextDecoder();
    for (const p of await IOUtils.getChildren(dir)) {
      if (!p.toLowerCase().endsWith(".md")) continue;
      try {
        const head = dec.decode(await IOUtils.read(p, { maxBytes: 8000 }));
        out.push({ name: PathUtils.filename(p), path: p, fm: RC.parseFrontmatter(head) });
      } catch (e) { Zotero.logError(e); }
    }
    return out;
  },
  async noteExists(paper) {
    return IOUtils.exists(PathUtils.join(this.vaultFile(this.settings().papersFolder), RC.fileName(paper)));
  },
  async savePaperNote(paper, rec, mode, itemID) {
    const s = this.settings();
    const dir = this.vaultFile(s.papersFolder);
    await IOUtils.makeDirectory(dir, { ignoreExisting: true, createAncestors: true });
    let name = RC.fileName(paper);
    let path = PathUtils.join(dir, name);
    if (mode === "new") {
      for (let i = 2; await IOUtils.exists(path); i++) {
        name = RC.fileName(paper).replace(/\.md$/, " (" + i + ").md");
        path = PathUtils.join(dir, name);
      }
    }
    await IOUtils.writeUTF8(path, RC.buildNote(paper, rec));
    const url = this.obsidianURL(path);
    try {
      const item = itemID ? Zotero.Items.get(itemID) : null;
      const parent = item && (item.isAttachment() || item.isNote()) && item.parentItem ? item.parentItem : item;
      if (parent) {
        let note = parent.getNotes().map(id => Zotero.Items.get(id)).find(n => n.getNote().startsWith("<h2>Reading Coach</h2>"));
        if (!note) {
          note = new Zotero.Item("note");
          note.libraryID = parent.libraryID;
          note.parentID = parent.id;
        }
        note.setNote(RC.zoteroNoteHTML(rec, url));
        await note.saveTx();
      }
    } catch (e) { Zotero.logError(e); }
    let count = 0;
    try { count = await this.rebuildTable(); } catch (e) { Zotero.logError(e); }
    return { path, name, count };
  },
  async rebuildTable() {
    const s = this.settings();
    const notes = await this.listNotes();
    const { text, rows } = RC.buildTable(notes, s);
    const path = this.vaultFile(s.tableFile);
    await IOUtils.makeDirectory(PathUtils.parent(path), { ignoreExisting: true, createAncestors: true });
    await IOUtils.writeUTF8(path, text);
    return rows.length;
  },
  async saveTrend(rows, guess, ai) {
    const s = this.settings();
    const dir = this.vaultFile(s.trendsFolder);
    await IOUtils.makeDirectory(dir, { ignoreExisting: true, createAncestors: true });
    let path = PathUtils.join(dir, "Trend check " + RC.today() + ".md");
    for (let i = 2; await IOUtils.exists(path); i++) path = PathUtils.join(dir, "Trend check " + RC.today() + " (" + i + ").md");
    await IOUtils.writeUTF8(path, RC.trendNote(rows, guess, ai, s));
    return path;
  },

  /* ---------- Drafts, so closing the window loses nothing ---------- */
  draftPath(key) { return PathUtils.join(Zotero.DataDirectory.dir, "reading-coach", "drafts", String(key).replace(/[^\w-]/g, "") + ".json"); },
  async saveDraft(key, data) {
    const p = this.draftPath(key);
    await IOUtils.makeDirectory(PathUtils.parent(p), { ignoreExisting: true, createAncestors: true });
    await IOUtils.writeUTF8(p, JSON.stringify(data));
  },
  async loadDraft(key) {
    const p = this.draftPath(key);
    if (!(await IOUtils.exists(p))) return null;
    try { return JSON.parse(await IOUtils.readUTF8(p)); } catch (e) { return null; }
  },
  async clearDraft(key) {
    try { await IOUtils.remove(this.draftPath(key), { ignoreAbsent: true }); } catch (e) { Zotero.logError(e); }
  }
};
