# AGENTS.md - Audit Charter

Operating contract for any agent (Claude, Copilot, opencode, ...) working
autonomously in this repo. You are not a code generator here; you are an
**auditor who happens to write code**. Every change is guilty until it
survives the evidence tiers below.

Session start: read this file + HISTORY.md (especially "How to bump version
in a new session" and "How to audit changes like a developer") + VERSION +
ARCHITECTURE.md.

## 0. Doctrine - what "audited" means

The 1.3.3 incident is the founding lesson: an audit that only *read* code
missed a `const now` use-before-declaration bug that silently broke every
weather fetch. Tests passed. Lint passed. The app shipped broken.

Therefore: **static green is not done.** Evidence is layered; each layer
proves exactly one kind of claim:

| Tier | Claim proved | Instrument |
|---|---|---|
| E1 Parse | source is syntactically valid JS | node --check on extracted module |
| E2 Order | no use-before-declaration in any scope | tests/ast-scan-tdz.mjs |
| E3 Shape | braces balance; feature substrings survive edits | tests/brace-balance.mjs, tests/sanity.test.js |
| E4 Intent | declared contracts hold (CSP origins, null guards, promise hygiene, transform classes) | csp-audit, domnull-audit, floating-promise-audit, visual-audit |
| E5 Behaviour | pure kernels produce correct outputs for known fixtures; the app actually works at runtime | tests/unit/ suite (automated), Fetch Gate (sec 6), Visual runtime pass (sec 7) |
| E6 Judgement | design risks reasoned about, not scanned | Blind-spot register (sec 8) |

A change is complete when it has cleared the highest tier that applies to
it - never earlier.

## 1. Non-negotiables

1. **Never skip the audit.** After ANY change to `index.html`, `worker.js`,
   `sw.js`, or anything under `tests/`, run the full pipeline before
   declaring done:
   ```
   npm run lint && npm test && npm run audit && npm run audit:verify
   ```
2. **Never commit unless explicitly asked.** No auto-commits, pushes, PRs.
3. **Never edit HISTORY.md historical entries.** Append a new dated chapter
   for the current release only. Existing entries are the record.
4. **VERSION is the single source of truth for version.** Bump = edit
   VERSION first, then sync package.json (Release Gate, sec 9).
5. **`'unsafe-inline'` in the CSP meta (`index.html:8`) is load-bearing** -
   required by the inline `<script type="module">` block (lines 658-7154).
   Do not drop it without extracting the engine to an external file first.
6. **Never weaken a scanner to make it pass.** Findings are resolved by
   fixing code, or by consciously revising the contract here first.
   Disabling a check to ship is how silent bugs happen.

## 2. Trigger matrix - what fires on what

| Changed surface | Required gates |
|---|---|
| Inline module JS in index.html | Full pipeline |
| CSS / Tailwind input | npm run precheck (pipeline + Tailwind build) |
| worker.js | Full pipeline; math fns must stay mirrored with main-thread copies (sec 10) |
| sw.js | Full pipeline |
| Anything under tests/ | Full pipeline; audit:verify proves scanner edits still detect real violations |
| Markers, panes, popups, any transform/rotation writer | Pipeline + Visual Audit runtime pass (sec 7) |
| Live DOM / interpolator / RAF bar / progress-fill | Pipeline + Fluidity Audit (sec 5.6) |
| processTelemetryPayload / normalizeTelemetryData / fetchData / fetch triggers | Pipeline + Fetch Gate (sec 6) |
| manifest.json / PWA install surfaces (icons, screenshots, install prompt) | Full pipeline + PWA standards gate: the unified audit's `pwa-manifest` check enforces the `/progressive-web-app` skill's Checklist Before Shipping (all icons maskable, install screenshots with narrow+wide form factors, name/short_name/local icons/display=standalone). Load the skill when touching these surfaces. |
| Version bump requested | Release Gate (sec 9) |

## 3. Canonical pipelines

```
Full pipeline (mandatory minimum):
  npm run lint && npm test && npm run audit && npm run audit:verify

With Tailwind build (CSS changed):
  npm run precheck

Unified (single-extract, parallel, project-matched — preferred for /audit):
  npm run audit:unified            # or node tests/audit-unified.mjs
  # does ONE extract reused for every E2-E4 scanner, runs lint/sanity/unit + tdz/fp/brace/csp/dom/visual/shell/fluidity in parallel,
  # plus inline project checks legacy missed: VERSION sync, SRI, no-setInterval, unsafe-inline load-bearing,
  # worker mirror, tailwind freshness, deploy guard, PWA standards (pwa-manifest: maskable icons +
  # install screenshots — rubric: /progressive-web-app skill, proven both directions at 1.10.3)

Individual scanners (each re-extracts the module itself):
  audit:extract  E1 parse        audit:fp     E4 floating promises
  audit:tdz      E2 order        audit:csp    E4 origin allow-list
  audit:brace    E3 shape        audit:dom    E4 null guards
                                 audit:visual E4 transform contracts
  audit:shell    E1 document integrity (doctype/BOM/mojibake/U+FFFD)
  audit:fluidity E5 fluidity (plug-in, perf + UI correctness) — not in mandatory chain; run via `npm run audit:fluidity` or `node tests/ui-fluidity.test.js`

Meta-audit (audits the auditors via positive + negative controls):
  npm run audit:verify
```

deploy.bat independently re-runs the full pipeline plus precheck before any
git add; a failure there aborts deployment.

## 4. Scanner roster - what each instrument proves

| Scanner | Guarantee | Pass condition |
|---|---|---|
| extract-module.mjs + node --check | E1: inline module parses under V8 | clean extract, PARSE OK |
| ast-scan-tdz.mjs | E2: no same-scope use-before-declare (pre-registers bindings per scope; catches what ESLint misses in block scopes) | 0 violations |
| floating-promise-audit.mjs | E4: no .then() chain without .catch/await | 0 findings |
| brace-balance.mjs | E3: brace FSM ends at depth 0 | depth 0 |
| sanity.test.js | E3: feature substrings present (presence, NOT correctness) | N passed / 0 failed |
| csp-audit.mjs | E4: every fetch/Worker/URL/import() origin appears in the CSP meta | 0 gaps |
| domnull-audit.mjs | E4: every getElementById result guarded before property access | 0 unguarded |
| visual-audit.mjs | E4: every rendered layer honors its transform contract (sec 5); prints a code-derived inventory table | PASS = all readable overlays resolve upright |
| tests/unit/ (node --test) | E5: executes worker.js end-to-end (dispatcher incl. error path), polyline codec round-trip, route-node planner, overpass parser, brand adapters + findNearby funnel; proves the fastDistance duplication stays bit-identical (sec 10) | all fixtures pass |
| shell-audit.mjs | E1: HTML DOCUMENT integrity - doctype first bytes, BOM, charset, U+FFFD, mojibake signatures. Exists because the encoding incident shipped "?<!DOCTYPE html>" (quirks mode + stray glyph) through a fully green module-level audit. Runtime twin: compatMode tripwire at module start | PASS = document shell intact |
| ui-fluidity-audit.mjs | E5: live DOM driven by low-freq sources (1→60 Hz) stays fluid — no stair/jank (G0-G4: inventory, hard fails, precision, hygiene, a11y) | Perfection verdict PASS (0 stairs, 0 janks) |
| verify-scanners.mjs | audits the auditors: injects known-good/bad fixtures into every scanner above | all controls behave |

Scanner limitations are documented in each file's header comment. Read them
when results look surprising.

## 5. Visual Audit - transform-contract protocol (code-derived, not case-derived)

No scanner sees pixels, but every rotated-overlay bug shares one auditable
root cause: a layer inherited a transform nobody classified. Every rendered
layer therefore gets an explicit contract derived from its PURPOSE:

> Purpose question: what is this element for? Must a human read or
> recognise it while the vehicle moves?

- **WORLD-LOCKED** - represents geography itself (tiles, route polylines).
  Correct behaviour: rotate with the map. Text-free shapes may live here.
- **SCREEN-LOCKED** - a readable surface: station names, popups, node
  labels, recognisable POI icons. Must never inherit map rotation;
  counter-rotated instead. Derivation example: tapping a pit stop opens
  station details the driver must read mid-drive; tilted details are
  unreadable at 90 degrees, so the contract is forced by purpose.
- **SELF-ROTATING** - encodes direction by design (compass needle, position
  arrow). Rotates by a NAMED reference (--user-heading: screen-up in
  tactical modes, true-north in mode 0). Undocumented self-rotation = bug.

When in doubt: readable -> SCREEN-LOCKED. Only pure world geometry earns
WORLD-LOCKED. `npm run audit:visual` enforces this mechanically from the
source itself. In the PERF-P2 var-driven rotation era the structural
contracts are: L - no direct JS rotate() writes on #hud-map or panes (all
rotation flows through --hud-rot); V1 - exactly one --hud-rot writer;
C1 - stylesheet must rotate #hud-map by calc(-1*var) and every managed pane
by +var; C3 - no CSS --user-heading rotation on popup containers (stacking
bug class). It prints the inventory table; read that table against this
classification whenever you touch anything transform-related.

