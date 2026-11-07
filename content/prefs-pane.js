/* Reading Coach settings pane: binds fields to Zotero prefs and adds the folder picker and connection test. */
(function () {
  const PREF = "extensions.readingcoach.";
  function bind() {
    const root = document.getElementById("readingcoach-prefs");
    if (!root) return false;
    root.querySelectorAll("[data-pref]").forEach(el => {
      const k = el.getAttribute("data-pref");
      const v = Zotero.Prefs.get(PREF + k, true);
      el.value = v == null ? "" : String(v);
      el.addEventListener("input", () => {
        if (k === "maxChars") { const n = parseInt(el.value, 10); if (n > 0) Zotero.Prefs.set(PREF + k, n, true); }
        else Zotero.Prefs.set(PREF + k, el.value, true);
      });
    });
    const choose = document.getElementById("rc-choose");
    if (choose) choose.addEventListener("click", async () => {
      try {
        const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
        const fp = new FilePicker();
        fp.init(window, "Choose your Obsidian vault", fp.modeGetFolder);
        if ((await fp.show()) === fp.returnOK) {
          const input = root.querySelector('[data-pref="vaultPath"]');
          input.value = fp.file;
          Zotero.Prefs.set(PREF + "vaultPath", fp.file, true);
        }
      } catch (e) {
        Zotero.logError(e);
        Zotero.alert(window, "Reading Coach", "The folder picker didn't open. Type the vault folder's full path instead.");
      }
    });
    const test = document.getElementById("rc-test");
    if (test) test.addEventListener("click", async () => {
      const out = document.getElementById("rc-test-result");
      out.textContent = "Testing…";
      try {
        const r = await Zotero.ReadingCoach.llm([{ role: "user", content: "Reply with the single word: ready" }]);
        out.textContent = "Connected. The model replied: " + String(r).slice(0, 40);
      } catch (e) { out.textContent = e.message; }
    });
    return true;
  }
  if (!bind()) setTimeout(bind, 300);
})();
