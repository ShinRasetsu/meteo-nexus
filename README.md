# MeteoNexus Tactical HUD

Active-telemetry PWA for driving: real-time weather, route intelligence, magnetometer-fused heading, and an "Aero HUD" overlay. Single-page app shipped from `index.html` with a Web Worker (`worker.js`) for heavy route math and a Service Worker (`sw.js`) for offline-first caching.

## Quick start

```bash
npm install
npm run precheck      # builds Tailwind + runs the full 5-phase audit chain + verify-scanners
npm test              # 127 substring guards (sanity.test.js)
npm run lint          # ESLint 10 flat config
npm run audit         # extract + TDZ + brace + CSP + DOM-null scanners
npm run audit:verify  # self-tests the scanners inject bug classes and catch them
```

A static file server (any will do) is enough to run the app locally — there is no build step beyond the Tailwind precompile:

```bash
npx @tailwindcss/cli --input src/tailwind.css --output tailwind.min.css --minify
# then serve the repo root with your tool of choice, e.g. `npx serve .`
```

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | App shell: markup + inline `<script type="module">` engine (~5100 lines) |
| `worker.js` | Web Worker: Valhalla polyline decode, route-node calc, Overpass top-K |
| `sw.js` | Service Worker: app shell + API SWR + map tile byte-budget cache + CDN cache |
| `src/tailwind.css` | Tailwind source — compiled to `tailwind.min.css` |
| `tests/` | Audit scanners + scanner self-tests + sanity substring suite |
| `manifest.json` | PWA manifest |
| `VERSION` | Single source of truth for version (read by header/footer badges at runtime) |
| `HISTORY.md` | Per-release changelog + handoff contract (read at the start of every session) |
| `eslint.config.js` | ESLint 10 flat config; `no-empty` with `allowEmptyCatch: false` |
| `deploy.bat` | Windows one-shot `git add && commit && push` (does **NOT** run precheck) |

## The handoff contract

`HISTORY.md` is the contract between sessions. Read it + `VERSION` before any work. The version is bumped by editing `VERSION` (single source of truth) and syncing `package.json`. See `HISTORY.md:32-40` for the bump procedure.

## Testing philosophy

The project has two layers of defence:

1. **Structural guards** (`tests/sanity.test.js`, 127 substring assertions) — verify that critical strings and patterns are still present in the source. They do NOT parse JS, do NOT execute functions, do NOT detect TDZ. They are *necessary but not sufficient* (per `HISTORY.md:86-92`).
2. **Audit scanners** (`npm run audit`) — a 5-phase pipeline that actually parses and statically analyses the inline module:
   - Phase 1: `node --check` on the extracted module (syntax parse)
   - Phase 2: acorn-based TDZ scanner (use-before-declare in same block scope)
   - Phase 3: brace-balance FSM with regex/template-literal awareness
   - Phase 4: CSP completeness checker (every `fetch`/`Worker`/`URL` origin must be in CSP)
   - Phase 5: DOM null-reference guard (unguarded `getElementById` → `.property`)

   `npm run audit:verify` self-tests the scanners by injecting each bug class and asserting the scanner exits non-zero.

These are guards against *accidental deletion*, not runtime verification. After any change to fetch / render / sensor pipelines, do the smoke test in `HISTORY.md:103-111`: open DevTools Network, reload with GPS, verify open-meteo 200 + telemetry card shows actual numbers, no console errors.

## Deploy

`deploy.bat` (Windows) commits and pushes but **does not run precheck**. Run `npm run precheck` manually before invoking it. (Precheck gating is on the roadmap.)

## Further reading

- **`ARCHITECTURE.md`** — module map, state surfaces, render-pipeline flow, cache strategy
- **`AGENTS.md`** — agent/AI-assist session protocol (mandatory reading before any autonomous change)
- **`HISTORY.md`** — per-release changelog, the audit phases, the bump protocol, the smoke test
