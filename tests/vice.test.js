"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function load() {
  const win = {};
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "vice-pieces.js"), "utf8"))(win);
  return win.__sfVicePieces;
}

test("Vice City set has all 12 pieces as valid SVG data URIs", () => {
  const set = load();
  const keys = ["wk", "wq", "wr", "wb", "wn", "wp", "bk", "bq", "br", "bb", "bn", "bp"];
  assert.deepEqual(Object.keys(set).sort(), keys.sort());
  for (const k of keys) {
    const prefix = "data:image/svg+xml;charset=utf-8,";
    assert.ok(set[k].startsWith(prefix), k);
    const svg = decodeURIComponent(set[k].slice(prefix.length));
    assert.match(svg, /^<svg [^>]*viewBox="0 0 100 100"/, k);
    assert.ok(svg.endsWith("</svg>"), k);
    assert.ok(!/<script|onload|href=/i.test(svg), k + " must be inert");
  }
});

test("every piece key used by app.js exists in the set", () => {
  const set = load();
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const m = app.match(/const MAP = \{([\s\S]*?)\};/);
  const vals = [...m[1].matchAll(/"(\w\w)"/g)].map((x) => x[1]);
  assert.equal(vals.length, 12);
  for (const v of vals) assert.ok(set[v], v);
});
