(function () {
  "use strict";

  const L = window.SFLib;
  const $ = (id) => document.getElementById(id);

  function fatal(msg) {
    const f = $("fatal");
    if (f) {
      f.hidden = false;
      f.textContent = msg;
    }
  }

  if (!window.Chess || !window.Chessboard || !window.jQuery || !L || !window.SFEngine) {
    fatal(
      "Couldn't load the chess libraries (jQuery, chess.js or chessboard.js). " +
        "Check your connection or disable content blockers, then reload."
    );
    return;
  }

  /* =====================================================================
   * State
   * ===================================================================== */

  const START_FEN = L.START_FEN;
  const FILES = "abcdefgh";
  const SVGNS = "http://www.w3.org/2000/svg";

  const S = {
    startFen: START_FEN,
    fens: [START_FEN], // fens[i] = position after i half-moves
    moves: [], // moves[i] leads from fens[i] to fens[i + 1]
    index: 0,
    orientation: "white",
    mode: "play", // "play" | "edit"
    selected: null,
    targets: [],
    positionError: null,
    castlePrefs: { K: true, Q: true, k: true, q: true },
    review: null,
  };

  let chess = new Chess(); // always mirrors fens[index]
  let board = null;
  let dragging = false;
  let dragStartSelected = null;
  let pendingMove = null;
  let pendingPromotion = null;
  let selectedPiece = null; // piece picked in the editor tray

  const PREF_KEY = "sf19-analysis";
  const A = {
    enabled: true,
    multipv: 3,
    depth: 20,
    reviewDepth: 12,
    lines: [],
    open: new Set(), // engine lines the user expanded
    liveFen: null,
    liveTurn: "w",
    run: 0,
    timer: null,
    reviewing: false,
    engineReady: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    if (typeof saved.enabled === "boolean") A.enabled = saved.enabled;
    if ([1, 2, 3, 4, 5].includes(saved.multipv)) A.multipv = saved.multipv;
    if ([0, 12, 16, 20, 24, 30].includes(saved.depth)) A.depth = saved.depth;
    if ([10, 12, 14, 16].includes(saved.reviewDepth)) A.reviewDepth = saved.reviewDepth;
  } catch (_) {}
  function savePrefs() {
    try {
      localStorage.setItem(
        PREF_KEY,
        JSON.stringify({ enabled: A.enabled, multipv: A.multipv, depth: A.depth, reviewDepth: A.reviewDepth })
      );
    } catch (_) {}
  }

  const engine = new SFEngine.Engine({
    createTransport: () => SFEngine.workerTransport("stockfish-19-lite-single.js"),
  });
  engine.setOption("UCI_ShowWDL", true);
  engine.setOption("Hash", 32);

  /* =====================================================================
   * Small helpers
   * ===================================================================== */

  const curFen = () => S.fens[S.index];

  function fields(fen) {
    const t = fen.split(" ");
    return { placement: t[0], turn: t[1], castling: t[2], ep: t[3], half: t[4], full: t[5] };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function legalMoves(sq) {
    if (S.positionError) return [];
    return chess.moves({ square: sq, verbose: true });
  }

  // Why the engine can't (or shouldn't) be asked about this position.
  function positionProblem(fen) {
    const f = fields(fen);
    const placementError = L.checkPlacement(f.placement);
    if (placementError) return placementError;
    const flipped = [f.placement, f.turn === "w" ? "b" : "w", "-", "-", "0", "1"].join(" ");
    const probe = new Chess();
    if (probe.load(flipped) && probe.in_check()) {
      return "The side that isn't to move is in check — that position is illegal.";
    }
    return null;
  }

  function terminalInfo(fen) {
    const g = new Chess();
    if (!g.load(fen)) return null;
    if (g.in_checkmate()) {
      const loser = g.turn();
      return {
        win: loser === "w" ? 0 : 100,
        label: loser === "w" ? "0-1" : "1-0",
        text: "Checkmate — " + (loser === "w" ? "Black" : "White") + " wins",
      };
    }
    if (g.in_stalemate()) return { win: 50, label: "½-½", text: "Stalemate — draw" };
    if (g.insufficient_material()) return { win: 50, label: "½-½", text: "Draw — insufficient material" };
    if (parseInt(fields(fen).half, 10) >= 100) return { win: 50, label: "½-½", text: "Draw — fifty-move rule" };
    return null;
  }

  function copyText(text, btn) {
    const done = () => {
      if (!btn) return;
      const t = btn.dataset.label || btn.textContent;
      btn.dataset.label = t;
      btn.textContent = "Copied ✓";
      setTimeout(() => (btn.textContent = t), 1200);
    };
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (_) {}
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  function setMsg(id, text, kind) {
    const m = $(id);
    m.textContent = text || "";
    m.className = "field-msg" + (kind ? " " + kind : "");
  }

  /* =====================================================================
   * Piece images / theme hook (themes.js provides the sets)
   * ===================================================================== */

  const MAP = {
    wK: "wk", wQ: "wq", wR: "wr", wB: "wb", wN: "wn", wP: "wp",
    bK: "bk", bQ: "bq", bR: "br", bB: "bb", bN: "bn", bP: "bp",
  };
  function theme(piece) {
    if ((window.__sfActivePieces === "vice" || window.__sfPieceFallback) && window.__sfVicePieces) {
      const key = MAP[piece];
      if (window.__sfVicePieces[key]) return window.__sfVicePieces[key];
    }
    const base =
      (window.__sfGetPieceBase && window.__sfGetPieceBase()) ||
      "https://images.chesscomfiles.com/chess-themes/pieces/neo/150/";
    if (base === "vice://" && window.__sfVicePieces) {
      const key = MAP[piece];
      if (window.__sfVicePieces[key]) return window.__sfVicePieces[key];
    }
    return base + MAP[piece] + ".png";
  }

  // If a remote piece set can't be fetched (offline, blocked CDN), fall back to the
  // built-in set for this session so the board is never left without pieces.
  document.addEventListener(
    "error",
    (e) => {
      const t = e.target;
      if (!t || t.tagName !== "IMG" || window.__sfPieceFallback) return;
      if (!/images\.chesscomfiles\.com/.test(t.src || "") || !window.__sfVicePieces) return;
      window.__sfPieceFallback = true;
      if (window.__sfBoardReload) window.__sfBoardReload();
      const n = document.createElement("div");
      n.className = "toast";
      n.setAttribute("role", "status");
      n.textContent = "Couldn't load that piece set, so the built-in set is showing.";
      document.body.appendChild(n);
      setTimeout(() => n.remove(), 7000);
    },
    true
  );

  const WHITE = ["wK", "wQ", "wR", "wB", "wN", "wP"];
  const BLACK = ["bK", "bQ", "bR", "bB", "bN", "bP"];
  [...WHITE, ...BLACK].forEach((p) => {
    const img = new Image();
    img.src = theme(p);
  });

  /* =====================================================================
   * Board
   * ===================================================================== */

  const boardEl = $("board");
  const arrowLayer = $("arrow-layer");

  function placementOf(fen) {
    return fen.split(" ")[0];
  }

  function createBoard(position) {
    board = Chessboard("board", {
      position: position || "start",
      orientation: S.orientation,
      draggable: true,
      dropOffBoard: "trash",
      sparePieces: false,
      pieceTheme: theme,
      appearSpeed: 0,
      moveSpeed: 0,
      snapbackSpeed: 0,
      snapSpeed: 0,
      trashSpeed: 0,
      onDragStart: onDragStart,
      onDrop: onDrop,
      onSnapEnd: onSnapEnd,
      onSnapbackEnd: onSnapbackEnd,
    });
  }

  function onDragStart(source, piece) {
    hidePromo();
    if (S.mode === "edit") {
      // With a tray piece armed, clicks place it (see the pointerup handler)
      // instead of picking up what's on the board.
      if (selectedPiece) return false;
      dragging = true;
      return true;
    }
    // Only checkmate/stalemate stop play, and those leave no legal moves.
    // Draw rules (50-move, bare kings) must not lock an analysis board.
    if (S.positionError) return false;
    if (piece[0] !== chess.turn()) return false;
    dragging = true;
    dragStartSelected = S.selected;
    selectSquare(source);
    return true;
  }

  function onDrop(source, target, piece, newPos) {
    dragging = false;
    if (S.mode === "edit") {
      if (target === "offboard") commitEdit(newPos); // chessboard.js fires no snap-end for trash
      return undefined;
    }
    pendingMove = null;
    if (target === "offboard") return "snapback";
    if (source === target) {
      if (dragStartSelected === source) clearSelection();
      return "snapback";
    }
    const mv = legalMoves(source).find((m) => m.to === target);
    if (!mv) return "snapback";
    if (mv.promotion) {
      pendingPromotion = { from: source, to: target, color: piece[0] };
      return "snapback";
    }
    pendingMove = { from: source, to: target };
    return undefined;
  }

  function onSnapEnd() {
    dragging = false;
    if (S.mode === "edit") {
      commitEdit();
      return;
    }
    if (pendingMove) {
      const m = pendingMove;
      pendingMove = null;
      if (commitMove(m.from, m.to)) syncAll();
      else board.position(placementOf(curFen()), false);
      return;
    }
    renderHighlights();
  }

  // chessboard.js reports a snapback here, not through onSnapEnd.
  function onSnapbackEnd() {
    dragging = false;
    if (S.mode === "play" && pendingPromotion) {
      showPromo();
      return;
    }
    renderHighlights();
  }

  /* ---------- sizing ---------- */

  function fitBoard() {
    const col = $("board-col");
    const evalW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--eval-w")) || 30;
    const avail = col.clientWidth - evalW - 10;
    const heightCap = window.innerWidth > 1060 ? Math.max(380, window.innerHeight - 215) : 760;
    const size = Math.max(240, Math.floor(Math.min(avail, 720, heightCap) / 8) * 8);
    const prev = document.documentElement.style.getPropertyValue("--board-size");
    document.documentElement.style.setProperty("--board-size", size + "px");
    // resize() rebuilds the squares, which drops our highlight classes.
    if (board && prev !== size + "px") {
      board.resize();
      renderHighlights();
    }
  }

  /* ---------- highlights ---------- */

  function sqEl(sq) {
    return boardEl.querySelector('[data-square="' + sq + '"]');
  }

  function renderHighlights() {
    boardEl
      .querySelectorAll(".hl-from,.hl-to,.hl-sel,.hl-target,.hl-cap,.hl-check")
      .forEach((n) => n.classList.remove("hl-from", "hl-to", "hl-sel", "hl-target", "hl-cap", "hl-check"));
    const add = (sq, cls) => {
      const n = sq && sqEl(sq);
      if (n) n.classList.add(cls);
    };
    const last = S.index > 0 ? S.moves[S.index - 1] : null;
    if (last) {
      add(last.from, "hl-from");
      add(last.to, "hl-to");
    }
    if (S.mode === "play") {
      if (S.selected) {
        add(S.selected, "hl-sel");
        S.targets.forEach((t) => {
          add(t, "hl-target");
          if (chess.get(t)) add(t, "hl-cap");
        });
      }
      if (!S.positionError && chess.in_check()) {
        const rows = chess.board();
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const p = rows[r][c];
            if (p && p.type === "k" && p.color === chess.turn()) add(FILES[c] + (8 - r), "hl-check");
          }
        }
      }
    }
  }

  function selectSquare(sq) {
    S.selected = sq;
    S.targets = legalMoves(sq).map((m) => m.to);
    renderHighlights();
  }

  function clearSelection() {
    S.selected = null;
    S.targets = [];
    renderHighlights();
  }

  /* ---------- arrows (drawn in an 800x800 space: 100 units per square) ---------- */

  function squareCenter(sq) {
    const file = FILES.indexOf(sq[0]);
    const rank = parseInt(sq[1], 10) - 1;
    return S.orientation === "white"
      ? { x: (file + 0.5) * 100, y: (7 - rank + 0.5) * 100 }
      : { x: (7 - file + 0.5) * 100, y: (rank + 0.5) * 100 };
  }

  function clearArrows() {
    arrowLayer.textContent = "";
  }

  const ARROW_STYLE = [
    { color: "#81b64c", opacity: 0.92, width: 17 },
    { color: "#e0a458", opacity: 0.7, width: 13 },
    { color: "#5aa0e6", opacity: 0.62, width: 11 },
    { color: "#b58bd6", opacity: 0.55, width: 10 },
    { color: "#d97b7b", opacity: 0.5, width: 9 },
  ];

  // `focus` is the index of a hovered engine line: its arrow is drawn on top at
  // full strength and the others fade back.
  function drawArrows(ucis, focus) {
    clearArrows();
    const hasFocus = Number.isInteger(focus) && !!ucis[focus];
    const order = ucis.map((_, i) => i).reverse();
    if (hasFocus) order.splice(order.indexOf(focus), 1), order.push(focus);
    for (const k of order) {
      const uci = ucis[k];
      if (!uci || uci.length < 4) continue;
      const look = ARROW_STYLE[k] || ARROW_STYLE[ARROW_STYLE.length - 1];
      const st = hasFocus
        ? k === focus
          ? { color: look.color, width: Math.max(look.width, 15), opacity: 0.96 }
          : { color: look.color, width: look.width, opacity: look.opacity * 0.3 }
        : look;
      const a = squareCenter(uci.slice(0, 2));
      const b = squareCenter(uci.slice(2, 4));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      const headLen = st.width * 2.1;
      const headHalf = st.width * 1.15;
      const tip = { x: b.x - ux * 10, y: b.y - uy * 10 };
      const base = { x: tip.x - ux * headLen, y: tip.y - uy * headLen };
      const start = { x: a.x + ux * 22, y: a.y + uy * 22 };
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("opacity", String(st.opacity));
      const shaft = document.createElementNS(SVGNS, "line");
      shaft.setAttribute("x1", start.x);
      shaft.setAttribute("y1", start.y);
      shaft.setAttribute("x2", base.x + ux * 2);
      shaft.setAttribute("y2", base.y + uy * 2);
      shaft.setAttribute("stroke", st.color);
      shaft.setAttribute("stroke-width", st.width);
      shaft.setAttribute("stroke-linecap", "round");
      const head = document.createElementNS(SVGNS, "polygon");
      head.setAttribute(
        "points",
        [
          tip.x + "," + tip.y,
          base.x - uy * headHalf + "," + (base.y + ux * headHalf),
          base.x + uy * headHalf + "," + (base.y - ux * headHalf),
        ].join(" ")
      );
      head.setAttribute("fill", st.color);
      g.appendChild(shaft);
      g.appendChild(head);
      arrowLayer.appendChild(g);
    }
  }

  /* ---------- promotion chooser ---------- */

  const PROMO_NAMES = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" };

  function showPromo() {
    const p = pendingPromotion;
    if (!p) return;
    const box = $("promo");
    box.textContent = "";
    ["q", "r", "b", "n"].forEach((t) => {
      const b = el("button", "promo-btn");
      b.type = "button";
      b.setAttribute("aria-label", PROMO_NAMES[t]);
      const img = new Image();
      img.src = theme(p.color + t.toUpperCase());
      img.alt = PROMO_NAMES[t];
      b.appendChild(img);
      b.addEventListener("click", () => {
        const pp = pendingPromotion;
        hidePromo();
        if (pp && commitMove(pp.from, pp.to, t)) syncAll();
      });
      box.appendChild(b);
    });
    box.hidden = false;
  }

  function hidePromo() {
    pendingPromotion = null;
    $("promo").hidden = true;
  }
  $("promo").addEventListener("click", (e) => {
    if (e.target === $("promo")) hidePromo();
  });

  /* =====================================================================
   * Game model
   * ===================================================================== */

  function syncPrefsFromFen(fen) {
    const r = fields(fen).castling;
    S.castlePrefs = { K: r.includes("K"), Q: r.includes("Q"), k: r.includes("k"), q: r.includes("q") };
  }

  function invalidateReview() {
    reviewToken++;
    S.review = null;
    if (A.reviewing) {
      A.reviewing = false;
      engine.stop();
      $("review-progress").hidden = true;
      $("btn-review").disabled = false;
    }
  }
  let reviewToken = 0;

  // Replace the whole game with a single starting position. Returns an error
  // message when the FEN can't be used at all, otherwise null.
  function setNewPosition(fen) {
    const norm = L.normalizeFen(fen);
    if (!norm) return "That doesn't look like a valid FEN.";
    const v = new Chess().validate_fen(norm);
    if (!v.valid) return "Invalid FEN: " + v.error;
    invalidateReview();
    S.startFen = norm;
    S.fens = [norm];
    S.moves = [];
    S.index = 0;
    S.positionError = positionProblem(norm);
    syncPrefsFromFen(norm);
    return null;
  }

  // Plays a move on the current position, dropping any later moves.
  function commitMove(from, to, promo) {
    if (S.positionError) return false;
    const mv = chess.move({ from: from, to: to, promotion: promo || "q" });
    if (!mv) return false;
    invalidateReview();
    S.moves = S.moves.slice(0, S.index);
    S.fens = S.fens.slice(0, S.index + 1);
    S.moves.push({
      from: mv.from,
      to: mv.to,
      promotion: mv.promotion || null,
      san: mv.san,
      color: mv.color,
      uci: mv.from + mv.to + (mv.promotion || ""),
    });
    S.fens.push(chess.fen());
    S.index++;
    syncPrefsFromFen(chess.fen());
    return true;
  }

  function goTo(i) {
    i = Math.max(0, Math.min(S.moves.length, i));
    if (i === S.index) return;
    S.index = i;
    syncAll();
  }

  /* ---------- editor ---------- */

  function commitEdit(posObj) {
    const obj = posObj || board.position();
    const placement = Chessboard.objToFen ? Chessboard.objToFen(obj) : board.fen();
    const f = fields(curFen());
    const rights = ["K", "Q", "k", "q"].filter((k) => S.castlePrefs[k]).join("");
    const keep = Object.assign({}, S.castlePrefs);
    const fen = L.composeFen(placement || "8/8/8/8/8/8/8/8", f.turn, rights || "-", 1);
    if (placement === placementOf(curFen())) return; // piece dropped back where it was
    setNewPosition(fen);
    S.castlePrefs = keep; // remember the user's intent even if the board can't support it right now
    syncAll({ boardInSync: true });
  }

  function placePiece(sq, piece) {
    const pos = board.position();
    if (pos[sq] === piece) delete pos[sq];
    else pos[sq] = piece;
    board.position(pos, false);
    commitEdit(pos);
  }

  function setMode(mode) {
    S.mode = mode;
    $("btn-edit").setAttribute("aria-pressed", String(mode === "edit"));
    $("btn-edit").textContent = mode === "edit" ? "Done editing" : "Edit position";
    $("editor").hidden = mode !== "edit";
    hidePromo();
    selectedPiece = null;
    document.querySelectorAll(".tray img").forEach((i) => i.classList.remove("selected"));
    S.selected = null;
    S.targets = [];
    renderHighlights();
  }

  function buildTray(id, pieces) {
    const root = $(id);
    root.textContent = "";
    pieces.forEach((p) => {
      const img = document.createElement("img");
      img.src = theme(p);
      img.alt = p;
      img.dataset.piece = p;
      img.draggable = true;
      img.addEventListener("click", (e) => {
        e.stopPropagation();
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
        img.classList.add("selected");
      });
      root.appendChild(img);
    });
  }

  function buildTrays() {
    buildTray("tray-black", BLACK);
    buildTray("tray-white", WHITE);
  }

  boardEl.addEventListener("dragover", (e) => {
    if (S.mode === "edit" && selectedPiece) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });

  boardEl.addEventListener("drop", (e) => {
    if (S.mode !== "edit") return;
    e.preventDefault();
    const piece = e.dataTransfer.getData("text/plain") || selectedPiece;
    if (!piece) return;
    for (const node of document.elementsFromPoint(e.clientX, e.clientY)) {
      const sq = node.getAttribute && node.getAttribute("data-square");
      if (sq) {
        placePiece(sq, piece);
        break;
      }
    }
  });

  // A tap fires touch events and then synthesized mouse events; chessboard.js
  // reacts to both, so the second pass would undo the selection the first one
  // made. Cancelling touchend suppresses the synthesized mouse events.
  boardEl.addEventListener(
    "touchend",
    (e) => {
      if (e.cancelable) e.preventDefault();
    },
    { capture: true, passive: false }
  );

  // Click-to-move, click-to-place. Drags are handled by chessboard.js
  // (`dragging` is true from drag start until the drop is processed).
  boardEl.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (dragging) return;
    const node = e.target.closest && e.target.closest("[data-square]");
    if (!node) return;
    const sq = node.getAttribute("data-square");
    if (S.mode === "edit") {
      if (selectedPiece) placePiece(sq, selectedPiece);
      return;
    }
    if (S.positionError) return;
    if (S.selected && S.selected !== sq) {
      const mv = legalMoves(S.selected).find((m) => m.to === sq);
      if (mv) {
        if (mv.promotion) {
          pendingPromotion = { from: S.selected, to: sq, color: chess.turn() };
          showPromo();
        } else if (commitMove(S.selected, sq)) {
          syncAll();
        }
        return;
      }
    }
    const pc = chess.get(sq);
    if (pc && pc.color === chess.turn()) return; // selecting is done by the drag handler
    clearSelection();
  });

  /* =====================================================================
   * Rendering: position controls, moves, players
   * ===================================================================== */

  function renderPosition() {
    const fen = curFen();
    const f = fields(fen);
    $("fen-input").value = fen;
    document.querySelectorAll("#seg-turn button").forEach((b) => b.classList.toggle("on", b.dataset.turn === f.turn));
    const possible = L.possibleCastling(f.placement);
    document.querySelectorAll(".castle").forEach((b) => {
      const k = b.dataset.castle;
      b.classList.toggle("on", f.castling.includes(k));
      b.disabled = !possible[k];
    });
  }

  function renderPlayers() {
    const turn = fields(curFen()).turn;
    const top = S.orientation === "white" ? "b" : "w";
    const bottom = top === "w" ? "b" : "w";
    $("name-top").textContent = top === "w" ? "White" : "Black";
    $("name-bottom").textContent = bottom === "w" ? "White" : "Black";
    $("dot-top").classList.toggle("active", turn === top);
    $("dot-bottom").classList.toggle("active", turn === bottom);
  }

  const MARKS = { inaccuracy: "?!", mistake: "?", blunder: "??" };

  function renderMoves() {
    const root = $("moves");
    root.textContent = "";
    const tag = $("result-tag");
    tag.textContent = "";
    if (!S.moves.length) {
      root.appendChild(
        el("div", "empty", "No moves yet. Drag a piece to play, load a PGN, or just analyse this position.")
      );
      return;
    }
    const f = fields(S.startFen);
    let num = parseInt(f.full, 10) || 1;
    let row = null;
    const newRow = (label) => {
      row = el("div", "mrow");
      row.setAttribute("role", "listitem");
      row.appendChild(el("span", "mn", label));
      root.appendChild(row);
    };
    S.moves.forEach((m, i) => {
      if (m.color === "w") newRow(num + ".");
      else if (i === 0) {
        newRow(num + "…");
        row.appendChild(el("span", "mv blank"));
      }
      const b = el("button", "mv" + (i + 1 === S.index ? " cur" : ""), m.san);
      b.type = "button";
      const mk = S.review && S.review.marks[i];
      if (mk && MARKS[mk.cls]) b.appendChild(el("span", "mark " + mk.cls, MARKS[mk.cls]));
      b.addEventListener("click", () => goTo(i + 1));
      row.appendChild(b);
      if (m.color === "b") num++;
    });
    const cur = root.querySelector(".mv.cur");
    if (cur) {
      const top = cur.offsetTop;
      if (top < root.scrollTop) root.scrollTop = Math.max(0, top - 4);
      else if (top + cur.offsetHeight > root.scrollTop + root.clientHeight) {
        root.scrollTop = top + cur.offsetHeight - root.clientHeight + 4;
      }
    }
    if (S.index === S.moves.length) {
      const t = terminalInfo(curFen());
      if (t) tag.textContent = t.label;
    }
  }

  /* =====================================================================
   * Engine UI
   * ===================================================================== */

  let lastEval = null;

  function applyEvalBar() {
    const bar = $("eval-bar");
    const fill = $("eval-fill");
    const label = $("eval-label");
    bar.classList.toggle("flipped", S.orientation === "black");
    if (!lastEval) {
      fill.style.height = "50%";
      label.textContent = "–";
      label.className = "eval-label mid";
      bar.setAttribute("aria-label", "Evaluation not available");
      return;
    }
    fill.style.height = Math.max(2, Math.min(98, lastEval.win)) + "%";
    label.textContent = lastEval.label;
    label.className = "eval-label " + (lastEval.win >= 50 ? "at-white" : "at-black");
    bar.setAttribute("aria-label", "Evaluation " + lastEval.label + " for White");
  }

  function setEvalBar(e) {
    lastEval = e;
    $("eval-bar").classList.remove("stale");
    applyEvalBar();
  }

  function setStatus(text, kind) {
    const s = $("engine-status");
    s.textContent = text;
    s.className = "engine-status" + (kind ? " " + kind : "");
  }

  function renderWdl(info, turn) {
    const box = $("wdl");
    if (!info || !info.wdl) {
      box.hidden = true;
      return;
    }
    let [w, d, l] = info.wdl;
    if (turn === "b") [w, l] = [l, w];
    const total = w + d + l || 1;
    const pct = (x) => (x / total) * 100;
    const set = (id, v) => {
      const n = $(id);
      n.style.width = pct(v) + "%";
      n.textContent = pct(v) >= 12 ? Math.round(pct(v)) + "%" : "";
    };
    set("wdl-w", w);
    set("wdl-d", d);
    set("wdl-l", l);
    box.hidden = false;
  }

  let hoverLine = null; // engine line under the pointer
  const arrowList = () => A.lines.map((i) => (i ? i.pv[0] : null));
  function redrawArrows() {
    if (A.lines[0] && A.liveFen === curFen()) drawArrows(arrowList(), hoverLine);
  }

  const pvCache = new Map();

  function pvTokens(fen, pv) {
    const key = fen + "|" + pv.join(" ");
    if (pvCache.has(key)) return pvCache.get(key);
    const g = new Chess();
    g.load(fen);
    const f = fields(fen);
    let num = parseInt(f.full, 10) || 1;
    const out = [];
    for (let i = 0; i < pv.length && i < 18; i++) {
      const u = pv[i];
      const mv = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!mv) break;
      let prefix = "";
      if (mv.color === "w") prefix = num + ".";
      else if (i === 0) prefix = num + "…";
      out.push({ san: mv.san, uci: u, prefix: prefix });
      if (mv.color === "b") num++;
    }
    if (pvCache.size > 400) pvCache.clear();
    pvCache.set(key, out);
    return out;
  }

  function renderLines() {
    const root = $("lines");
    root.textContent = "";
    if (!A.liveFen) return;
    A.lines.forEach((info, idx) => {
      if (!info) return;
      const sw = L.scoreToWhite(info.score, A.liveTurn);
      const row = el("div", "line" + (idx === 0 ? " best" : "") + (A.open.has(idx) ? " open" : ""));
      row.dataset.idx = String(idx);
      const rank = el("span", "rank", String(idx + 1));
      rank.title = "Click to show the whole line";
      row.appendChild(rank);
      row.appendChild(
        el("span", "score " + (L.scoreWin(sw) >= 50 ? "for-white" : "for-black"), L.formatScore(sw, 2))
      );
      const pv = el("div", "pv");
      pvTokens(A.liveFen, info.pv).forEach((t, k) => {
        if (t.prefix) pv.appendChild(el("span", "pv-num", t.prefix));
        const m = el("span", "pv-move" + (k === 0 ? " first" : ""), t.san);
        m.dataset.line = String(idx);
        m.dataset.k = String(k);
        pv.appendChild(m);
        pv.appendChild(document.createTextNode(" "));
      });
      row.appendChild(pv);
      root.appendChild(row);
    });
  }

  // Rows are rebuilt on every engine update, so "open" lives in state, not the DOM.
  function toggleOpen(row) {
    const idx = parseInt(row.dataset.idx, 10);
    if (A.open.has(idx)) A.open.delete(idx);
    else A.open.add(idx);
    row.classList.toggle("open", A.open.has(idx));
  }
  $("lines").addEventListener("dblclick", (e) => {
    const row = e.target.closest && e.target.closest(".line");
    if (row) toggleOpen(row);
  });
  $("lines").addEventListener("mouseover", (e) => {
    const row = e.target.closest && e.target.closest(".line");
    const idx = row ? parseInt(row.dataset.idx, 10) : null;
    if (idx !== hoverLine) {
      hoverLine = idx;
      redrawArrows();
    }
  });
  $("lines").addEventListener("mouseleave", () => {
    if (hoverLine !== null) {
      hoverLine = null;
      redrawArrows();
    }
  });

  $("lines").addEventListener("click", (e) => {
    const rk = e.target.closest && e.target.closest(".rank");
    if (rk) {
      toggleOpen(rk.parentNode);
      return;
    }
    const t = e.target.closest && e.target.closest(".pv-move");
    if (!t) return;
    playPv(parseInt(t.dataset.line, 10), parseInt(t.dataset.k, 10));
  });

  function playPv(lineIdx, k) {
    const info = A.lines[lineIdx];
    if (!info || A.liveFen !== curFen() || S.mode === "edit") return;
    let played = false;
    for (const u of info.pv.slice(0, k + 1)) {
      if (!commitMove(u.slice(0, 2), u.slice(2, 4), u[4])) break;
      played = true;
    }
    if (played) syncAll();
  }

  function playBest() {
    if (S.mode === "edit") return;
    const top = A.lines[0];
    if (top && A.liveFen === curFen()) playPv(0, 0);
  }

  function renderEngine() {
    const top = A.lines[0];
    if (!top || A.liveFen !== curFen()) return;
    const sw = L.scoreToWhite(top.score, A.liveTurn);
    setEvalBar({ win: L.scoreWin(sw), label: L.formatScore(sw, 1) });
    renderWdl(top, A.liveTurn);
    renderLines();
    redrawArrows();
    const cap = A.depth ? "/" + A.depth : "";
    $("depth-info").textContent =
      "Depth " + top.depth + cap + " (sel. " + top.seldepth + ") · " + L.fmtCount(top.nodes) + " nodes · " +
      L.fmtCount(top.nps) + " n/s";
  }

  let renderTimer = null;
  let lastRender = 0;
  function queueEngineRender() {
    if (renderTimer) return;
    const wait = Math.max(0, 150 - (performance.now() - lastRender));
    renderTimer = setTimeout(() => {
      renderTimer = null;
      lastRender = performance.now();
      renderEngine();
    }, wait);
  }

  function clearEngineView() {
    A.lines = [];
    A.liveFen = null;
    $("lines").textContent = "";
    $("depth-info").textContent = "";
    $("wdl").hidden = true;
    clearArrows();
  }

  function stopAnalysis() {
    A.run++;
    engine.stop();
  }

  function scheduleAnalysis(immediate) {
    clearTimeout(A.timer);
    A.timer = setTimeout(startAnalysis, immediate ? 0 : 120);
  }

  function startAnalysis() {
    if (A.reviewing) return;
    if (!A.enabled) {
      stopAnalysis();
      setStatus("Analysis is off");
      return;
    }
    if (document.hidden && A.depth === 0) {
      stopAnalysis();
      setStatus("Paused while the tab is in the background");
      return;
    }
    const fen = curFen();
    const run = ++A.run;
    A.lines = [];
    if (A.liveFen !== fen) A.open.clear();
    A.liveFen = fen;
    A.liveTurn = fields(fen).turn;
    $("lines").textContent = "";
    $("depth-info").textContent = "";
    $("wdl").hidden = true;
    clearArrows();

    if (S.positionError) {
      engine.stop();
      setStatus(S.positionError, "warn");
      setEvalBar(null);
      return;
    }
    const term = terminalInfo(fen);
    if (term) {
      engine.stop();
      setStatus(term.text);
      setEvalBar({ win: term.win, label: term.label });
      return;
    }

    setStatus(A.engineReady ? "Analysing…" : "Loading engine…", "busy");
    let firstInfo = true;
    engine
      .analyse({
        fen: fen,
        multipv: A.multipv,
        depth: A.depth,
        onInfo: (info, lines) => {
          if (run !== A.run) return;
          if (firstInfo) {
            firstInfo = false;
            A.engineReady = true;
            setStatus("Analysing…", "busy");
          }
          A.lines = lines.slice();
          queueEngineRender();
        },
      })
      .then((res) => {
        if (run !== A.run) return;
        if (res.error) {
          setStatus("Engine error: " + (res.error.message || "couldn't start") + ". Try reloading the page.", "error");
          return;
        }
        A.engineReady = true;
        if (res.lines.length) A.lines = res.lines;
        clearTimeout(renderTimer);
        renderTimer = null;
        renderEngine();
        const top = A.lines[0];
        setStatus(res.stopped ? "Paused" : "Done · depth " + (top ? top.depth : A.depth));
      });
  }

  /* =====================================================================
   * Everything that depends on the current position
   * ===================================================================== */

  let urlTimer = null;
  function updateUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      try {
        const u = new URL(location.href);
        const fen = curFen();
        if (fen === START_FEN) u.searchParams.delete("fen");
        else u.searchParams.set("fen", fen);
        history.replaceState(null, "", u.toString());
      } catch (_) {}
    }, 300);
  }

  function syncAll(opts) {
    opts = opts || {};
    const fen = curFen();
    chess = new Chess();
    chess.load(fen);
    S.selected = null;
    S.targets = [];
    pendingMove = null;
    hidePromo();
    if (!opts.boardInSync && board) board.position(placementOf(fen), false);
    renderPosition();
    renderPlayers();
    renderMoves();
    renderHighlights();
    renderGraph();
    renderReviewSummary();
    updateUrl();

    // engine view: drop stale lines, show the reviewed eval if we have one
    // The old search is now about a different position: invalidate it right away so its
    // result can't land during the debounce window and mark the new position "Done".
    if (!A.reviewing) stopAnalysis();
    clearEngineView();
    const rv = S.review && S.review.results[S.index];
    if (rv) setEvalBar({ win: rv.win, label: rv.label });
    else $("eval-bar").classList.add("stale");
    // Never leave "Done" on screen for a position that is no longer shown.
    if (A.enabled && !A.reviewing) setStatus(A.engineReady ? "Analysing…" : "Loading engine…", "busy");
    scheduleAnalysis(false);
  }

  /* =====================================================================
   * Game review
   * ===================================================================== */

  async function runReview() {
    if (A.reviewing) return;
    if (S.positionError) {
      setMsg("pgn-msg", S.positionError, "error");
      return;
    }
    if (!S.moves.length) {
      setMsg("pgn-msg", "Play some moves or load a PGN first — there's nothing to review yet.", "error");
      return;
    }
    setMsg("pgn-msg", "");
    const token = ++reviewToken;
    A.reviewing = true;
    stopAnalysis();
    clearEngineView();
    const fens = S.fens.slice();
    const moves = S.moves.slice();
    const depth = A.reviewDepth;
    $("btn-review").disabled = true;
    $("review-progress").hidden = false;
    $("review-summary").hidden = true;
    setStatus("Reviewing game…", "busy");

    const positions = new Array(fens.length);
    const results = new Array(fens.length);
    S.review = null;
    let aborted = false;

    for (let i = 0; i < fens.length; i++) {
      if (token !== reviewToken) {
        aborted = true;
        break;
      }
      $("review-fill").style.width = (i / fens.length) * 100 + "%";
      $("review-text").textContent = "Position " + (i + 1) + " of " + fens.length;
      const fen = fens[i];
      const turn = fields(fen).turn;
      const term = terminalInfo(fen);
      if (term) {
        positions[i] = { win: term.win, best: null, turn: turn };
        results[i] = { win: term.win, label: term.label };
        continue;
      }
      const res = await engine.analyse({ fen: fen, multipv: 1, depth: depth });
      if (token !== reviewToken || res.stopped || res.error) {
        aborted = true;
        if (res.error && token === reviewToken) setStatus("Engine error during review.", "error");
        break;
      }
      const top = res.lines[0];
      if (!top) continue;
      const sw = L.scoreToWhite(top.score, turn);
      const win = L.scoreWin(sw);
      positions[i] = { win: win, best: res.best, turn: turn };
      results[i] = { win: win, label: L.formatScore(sw, 1) };
      if (i === S.index) setEvalBar({ win: win, label: results[i].label });
    }

    if (token !== reviewToken) return; // cancelled or game changed; whoever did that cleaned up
    A.reviewing = false;
    $("review-progress").hidden = true;
    $("btn-review").disabled = false;
    if (aborted) {
      scheduleAnalysis(true);
      return;
    }
    const rv = L.computeReview(positions, moves.map((m) => m.uci));
    S.review = { results: results, marks: rv.marks, summary: rv.summary };
    renderMoves();
    renderGraph();
    renderReviewSummary();
    const rr = results[S.index];
    if (rr) setEvalBar({ win: rr.win, label: rr.label });
    scheduleAnalysis(true);
  }

  function cancelReview() {
    if (!A.reviewing) return;
    invalidateReview();
    renderGraph();
    renderReviewSummary();
    scheduleAnalysis(true);
  }

  function renderReviewSummary() {
    const box = $("review-summary");
    box.textContent = "";
    if (!S.review) {
      box.hidden = true;
      return;
    }
    const sm = S.review.summary;
    const table = el("table", "sum-table");
    const head = el("tr");
    ["", "White", "Black"].forEach((h) => head.appendChild(el("th", "", h)));
    table.appendChild(head);
    const addRow = (label, w, b, cls, valCls) => {
      const tr = el("tr");
      tr.appendChild(el("td", "", label));
      const tw = el("td", cls || "", w);
      const tb = el("td", cls || "", b);
      if (valCls) {
        if (w !== "0" && w !== "–") tw.classList.add(valCls);
        if (b !== "0" && b !== "–") tb.classList.add(valCls);
      }
      tr.appendChild(tw);
      tr.appendChild(tb);
      table.appendChild(tr);
    };
    const acc = (x) => (x == null ? "–" : x.toFixed(0) + "%");
    addRow("Accuracy", acc(sm.w.accuracy), acc(sm.b.accuracy), "acc");
    addRow("Inaccuracies", String(sm.w.inaccuracy), String(sm.b.inaccuracy), "", "c-inacc");
    addRow("Mistakes", String(sm.w.mistake), String(sm.b.mistake), "", "c-mist");
    addRow("Blunders", String(sm.w.blunder), String(sm.b.blunder), "", "c-blun");
    addRow("Best moves", String(sm.w.best), String(sm.b.best), "");
    box.appendChild(table);
    box.appendChild(
      el(
        "p",
        "sum-note",
        "Reviewed at depth " + A.reviewDepth + ". Accuracy is the average per-move score from the win-probability " +
          "lost on each move — a guide, not an official rating."
      )
    );
    box.hidden = false;
  }

  function renderGraph() {
    const card = $("graph-card");
    const svg = $("graph");
    if (!S.review) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    svg.textContent = "";
    const W = 800;
    const H = 140;
    const n = S.review.results.length;
    const x = (i) => (n === 1 ? 0 : (i * W) / (n - 1));
    const wins = [];
    let prev = 50;
    S.review.results.forEach((r) => {
      prev = r ? r.win : prev;
      wins.push(prev);
    });
    const y = (w) => H * (1 - w / 100);
    const mk = (tag, attrs) => {
      const e = document.createElementNS(SVGNS, tag);
      Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
      return e;
    };
    svg.appendChild(mk("rect", { x: 0, y: 0, width: W, height: H, fill: "#2a2a2a" }));
    const pts = wins.map((w, i) => x(i) + "," + y(w));
    if (n === 1) pts.push(W + "," + y(wins[0]));
    svg.appendChild(
      mk("polygon", { points: "0," + H + " " + pts.join(" ") + " " + W + "," + H, fill: "#e4e4e4", opacity: "0.92" })
    );
    svg.appendChild(mk("line", { x1: 0, y1: H / 2, x2: W, y2: H / 2, stroke: "#777", "stroke-width": 1, "stroke-dasharray": "4 4" }));
    const colors = { inaccuracy: "#f0c24b", mistake: "#e8893a", blunder: "#d9534f" };
    S.review.marks.forEach((m, i) => {
      if (m && colors[m.cls]) {
        svg.appendChild(mk("circle", { cx: x(i + 1), cy: y(wins[i + 1]), r: m.cls === "inaccuracy" ? 3 : 4.5, fill: colors[m.cls] }));
      }
    });
    svg.appendChild(mk("line", { x1: x(S.index), y1: 0, x2: x(S.index), y2: H, stroke: "#81b64c", "stroke-width": 2.5 }));
  }

  $("graph").addEventListener("click", (e) => {
    if (!S.review) return;
    const rect = $("graph").getBoundingClientRect();
    const n = S.review.results.length;
    goTo(Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)));
  });

  /* =====================================================================
   * Import / export
   * ===================================================================== */

  function buildPgn() {
    const g = new Chess();
    if (S.startFen !== START_FEN) g.load(S.startFen);
    S.moves.forEach((m) => g.move({ from: m.from, to: m.to, promotion: m.promotion || undefined }));
    const d = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    g.header(
      "Event", "Stockfish 19 Analysis",
      "Site", "stockfish-19-analysis.vercel.app",
      "Date", d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate())
    );
    return g.pgn({ max_width: 80, newline_char: "\n" });
  }

  const FEN_LIKE = /^\s*([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+(\s|$)/;

  function loadPgnText(text) {
    text = (text || "").trim();
    if (!text) return "Paste a PGN or FEN first.";
    if (FEN_LIKE.test(text) && text.indexOf("[") === -1) {
      const err = setNewPosition(text.split("\n")[0]);
      if (err) return err;
      syncAll();
      return null;
    }
    const first = text.split(/\n\s*\n(?=\[Event )/)[0];
    const g = new Chess();
    if (!g.load_pgn(first, { sloppy: true })) return "Couldn't read that PGN. Check it for typos or illegal moves.";
    const hist = g.history({ verbose: true });
    const hdr = g.header();
    let start = START_FEN;
    if (hdr.FEN) {
      const n = L.normalizeFen(hdr.FEN);
      if (n) start = n;
    }
    if (!hist.length && start === START_FEN) return "That PGN doesn't contain any moves.";
    const replay = new Chess();
    if (!replay.load(start)) return "The PGN's starting position is invalid.";
    const fens = [start];
    const moves = [];
    for (const m of hist) {
      const mv = replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      if (!mv) return "Couldn't replay that game.";
      moves.push({
        from: mv.from,
        to: mv.to,
        promotion: mv.promotion || null,
        san: mv.san,
        color: mv.color,
        uci: mv.from + mv.to + (mv.promotion || ""),
      });
      fens.push(replay.fen());
    }
    invalidateReview();
    S.startFen = start;
    S.fens = fens;
    S.moves = moves;
    S.index = 0;
    S.positionError = positionProblem(start);
    syncPrefsFromFen(start);
    syncAll();
    return null;
  }

  /* =====================================================================
   * Wiring
   * ===================================================================== */

  function applyEditedFen(fen) {
    const err = setNewPosition(fen);
    if (err) {
      setMsg("fen-msg", err, "error");
      return;
    }
    setMsg("fen-msg", "");
    syncAll();
  }

  function wire() {
    // navigation
    $("nav-first").addEventListener("click", () => goTo(0));
    $("nav-prev").addEventListener("click", () => goTo(S.index - 1));
    $("nav-next").addEventListener("click", () => goTo(S.index + 1));
    $("nav-last").addEventListener("click", () => goTo(S.moves.length));
    $("btn-flip").addEventListener("click", flip);

    // position controls
    $("btn-load-fen").addEventListener("click", () => {
      const err = setNewPosition($("fen-input").value);
      if (err) {
        setMsg("fen-msg", err, "error");
        return;
      }
      setMsg("fen-msg", "Position loaded.", "ok");
      syncAll();
    });
    $("fen-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("btn-load-fen").click();
    });
    $("fen-input").addEventListener("input", () => setMsg("fen-msg", ""));
    $("btn-copy-fen").addEventListener("click", () => copyText(curFen(), $("btn-copy-fen")));
    $("btn-share").addEventListener("click", () => {
      const u = new URL(location.href);
      u.hash = "";
      if (curFen() === START_FEN) u.searchParams.delete("fen");
      else u.searchParams.set("fen", curFen());
      copyText(u.toString(), $("btn-share"));
    });

    document.querySelectorAll("#seg-turn button").forEach((b) =>
      b.addEventListener("click", () => {
        const f = fields(curFen());
        if (f.turn === b.dataset.turn) return;
        const rights = f.castling === "-" ? "" : f.castling;
        applyEditedFen(L.composeFen(f.placement, b.dataset.turn, rights || "-", f.full));
      })
    );
    document.querySelectorAll(".castle").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.disabled) return;
        const k = b.dataset.castle;
        const f = fields(curFen());
        let r = f.castling === "-" ? "" : f.castling;
        r = r.includes(k) ? r.replace(k, "") : r + k;
        applyEditedFen(L.composeFen(f.placement, f.turn, r || "-", f.full));
      })
    );

    $("btn-edit").addEventListener("click", () => setMode(S.mode === "edit" ? "play" : "edit"));
    $("btn-reset").addEventListener("click", () => {
      applyEditedFen(START_FEN);
      setMode("play");
    });
    $("btn-clear").addEventListener("click", () => {
      applyEditedFen("8/8/8/8/8/8/8/8 w - - 0 1");
      setMode("edit");
    });

    // game import / export
    $("btn-load-pgn").addEventListener("click", () => {
      const err = loadPgnText($("pgn-input").value);
      setMsg("pgn-msg", err || "Loaded. Use ← → to step through the game, or press “Review game”.", err ? "error" : "ok");
    });
    $("btn-copy-pgn").addEventListener("click", () => copyText(buildPgn(), $("btn-copy-pgn")));
    $("btn-review").addEventListener("click", runReview);
    $("btn-review-cancel").addEventListener("click", cancelReview);

    // engine controls
    $("btn-analysis").addEventListener("click", toggleAnalysis);
    $("btn-play-best").addEventListener("click", playBest);
    $("sel-lines").value = String(A.multipv);
    $("sel-depth").value = String(A.depth);
    $("sel-review-depth").value = String(A.reviewDepth);
    $("sel-lines").addEventListener("change", (e) => {
      A.multipv = +e.target.value;
      savePrefs();
      scheduleAnalysis(true);
    });
    $("sel-depth").addEventListener("change", (e) => {
      A.depth = +e.target.value;
      savePrefs();
      scheduleAnalysis(true);
    });
    $("sel-review-depth").addEventListener("change", (e) => {
      A.reviewDepth = +e.target.value;
      savePrefs();
    });

    document.addEventListener("visibilitychange", () => {
      if (A.depth === 0 && A.enabled) scheduleAnalysis(true);
    });

    // keyboard
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
      if (!$("settings-modal").classList.contains("hidden")) return;
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); goTo(S.index - 1); break;
        case "ArrowRight": e.preventDefault(); goTo(S.index + 1); break;
        case "Home": e.preventDefault(); goTo(0); break;
        case "End": e.preventDefault(); goTo(S.moves.length); break;
        case "f": case "F": flip(); break;
        case "a": case "A": toggleAnalysis(); break;
        case "b": case "B": playBest(); break;
        case "e": case "E": setMode(S.mode === "edit" ? "play" : "edit"); break;
        case "Escape": hidePromo(); clearSelection(); break;
        default: break;
      }
    });

    // keep the board sized to its column
    window.addEventListener("resize", fitBoard);
    if (window.ResizeObserver) new ResizeObserver(fitBoard).observe($("board-col"));
  }

  function flip() {
    S.orientation = S.orientation === "white" ? "black" : "white";
    board.orientation(S.orientation);
    renderPlayers();
    applyEvalBar();
    renderHighlights();
    redrawArrows();
  }

  function toggleAnalysis() {
    A.enabled = !A.enabled;
    savePrefs();
    const sw = $("btn-analysis");
    sw.classList.toggle("on", A.enabled);
    sw.setAttribute("aria-checked", String(A.enabled));
    if (A.reviewing) return; // the review owns the engine; the setting applies once it finishes
    if (A.enabled) scheduleAnalysis(true);
    else {
      stopAnalysis();
      clearEngineView();
      setStatus("Analysis is off");
      $("eval-bar").classList.add("stale");
    }
  }

  // themes.js calls this after the piece set changes
  window.__sfBoardReload = function () {
    const pos = board.position();
    board.destroy();
    createBoard(pos);
    fitBoard();
    renderHighlights();
    buildTrays();
  };

  /* =====================================================================
   * Boot
   * ===================================================================== */

  const initial = new URLSearchParams(location.search).get("fen");
  if (initial) {
    const err = setNewPosition(initial);
    if (err) console.warn("Ignoring ?fen=: " + err);
  }

  createBoard(placementOf(curFen()));
  buildTrays();
  fitBoard();
  wire();
  $("btn-analysis").classList.toggle("on", A.enabled);
  $("btn-analysis").setAttribute("aria-checked", String(A.enabled));
  syncAll({ boardInSync: true });
  applyEvalBar();

  engine
    .init()
    .then(() => {
      A.engineReady = true;
      if (!A.enabled) setStatus("Analysis is off");
    })
    .catch((err) => {
      setStatus("The engine couldn't start (" + (err && err.message ? err.message : "unknown error") + "). Reload the page to try again.", "error");
    });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
