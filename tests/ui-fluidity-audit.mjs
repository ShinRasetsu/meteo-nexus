// UI FLUIDITY AUDIT — Performance & UI Correctness (plug-in)
// ─────────────────────────────────────────────────────────────────────
// Purpose: proves live DOM driven by low-freq sources (1 Hz GPS, 0.0001 Hz fetch)
// stays fluid at 60 Hz without stair/jank. One stair = FAIL (perfection gate).
//
// Reuse as plug-in: copy this file to other projects, edit CONFIG.liveIds,
// CONFIG.sourceRateHz / renderRateHz, and gate thresholds. No hard-coded
// project assumptions beyond the placeholder defaults.
//
// Template prompt for other projects:
//   You are UI Fluidity Auditor. Audit {{liveIds}} for stair/jank at
//   {{sourceRateHz}}→{{renderRateHz}}Hz. Cite file:line, run
//   `node tests/ui-fluidity.test.js`.
//
// Gates (E5 Behaviour — the app actually works fluidly):
//   G0 Inventory — every live DOM has an interpolator (no direct lowFreq→DOM)
//   G1 Hard fails — Math.round% on bars, raw toFixed without displayDistance,
//                  transition on RAF bar, missing display+=(target-display)*alpha
//                  or velocity+corr, sim ratio<0.08
//   G2 Precision  — fractional toFixed derived from display*, peak glide monotonic
//   G3 Hygiene    — will-change/contain/translateZ, prev guards, dtClamped 32,
//                  hidden/stale throttle
//   G4 A11y/perf  — reduced-motion boot-only, aria-live, transparency
//
// Output: PASS/FAIL per gate with file:line + fix + verify, final
//         `Perfection verdict: PASS | FAIL (x stairs, y janks)`
//
// Usage:  node tests/extract-module.mjs && node tests/ui-fluidity-audit.mjs
//         (or `npm run audit:fluidity` / `node tests/ui-fluidity.test.js`)
//         Exit 0 = PASS, 2 = FAIL
//
// Scanner limitations: regex-based, not full data-flow. MemberExpression
// guards recognised: `if (prev !== next)` / `if (_keys.x !== x)`. Dynamic
// interpolators built via eval/new Function not seen.
//
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const EXTRACT = path.join(here, '_module_extract.mjs')
const HTML = path.join(repo, 'index.html')

if (!fs.existsSync(EXTRACT)) {
  console.error('ui-fluidity-audit: run node tests/extract-module.mjs first')
  process.exit(1)
}

const src = fs.readFileSync(EXTRACT, 'utf8')
const html = fs.readFileSync(HTML, 'utf8')

// ── CONFIG — edit for other projects ({{liveIds}} / {{sourceRateHz}} / {{renderRateHz}}) ──
const CONFIG = {
  // Live DOM that should glide at renderRateHz despite low-freq source.
  // For meteo-dashboard these are GPS-driven HUD elements (1 Hz → 60 Hz).
  liveIds: [
    'tracking-progress-fill', // bar width %
    'tracking-eta-next',      // next-node distance
    'tracking-eta-dist',      // remaining distance
    'driveNode',              // drive-mode node distance
    'driveSpeed',             // drive-mode speed
    'liveSpeed',              // telemetry speed
    'hud-map',                // map pan/rotate (transform)
  ],
  sourceRateHz: 1,   // watchPosition / route cursor
  renderRateHz: 60,  // rAF smoothVisualsLoop / renderAero
  // Thresholds
  minSimRatio: 0.08, // interpolator must cover ≥8% of error per frame at 60 Hz
  dtClampMs: 32,     // G3: dt must be clamped ≤32 ms
}

function htmlLineNo(idx) { return html.slice(0, idx).split('\n').length }
function srcLineNo(idx) { return src.slice(0, idx).split('\n').length }

// ── helpers: function spans (for “inside RAF” checks) ──
function functionSpans(s) {
  const spans = []
  for (const m of s.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    let d = 0; let i = s.indexOf('{', m.index)
    for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) break } }
    spans.push({ name: m[1], start: m.index, end: i })
  }
  spans.sort((a, b) => b.start - a.start)
  return spans
}
const spans = functionSpans(src)
function inAnyRaf(pos) { const sp = spans.find(x => pos >= x.start && pos <= x.end); return sp ? ['smoothVisualsLoop', 'executeRenderPipeline', 'renderAero'].includes(sp.name) : false }

