(function () {
  "use strict";
  var s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/gh/TTFabianstenq/stockfish-19-analysis@e6180c6/app.js";
  s.onerror = function () {
    var s2 = document.createElement("script");
    s2.src = "https://raw.githubusercontent.com/TTFabianstenq/stockfish-19-analysis/e6180c6/app.js";
    s2.onerror = function () {
      var f = document.getElementById("fatal");
      if (f) { f.hidden = false; f.textContent = "Failed to load analysis app. Hard-refresh or try again."; }
    };
    document.body.appendChild(s2);
  };
  document.body.appendChild(s);
})();
