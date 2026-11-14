# Stockfish 19 Analysis

A free chess analysis board that runs **Stockfish 19** (lite, single-thread NNUE, WebAssembly) entirely in your browser. Nothing is uploaded; there is no backend and no sign-up.

Live site: https://stockfish-19-analysis.vercel.app

## Features

- **Live analysis** with up to 5 lines (MultiPV), configurable depth or infinite search, win/draw/loss bar, and coloured best-move arrows
- **Play any line**: click a move in an engine line to play it, or press `B` to play the best move
- **Game review**: run Stockfish over a whole game for per-side accuracy, inaccuracy / mistake / blunder marks in the move list, and a clickable evaluation graph
- **Import / export**: paste a PGN or FEN, copy the PGN, or share a link to the current position (`?fen=...`)
- **Move list and navigation** with keyboard shortcuts (`←` `→` `Home` `End`)
- **Position editor**: place or delete pieces, set side to move and castling rights; impossible positions get a clear message instead of a broken engine
- Click-to-move, drag-to-move and tap-to-move, with a promotion chooser
- 16 board colours and 7 piece sets, saved in your browser. Includes **Vice City**: a neon lagoon board with original art pieces (sunglasses pawns, seahorse knights) that are built in, so they work offline. If a remote piece set fails to load, the board falls back to it
- Installable and works offline after the first visit (service worker)

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | previous / next move |
| `Home` / `End` | first / last position |
| `F` | flip board |
| `A` | analysis on / off |
| `B` | play the engine's best move |
| `E` | edit position |
| `Esc` | close dialogs, clear selection |

## Development

It is a static site with no build step. Serve the folder with any static server:

```sh
npx serve .
```

Tests (Node 20+) run the pure logic and drive the real Stockfish 19 build through the same controller the browser uses:

```sh
npm test
```

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | page and styles |
| `app.js` | UI: board, move list, analysis panel, review, import / export |
| `engine.js` | UCI controller: one search at a time, newest request wins, no stale results |
| `lib.js` | pure helpers: UCI parsing, score maths, FEN checks, review scoring |
| `themes.js`, `vice-pieces.js` | board / piece themes |
| `sw.js`, `manifest.webmanifest` | offline support and installability |
| `stockfish-19-lite-single.{js,wasm}` | the engine |

## Credits

Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3), based on [Stockfish](https://github.com/official-stockfish/Stockfish). Board UI: [chessboard.js](https://chessboardjs.com/) and [chess.js](https://github.com/jhlywa/chess.js). Piece images for the non-default sets are loaded from chess.com's public asset CDN.