## 5.6 UI Fluidity Audit — performance & UI correctness (plug-in)

Live DOM driven by low-freq sources (1 Hz GPS, 0.0002 Hz fetch) must glide
at 60 Hz without stair (quantised jumps) or jank (layout thrash / lag).
The fluidity plug-in is a **perfection gate** — one stair = FAIL — and is
reusable in other projects via `{{liveIds}}` / `{{sourceRateHz}}` /
`{{renderRateHz}}` placeholders.

**Plug-in prompt (copy to other project, edit CONFIG):**
> You are UI Fluidity Auditor. Audit `{{liveIds}}` for stair/jank at
> `{{sourceRateHz}}→{{renderRateHz}}Hz`. Cite `file:line`, run
> `node tests/ui-fluidity.test.js`.

For this repo the instantiation is `CONFIG.liveIds = [tracking-progress-fill,
tracking-eta-next, driveNode, driveSpeed, liveSpeed, hud-map]` at
`1→60 Hz` (`tests/ui-fluidity-audit.mjs:28`). Edit that CONFIG for other
projects.

**Gates (cite `file:line` per finding, print PASS/FAIL per gate):**

- **G0 Inventory** — every live DOM vs low-freq source (watchPosition/fetch/
  interval/onmessage) has an interpolator; missing `display+=(target-display)*alpha`
  or `vel*dt+corr` → FAIL. Verifies `state.visual` lerp exists.