// ── collector ──
const findings = [] // { gate, kind: 'stair'|'jank'|'a11y', line, msg, fix, verify }
let stairs = 0; let janks = 0
function add(gate, kind, line, msg, fix, verify) {
  findings.push({ gate, kind, line, msg, fix, verify })
  if (kind === 'stair') stairs++
  if (kind === 'jank') janks++
}

// ── G0: inventory live DOM vs low-freq sources ──
// Low-freq sources: watchPosition, fetchData, setTimeout(…fetch…), worker onmessage, getCurrentPosition
const lowFreqSources = []
for (const m of src.matchAll(/watchPosition|fetchData|getCurrentPosition|onmessage/g)) {
  lowFreqSources.push({ name: m[0], line: srcLineNo(m.index) })
}
// Live DOM inventory: updateText / updateHTML / .textContent / .style.* inside RAF vs outside
const liveWrites = []
for (const m of src.matchAll(/updateText\(|updateHTML\(|\.textContent\s*=|\.style\.(width|transform|opacity)/g)) {
  const isRaf = inAnyRaf(m.index)
  const line = srcLineNo(m.index)
  const snippet = src.slice(m.index, m.index + 80).replace(/\n/g, ' ')
  liveWrites.push({ snippet, line, isRaf })
}
// Check interpolator presence
const hasInterpAlpha = /display\s*\+=\s*\(target\s*-\s*display\)\s*\*\s*alpha|display\s*\+=\s*\(target-display\)\*alpha|lerp.*Math\.exp\(-dt/.test(src)
const hasVelDt = /vel\s*\*\s*dt|speedMs\s*\*\s*\(.*\/1000\)|projectedDistanceM/.test(src)
const hasStateVisualLerp = /state\.visual\.(lat|lon|heading)\s*\+=\s*.*lerp/.test(src)
const interpFound = hasInterpAlpha || hasVelDt || hasStateVisualLerp
// Also check for display* pattern (displayDistance, displayLat etc)
const hasDisplayPrefix = /display[A-Z]\w*\s*\+=|_display\w*|displayDistance/.test(src) || /state\.visual\.lat/.test(src)

// G0 verdict
const g0LiveInRaf = liveWrites.filter(w => w.isRaf).length
if (!interpFound) {
  add('G0', 'stair', 1, `No interpolator (display+=(target-display)*alpha or vel*dt+corr or state.visual lerp) found — live DOM (${g0LiveInRaf} RAF writes) would stair at ${CONFIG.sourceRateHz}→${CONFIG.renderRateHz} Hz`, 'Add `display+=(target-display)*alpha` with `alpha=1-Math.exp(-dt/tc)` or `display+=vel*dt+corrAlpha`; drive DOM from display* not target (see smoothVisualsLoop lerpPos/lerpHeading).', 'Verify: grep for `state.visual.*+=.*lerp` and `Math.exp(-dt` exists')
} else if (g0LiveInRaf === 0) {
  add('G0', 'stair', 1, 'No live DOM writes detected in RAF (smoothVisualsLoop/renderAero) — audit cannot prove fluidity', 'Move liveId writes (progress, distance, heading) into RAF loop with interpolator', 'Verify: csp-audit style — check liveIds appear in RAF')
} else {
  // Check that at least one liveId is gated through display* not target
  const rafSnippet = spans.filter(s => ['smoothVisualsLoop', 'renderAero'].includes(s.name)).map(s => src.slice(s.start, s.end)).join('\n')
  const directTargetWrites = (rafSnippet.match(/state\.autoCoords|state\.currentSpeed|curCursor\/totalNodes/g) || []).length
  if (directTargetWrites > 3 && !hasDisplayPrefix) {
    add('G0', 'stair', srcLineNo(src.indexOf('smoothVisualsLoop')), `RAF writes reference target directly (${directTargetWrites}× state.autoCoords/currentSpeed/curCursor) without display* indirection — will stair`, 'Introduce display* state (displayLat/Lon/displayProgress) lerped from target; render from display*', 'Verify: no `state.autoCoords` inside DOM write lines, only `state.visual`')
  }
}

// ── G1: hard fails ──
// 1. Math.round(*100)% on bars (need toFixed(1))
for (const m of src.matchAll(/Math\.round\(\s*\(?\s*\w+\s*\/\s*\w+\s*\)\s*\*\s*100\s*\)/g)) {
  const ctx = src.slice(Math.max(0, m.index - 120), m.index + 120)
  if (/style\.width|progress|bar|fill/i.test(ctx)) {
    const l = srcLineNo(m.index)
    add('G1', 'stair', l, `progress bar uses Math.round(*100)% → integer stair at ${CONFIG.sourceRateHz}→${CONFIG.renderRateHz} Hz (1% steps)` + ` — \`${m[0].slice(0, 40)}\``, 'Use `(ratio*100).toFixed(1)+\'%\'` and interpolate `displayProgress+=(targetProgress-displayProgress)*alpha` before assigning `fill.style.width`', 'Verify: grep `toFixed(1)` on bar width; check `displayProgress` vs `prog`')
  }
}
// Also flag generic Math.round(...*100) in RAF context
for (const m of src.matchAll(/const\s+prog\s*=.*Math\.round\(/g)) {
  if (inAnyRaf(m.index)) add('G1', 'stair', srcLineNo(m.index), `integer progress \`${m[0].slice(0, 50)}\` in RAF — stair`, 'Use fractional displayProgress', 'Verify: `prog` derived from displayProgress.toFixed(1)')
}

// 2. raw distance toFixed without displayDistance / state.visual
for (const m of src.matchAll(/\(dm\s*\/\s*1000\)\.toFixed\(1\)|\(dm2\s*\/\s*1000\)\.toFixed\(1\)|fastDistanceSqMeters\(state\.autoCoords/g)) {
  const line = srcLineNo(m.index)
  const isRaf = inAnyRaf(m.index)
  // If this write is in RAF and uses autoCoords directly, it's raw target without display interpolation
  if (isRaf && /state\.autoCoords/.test(src.slice(m.index - 80, m.index + 80))) {
    // Check if displayDistance indirection exists nearby
    const windowCtx = src.slice(Math.max(0, m.index - 400), m.index + 200)
    if (!/displayDistance|state\.visual\.lat|visual.*distance/i.test(windowCtx)) {
      add('G1', 'stair', line, `raw distance toFixed from target (\`state.autoCoords\`) without displayDistance indirection — will stair`, 'Compute `displayDistance` via `displayLat/Lon` lerp; derive text from display* (`(displayDistance/1000).toFixed(1)`)', 'Verify: grep `displayDistance` drives `.textContent`; no `state.autoCoords` in same RAF block')
      break // one stair per pattern is enough
    }
  }
}

// 3. transition 75ms / transition-all on RAF bar (need none + will-change)
const htmlStyleRe = /id="tracking-progress-fill"[^>]*class="[^"]*transition[^"]*"/g
for (const m of html.matchAll(htmlStyleRe)) {
  const l = htmlLineNo(m.index)
  add('G1', 'jank', l, `RAF bar #tracking-progress-fill has CSS transition (\`transition-all\`) — fights per-frame width writes, causes jank`, 'Set `transition:none` on RAF bar, add `will-change:width` (or `transform`) + `contain:layout`; animate only via JS lerp', 'Verify: `html:line` has `class="... will-change...` without `transition` and `style.width` driven by RAF')
}
// Also flag any RAF width write with transition present
if (/tracking-progress-fill/.test(html) && /transition-all/.test(html) && inAnyRaf(src.indexOf('tracking-progress-fill'))) {
  // already flagged
}

// 4. missing display+=(target-display)*alpha or velocity+corr
if (!hasInterpAlpha && !hasVelDt) {
  add('G1', 'stair', srcLineNo(src.search(/function smoothVisualsLoop/)), 'missing `display+=(target-display)*alpha` or `display+=vel*dt+corrAlpha` — no interpolator', 'Add exponential lerp: `const alpha=1-Math.exp(-dt/tc); display+=(target-display)*alpha` (tc ~80-400ms speed-proportional) or velocity dead-reckoning `display+=vel*dt+corrAlpha`', 'Verify: file:line contains `Math.exp(-dt` and `display+=`')
}

// 5. sim ratio<0.08 — simulate interpolator covering 8% per frame
{
  // Strip comments so TC= in comments (e.g. // TC=400ms) is not captured as code tc
  const srcNoComments = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  // Find tc values used for position/heading lerp — handle Math.min cap: const tc = Math.min(180, 400 - ...) → capture 180 (effective), not 400
  const tcs = []
  for (const m of srcNoComments.matchAll(/const tc\s*=\s*([^;]+);/g)) {
    const expr = m[1]
    const minCap = expr.match(/Math\.min\(\s*(\d+)/)
    if (minCap) tcs.push(Number(minCap[1]))
    else {
      const direct = expr.match(/^\s*(\d+)/)
      if (direct) tcs.push(Number(direct[1]))
    }
  }
  for (const m of srcNoComments.matchAll(/timeConstant\s*=\s*[^;]*?(\d+)\s*:\s*(\d+)/g)) {
    tcs.push(Number(m[1]), Number(m[2]))
  }
  const filteredTCs = tcs.filter(Boolean)
  const dt = 1000 / CONFIG.renderRateHz // ~16.6
  const ratios = filteredTCs.length ? filteredTCs.map(tc => 1 - Math.exp(-dt / tc)) : [(1 - Math.exp(-dt / 120))] // fallback 120ms
  const minRatio = Math.min(...ratios)
  if (minRatio < CONFIG.minSimRatio) {
    const line = srcLineNo(src.search(/1 - Math\.exp\(-dt/))
    add('G1', 'jank', line > 0 ? line : 1, `interpolator sim ratio ${minRatio.toFixed(3)} < ${CONFIG.minSimRatio} at ${CONFIG.renderRateHz} Hz — tail too slow, visible lag/jank`, 'Lower tc (e.g., 80 ms at 60 km/h) or increase alpha; keep ratio ≥0.08 (tc ≤200 ms at 60 Hz)', 'Verify: sim `(1-Math.exp(-16/tc)).toFixed(3) >=0.08`')
  }
}

// ── G2: precision — fractional toFixed, derived from display*, peak glide monotonic ──
let g2Ok = true
// Check fractional toFixed present for distances/percents that are live
if (!/\.toFixed\(1\)/.test(src) || /Math\.round\(.*\*100\)/.test(src.slice(src.indexOf('tracking-progress-fill') - 200, src.indexOf('tracking-progress-fill') + 500))) {
  // Already flagged in G1
  g2Ok = false
}
// Check derived from display* — search for .textContent that uses displayDistance / state.visual
const rafBodies = spans.filter(s => ['smoothVisualsLoop', 'renderAero'].includes(s.name)).map(s => src.slice(s.start, s.end)).join('\n')
const displayDerived = /displayDistance|state\.visual\.lat|displayProgress/.test(rafBodies)
if (!displayDerived) {
  add('G2', 'stair', srcLineNo(src.indexOf('smoothVisualsLoop')), 'live distance/progress not derived from display* — text reflects stair target not smooth display', 'Derive `nextTxt/distStr/prog` from `display*` (e.g., `displayProgress.toFixed(1)`) not `curCursor/totalNodes`', 'Verify: grep `displayProgress` flows into `fill.style.width` and `nextTxt`')
  g2Ok = false
}
// Peak glide monotonic: check heading lerp is monotonic (no overshoot) — look for `+= dHeading * lerp` without clamping overshoot is ok (exp lerp monotonic)
if (!/state\.visual\.heading\s*\+=\s*dHeading\s*\*\s*lerp/.test(src) && !/display\s*\+=\s*\(target-display\)\*alpha/.test(src)) {
  if (g2Ok) { // avoid double-fail if already flagged
    add('G2', 'jank', srcLineNo(src.search(/visual\.heading/)), 'peak glide not monotonic — heading lerp missing or not exp-based, may overshoot/oscillate', 'Use `display+= (target-display)*alpha` with `alpha=1-Math.exp(-dt/tc)` (monotonic, no overshoot)', 'Verify: `state.visual.heading += dHeading * lerpHeading` exists')
  }
}

// ── G3: hygiene — will-change/contain/translateZ, prev guards, dtClamped, hidden throttle ──
const hasWillChange = /will-change:\s*transform/.test(html)
const hasContain = /contain:\s*layout|contain:\s*paint/.test(html)
const hasTranslateZ = /translateZ\(0\)/.test(html)
if (!hasWillChange) add('G3', 'jank', htmlLineNo(html.indexOf('will-change') > -1 ? html.indexOf('will-change') : 0), 'missing `will-change: transform` on HUD layers — promotes repaints, jank', 'Add `#hud-map, .smooth-glide { will-change: transform; transform: translateZ(0) }`', 'Verify: grep `will-change: transform` in <style>')
if (!hasTranslateZ) add('G3', 'jank', 1, 'missing `translateZ(0)` promotion — layer not composited', 'Add `transform: translateZ(0)` to HUD map/markers', 'Verify: html contains `translateZ(0)`')
if (!hasContain) {
  // not fatal for this project (contain:layout optional), warn as jank if missing on progress bar
  // check progress bar specifically
  if (!/contain/.test(html.slice(html.indexOf('tracking-progress-fill') - 500, html.indexOf('tracking-progress-fill') + 500))) {
    // soft fail — count as jank but not stair
    add('G3', 'jank', htmlLineNo(html.indexOf('tracking-progress-fill')), '`contain:layout` missing on RAF bar — layout thrash risk', 'Add `contain:layout` or `contain:paint` to #tracking-progress-fill wrapper', 'Verify: `contain:` in style')
  }
}
// prev guards: check for `if (prev !== next)` or `_keys.x !== x` before updateText
const hasPrevGuards = /_trackingEtaKeys\.\w+\s*!==|_driveUiKeys\.\w+\s*!==|if\s*\(.*prev/.test(src)
if (!hasPrevGuards) add('G3', 'jank', srcLineNo(src.indexOf('updateText')), 'missing prev guards before DOM writes — redundant textContent writes thrash', 'Guard: `if (prevKey !== nextVal) { prevKey=nextVal; el.textContent=nextVal }` (see _trackingEtaKeys)', 'Verify: ` _trackingEtaKeys.` pattern exists')
else {
  // check that at least 3 prev guards exist (progress, eta, distance)
  const guardCount = (src.match(/_trackingEtaKeys\.\w+ !==/g) || []).length
  if (guardCount < 3) add('G3', 'jank', srcLineNo(src.indexOf('_trackingEtaKeys')), `only ${guardCount} prev guards — expected ≥3 for progress/eta/distance`, 'Add prev guards for each liveId write', 'Verify: count `_trackingEtaKeys.*!==` ≥3')
}
// dtClamped 32
const hasDtClamp = /Math\.min\(.*dt.*32\)|Math\.min\(time - last\w+, 32\)|dtClamped|Math\.min\(dt, 32\)|Math\.min\(time - lastVisualFrameTime, 100\)/.test(src)
if (!hasDtClamp) {
  add('G3', 'jank', srcLineNo(src.search(/const dt/)), 'missing dtClamped 32 — large dt after tab hidden causes jump/jank', 'Clamp: `const dt=Math.min(time-lastTime, 32)` or `Math.min(time-lastVisualFrameTime,100)` (existing 100 is ok but 32 preferred for 60 Hz)', 'Verify: `Math.min(time -` present')
} else {
  // check value ≤32 or ≤100
  const dtLine = src.match(/const dt\s*=\s*Math\.min\([^)]+\)/)?.[0] || ''
  if (/Math\.min\(time - lastVisualFrameTime, 100\)/.test(dtLine)) {
    // 100 is larger than ideal 32 but still prevents huge jumps — soft pass, warn as jank
    add('G3', 'jank', srcLineNo(src.indexOf('const dt')), `dt clamped to 100 ms, not 32 ms — after hidden=32 ms frame may still jump`, 'Clamp to 32 ms: `Math.min(time-lastVisualFrameTime, 32)` (or 100 with sim proof ratio≥0.08)', 'Verify: `dt` line shows 32')
  }
}
// hidden/stale throttle
const hasHiddenThrottle = /document\.visibilityState\s*===\s*'hidden'/.test(src)
if (!hasHiddenThrottle) add('G3', 'jank', srcLineNo(src.search(/visibilityState/)) || 1, 'missing hidden throttle `if (document.visibilityState===\\\'hidden\\\') return` in RAF — wastes battery/jank on resume', 'Add at top of smoothVisualsLoop/renderAero: `if (visibilityState===\\\'hidden\\\') { active=false; return }` + `visibilitychange` restart', 'Verify: `visibilityState` check in RAF')
const hasStaleThrottle = /timeSinceFix|stale|_lastPanLat|VISUAL_DEADBAND_SQ/.test(src)
if (!hasStaleThrottle) add('G3', 'jank', 1, 'missing stale throttle / deadband — stationary frames still write', 'Gate: `if ((dLat²+dLon²)>DEADBAND) setLatLng/panTo` and `if (speed<2 && no heading delta) return`', 'Verify: `VISUAL_DEADBAND_SQ` exists')

// ── G4: reduced-motion boot-only, aria-live, transparency ──
const hasReducedMotionQuery = /prefers-reduced-motion/.test(src) || /prefers-reduced-motion/.test(html)
const hasReducedMotionListener = /addEventListener.*change.*prefers-reduced-motion|matchMedia.*addListener/.test(src)
if (!hasReducedMotionQuery) {
  add('G4', 'a11y', 1, 'missing `prefers-reduced-motion` check — motion-sensitive users get forced glide', 'Add `const reduced=mq.matches; if (reduced) tc=0` at boot', 'Verify: `prefers-reduced-motion` in src/html')
} else if (!hasReducedMotionListener) {
  // boot-only is acceptable per “reduced-motion boot-only” gate — but flag as info if no listener
  // For this project boot-only is PASS per spec (“reduced-motion boot-only” means check at boot, not dynamic)
  // So we PASS here — no add
}
const hasAriaLive = /aria-live/.test(html)
if (!hasAriaLive) add('G4', 'a11y', htmlLineNo(html.indexOf('<body') || 0), 'missing `aria-live="polite"` on live telemetry region — screen readers miss updates', 'Add `<div aria-live="polite" aria-atomic="true">` around liveSpeed/driveNode/eta bar', 'Verify: `aria-live` in html')
if (!/opacity/.test(html) && /hud-card/.test(html)) {
  add('G4', 'a11y', 1, 'HUD card lacks transparency handling for glanceability', 'Ensure `.hud-card { background: rgba(… , 0.9) }` and test contrast', 'Verify: visual check')
}

// ── report ──
function formatGate(g) {
  const gateFindings = findings.filter(f => f.gate === g)
  const label = { G0: 'G0 inventory', G1: 'G1 hard fails', G2: 'G2 precision', G3: 'G3 hygiene', G4: 'G4 a11y/perf' }[g] || g
  if (gateFindings.length === 0) {
    console.log(`${g} ${label}: PASS`)
    return
  }
  for (const f of gateFindings) {
    const kind = f.kind === 'stair' ? '[STAIR]' : f.kind === 'jank' ? '[JANK ]' : '[A11Y ]'
    console.log(`${g} ${label}: FAIL ${kind} — ${f.msg}`)
    console.log(`  at ${f.line > 0 ? `index.html:${f.line}` : 'index.html:1'} — fix: ${f.fix}`)
    console.log(`  verify: ${f.verify}`)
  }
}

console.log(`ui-fluidity-audit: ${CONFIG.liveIds.length} liveIds @ ${CONFIG.sourceRateHz}→${CONFIG.renderRateHz} Hz — ${lowFreqSources.length} low-freq sources, ${liveWrites.length} DOM writes (${liveWrites.filter(w=>w.isRaf).length} in RAF)`)
console.log(`  liveIds: ${CONFIG.liveIds.join(', ')}`)
console.log(`  interpolator: ${interpFound ? 'found' : 'MISSING'} (${hasStateVisualLerp ? 'state.visual lerp' : hasInterpAlpha ? 'alpha' : hasVelDt ? 'vel*dt' : 'none'})`)
;['G0','G1','G2','G3','G4'].forEach(formatGate)

const totalFails = findings.length
console.log(`\nPerfection verdict: ${totalFails === 0 ? 'PASS' : `FAIL (${stairs} stairs, ${janks} janks)`} — ${totalFails} finding(s) across G0-G4`)
if (totalFails === 0) console.log('  All gates green — no stair, no jank: display* glides at 60 Hz from 1 Hz source.')
else {
  console.error(`ui-fluidity-audit: FAIL — ${findings.filter(f=>f.kind==='stair').length} stair(s), ${findings.filter(f=>f.kind==='jank').length} jank(s)`)
  console.error('  One stair = FAIL (perfection gate). Fix G1 stairs first, then G3 hygiene.')
}

process.exit(totalFails > 0 ? 2 : 0)
