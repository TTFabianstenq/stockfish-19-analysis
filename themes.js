(function () {
  "use strict";

  const BOARD_THEMES = [
    { id: "classic", name: "Classic", light: "#f0d9b5", dark: "#b58863" },
    { id: "green", name: "Green", light: "#eeeed2", dark: "#769656" },
    { id: "blue", name: "Blue", light: "#eae9d2", dark: "#4b7399" },
    { id: "purple", name: "Purple", light: "#e4d9f0", dark: "#7a5a9e" },
    { id: "red", name: "Red", light: "#f0d8d8", dark: "#a35454" },
    { id: "brown", name: "Walnut", light: "#e7d0a8", dark: "#8b5a2b" },
    { id: "gray", name: "Gray", light: "#e0e0e0", dark: "#6b6b6b" },
    { id: "ice", name: "Ice", light: "#e8f4fc", dark: "#5b8fad" },
    { id: "coral", name: "Coral", light: "#f5e6d3", dark: "#d08b6d" },
    { id: "olive", name: "Olive", light: "#e8ecd6", dark: "#6b7f4a" },
    { id: "slate", name: "Slate", light: "#dfe3e8", dark: "#4a5568" },
    { id: "rose", name: "Rose", light: "#f5e0e8", dark: "#9b4f6a" },
    { id: "sand", name: "Sand", light: "#f3e5c3", dark: "#c4a35a" },
    { id: "navy", name: "Navy", light: "#d6dce8", dark: "#2c3e6b" },
    { id: "tournament", name: "Tournament", light: "#ffffff", dark: "#086523" },
  ];

  const PIECE_SETS = [
    { id: "neo", name: "Neo", base: "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/" },
    { id: "wood", name: "Wood", base: "https://images.chesscomfiles.com/chess-themes/pieces/wood/150/" },
    { id: "glass", name: "Glass", base: "https://images.chesscomfiles.com/chess-themes/pieces/glass/150/" },
    { id: "newspaper", name: "Newspaper", base: "https://images.chesscomfiles.com/chess-themes/pieces/newspaper/150/" },
    { id: "cases", name: "Cases", base: "https://images.chesscomfiles.com/chess-themes/pieces/cases/150/" },
    { id: "3d_wood", name: "3D Wood", base: "https://images.chesscomfiles.com/chess-themes/pieces/3d_wood/150/" },
  ];

  let draftTheme = "green";
  let draftPieces = "neo";
  let activeTheme = "green";
  let activePieces = "neo";

  try {
    const saved = JSON.parse(localStorage.getItem("sf19-theme") || "{}");
    if (saved.board) activeTheme = saved.board;
    if (saved.pieces) activePieces = saved.pieces;
  } catch (_) {}
  draftTheme = activeTheme;
  draftPieces = activePieces;

  function $(id) { return document.getElementById(id); }

  function applyBoardTheme(id) {
    const t = BOARD_THEMES.find((x) => x.id === id) || BOARD_THEMES[1];
    document.documentElement.style.setProperty("--sq-light", t.light);
    document.documentElement.style.setProperty("--sq-dark", t.dark);
  }

  function renderSwatches() {
    const grid = $("board-swatches");
    if (!grid) return;
    grid.innerHTML = "";
    BOARD_THEMES.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch" + (t.id === draftTheme ? " selected" : "");
      btn.title = t.name;
      btn.innerHTML =
        '<span style="background:' + t.light + '"></span>' +
        '<span style="background:' + t.dark + '"></span>' +
        '<span style="background:' + t.dark + '"></span>' +
        '<span style="background:' + t.light + '"></span>';
      btn.addEventListener("click", () => {
        draftTheme = t.id;
        applyBoardTheme(t.id);
        renderSwatches();
      });
      grid.appendChild(btn);
    });
  }

  function renderPieceSets() {
    const grid = $("piece-sets");
    if (!grid) return;
    grid.innerHTML = "";
    PIECE_SETS.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "piece-set" + (s.id === draftPieces ? " selected" : "");
      btn.innerHTML =
        '<img src="' + s.base + 'wn.png" alt="" />' +
        '<img src="' + s.base + 'bk.png" alt="" />' +
        '<span class="set-name">' + s.name + "</span>";
      btn.addEventListener("click", () => {
        draftPieces = s.id;
        renderPieceSets();
        const prev = $("preview-pieces");
        if (prev) {
          prev.innerHTML =
            '<img src="' + s.base + 'wn.png" alt="" />' +
            '<img src="' + s.base + 'wq.png" alt="" />' +
            '<img src="' + s.base + 'bk.png" alt="" />';
        }
      });
      grid.appendChild(btn);
    });
  }

  function openSettings() {
    draftTheme = activeTheme;
    draftPieces = activePieces;
    applyBoardTheme(draftTheme);
    renderSwatches();
    renderPieceSets();
    const prev = $("preview-pieces");
    const set = PIECE_SETS.find((s) => s.id === draftPieces) || PIECE_SETS[0];
    if (prev) {
      prev.innerHTML =
        '<img src="' + set.base + 'wn.png" alt="" />' +
        '<img src="' + set.base + 'wq.png" alt="" />' +
        '<img src="' + set.base + 'bk.png" alt="" />';
    }
    const modal = $("settings-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeSettings(revert) {
    if (revert) applyBoardTheme(activeTheme);
    const modal = $("settings-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  function saveSettings() {
    activeTheme = draftTheme;
    applyBoardTheme(activeTheme);
    const piecesChanged = draftPieces !== activePieces;
    activePieces = draftPieces;
    try {
      localStorage.setItem(
        "sf19-theme",
        JSON.stringify({ board: activeTheme, pieces: activePieces })
      );
    } catch (_) {}
    if (piecesChanged && window.__sfBoardReload) {
      window.__sfBoardReload(activePieces);
    }
    closeSettings(false);
  }

  function wire() {
    const btn = $("btn-themes");
    if (btn) btn.addEventListener("click", openSettings);
    if ($("modal-close")) $("modal-close").addEventListener("click", () => closeSettings(true));
    if ($("modal-cancel")) $("modal-cancel").addEventListener("click", () => closeSettings(true));
    if ($("modal-backdrop")) $("modal-backdrop").addEventListener("click", () => closeSettings(true));
    if ($("modal-save")) $("modal-save").addEventListener("click", saveSettings);

    document.querySelectorAll(".modal-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".modal-tabs .tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        const panel = $("tab-" + tab.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });

    applyBoardTheme(activeTheme);
    window.__sfGetPieceBase = function () {
      const set = PIECE_SETS.find((s) => s.id === activePieces) || PIECE_SETS[0];
      return set.base;
    };
    window.__sfActivePieces = activePieces;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
