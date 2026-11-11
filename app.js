(function () {
  "use strict";

  let game = new Chess();
  let board = null;
  let selectedPiece = null;
  let orientation = "white";
  let castling = { K: true, Q: true, k: true, q: true };
  let engine = null;
  let analysing = false;

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

  const WHITE_PIECES = ["wK", "wQ", "wR", "wB", "wN", "wP"];
  const BLACK_PIECES = ["bK", "bQ", "bR", "bB", "bN", "bP"];
  const PIECE_CDN = "https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/";

  function buildTray(containerId, pieces) {
    const el = $(containerId);
    el.innerHTML = "";
    pieces.forEach((p) => {
      const img = document.createElement("img");
      img.src = PIECE_CDN + p + ".png";
      img.alt = p;
      img.dataset.piece = p;
      img.draggable = true;
      img.addEventListener("click", () => selectPiece(p, img));
      img.addEventListener("dragstart", (e) => {
        selectedPiece = p;
        e.dataTransfer.setData("text/plain", p);
      });
      el.appendChild(img);
    });
  }

  function selectPiece(piece, imgEl) {
    document.querySelectorAll(".piece-tray img").forEach((i) => i.classList.remove("selected"));
    if (selectedPiece === piece) {
      selectedPiece = null;
      return;
    }
    selectedPiece = piece;
    imgEl.classList.add("selected");
  }

  buildTray("tray-top", BLACK_PIECES);
  buildTray("tray-bottom", WHITE_PIECES);

  board = Chessboard("board", {
    position: "start",
    orientation: orientation,
    draggable: true,
    dropOffBoard: "trash",
    sparePieces: false,
    pieceTheme: PIECE_CDN + "{piece}.png",
    onDragStart: function () { return true; },
    onDrop: function () { return true; },
    onSnapEnd: function () { syncGameFromBoard(); },
  });

  document.getElementById("board").addEventListener("click", (e) => {
    const square = e.target.closest("[data-square]");
    if (!square || !selectedPiece) return;
    const sq = square.dataset.square;
    const pos = board.position();
    if (pos[sq] === selectedPiece) delete pos[sq];
    else pos[sq] = selectedPiece;
    board.position(pos, false);
    syncGameFromBoard();
  });

  function buildCastlingString() {
    let s = "";
    if (castling.K) s += "K";
    if (castling.Q) s += "Q";
    if (castling.k) s += "k";
    if (castling.q) s += "q";
    return s || "-";
  }

  function syncGameFromBoard(sideToMove) {
    const fen = board.fen();
    const side = sideToMove || "w";
    const castle = buildCastlingString();
    const fullFen = `${fen} ${side} ${castle} - 0 1`;
    try {
      game = new Chess(fullFen);
      fenInput.value = game.fen();
    } catch (err) {
      fenInput.value = fullFen;
    }
    updateEvalBar(0);
  }

  syncGameFromBoard("w");

  document.querySelectorAll(".castle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.castle;
      castling[key] = !castling[key];
      btn.classList.toggle("active", castling[key]);
      syncGameFromBoard(game.turn());
    });
  });

  $("btn-flip").addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    board.orientation(orientation);
  });

  $("btn-reset").addEventListener("click", () => {
    board.position("start");
    castling = { K: true, Q: true, k: true, q: true };
    document.querySelectorAll(".castle-btn").forEach((b) => b.classList.add("active"));
    selectedPiece = null;
    document.querySelectorAll(".piece-tray img").forEach((i) => i.classList.remove("selected"));
    game = new Chess();
    fenInput.value = game.fen();
    clearEngineOutput();
    updateEvalBar(0);
  });

  $("btn-clear").addEventListener("click", () => {
    board.position({});
    selectedPiece = null;
    document.querySelectorAll(".piece-tray img").forEach((i) => i.classList.remove("selected"));
    syncGameFromBoard("w");
    clearEngineOutput();
    updateEvalBar(0);
  });

  $("btn-copy-fen").addEventListener("click", () => {
    fenInput.select();
    navigator.clipboard.writeText(fenInput.value).then(() => {
      const btn = $("btn-copy-fen");
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = old), 1200);
    });
  });

  function clearEngineOutput() {
    engineStatus.textContent = "Ready";
    bestMoveEl.textContent = "";
    pvEl.textContent = "";
    depthInfo.textContent = "";
  }

  function updateEvalBar(cp) {
    let pct = 50 + (cp / 20);
    pct = Math.max(2, Math.min(98, pct));
    evalFill.style.height = pct + "%";
    let label;
    if (Math.abs(cp) > 900) label = cp > 0 ? "M" : "-M";
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
        engineStatus.textContent = "Failed to load engine worker";
        reject(e);
        return;
      }
      let ready = false;
      engine.onmessage = function (e) {
        const line = e.data;
        if (typeof line !== "string") return;
        if (line === "uciok") engine.postMessage("isready");
        else if (line === "readyok") {
          ready = true;
          engineStatus.textContent = "Engine ready (Stockfish 19)";
          resolve(engine);
        } else if (line.startsWith("info") && analysing) parseInfo(line);
        else if (line.startsWith("bestmove") && analysing) {
          analysing = false;
          const parts = line.split(" ");
          const move = parts[1];
          if (move && move !== "(none)") {
            bestMoveEl.textContent = formatMove(move);
            engineStatus.textContent = "Best move found";
          } else {
            bestMoveEl.textContent = "—";
            engineStatus.textContent = "No legal moves";
          }
          btnWhite.disabled = false;
          btnBlack.disabled = false;
        }
      };
      engine.onerror = function (err) {
        console.error(err);
        engineStatus.textContent = "Engine error – check console";
        reject(err);
      };
      engine.postMessage("uci");
      setTimeout(() => {
        if (!ready) engineStatus.textContent = "Engine taking long to start…";
      }, 4000);
    });
  }

  function formatMove(uci) {
    if (!uci || uci.length < 4) return uci;
    return uci.slice(0, 2) + " → " + uci.slice(2, 4) + (uci.length > 4 ? "=" + uci[4].toUpperCase() : "");
  }

  function parseInfo(line) {
    const depthMatch = line.match(/\bdepth (\d+)/);
    const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
    const pvMatch = line.match(/\bpv (.+)/);
    const nodesMatch = line.match(/\bnodes (\d+)/);
    if (depthMatch) {
      depthInfo.textContent = `Depth ${depthMatch[1]}` + (nodesMatch ? ` · ${Number(nodesMatch[1]).toLocaleString()} nodes` : "");
    }
    if (scoreMatch) {
      let cp = scoreMatch[1] === "cp" ? parseInt(scoreMatch[2], 10) : (parseInt(scoreMatch[2], 10) > 0 ? 10000 : -10000);
      if (game.turn() === "b") cp = -cp;
      updateEvalBar(cp);
    }
    if (pvMatch) {
      pvEl.textContent = pvMatch[1].trim().split(/\s+/).slice(0, 8).map(formatMove).join("  ");
    }
  }

  async function runAnalysis(side) {
    if (analysing) return;
    try { await initEngine(); } catch (e) { return; }
    const pos = board.fen();
    const castle = buildCastlingString();
    const fullFen = `${pos} ${side} ${castle} - 0 1`;
    try { game = new Chess(fullFen); } catch (err) {
      engineStatus.textContent = "Invalid position – fix pieces/kings";
      return;
    }
    fenInput.value = game.fen();
    if (game.game_over()) {
      engineStatus.textContent = game.in_checkmate() ? "Checkmate" : "Game over";
      bestMoveEl.textContent = "—";
      return;
    }
    analysing = true;
    btnWhite.disabled = true;
    btnBlack.disabled = true;
    clearEngineOutput();
    engineStatus.textContent = "Analysing…";
    engine.postMessage("stop");
    engine.postMessage("ucinewgame");
    engine.postMessage("position fen " + fullFen);
    engine.postMessage("go depth 18");
  }

  btnWhite.addEventListener("click", () => runAnalysis("w"));
  btnBlack.addEventListener("click", () => runAnalysis("b"));
  initEngine().catch(() => {});
})();
