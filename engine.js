/*
 * Stockfish controller. Wraps a UCI transport (a Web Worker in the browser, a
 * child process in the tests) in a small state machine so that changing the
 * position while a search is running can never mix up results:
 *
 *   idle -> searching -> (stopping) -> idle
 *
 * Only the newest request survives; an older one resolves with
 * { superseded: true }. Info lines that arrive after "stop" are ignored.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./lib.js"));
  else root.SFEngine = factory(root.SFLib);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  function workerTransport(url) {
    const w = new Worker(url);
    return {
      send: (s) => w.postMessage(s),
      onLine: (fn) => {
        w.onmessage = (e) => fn(typeof e.data === "string" ? e.data : "");
      },
      onError: (fn) => {
        w.onerror = (e) => fn(new Error((e && e.message) || "Engine worker failed to load"));
      },
      terminate: () => w.terminate(),
    };
  }

  class Engine {
    constructor(opts) {
      this.createTransport = opts.createTransport;
      this.transport = null;
      this.state = "init"; // init | idle | searching | stopping | dead
      this.current = null;
      this.queued = null;
      this.name = "";
      this.options = { MultiPV: 1 };
      this.applied = {};
      this.readyPromise = null;
    }

    setOption(name, value) {
      this.options[name] = value;
    }

    init() {
      if (this.readyPromise) return this.readyPromise;
      this.readyPromise = new Promise((resolve, reject) => {
        let t;
        try {
          t = this.createTransport();
        } catch (e) {
          this.state = "dead";
          this.readyPromise = null;
          reject(e);
          return;
        }
        this.transport = t;
        let stage = "uci";
        let settled = false;
        const fail = (err) => {
          if (settled) {
            this._fail(err);
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.state = "dead";
          this.readyPromise = null;
          try {
            t.terminate();
          } catch (_) {}
          reject(err);
        };
        const timer = setTimeout(() => fail(new Error("Engine start timed out")), 60000);
        t.onError(fail);
        t.onLine((line) => {
          if (stage === "uci") {
            if (line.startsWith("id name ")) this.name = line.slice(8).trim();
            if (line === "uciok") {
              stage = "ready";
              this._applyOptions(1);
              t.send("isready");
            }
          } else if (stage === "ready") {
            if (line === "readyok") {
              stage = "done";
              settled = true;
              clearTimeout(timer);
              this.state = "idle";
              t.onLine((l) => this._onLine(l));
              resolve(this);
            }
          }
        });
        t.send("uci");
      });
      return this.readyPromise;
    }

    // Resolves when the search ends (naturally, stopped, or superseded).
    analyse(req) {
      return new Promise((resolve) => {
        const r = {
          fen: req.fen,
          multipv: Math.max(1, req.multipv || 1),
          depth: req.depth || 0,
          onInfo: req.onInfo || null,
          resolve,
          lines: [],
          stopRequested: false,
          superseded: false,
        };
        // A crashed or failed engine is restarted by the next request.
        if (this.state === "dead") this._reset();
        // The request is queued *before* the engine is ready, so stop() and
        // newer requests can cancel it while the worker is still starting.
        if (this.queued) this._finish(this.queued, null, { stopped: true, superseded: true });
        this.queued = r;
        this.init()
          .then(() => this._pump())
          .catch((error) => {
            if (this.queued === r) {
              this.queued = null;
              resolve({ error, best: null, lines: [], stopped: true, superseded: false });
            }
          });
      });
    }

    _reset() {
      this.readyPromise = null;
      this.transport = null;
      this.applied = {};
      this.current = null;
      this.state = "init";
    }

    stop() {
      if (this.queued) {
        this._finish(this.queued, null, { stopped: true });
        this.queued = null;
      }
      if (this.state === "searching" && this.current) {
        this.current.stopRequested = true;
        this.state = "stopping";
        this.transport.send("stop");
      }
    }

    terminate() {
      this.state = "dead";
      if (this.transport) {
        try {
          this.transport.terminate();
        } catch (_) {}
      }
    }

    _pump() {
      if (this.state === "idle") {
        const r = this.queued;
        if (!r) return;
        this.queued = null;
        this._start(r);
      } else if (this.state === "searching" && this.queued) {
        this.current.superseded = true;
        this.state = "stopping";
        this.transport.send("stop");
      }
      // "stopping": the pending bestmove will pump again.
    }

    _applyOptions(multipv) {
      this.options.MultiPV = multipv;
      for (const name of Object.keys(this.options)) {
        const v = String(this.options[name]);
        if (this.applied[name] !== v) {
          this.transport.send("setoption name " + name + " value " + v);
          this.applied[name] = v;
        }
      }
    }

    _start(req) {
      this.current = req;
      this.state = "searching";
      this._applyOptions(req.multipv);
      this.transport.send("position fen " + req.fen);
      this.transport.send(req.depth > 0 ? "go depth " + req.depth : "go infinite");
    }

    _onLine(line) {
      if (line.startsWith("info")) {
        if (this.state !== "searching" || !this.current) return;
        const info = L.parseInfo(line);
        if (!info || info.bound) return;
        const cur = this.current;
        if (info.multipv > cur.multipv) return;
        cur.lines[info.multipv - 1] = info;
        if (cur.onInfo) cur.onInfo(info, cur.lines);
      } else if (line.startsWith("bestmove")) {
        const cur = this.current;
        this.current = null;
        this.state = "idle";
        if (cur) {
          const p = line.split(/\s+/);
          this._finish(cur, p[1] && p[1] !== "(none)" ? p[1] : null, {
            ponder: p[3] || null,
            stopped: cur.stopRequested || cur.superseded,
            superseded: cur.superseded,
          });
        }
        this._pump();
      }
    }

    _finish(req, best, extra) {
      req.resolve(
        Object.assign(
          { best, lines: req.lines.filter(Boolean), stopped: false, superseded: false },
          extra || {}
        )
      );
    }

    _fail(err) {
      this.state = "dead";
      if (this.current) {
        this._finish(this.current, null, { error: err, stopped: true });
        this.current = null;
      }
      if (this.queued) {
        this._finish(this.queued, null, { error: err, stopped: true });
        this.queued = null;
      }
    }
  }

  return { Engine, workerTransport };
});
