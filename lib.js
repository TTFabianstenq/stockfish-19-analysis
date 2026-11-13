/*
 * Pure helpers shared by the UI and the tests: UCI parsing, score maths,
 * FEN sanity checks and game-review scoring. No DOM, no chess.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SFLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  /* ---------- scores ---------- */

  // Win probability (0-100) for the side the score is from, using the
  // logistic curve Lichess fitted to engine centipawn scores.
  function winPercent(cp) {
    const c = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }

  // Engine scores are from the side to move's view; the UI wants White's view.
  function scoreToWhite(score, turn) {
    return turn === "b" ? { type: score.type, value: -score.value } : score;
  }

  // White-view score -> White win percentage.
  function scoreWin(score) {
    if (score.type === "mate") return score.value > 0 ? 100 : 0;
    return winPercent(score.value);
  }

  // White-view score -> label such as "+0.32", "-1.5", "M4", "-M2".
  function formatScore(score, decimals) {
    const d = decimals == null ? 2 : decimals;
    if (score.type === "mate") {
      return (score.value < 0 ? "-M" : "M") + Math.abs(score.value);
    }
    const v = score.value / 100;
    const s = Math.abs(v).toFixed(d);
    if (v > 0 && Number(s) !== 0) return "+" + s;
    if (v < 0 && Number(s) !== 0) return "-" + s;
    return (0).toFixed(d);
  }

  function fmtCount(n) {
    if (!isFinite(n) || n == null) return "–";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "k";
    return String(Math.round(n));
  }

  /* ---------- UCI ---------- */

  // Parses one "info ..." line. Returns null for anything that is not a
  // usable principal-variation line (info string, currmove, depth 0, bounds
  // are returned with .bound set so callers can skip them).
  function parseInfo(line) {
    if (typeof line !== "string" || line.slice(0, 5) !== "info ") return null;
    const t = line.trim().split(/\s+/);
    if (t[1] === "string") return null;
    const o = { multipv: 1 };
    for (let i = 1; i < t.length; i++) {
      switch (t[i]) {
        case "depth": o.depth = +t[++i]; break;
        case "seldepth": o.seldepth = +t[++i]; break;
        case "multipv": o.multipv = +t[++i]; break;
        case "nodes": o.nodes = +t[++i]; break;
        case "nps": o.nps = +t[++i]; break;
        case "time": o.time = +t[++i]; break;
        case "hashfull": o.hashfull = +t[++i]; break;
        case "tbhits": o.tbhits = +t[++i]; break;
        case "score":
          o.score = { type: t[i + 1], value: +t[i + 2] };
          i += 2;
          if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") o.bound = t[++i];
          break;
        case "wdl":
          o.wdl = [+t[i + 1], +t[i + 2], +t[i + 3]];
          i += 3;
          break;
        case "pv":
          o.pv = t.slice(i + 1);
          i = t.length;
          break;
        default:
          break;
      }
    }
    if (!o.score || (o.score.type !== "cp" && o.score.type !== "mate")) return null;
    if (!isFinite(o.score.value)) return null;
    if (!o.pv || !o.pv.length || !o.depth) return null;
    return o;
  }

  /* ---------- FEN ---------- */

  const PLACEMENT_RE = /^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+$/;

  // Accepts partial FENs ("placement" or "placement w") and returns a full
  // six-field FEN, or null when it cannot possibly be a position.
  function normalizeFen(input) {
    if (typeof input !== "string") return null;
    const t = input.trim().split(/\s+/);
    if (!t[0] || t.length > 6) return null;
    if (!PLACEMENT_RE.test(t[0])) return null;
    const rows = t[0].split("/");
    for (const row of rows) {
      let n = 0;
      for (const ch of row) n += /\d/.test(ch) ? +ch : 1;
      if (n !== 8) return null;
    }
    const turn = t[1] === undefined ? "w" : t[1].toLowerCase();
    if (turn !== "w" && turn !== "b") return null;
    const castling = t[2] === undefined ? "-" : t[2];
    if (!/^(-|[KQkq]+)$/.test(castling)) return null;
    const ep = t[3] === undefined ? "-" : t[3];
    if (!/^(-|[a-h][36])$/.test(ep)) return null;
    const half = t[4] === undefined ? "0" : t[4];
    const full = t[5] === undefined ? "1" : t[5];
    if (!/^\d+$/.test(half) || !/^\d+$/.test(full) || +full < 1) return null;
    return [t[0], turn, castling, ep, half, full].join(" ");
  }

  // Things that make Stockfish misbehave. Returns an error message or null.
  function checkPlacement(placement) {
    const count = {};
    const rows = placement.split("/");
    for (let r = 0; r < rows.length; r++) {
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) continue;
        count[ch] = (count[ch] || 0) + 1;
        if ((ch === "P" || ch === "p") && (r === 0 || r === 7)) {
          return "Pawns can't stand on the first or last rank.";
        }
      }
    }
    if ((count.K || 0) !== 1 || (count.k || 0) !== 1) {
      return "Each side needs exactly one king.";
    }
    for (const side of ["PNBRQK", "pnbrqk"]) {
      let total = 0;
      for (const ch of side) total += count[ch] || 0;
      if (total > 16) return "A side can't have more than 16 pieces.";
    }
    if ((count.P || 0) > 8 || (count.p || 0) > 8) return "A side can't have more than 8 pawns.";
    // Adjacent kings are impossible and can trip up the engine.
    const b = expandPlacement(placement);
    let wk = null;
    let bk = null;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (b[r][c] === "K") wk = [r, c];
        else if (b[r][c] === "k") bk = [r, c];
      }
    }
    if (wk && bk && Math.max(Math.abs(wk[0] - bk[0]), Math.abs(wk[1] - bk[1])) <= 1) {
      return "The kings can't be next to each other.";
    }
    return null;
  }

  function expandPlacement(placement) {
    return placement.split("/").map((row) => {
      const out = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) out.push("");
        else out.push(ch);
      }
      return out;
    });
  }

  // Which castling rights are physically possible for this placement.
  function possibleCastling(placement) {
    const b = expandPlacement(placement);
    const at = (r, c) => (b[r] && b[r][c]) || "";
    return {
      K: at(7, 4) === "K" && at(7, 7) === "R",
      Q: at(7, 4) === "K" && at(7, 0) === "R",
      k: at(0, 4) === "k" && at(0, 7) === "r",
      q: at(0, 4) === "k" && at(0, 0) === "r",
    };
  }

  // Drops castling rights that the placement cannot support.
  function effectiveCastling(placement, rights) {
    const ok = possibleCastling(placement);
    let s = "";
    for (const k of ["K", "Q", "k", "q"]) if (ok[k] && rights.includes(k)) s += k;
    return s || "-";
  }

  function composeFen(placement, turn, rights, fullmove) {
    return [placement, turn, effectiveCastling(placement, rights), "-", "0", fullmove || 1].join(" ");
  }

  /* ---------- game review ---------- */

  // Lichess' accuracy curve: win-percentage points lost by a move -> 0..100.
  function moveAccuracy(drop) {
    const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669;
    return Math.max(0, Math.min(100, a));
  }

  function classifyDrop(drop, isBest) {
    if (drop >= 30) return "blunder";
    if (drop >= 20) return "mistake";
    if (drop >= 10) return "inaccuracy";
    return isBest ? "best" : "good";
  }

  /*
   * positions[i] = { win: White win% at position i, best: engine's best UCI
   * move there (or null), turn: "w"|"b" side to move }.
   * playedUcis[i] is the move that leads from position i to i+1.
   */
  function computeReview(positions, playedUcis) {
    const marks = [];
    const side = {
      w: { acc: [], blunder: 0, mistake: 0, inaccuracy: 0, best: 0 },
      b: { acc: [], blunder: 0, mistake: 0, inaccuracy: 0, best: 0 },
    };
    for (let i = 0; i < playedUcis.length; i++) {
      const before = positions[i];
      const after = positions[i + 1];
      if (!before || !after) {
        marks.push(null);
        continue;
      }
      const mover = before.turn;
      const wb = mover === "w" ? before.win : 100 - before.win;
      const wa = mover === "w" ? after.win : 100 - after.win;
      const drop = Math.max(0, wb - wa);
      const isBest = !!before.best && before.best === playedUcis[i];
      const cls = classifyDrop(drop, isBest);
      const acc = moveAccuracy(drop);
      marks.push({ cls, drop, acc });
      const s = side[mover];
      s.acc.push(acc);
      if (cls === "blunder") s.blunder++;
      else if (cls === "mistake") s.mistake++;
      else if (cls === "inaccuracy") s.inaccuracy++;
      else if (cls === "best") s.best++;
    }
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return {
      marks,
      summary: {
        w: Object.assign({}, side.w, { accuracy: mean(side.w.acc), moves: side.w.acc.length }),
        b: Object.assign({}, side.b, { accuracy: mean(side.b.acc), moves: side.b.acc.length }),
      },
    };
  }

  return {
    START_FEN,
    winPercent,
    scoreToWhite,
    scoreWin,
    formatScore,
    fmtCount,
    parseInfo,
    normalizeFen,
    checkPlacement,
    possibleCastling,
    effectiveCastling,
    composeFen,
    moveAccuracy,
    classifyDrop,
    computeReview,
  };
});
