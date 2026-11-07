/* Reading Coach: Zotero 7 bootstrap entry points. */
var RC, ReadingCoach;

function install() {}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + "content/core.js");
  Services.scriptloader.loadSubScript(rootURI + "content/bridge.js");
  ReadingCoach.init({ id, version, rootURI });
  await ReadingCoach.registerPrefs();
  ReadingCoach.addToAllWindows();
  ReadingCoach.registerSection();
}

function onMainWindowLoad({ window }) {
  if (ReadingCoach) ReadingCoach.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  if (ReadingCoach) ReadingCoach.removeFromWindow(window);
}

function shutdown() {
  if (ReadingCoach) ReadingCoach.shutdown();
  ReadingCoach = undefined;
  RC = undefined;
}

function uninstall() {}
