"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

test("parseInfo reads a full multipv line", () => {
  const i = L.parseInfo(
    "info depth 10 seldepth 14 multipv 2 score cp -35 wdl 100 400 500 nodes 36928 nps 329714 hashfull 11 time 112 pv c7c5 g1f3 e7e6"
  );
  assert.equal(i.depth, 10);
  assert.equal(i.multipv, 2);
  assert.deepEqual(i.score, { type: "cp", value: -35 });
  assert.deepEqual(i.wdl, [100, 400, 500]);
  assert.deepEqual(i.pv, ["c7c5", "g1f3", "e7e6"]);
  assert.equal(i.nodes, 36928);
});

test("parseInfo handles mate scores and bounds", () => {
  assert.deepEqual(L.parseInfo("info depth 5 score mate 3 pv a1a8").score, { type: "mate", value: 3 });
  assert.equal(L.parseInfo("info depth 9 score cp 40 lowerbound pv e2e4").bound, "lowerbound");
});

test("parseInfo ignores non-PV noise", () => {
  assert.equal(L.parseInfo("info string NNUE evaluation using nn.nnue"), null);
  assert.equal(L.parseInfo("info depth 5 currmove e2e4 currmovenumber 1"), null);
  assert.equal(L.parseInfo("info depth 0 score mate 0"), null);
  assert.equal(L.parseInfo("bestmove e2e4"), null);
  assert.equal(L.parseInfo(42), null);
});

test("scores flip to White's view and format", () => {
  const cp = { type: "cp", value: 123 };
  assert.deepEqual(L.scoreToWhite(cp, "b"), { type: "cp", value: -123 });
  assert.deepEqual(L.scoreToWhite(cp, "w"), cp);
  assert.equal(L.formatScore({ type: "cp", value: 32 }), "+0.32");
  assert.equal(L.formatScore({ type: "cp", value: -150 }, 1), "-1.5");
  assert.equal(L.formatScore({ type: "cp", value: 0 }), "0.00");
  assert.equal(L.formatScore({ type: "cp", value: 2 }, 1), "0.0");
  assert.equal(L.formatScore({ type: "mate", value: 4 }), "M4");
  assert.equal(L.formatScore({ type: "mate", value: -2 }), "-M2");
});

test("win percentage is symmetric and bounded", () => {
  assert.ok(Math.abs(L.winPercent(0) - 50) < 1e-9);
  assert.ok(Math.abs(L.winPercent(300) + L.winPercent(-300) - 100) < 1e-9);
  assert.ok(L.winPercent(100000) <= 100 && L.winPercent(-100000) >= 0);
  assert.equal(L.scoreWin({ type: "mate", value: 5 }), 100);
  assert.equal(L.scoreWin({ type: "mate", value: -1 }), 0);
});

test("fmtCount abbreviates", () => {
  assert.equal(L.fmtCount(950), "950");
  assert.equal(L.fmtCount(36928), "37k");
  assert.equal(L.fmtCount(1250000), "1.3M");
  assert.equal(L.fmtCount(undefined), "–");
});

test("normalizeFen pads partial FENs and rejects junk", () => {
  assert.equal(
    L.normalizeFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"),
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1"
  );
  assert.equal(L.normalizeFen(L.START_FEN), L.START_FEN);
  assert.equal(L.normalizeFen("  8/8/8/8/8/8/8/8   b  "), "8/8/8/8/8/8/8/8 b - - 0 1");
  assert.equal(L.normalizeFen("not a fen"), null);
  assert.equal(L.normalizeFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1"), null);
  assert.equal(L.normalizeFen("9/8/8/8/8/8/8/8 w - - 0 1"), null);
  assert.equal(L.normalizeFen("8/8/8/8/8/8/8/7 w - - 0 1"), null);
  assert.equal(L.normalizeFen("8/8/8/8/8/8/8/8 x - - 0 1"), null);
  assert.equal(L.normalizeFen("8/8/8/8/8/8/8/8 w KQkq e4 0 1"), null);
  assert.equal(L.normalizeFen(null), null);
});

test("checkPlacement catches positions that crash engines", () => {
  const ok = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  assert.equal(L.checkPlacement(ok), null);
  assert.match(L.checkPlacement("8/8/8/8/8/8/8/8"), /exactly one king/);
  assert.match(L.checkPlacement("4k3/8/8/8/8/8/8/8"), /exactly one king/);
  assert.match(L.checkPlacement("4k1k1/8/8/8/8/8/8/4K3"), /exactly one king/);
  assert.match(L.checkPlacement("4k2P/8/8/8/8/8/8/4K3"), /Pawns/);
  assert.match(L.checkPlacement("4k3/8/8/8/8/8/8/p3K3"), /Pawns/);
  assert.match(L.checkPlacement("4k3/pppppppp/p7/8/8/8/8/4K3"), /8 pawns/);
  assert.match(L.checkPlacement("8/8/8/3kK3/8/8/8/8"), /next to each other/);
  assert.match(L.checkPlacement("8/8/8/3k4/4K3/8/8/8"), /next to each other/);
  assert.equal(L.checkPlacement("8/8/8/3k4/8/4K3/8/8"), null);
});

test("castling rights are limited to what the board allows", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  assert.equal(L.effectiveCastling(start, "KQkq"), "KQkq");
  assert.equal(L.effectiveCastling(start, "Kq"), "Kq");
  assert.equal(L.effectiveCastling(start, ""), "-");
  // white king off e1 -> no white rights
  assert.equal(L.effectiveCastling("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1KNR", "KQkq"), "kq");
  // missing h8 rook -> no black kingside
  assert.equal(L.effectiveCastling("rnbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", "KQkq"), "KQq");
  assert.equal(L.composeFen("8/8/8/8/8/8/8/8", "b", "KQkq"), "8/8/8/8/8/8/8/8 b - - 0 1");
});

test("move accuracy and classification", () => {
  assert.ok(L.moveAccuracy(0) > 99.9);
  assert.ok(L.moveAccuracy(10) < L.moveAccuracy(5));
  assert.ok(L.moveAccuracy(100) >= 0);
  assert.equal(L.classifyDrop(0, true), "best");
  assert.equal(L.classifyDrop(3, false), "good");
  assert.equal(L.classifyDrop(12, false), "inaccuracy");
  assert.equal(L.classifyDrop(25, true), "mistake");
  assert.equal(L.classifyDrop(55, false), "blunder");
});

test("computeReview scores each side from its own point of view", () => {
  // 1.e4 (good) e5?? (drops black's chances) 2.Nf3 (best)
  const positions = [
    { win: 50, best: "e2e4", turn: "w" },
    { win: 52, best: "e7e5", turn: "b" },
    { win: 95, best: "g1f3", turn: "w" }, // black fell from 48 to 5
    { win: 95, best: null, turn: "b" },
  ];
  const r = L.computeReview(positions, ["e2e4", "e7e5", "g1f3"]);
  assert.equal(r.marks[0].cls, "best");
  assert.equal(r.marks[1].cls, "blunder"); // 48 -> 5, drop 43
  assert.equal(r.marks[2].cls, "best");
  assert.equal(r.summary.b.blunder, 1);
  assert.equal(r.summary.w.blunder, 0);
  assert.equal(r.summary.w.moves, 2);
  assert.ok(r.summary.w.accuracy > r.summary.b.accuracy);
});

test("computeReview tolerates gaps", () => {
  const r = L.computeReview([{ win: 50, best: null, turn: "w" }, null], ["e2e4"]);
  assert.equal(r.marks[0], null);
  assert.equal(r.summary.w.accuracy, null);
});
