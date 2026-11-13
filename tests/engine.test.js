"use strict";
// Drives the real Stockfish 19 build through the same controller the browser
// uses, with a child process standing in for the Web Worker.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Engine } = require("../engine.js");

const SF = path.join(__dirname, "..", "stockfish-19-lite-single.js");

function processTransport() {
  const child = spawn(process.execPath, [SF], { stdio: ["pipe", "pipe", "pipe"] });
  let lineHandler = () => {};
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line) lineHandler(line);
    }
  });
  return {
    send: (s) => child.stdin.write(s + "\n"),
    onLine: (fn) => (lineHandler = fn),
    onError: (fn) => child.on("error", fn),
    terminate: () => child.kill(),
  };
}

const MATE_IN_1 = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeEngine() {
  const e = new Engine({ createTransport: processTransport });
  e.setOption("UCI_ShowWDL", true);
  e.setOption("Hash", 16);
  return e;
}

test("engine: handshake, multipv and wdl", async (t) => {
  const e = makeEngine();
  t.after(() => e.terminate());
  await e.init();
  assert.match(e.name, /Stockfish/);
  const seen = [];
  const res = await e.analyse({
    fen: START,
    multipv: 3,
    depth: 8,
    onInfo: (info) => seen.push(info.multipv),
  });
  assert.equal(res.stopped, false);
  assert.equal(res.lines.length, 3);
  assert.deepEqual(res.lines.map((l) => l.multipv), [1, 2, 3]);
  assert.ok(res.best && /^[a-h][1-8][a-h][1-8]/.test(res.best));
  assert.ok(res.lines[0].depth >= 8);
  assert.ok(Array.isArray(res.lines[0].wdl));
  assert.ok(seen.length > 3);
});

test("engine: finds mate in one", async (t) => {
  const e = makeEngine();
  t.after(() => e.terminate());
  const res = await e.analyse({ fen: MATE_IN_1, multipv: 1, depth: 6 });
  assert.equal(res.best, "a1a8");
  assert.deepEqual(res.lines[0].score, { type: "mate", value: 1 });
});

test("engine: a newer request supersedes an infinite search", async (t) => {
  const e = makeEngine();
  t.after(() => e.terminate());
  const infos = [];
  const first = e.analyse({ fen: START, multipv: 1, depth: 0, onInfo: (i) => infos.push(["A", i]) });
  await new Promise((r) => setTimeout(r, 400));
  const second = e.analyse({ fen: MATE_IN_1, multipv: 1, depth: 6, onInfo: (i) => infos.push(["B", i]) });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.superseded, true);
  assert.equal(a.stopped, true);
  assert.equal(b.superseded, false);
  assert.equal(b.best, "a1a8");
  // Nothing from the old search may leak into the new one.
  for (const [tag, info] of infos) {
    if (tag === "B") assert.equal(info.score.type === "mate" || info.score.type === "cp", true);
  }
  assert.deepEqual(b.lines[0].score, { type: "mate", value: 1 });
});

test("engine: only the newest of several rapid requests runs", async (t) => {
  const e = makeEngine();
  t.after(() => e.terminate());
  const p1 = e.analyse({ fen: START, multipv: 1, depth: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const p2 = e.analyse({ fen: START, multipv: 1, depth: 0 });
  const p3 = e.analyse({ fen: MATE_IN_1, multipv: 2, depth: 6 });
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1.superseded, true);
  assert.equal(r2.superseded, true);
  assert.equal(r3.best, "a1a8");
});

test("engine: stop() ends an infinite search and keeps the lines", async (t) => {
  const e = makeEngine();
  t.after(() => e.terminate());
  const p = e.analyse({ fen: START, multipv: 2, depth: 0 });
  await new Promise((r) => setTimeout(r, 500));
  e.stop();
  const res = await p;
  assert.equal(res.stopped, true);
  assert.equal(res.superseded, false);
  assert.ok(res.lines.length >= 1);
  assert.ok(res.best);
  // and the engine is usable again afterwards
  const again = await e.analyse({ fen: MATE_IN_1, multipv: 1, depth: 5 });
  assert.equal(again.best, "a1a8");
});

test("engine: changing MultiPV between searches takes effect", async (t) => {
  const e = makeEngine();
  t.after(() => e.terminate());
  const three = await e.analyse({ fen: START, multipv: 3, depth: 6 });
  assert.equal(three.lines.length, 3);
  const one = await e.analyse({ fen: START, multipv: 1, depth: 6 });
  assert.equal(one.lines.length, 1);
});

test("engine: a failing transport rejects cleanly", async () => {
  const e = new Engine({
    createTransport: () => {
      throw new Error("no worker");
    },
  });
  const res = await e.analyse({ fen: START, multipv: 1, depth: 4 });
  assert.ok(res.error);
  assert.equal(res.best, null);
});
