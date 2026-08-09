# AGENTS.md — protocol for AI-assisted sessions

This document is the contract for any agent (Claude, Copilot, opencode, etc.) working autonomously on this repo. Read this + `HISTORY.md` + `VERSION` + `ARCHITECTURE.md` at the start of every session.

## Hard rules

1. **Never skip the audit.** After ANY change to `index.html`, `worker.js`, `sw.js`, or any file under `tests/`, run the full pipeline before declaring done:
   ```bash
   npm run lint && npm test && npm run audit && npm run audit:verify
   ```
   `npm run precheck` runs these in addition to the Tailwind build — run that if CSS changed.

2. **Never commit unless explicitly asked.** No auto-commits, no auto-push, no auto-PRs. The user will say "commit and push" when they want it.

3. **Never edit `HISTORY.md`'s historical entries.** Append a new dated chapter for the current release only. Existing entries are the record.

4. **`VERSION` is the single source of truth for version.** If a version bump is requested, edit `VERSION` first, then sync `package.json` `"version"`. See `HISTORY.md:32-40`.

5. **`'unsafe-inline'` in CSP (`index.html:8`) is required by the inline `<script type="module">`.** Do not drop it without first extracting the engine to an external file — doing so silently breaks every browser that enforces CSP.

## Bump procedure (from `HISTORY.md:32-40`)

1. Read `VERSION` to know current version.
2. Decide bump level: `1.3.8 → 1.3.9` (patch: bug fixes / audit-driven fixes) or `1.3.8 → 1.4.0` (minor: feature) — never silently bump major.
3. Edit `VERSION` (e.g. `1.3.8` → `1.3.9`). Header + footer badges read this file at runtime.
4. Sync `package.json` → `"version": "1.3.9"`.
5. Append a new `## 1.3.9 — YYYY-MM-DD` section in `HISTORY.md` with all changes (rationale, findings, files changed, verification).
6. Run `npm test && npm run lint && npm run audit && npm run audit:verify`.
7. (Optional) `git tag v1.3.9` for deployment tracking.

## The 4-phase audit philosophy (mandatory knowledge)

From `HISTORY.md:43-92`. The 1.3.3 silent-bug lesson is the contract:

> An audit that only *reads* the code (without executing it) missed a `const now` use-before-declaration bug that silently broke every weather fetch. Tests + lint passed. The app shipped broken. The fix was to actually run the JS through Node's V8 parser and a use-before-declare scanner.

**Phase 1 — Syntax parse.** `node --check` on the extracted module. Any other output than `PARSE OK` is a ship-blocker.

**Phase 2 — Use-before-declare scan.** The `tests/ast-scan-tdz.mjs` walker pre-registers bindings per scope, then walks the body in source order. A reference before the declaration line, in the same scope, is a TDZ violation. ESLint's `no-use-before-define` does NOT catch this when use and decl are in the same block scope.

**Phase 3 — Structural checks.** `{` vs `}` count (the `tests/brace-balance.mjs` FSM). Verify critical feature substrings are still present (the substring guards in `tests/sanity.test.js`).

**Phase 4 — Lifecycle + behavioural reasoning.** For each new `const` inside a loop or fetch handler, ask:
- Is it declared **before** every branch that references it?
- Is the surrounding `try/catch` swallowing what would otherwise be a loud failure? An empty `catch {}` (now blocked by eslint `no-empty` with `allowEmptyCatch: false`) hides bugs.
- Does the variable's value match across all consumer surfaces (telemetry card vs glance strip vs Aero HUD)?

## The minimum "did I break fetch?" smoke test

From `HISTORY.md:103-111`. After any change to `processTelemetryPayload`, `normalizeTelemetryData`, `fetchData`, or the fetch trigger guard:

1. Open DevTools → Network tab.
2. Reload the app with GPS permitted.
3. Verify a request to `api.open-meteo.com/v1/forecast?current=temperature_2m,...` completes with HTTP 200.
4. Verify the telemetry card shows non-`--` values (a temperature, a wind speed, a status text).
5. Verify `#hud-glance-temp` shows a number, not `--°C`.
6. Check Console for any red errors (a silent `catch {}` would otherwise hide them).

If any of these fails, the change is broken — regardless of what `npm test` or `npm run lint` report. **Runtime truth > static checks.**

## What the audit chain does NOT catch

Be aware of these blind spots. Add manual reasoning for any of them when relevant:

- **Race conditions** — no concurrency tests.
- **Memory leaks** — no leak detector.
- **Off-by-one / type-coercion** — the substring guards check presence, not correctness.
- **Unhandled promise rejections** — every `then(...)` chain without `.catch` evades the audit. Prefer `async/await + try/catch`.
- **`import()` is not covered by `csp-audit.mjs`.** Any new dynamic `import('https://...')` must be manually cross-checked against `script-src` in the CSP meta.
- **DOM null-guard scanner doesn't understand `el?.foo()` optional chaining.** It only recognises `if (el)` and `if (!el)` guard shapes (`tests/domnull-audit.mjs:57-58`). When adding guarded chains, prefer the explicit form.
- **Performance regressions** — no budgets, no Lighthouse.
- **Accessibility** — no a11y scanner yet (planned).

## Don't do these things

- Don't add `'unsafe-eval'` or `'unsafe-inline'` to CSP. The inline `'unsafe-inline'` is already there for the inline module; loosening further defeats the entire CSP.
- Don't reintroduce `setInterval` for anything that should pause on tab hide. All timers should be visibility-aware `setTimeout` recursion.
- Don't move section logic out of the inline module into separate files without coordinating the whole audit pipeline — the scanners depend on the inline-block shape.
- Don't change `worker.js` math functions without changing their main-thread siblings (`fastDistance` is duplicated intentionally).
- Don't change `deploy.bat` to skip `git pull --rebase` — that's what saves you from force-push conflicts.
- Don't edit `tests/_module_extract.mjs` directly — it's a generated artefact (gitignored). Edit `index.html` then run `npm run audit:extract` to regenerate.
- Don't add new CDN `<script>` tags without SRI hashes (`integrity="sha384-..." crossorigin="anonymous"`).
- Don't add new fetch / Worker / URL origins without adding them to the CSP meta tag — `audit:csp` will flag the gap, but manual review beats the scanner catching it last.

## Reference numbers (current as of v1.3.8)

- `tests/sanity.test.js` — 127 substring assertions
- `tests/audit:verify` — 10 self-test cases (5 positive + 5 negative controls)
- File sizes — `index.html` 5610 lines / ~379 KB; `worker.js` 260 lines; `sw.js` 303 lines
- Inline `<script type="module">` block — lines 520 → 5590 (~5100 lines, ~330 KB of JS)
- ES target — `ecmaVersion: 2022` (per `eslint.config.js:30, 45`)
- TypeScript — not used
- Bundler — not used; only `@tailwindcss/cli` for CSS
