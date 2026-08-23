// VISUAL AUDIT (Phase 3 extension) — transform-contract enforcement.
//
// No static tool can see pixels, but every rotated-overlay bug shares one
// auditable root cause: a rendered layer inherited a transform nobody
// classified. This scanner reconstructs the layer inventory FROM THE SOURCE
// (not from a hand-maintained list), derives each layer's contract, and
// enforces it mechanically:
//
//   WORLD-LOCKED   — geography (tiles, route geometry). Rotates with the map.
//                    Text-free shapes may live here.
//   SCREEN-LOCKED  — anything a human reads/recognises mid-drive (station
//                    icons, popups, node labels). Must resolve to a pane that
//                    is counter-rotated whenever #hud-map rotates.
//   SELF-ROTATING  — encodes direction by design and declares its own named
//                    reference (e.g. rotate(var(--user-heading))). Allowed in
//                    any pane because it manages its own frame.
//
// Derivation rule (the common-sense clause): if a driver would need to read
// it while moving, it cannot inherit map rotation. When in doubt,
// readable -> SCREEN-LOCKED; only pure world geometry earns WORLD-LOCKED.
//
// Enforced contracts (PERF-P2 var-driven rotation era):
//   L  LEGACY BAN — no JS may write rotate() templates directly on #hud-map
//                   or any leaflet pane. All rotation flows through --hud-rot.
//   V1 SINGLE WRITER — exactly one function may setProperty('--hud-rot', ...).
//                   A second writer is a desync waiting to happen.
//   C1 CSS SIGNS  — the stylesheet must rotate #hud-map by calc(-1*var) and
//                   every MANAGED pane by +var. Wrong/missing signs = broken
//                   counter-rotation (double tilt or tilt with heading).
//   C3 CSS STACK  — popup containers must NOT carry their own CSS
//                   --user-heading counter-rotation on top of the pane sync
//                   (net +heading tilt — shipped once, caught here forever).
//
// What it scans (tests/_module_extract.mjs + index.html):
//   - createPane(...) calls            -> custom pane inventory
//   - L.marker / setIcon(L.divIcon)    -> content + pane assignment
//   - style.transform = rotate(...)    -> legacy writes (banned)
//   - setProperty('--hud-rot')         -> sanctioned writer inventory
//   - <style> rules                    -> sign + coverage of derived transforms
//   - bindPopup                        -> popup-pane requirement
//
// Known limitations (accepted, reviewed manually):
//   - setIcon() inherits its pane from the nearest preceding L.marker with a
//     `pane:` option (window: 1500 chars back).
//   - verify-scanners.mjs can only mutate the extracted module, so the
//     CSS-side contracts (C1/C3) are proven by manual injection tests during
//     audit sessions, not automated controls.
//
// Usage: node tests/extract-module.mjs && node tests/visual-audit.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const EXTRACT = path.join(here, '_module_extract.mjs')
const HTML = path.join(here, '..', 'index.html')

if (!fs.existsSync(EXTRACT)) {
  console.error('visual-audit: run node tests/extract-module.mjs first.')
  process.exit(1)
}

const src = fs.readFileSync(EXTRACT, 'utf8')
const htmlSrc = fs.readFileSync(HTML, 'utf8')

function lineNo(pos) { return src.slice(0, pos).split('\n').length }

// ---------- helpers: enclosing-function spans ----------

function functionSpans(s) {
  const spans = []
  const patterns = [
    /function\s+([\w$]+)\s*\([^)]*\)\s*\{/g,
    /([\w.$]+)\s*=\s*function\s*(?:[\w$]+)?\s*\([^)]*\)\s*\{/g
  ]
  for (const re of patterns) {
    for (const m of s.matchAll(re)) {
      let depth = 0, i = s.indexOf('{', m.index)
      for (; i < s.length; i++) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') { depth--; if (depth === 0) break }
      }
      const rawName = m[1].includes('.') ? m[1].split('.').pop() : m[1]
      spans.push({ name: rawName || '(anon)', start: m.index, end: i })
    }
  }
  spans.sort((a, b) => b.start - a.start || (a.end - a.start) - (b.end - b.start))
  return spans
}
const spans = functionSpans(src)
function enclosingFn(pos) {
  return spans.find(sp => pos >= sp.start && pos <= sp.end) || null
}

// ---------- 1. Custom pane inventory ----------
// Leaflet names the element class `leaflet-<name minus "Pane">-pane`.

const panes = [] // { name, cssSelector, declaredLine }
for (const m of src.matchAll(/createPane\(\s*'([\w]+)'\s*\)/g)) {
  const name = m[1]
  const css = `.leaflet-${name.replace('Pane', '')}-pane`
  panes.push({ name, css, declaredLine: lineNo(m.index) })
}

// ---------- 2. Rotation writers ----------

