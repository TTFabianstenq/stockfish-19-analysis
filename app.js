(function () {
  "use strict";

  let game = new Chess();
  let board = null;
  let selectedPiece = null;
  let orientation = "white";
  let castling = { K: true, Q: true, k: true, q: true };
  let engine = null;
  let analysing = false;
  let syncTimer = null;
  let lastBestUci = null;

  const $ = (id) => document.getElementById(id);
  const fenInput = $("fen-input");
  const engineStatus = $("engine-status");
  const bestMoveEl = $("best-move");
  const pvEl = $("pv");
  const depthInfo = $("depth-info");
  const evalFill = $("eval-fill");
  const evalLabel = $("eval-label");
  const btnWhite = $("btn-white");
  const btnBlack = $("btn-black");
  const arrowLayer = $("arrow-layer");

  const MAP = {
    wK: "wk", wQ: "wq", wR: "wr", wB: "wb", wN: "wn", wP: "wp",
    bK: "bk", bQ: "bq", bR: "br", bB: "bb", bN: "bn", bP: "bp",
  };
  const theme = (piece) =>
    "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/" + MAP[piece] + ".png";

  const WHITE = ["wK", "wQ", "wR", "wB", "wN", "wP"];
  const BLACK = ["bK", "bQ", "bR", "bB", "bN", "bP"];
  const FILES = "abcdefgh";

  [...WHITE, ...BLACK].forEach((p) => {
    const img = new Image();
    img.src = theme(p);
  });

  function buildTray(id, pieces) {
    const el = $(id);
    el.innerHTML = "";
    pieces.forEach((p) => {
      const img = document.createElement("img");
      img.src = theme(p);
      img.alt = p;
      img.dataset.piece = p;
      img.draggable = true;
      img.addEventListener("click", () => {
        document.querySelectorAll(".tray img").forEach((i) => i.classList.remove("selected"));
        if (selectedPiece === p) {
          selectedPiece = null;
          return;
        }
        selectedPiece = p;
        img.classList.add("selected");
      });
      img.addEventListener("dragstart", (e) => {
        selectedPiece = p;
        e.dataTransfer.setData("text/plain", p);
        e.dataTransfer.effectAllowed = "copy";
      });
      el.appendChild(img);
    });
  }

  buildTray("tray-top", BLACK);
  buildTray("tray-bottom", WHITE);

  board = Chessboard("board", {
    position: "start",
    orientation: orientation,
    draggable: true,
    dropOffBoard: "trash",
    sparePieces: false,
    pieceTheme: theme,
    appearSpeed: 0,
    moveSpeed: 0,
    snapbackSpeed: 0,
    snapSpeed: 0,
    trashSpeed: 0,
    onDragStart: function () {
      clearArrows();
      return true;
    },
    onDrop: function () {
      return true;
    },
    onSnapEnd: function () {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncGameFromBoard(), 20);
    },
  });

  function sizeArrowLayer() {
    const stage = document.querySelector(".board-frame");
    if (!stage) return;
    const s = stage.getBoundingClientRect().width;
    arrowLayer.setAttribute("viewBox", "0 0 " + s + " " + s);
    arrowLayer.style.width = s + "px";
    arrowLayer.style.height = s + "px";
  }
  sizeArrowLayer();
  window.addEventListener("resize", () => {
    sizeArrowLayer();
    if (lastBestUci) drawArrow(lastBestUci);
  });

  document.getElementById("board").addEventListener("click", (e) => {
    if (!selectedPiece) return;
    const sqEl = e.target.closest("[data-square]");
    if (!sqEl) return;
    const sq = sqEl.getAttribute("data-square");
    if (!sq) return;
    const pos = board.position();
    if (pos[sq] === selectedPiece) delete pos[sq];
    else pos[sq] = selectedPiece;
    board.position(pos, false);
    clearArrows();
    syncGameFromBoard();
  });

  function squareCenter(sq) {
    const file = FILES.indexOf(sq[0]);
    const rank = parseInt(sq[1], 10) - 1;
    const stage = document.querySelector(".board-frame");
    const size = stage.getBoundingClientRect().width;
    const cell = size / 8;
    let x, y;
    if (orientation === "white") {
      x = (file + 0.5) * cell;
      y = (7 - rank + 0.5) * cell;
    } else {
      x = (7 - file + 0.5) * cell;
      y = (rank + 0.5) * cell;
    }
    return { x, y, cell };
  }

  function clearArrows() {
    arrowLayer.innerHTML = "";
    lastBestUci = null;
  }

  function drawArrow(uci) {
    clearArrows();
    if (!uci || uci.length < 4 || uci === "(none)") return;
    lastBestUci = uci;

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const a = squareCenter(from);
    const b = squareCenter(to);

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("refX", "4");
    marker.setAttribute("refY", "2.5");
    marker.setAttribute("orient", "auto");
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tip.setAttribute("d", "M0,0 L5,2.5 L0,5 Z");
    tip.setAttribute("fill", "#81b64c");
    tip.setAttribute("opacity", "0.95");
    marker.appendChild(tip);
    defs.appendChild(marker);
    arrowLayer.appendChild(defs);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const shrink = a.cell * 0.18;
    const sx = a.x + (dx / len) * shrink;
    const sy = a.y + (dy / len) * shrink;
    const ex = b.x - (dx / len) * shrink;
    const ey = b.y - (dy / len) * shrink;

    const glow = document.createElementNS("http://www.w3.org/2000/svg", "line");
    glow.setAttribute("x1", sx);
    glow.setAttribute("y1", sy);
    glow.setAttribute("x2", ex);
    glow.setAttribute("y2", ey);
    glow.setAttribute("stroke", "#81b64c");
    glow.setAttribute("stroke-width", String(a.cell * 0.22));
    glow.setAttribute("stroke-linecap", "round");
    glow.setAttribute("opacity", "0.25");
    arrowLayer.appendChild(glow);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", sx);
    line.setAttribute("y1", sy);
    line.setAttribute("x2", ex);
    line.setAttribute("y2", ey);
    line.setAttribute("stroke", "#81b64c");
    line.setAttribute("stroke-width", String(a.cell * 0.12));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("marker-end", "url(#arrowhead)");
    line.setAttribute("opacity", "0.95");
    arrowLayer.appendChild(line);

    const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circ.setAttribute("cx", a.x);
    circ.setAttribute("cy", a.y);
    circ.setAttribute("r", String(a.cell * 0.12));
    circ.setAttribute("fill", "#81b64c");
    circ.setAttribute("opacity", "0.55");
    arrowLayer.appendChild(circ);

    sizeArrowLayer();
  }

  function buildCastling() {
    let s = "";
    if (castling.K) s += "K";
    if (castling.Q) s += "Q";
    if (castling.k) s += "k";
    if (castling.q) s += "q";
    return s || "-";
  }

  function syncGameFromBoard(side) {
    const fen = board.fen();
    const stm = side || "w";
    const full = fen + " " + stm + " " + buildCastling() + " - 0 1";
    try {
      game = new Chess(full);
      fenInput.value = game.fen();
    } catch (_) {
      fenInput.value = full;
    }
  }

  syncGameFromBoard("w");

  document.querySelectorAll(".castle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.castle;
      castling[k] = !castling[k];
      btn.classList.toggle("on", castling[k]);
      syncGameFromBoard(game.turn());
    });
  });

  $("btn-flip").addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    board.orientation(orientation);
    if (lastBestUci) drawArrow(lastBestUci);
  });

  $("btn-reset").addEventListener("click", () => {
    board.position("start", false);
    castling = { K: true, Q: true, k: true, q: true };
    document.querySelectorAll(".castle").forEach((b) => b.classList.add("on"));
    selectedPiece = null;
    document.querySelectorAll(".tray img").forEach((i) => i.classList.remove("selected"));
    game = new Chess();
    fenInput.value = game.fen();
    clearOut();
    setEval(0);
    clearArrows();
  });

  $("btn-clear").addEventListener("click", () => {
    board.position({}, false);
    selectedPiece = null;
    document.querySelectorAll(".tray img").forEach((i) => i.classList.remove("selected"));
    syncGameFromBoard("w");
    clearOut();
    setEval(0);
    clearArrows();
  });

  $("btn-copy-fen").addEventListener("click", () => {
    navigator.clipboard.writeText(fenInput.value).then(() => {
      const b = $("btn-copy-fen");
      const t = b.textContent;
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = t), 1000);
    });
  });

  function clearOut() {
    engineStatus.textContent = "Ready";
    bestMoveEl.textContent = "";
    pvEl.textContent = "";
    depthInfo.textContent = "";
  }

  function setEval(cp) {
    let pct = 50 + cp / 20;
    pct = Math.max(3, Math.min(97, pct));
    evalFill.style.height = pct + "%";
    let label;
    if (Math.abs(cp) >= 900) label = cp > 0 ? "M" : "-M";
    else {
      label = (cp / 100).toFixed(1);
      if (cp > 0) label = "+" + label;
    }
    evalLabel.textContent = label;
  }

  function initEngine() {
    if (engine) return Promise.resolve(engine);
    return new Promise((resolve, reject) => {
      try {
        engine = new Worker("stockfish-19-lite-single.js");
      } catch (e) {
        engineStatus.textContent = "Worker failed to load";
        reject(e);
        return;
      }
      let ready = false;
      engine.onmessage = (e) => {
        const line = e.data;
        if (typeof line !== "string") return;
        if (line === "uciok") engine.postMessage("isready");
        else if (line === "readyok") {
          ready = true;
          engineStatus.textContent = "Engine ready";
          resolve(engine);
        } else if (line.startsWith("info") && analysing) parseInfo(line);
        else if (line.startsWith("bestmove") && analysing) {
          analysing = false;
          const move = line.split(" ")[1];
          if (move && move !== "(none)") {
            bestMoveEl.textContent = fmt(move);
            engineStatus.textContent = "Best move";
            drawArrow(move);
          } else {
            bestMoveEl.textContent = "—";
            engineStatus.textContent = "No legal moves";
            clearArrows();
          }
          btnWhite.disabled = false;
          btnBlack.disabled = false;
        }
      };
      engine.onerror = (err) => {
        engineStatus.textContent = "Engine error (missing .wasm?)";
        reject(err);
      };
      engine.postMessage("uci");
      setTimeout(() => {
        if (!ready) engineStatus.textContent = "Starting engine…";
      }, 2500);
    });
  }

  function fmt(uci) {
    if (!uci || uci.length < 4) return uci || "";
    return uci.slice(0, 2) + " → " + uci.slice(2, 4) + (uci[4] ? "=" + uci[4].toUpperCase() : "");
  }

  function parseInfo(line) {
    const d = line.match(/\bdepth (\d+)/);
    const s = line.match(/\bscore (cp|mate) (-?\d+)/);
    const p = line.match(/\bpv (.+)/);
    const n = line.match(/\bnodes (\d+)/);
    if (d) {
      depthInfo.textContent =
        "Depth " + d[1] + (n ? " · " + Number(n[1]).toLocaleString() + " nodes" : "");
    }
    if (s) {
      let cp =
        s[1] === "cp"
          ? parseInt(s[2], 10)
          : parseInt(s[2], 10) > 0
            ? 10000
            : -10000;
      if (game.turn() === "b") cp = -cp;
      setEval(cp);
    }
    if (p) {
      const moves = p[1].trim().split(/\s+/);
      if (moves[0] && moves[0].length >= 4) {
        drawArrow(moves[0]);
        bestMoveEl.textContent = fmt(moves[0]);
      }
      pvEl.textContent = moves.slice(0, 10).map(fmt).join("  ");
    }
  }

  async function analyse(side) {
    if (analysing) return;
    try {
      await initEngine();
    } catch (_) {
      return;
    }
    const full = board.fen() + " " + side + " " + buildCastling() + " - 0 1";
    try {
      game = new Chess(full);
    } catch (_) {
      engineStatus.textContent = "Invalid position";
      return;
    }
    fenInput.value = game.fen();
    if (game.game_over()) {
      engineStatus.textContent = game.in_checkmate() ? "Checkmate" : "Game over";
      bestMoveEl.textContent = "—";
      clearArrows();
      return;
    }
    analysing = true;
    btnWhite.disabled = true;
    btnBlack.disabled = true;
    clearOut();
    clearArrows();
    engineStatus.textContent = "Analysing…";
    engine.postMessage("stop");
    engine.postMessage("ucinewgame");
    engine.postMessage("position fen " + full);
    engine.postMessage("go depth 18");
  }

  btnWhite.addEventListener("click", () => analyse("w"));
  btnBlack.addEventListener("click", () => analyse("b"));

  initEngine().catch(() => {});
})();