- **G1 Hard fails** — `target→dom.textContent` direct, `Math.round(*100)%`
  on bars (need `toFixed(1)`), raw `toFixed` without `displayDistance`,
  `transition 75ms` on RAF bar (need `none`+`will-change`), missing
  `display+=(target-display)*alpha` / `vel*dt+corrAlpha`, or sim `ratio<0.08`.
- **G2 Precision** — fractional `toFixed(1)` derived from `display*`, peak
  glide monotonic (exp lerp, no overshoot).
- **G3 Hygiene** — `will-change`/`contain`/`translateZ(0)`, prev guards
  (`if (prev!==next)`), `dt` clamped ≤32 ms, hidden/stale throttle
  (`visibilityState`, deadband `VISUAL_DEADBAND_SQ`).
- **G4 A11y/perf** — `prefers-reduced-motion` boot-only (no dynamic listener
  needed), `aria-live="polite"` on live regions, `will-change` not leaking
  transparency.

**Run:** `npm run audit:fluidity` (needs `extract-module.mjs` first) or
`node tests/ui-fluidity.test.js` (self-contained, also used by other projects).
Output ends `Perfection verdict: PASS | FAIL (x stairs, y janks)` — one stair
= FAIL. Fix G1 stairs first, then G3 hygiene.

## 6. Fetch Gate ("did I break fetch?")

After any change to processTelemetryPayload, normalizeTelemetryData,
fetchData, or the fetch trigger guard:

1. DevTools Network tab open, GPS permitted, reload the app.
2. Verify api.open-meteo.com/v1/forecast?current=... completes HTTP 200.
3. Telemetry card shows non-placeholder values (temperature, wind, status).
4. #hud-glance-temp shows a number, not --C.
5. Console: zero red errors (a silent catch would otherwise hide them).

If any step fails, the change is broken regardless of what npm test or lint
report. Runtime truth > static checks.

6. Record evidence in the HISTORY chapter: the HTTP status line, one
   telemetry value read off the UI, and console state ("0 red errors").
   A gate without recorded evidence is an unevaluated gate - claims are
   not verifiable after the fact.

## 7. Visual runtime pass ("does the contract survive compositing?")

Static tiers cannot see pixels. After any change the visual scanner flagged
as touched (new pane, marker, rotation writer, popup binding):

1. Exercise every state the contract spans: tactical modes 0/1/2 via the
   button, mid-drag pan, the ~5s re-lock after dragend, and exit back to
   north-up.
2. Confirm each inventoried layer behaves per its declared class:
   SCREEN-LOCKED stays upright in all states; WORLD-LOCKED stays glued to
   geography; SELF-ROTATING follows its named reference (and only that one).
3. Console: zero red errors.

## 8. Blind-spot register - what no instrument catches

Reason through these manually whenever relevant:

- **Race conditions** - no concurrency tests.
- **Memory leaks** - no leak detector.
- **Off-by-one / type-coercion** - substring guards check presence only.
- **Unhandled promise rejections** - prefer async/await + try/catch.
- **import() origins** - csp-audit does not see dynamic import(); cross-check
  script-src manually.
- **DOM null-guard shapes** - domnull-audit recognises if(el)/if(!el)/el?.
  guards; exotic guard forms need manual review (tests/domnull-audit.mjs).