// varName -> leaflet pane CSS selector (from `const x = el.querySelector('.leaflet-...')`)
const paneVarToCss = new Map()
for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*[\w.$]+\.querySelector\(\s*'(\.leaflet-[\w-]+)'\s*\)/g)) {
  paneVarToCss.set(m[1], m[2])
}

const ROTATE_WRITE_RE = /([\w.$]+)\.style\.transform\s*=\s*`rotate\(\$\{-?[A-Za-z_$][\w$]*\}deg\)`/g
const legacyWriters = [] // { target, fn, line } — banned post-P2
for (const m of src.matchAll(ROTATE_WRITE_RE)) {
  const target = m[1]
  if (/hudMap$|hud-map/.test(target)) {
    const sp = enclosingFn(m.index)
    legacyWriters.push({ target, fn: sp ? sp.name : '(module top-level)', line: lineNo(m.index) })
    continue
  }
  const rootVar = target.split('.').pop()
  if (paneVarToCss.has(rootVar)) {
    const sp = enclosingFn(m.index)
    legacyWriters.push({ target: paneVarToCss.get(rootVar), fn: sp ? sp.name : '(module top-level)', line: lineNo(m.index) })
  }
  // non-map, non-pane writers (dashboard dials) stay out of scope
}

const VAR_WRITE_RE = /setProperty\(\s*'--hud-rot'\s*,/g
const varWriterFns = new Set() // distinct enclosing functions writing the var
const varWriterLines = []
for (const m of src.matchAll(VAR_WRITE_RE)) {
  const sp = enclosingFn(m.index)
  varWriterFns.add(sp ? sp.name : '(module top-level)')
  varWriterLines.push(lineNo(m.index))
}

// ---------- 3. Marker / overlay inventory ----------

function classifyHtml(htmlChunk) {
  if (typeof htmlChunk !== 'string') return { textBearing: false, selfRotating: false }
  const noInterp = htmlChunk.replace(/\$\{[^}]*\}/g, '')
  const textOnly = noInterp.replace(/<[^>]*>/g, '')
  return {
    textBearing: /[A-Za-z0-9]/.test(textOnly),
    selfRotating: /rotate\(var\(--/.test(htmlChunk)
  }
}

const layers = []
const ICON_RE = /L\.divIcon\s*\(/g
for (const m of src.matchAll(ICON_RE)) {
  const start = m.index
  const body = src.slice(start, start + 800)

  const htmlM = body.match(/html:\s*`([^`]*)`/) || body.match(/html:\s*'([^']*)'/)
  const cls = classifyHtml(htmlM ? htmlM[1] : '')

  let pane = null
  const ownOpt = src.slice(Math.max(0, start - 400), start).match(/pane:\s*'([\w]+)'\s*,?\s*$|\{ pane:\s*'([\w]+)'/)
  if (ownOpt) pane = ownOpt[1] || ownOpt[2]
  if (!pane) {
    const back = src.slice(Math.max(0, start - 1500), start)
    const all = [...back.matchAll(/pane:\s*'([\w]+)'/g)]
    if (all.length) pane = all[all.length - 1][1]
  }
  const paneCss = pane ? `.leaflet-${pane.replace('Pane', '')}-pane` : '.leaflet-marker-pane (default)'
  const label = (body.match(/className:\s*'([\w-]+)'/) || [null, null])[1]

  layers.push({
    line: lineNo(start),
    paneCss,
    textBearing: cls.textBearing,
    selfRotating: cls.selfRotating,
    hint: label || ''
  })
}

// ---------- 4. Popup requirement ----------

const hasPopups = /bindPopup\(/.test(src)
const POPUP_CSS = '.leaflet-popup-pane'

const hostedPanes = new Set(layers.map(l => l.paneCss))
const managedPanes = new Set()
if (hasPopups) managedPanes.add(POPUP_CSS)
for (const p of panes) {
  if (hostedPanes.has(p.css)) managedPanes.add(p.css)
}

// ---------- 5. Stylesheet contracts (C1 signs / coverage, C3 stack) ----------

// Comments may legitimately mention class names (e.g. rationale notes);
// strip them so their text can't contaminate selector matching.
const styleCss = [...htmlSrc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map(m => m[1])
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const norm = (s) => s.replace(/\s+/g, '')
const cssInfo = [] // info lines for report

let hudMapNegRule = false
const positivePaneRules = new Set() // pane css selectors covered by +var rule
const wrongSignedPanes = new Set()

for (const m of styleCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const sel = norm(m[1])
  const body = norm(m[2])
  const isHudMap = sel.includes('#hud-map')
  const isManagedPane = [...managedPanes].some(css => sel.includes(css))
  if (!isHudMap && !isManagedPane && !/popup/i.test(sel)) continue
  if (/rotate\(/.test(body) || /--hud-rot/.test(body)) {
    cssInfo.push(`css: ${m[1].trim().replace(/\s+/g, ' ').slice(0, 60)} -> ${body.slice(0, 80)}`)
  }
  if (isHudMap && body.includes('calc(-1*var(--hud-rot')) hudMapNegRule = true
  if (isHudMap && body.includes('rotate(var(--hud-rot')) wrongSignedPanes.add('#hud-map')
  for (const css of managedPanes) {
    if (!sel.includes(css)) continue
    if (body.includes('rotate(var(--hud-rot')) positivePaneRules.add(css)
    if (body.includes('calc(-1*var(--hud-rot')) wrongSignedPanes.add(css)
  }
}

// ---------- 6. Contract enforcement ----------

const findings = []

// L — legacy direct rotate writes are banned on map + panes
for (const w of legacyWriters) {
  findings.push(
    `line ${w.line}: direct rotate() write on ${w.target} in '${w.fn}' — rotation must flow through --hud-rot (see applyHudCssRotation + stylesheet rules)`
  )
}

// V1 — single --hud-rot writer
if (varWriterFns.size > 1) {
  findings.push(
    `--hud-rot written from ${varWriterFns.size} functions (${[...varWriterFns].join(', ')}) — single-writer contract violated`
  )
}

// C1 — stylesheet signs + coverage
if (managedPanes.size > 0 || varWriterFns.size > 0) {
  if (!hudMapNegRule) {
    findings.push('stylesheet lacks #hud-map { transform: rotate(calc(-1 * var(--hud-rot))) } — the map would not counter the rotation variable')
  }
  for (const css of managedPanes) {
    if (!positivePaneRules.has(css)) {
      findings.push(`stylesheet does not counter-rotate ${css} via rotate(var(--hud-rot)) — its overlays inherit map rotation`)
    }
  }
  for (const css of wrongSignedPanes) {
    findings.push(`${css} uses a NEGATIVE --hud-rot sign — doubles rotation instead of countering it`)
  }
}

// Layer contract: text-bearing overlays must sit in a managed pane.
for (const layer of layers) {
  if (!layer.textBearing || layer.selfRotating) continue
  if (layer.paneCss !== POPUP_CSS && !positivePaneRules.has(layer.paneCss)) {
    findings.push(
      `line ${layer.line}: text-bearing overlay inherits map rotation (pane ${layer.paneCss}, not counter-rotated) — unreadable while driving; move it to a managed pane or make it SELF-ROTATING with a named reference`
    )
  }
}

// C3 — popup containers must not carry their own CSS counter-rotation
for (const m of styleCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const sel = m[1].trim()
  if (/popup/i.test(sel) && /rotate\(\s*var\(\s*--user-heading/.test(m[2])) {
    findings.push(
      `CSS rule "${sel.slice(0, 50)}" rotates a popup container by var(--user-heading) — stacks on the JS pane sync (net +heading tilt). Popup uprightness is owned solely by --hud-rot.`
    )
  }
}

// ---------- 7. Report ----------

const kindOf = (l) => l.selfRotating ? 'SELF-ROTATING' : (l.textBearing ? 'SCREEN-LOCKED' : 'text-free')

console.log('visual-audit: layer inventory (derived from source)')
console.log(`  #hud-map ..................... WORLD-LOCKED root | --hud-rot writers: ${varWriterFns.size} (${[...varWriterFns].join(', ') || 'none'}) @${varWriterLines.join(',') || '-'} | legacy rotate sites: ${legacyWriters.length}`)
console.log(`  css coverage ................. hud-map negative rule: ${hudMapNegRule ? 'OK' : 'MISSING'} | managed panes covered: ${[...positivePaneRules].join(', ') || 'none'}`)
for (const p of panes) {
  console.log(`  ${p.css.padEnd(30)} ${positivePaneRules.has(p.css) ? 'SCREEN-LOCKED (+var)' : 'unmanaged'} | created line ${p.declaredLine}`)
}
if (hasPopups) console.log(`  ${POPUP_CSS.padEnd(30)} ${positivePaneRules.has(POPUP_CSS) ? 'SCREEN-LOCKED (+var)' : 'UNMANAGED'} | popups bound`)
for (const l of layers) {
  console.log(`  marker @${String(l.line).padEnd(5)} .............. ${kindOf(l).padEnd(14)} | ${l.paneCss}${l.hint ? ' | .' + l.hint : ''}`)
}
if (varWriterFns.size) console.log(`  info: rotation sync helper: ${[...varWriterFns].join(', ')}`)

// CSS info dump (non-contract rules touching the HUD)
for (const line of cssInfo) console.log(`  ${line}`)

if (findings.length === 0) {
  console.log('visual-audit: PASS - all readable overlays resolve to upright surfaces')
  process.exit(0)
}

console.error('visual-audit: FAIL - transform-contract violations:')
for (const f of findings) console.error('  [HIGH] ' + f)
console.error('Classify every affected layer (see AGENTS.md "Visual Audit"): readable -> SCREEN-LOCKED (managed pane), direction indicator -> SELF-ROTATING with named reference, pure geometry -> world-locked.')
process.exit(2)
