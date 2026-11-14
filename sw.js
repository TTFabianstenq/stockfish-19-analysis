/*
 * Offline support. Strategy, chosen so a stale cache can never trap users on
 * an old version:
 *  - same-origin app files: network first, cache as the offline fallback
 *  - the engine (.js/.wasm): cache first (large, and the filename is versioned)
 *  - third-party libraries and piece images: stale-while-revalidate
 */
const CACHE = "sf19-v3";
const CORE = [
  "./",
  "index.html",
  "styles.css",
  "lib.js",
  "engine.js",
  "app.js",
  "themes.js",
  "vice-pieces.js",
  "icon.svg",
  "manifest.webmanifest",
  "stockfish-19-lite-single.js",
  "stockfish-19-lite-single.wasm",
];
const THIRD_PARTY = [
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "code.jquery.com",
  "images.chesscomfiles.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(res) {
  return res && (res.ok || res.type === "opaque");
}

function store(req, res) {
  if (cacheable(res)) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const isEngine = /stockfish-19-lite-single\.(js|wasm)$/.test(url.pathname);
    if (isEngine) {
      event.respondWith(
        caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res)))
      );
      return;
    }
    event.respondWith(
      fetch(req)
        .then((res) => store(req, res))
        .catch(() =>
          caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
        )
    );
    return;
  }

  if (THIRD_PARTY.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req).then((res) => store(req, res)).catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