- **Performance regressions** - fluidity audit (sec 5.6, G0-G3) catches stair/jank + hygiene,
  but no Lighthouse budgets, no long-task detector.
- **Accessibility** - fluidity G4 catches `aria-live` + `prefers-reduced-motion`, but no axe-core/full a11y scan.
- **Visual compositing** - audit:visual proves declared contracts statically;
  pixels are proven only by the sec 7 runtime pass.

## 9. Release Gate (version bump procedure)

From HISTORY.md "How to bump version in a new session":

1. Read VERSION for the current version.
2. Decide level: patch = bugfix/audit fix; minor = feature; never silently
   bump major.
3. Edit VERSION first, then sync package.json "version" to match.
4. Append a new `## X.Y.Z - YYYY-MM-DD` chapter in HISTORY.md covering every
   change: rationale, findings, files touched, which gates (sec 2) were
   run with their recorded evidence (sec 6 step 6), and which blind spots
   (sec 8) were considered with a one-line dismissal or mitigation each.
5. Run the full pipeline + precheck. deploy.bat re-runs it before git add.
6. Bump `sw.js` `APP_CACHE` (`vN` → `vN+1`) so the SW update detector fires
   and installed clients fetch the new shell — without it, no index.html
   change ever reaches them (the in-page update pill only helps once seen).
7. Optional: git tag vX.Y.Z for deployment tracking.

## 10. Prohibitions

- Do not add 'unsafe-eval' to CSP, or more 'unsafe-inline' entries than the
  load-bearing one in sec 1.5.
- Do not reintroduce setInterval for anything that must pause on tab hide;
  use visibility-aware setTimeout recursion.
- Do not move section logic out of the inline module into separate files
  without re-coordinating the whole audit pipeline - the scanners depend on
  the extracted-block shape.
- Do not change worker.js math functions without their main-thread siblings
  (fastDistance is duplicated intentionally).
- Do not change deploy.bat to skip git pull --rebase.
- Do not edit tests/_module_extract.mjs by hand - generated artefact
  (gitignored); edit index.html then npm run audit:extract.
- Never rewrite index.html (or any source file) via PowerShell
  Get-Content/Set-Content - PS 5.1 reads UTF-8 as ANSI and re-encoding
  double-encodes every non-ASCII char (em-dash -> mojibake). Use the Edit
  tool, or byte-exact [IO.File] APIs only. If a full-file transform is ever
  unavoidable: backup first, then verify with git diff --stat (mass line
  changes = corruption) and reverse via
  utf8-decode -> cp1252-encode -> WriteAllBytes.
  RECOVERY VERIFICATION PROTOCOL (the '?' doctype lesson): after any
  transcoding recovery, check BOTH failure classes - mojibake signatures
  AND replacement losses (standalone '?', U+FFFD, first-bytes dump of the
  file, non-ASCII count vs git HEAD). A grep for one class never proves
  the other absent.
- No new CDN script tag without SRI hash + crossorigin="anonymous".
- No new fetch/Worker/URL origin without a CSP meta entry - let audit:csp
  confirm, but manual review beats the scanner catching it last.

## 11. Reference numbers (verified v1.10.3, 2026-09-24)

- sanity.test.js - 240 substring assertions / 0 failing (incl. 4 negative-pair
  removals: sec-plot, altimeter+rel-angle, CRS/TAL, Regime/Spread/Brier+NO ROUTE;
  +9 from the 1.10.2 audit round, +5 from GPS-denial recovery, +4 from the
  1.10.3 headline-consensus overhaul)
- tests/unit/ - 36 executable fixtures / 0 failing (worker kernel, fuel
  search funnel + Caltex id-table proven against live JSON, WGS84 distance
  arcs, fastDistance mirror parity). The unified audit's fixture count is a
  PIN (catches accidental deletion) — bump it when intentionally adding
  tests; see tests/audit-unified.mjs:569.
- audit:verify - 24 self-test controls, all passing (incl. PHASE V var-era
  layer contracts + PHASE S shell integrity)
- Scanners: 8 mandatory (tdz, fp, brace, csp, domnull, visual, shell, extract+parse)
  + 1 plug-in (fluidity: G0-G4 perfection gate) plus meta-verifier
  + unified audit-unified.mjs (single-extract, 37 checks, E1-E6)
- index.html - ~9356 lines / ~653 KB; inline module lines 861-9332 (~567 KB)
- worker.js - 272 lines; sw.js - 475 lines; fuel-stations.js - 358 lines
- ESLint - ecmaVersion 2022 (eslint.config.js:32,46); no-empty with
  allowEmptyCatch:false (eslint.config.js:19)
- TypeScript - not used. Bundler - none; @tailwindcss/cli for CSS only.
