(function () {
  "use strict";

  const L = window.SFLib;
  const $ = (id) => document.getElementById(id);
  function fatal(msg) {
    const f = $("fatal");
    if (f) { f.hidden = false; f.textContent = msg; }
    console.error(msg);
  }
  if (!L || !window.SFEngine || typeof Chess === "undefined" || typeof Chessboard === "undefined") {
    fatal("Required libraries failed to load. Check your connection and hard-refresh.");
    return;
  }

  // NOTE: This is a STUB. Full app-part1 must be pushed.
  fatal("App part 1 incomplete — redeploying. Refresh in ~1 minute.");
})();
