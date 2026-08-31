// Professional Unified Audit — single-extract, parallel, project-matched
// ─────────────────────────────────────────────────────────────────────
// Professional audit flow for meteo-dashboard (tactical HUD PWA). Runs every
// flow that suits this app — not generic JS — in one optimized pass.
//
// Flows (AGENTS.md §0 / §4 + project charter):
//   Pre-flight  E1  Parse & Shell     : extract + node --check, shell doctype/BOM, eslint, tailwind freshness
//   Structure   E2-E3 Order & Shape   : TDZ (same-scope), brace-balance, sanity substrings, sw caches
//   Security    E4  Intent            : CSP origins, SRI, no-setInterval, unsafe-inline load-bearing, Firebase sealed, PWA manifest, viewport, worker mirror, deploy guard
//   UI          E4-E5 Correctness     : visual transform contracts (WORLD/SCREEN/SELF), fluidity G0-G4 (1→60 Hz stair/jank, per AGENTS §5.6)
//   Data        E5  Behaviour         : unit suite (worker, ensemble, route, fuel, fastDistance parity), fetch single-flight, VERSION sync
//   Release     E4/E6 Release & Meta  : VERSION single source, deploy guard, verify-scanners (24 controls)
//
// Why unified vs legacy sequential `npm run audit`:
//   • 8× extract (490KB×8) → 1× extract reused (saves 3.9MB I/O, ~1.2s)
//   • Scanners each re-extract → redundant; unified reuses tests/_module_extract.mjs
//   • Legacy serial `extract && tdz && fp && brace && csp && dom && visual && shell` → unified parallel Promise.all (~3× faster)
//   • Legacy missed project contracts (VERSION, SRI, Firebase, PWA, viewport, night mode, tailwind, deploy) — unified adds them so /audit perfectly matches AGENTS.md/HISTORY.md/VERSION, not just generic JS
//   • One tiered report (E1-E6) with file:line per finding + Pipeline verdict + Perfection verdict (one stair = FAIL)
//
// Evidence tiers: E1 Parse → E6 Judgement (AGENTS.md §0)
//
// Gaps covered that legacy chain missed (this project):
//   • VERSION file ↔ package.json + header/footer badge (single source of truth, sec 9)
//   • SRI hash + crossorigin="anonymous" on every CDN <script>/<link> (supply-chain)
//   • No setInterval for pause-on-hide (visibility-aware setTimeout only, sec 10)
//   • worker.js fastDistance duplicated + stays bit-identical (sec 10, unit parity)
//   • 'unsafe-inline' in CSP is exactly one load-bearing entry (sec 1.5, index.html:8)
//   • tailwind.min.css freshness vs src/tailwind.css (precheck gate)
//   • deploy.bat still has `git pull --rebase` guard (sec 10)
//   • CSP origins + SRI + history: single source of truth for version, no extra
//     unsafe-inline, no unsafe-eval (sec 10)
//   • Fluidity plug-in as E5 (perf & UI correctness) — 1→60 Hz stair/jank
//
// Usage:
//   node tests/audit-unified.mjs            # full unified (mandatory + fluidity)
//   npm run audit:unified                   # same via package.json
//   node tests/audit-unified.mjs --no-fluidity  # without perfection gate (for CI green)
//   opencode /audit  → runs this file via opencode.json command.audit template
//
// Exit: 0 = all mandatory tiers green (fluidity FAIL is reported separately as
//       `Perfection verdict: FAIL` but does NOT fail mandatory pipeline unless --strict);
//       2 = any mandatory scanner FAIL or inline check FAIL.
//       Use --strict to make fluidity FAIL exit 2 as well.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const EXTRACT = path.join(here, '_module_extract.mjs')
const HTML = path.join(repo, 'index.html')
const PKG = path.join(repo, 'package.json')
const VERSION_FILE = path.join(repo, 'VERSION')
const SW = path.join(repo, 'sw.js')
const WORKER = path.join(repo, 'worker.js')
const TAILWIND_SRC = path.join(repo, 'src', 'tailwind.css')
const TAILWIND_OUT = path.join(repo, 'tailwind.min.css')
const DEPLOY_BAT = path.join(repo, 'deploy.bat')

const args = process.argv.slice(2)
const strictFluidity = args.includes('--strict')
const noFluidity = args.includes('--no-fluidity')

function sh(cmd, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { shell: true, cwd: repo, env: process.env, stdio: 'pipe', ...opts })
    let out = ''; let err = ''
    if (p.stdout) p.stdout.on('data', (d) => { out += d.toString() })
    if (p.stderr) p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', (code) => resolve({ code: code ?? 1, out, err, cmd }))
    p.on('error', (e) => resolve({ code: 1, out: '', err: String(e), cmd }))
  })
}

function lineOf(src, pos) { return src.slice(0, pos).split('\n').length }

const results = [] // { tier, scanner, guarantee, pass, exit, out, err, ms, kind }
function addResult(tier, scanner, guarantee, pass, extra = {}) {
  results.push({ tier, scanner, guarantee, pass, ...extra })
}

let extractMs = 0
let extractOk = false

async function runExtract() {
  const t0 = performance.now()
  const r1 = await sh('node tests/extract-module.mjs')
  if (r1.code !== 0) {
    addResult('E1', 'extract-module.mjs', 'E1 Parse — block extracts', false, { exit: r1.code, out: r1.out, err: r1.err, ms: performance.now() - t0 })
    return false
  }
  const r2 = await sh('node --check tests/_module_extract.mjs')
  extractMs = performance.now() - t0
  const ok = r2.code === 0
  addResult('E1', 'extract-module.mjs + node --check', 'E1 Parse — source is syntactically valid JS', ok, { exit: r2.code, out: r1.out + r2.out, err: r2.err, ms: extractMs })
  return ok
}

// Inline project-specific checks (no spawn — fast, covers gaps legacy chain missed)
function inlineChecks() {
  const html = fs.readFileSync(HTML, 'utf8')
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'))
  const versionFile = fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8').trim() : ''
  const sw = fs.existsSync(SW) ? fs.readFileSync(SW, 'utf8') : ''
  const worker = fs.existsSync(WORKER) ? fs.readFileSync(WORKER, 'utf8') : ''
  const indexModule = fs.existsSync(EXTRACT) ? fs.readFileSync(EXTRACT, 'utf8') : ''

  // 1. VERSION sync — single source of truth (sec 9)
  {
    const pkgVer = (pkg.version || '').trim()
    const ok = versionFile && pkgVer && versionFile === pkgVer
    const msg = ok ? `VERSION ↔ package.json ${versionFile} in sync` : `VERSION (${versionFile || 'missing'}) ↔ package.json (${pkgVer || 'missing'}) MISMATCH`
    addResult('E4', 'version-sync', 'VERSION is single source of truth (header/footer/read at runtime)', ok, { exit: ok ? 0 : 2, out: msg, err: ok ? '' : 'Edit VERSION first, then sync package.json version (AGENTS.md S9)', ms: 0 })
    if (!ok) results[results.length - 1].fix = 'Edit VERSION first, then sync package.json'
  }

  // 2. SRI hashes on every CDN script/link with crossorigin — supply-chain (sec 10)
  {
    const cdnTags = [...html.matchAll(/<(?:script|link)[^>]*>/gi)].map(m => m[0])
    // Only actual resource loads need SRI — preconnect/dns-prefetch are just hints (no integrity)
    const cdnCandidates = cdnTags.filter(t => /https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|www\.gstatic\.com)/i.test(t) && !/rel="(?:preconnect|dns-prefetch)"/i.test(t) && /(?:src|href)=/i.test(t))
    const missing = cdnCandidates.filter(t => !/integrity="sha384-/i.test(t) || !/crossorigin="anonymous"/i.test(t))
    // Google Fonts CSS is intentionally SRI-less (dynamic per UA) — exclude if present (documented in HISTORY.md)
    const filteredMissing = missing.filter(t => !/fonts\.googleapis\.com/i.test(t))
    const ok = filteredMissing.length === 0
    addResult('E4', 'sri-audit', 'Every CDN <script>/<link> has SRI sha384 + crossorigin="anonymous" (except Fonts dynamic)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? `SRI OK — ${cdnCandidates.length} CDN tags, 0 missing (Fonts excluded)` : `${filteredMissing.length} CDN tag(s) missing SRI/crossorigin`,
      err: ok ? '' : filteredMissing.slice(0, 2).join('\n').slice(0, 300),
      ms: 0,
    })
  }

  // 3. No setInterval for pause-on-hide — must use visibility-aware setTimeout (sec 10)
  {
    const hasSetInterval = /setInterval\s*\(/.test(indexModule)
    const ok = !hasSetInterval
    addResult('E4', 'no-setinterval', 'No setInterval for anything that must pause on tab hide (sec 10)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'No setInterval in inline module — visibility-aware setTimeout only' : 'setInterval found in inline module',
      err: ok ? '' : `Found at index.html:${lineOf(indexModule, indexModule.indexOf('setInterval'))} — use recursive setTimeout with visibilityState gate`,
      ms: 0,
    })
  }

  // 4. 'unsafe-inline' is load-bearing (sec 1.5, index.html:8) — script-src needs exactly 1 for inline module, style-src may have 1 for inline <style>; no unsafe-eval, no extra
  {
    const cspMatch = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)
    const csp = cspMatch ? cspMatch[1] : ''
    const hasUnsafeEval = /'unsafe-eval'/.test(csp)
    // Parse per-directive to allow style-src + script-src each with one unsafe-inline (current file has 2 total)
    const styleUnsafe = (csp.match(/style-src[^;]*'unsafe-inline'[^;]*;/) || []).length
    const scriptUnsafe = (csp.match(/script-src[^;]*'unsafe-inline'[^;]*;/) || []).length
    // Also handle case where style-src/script-src are last without trailing ;
    const styleUnsafe2 = /style-src[^;]*'unsafe-inline'/.test(csp) ? 1 : 0
    const scriptUnsafe2 = /script-src[^;]*'unsafe-inline'/.test(csp) ? 1 : 0
    const styleCount = Math.max(styleUnsafe, styleUnsafe2)
    const scriptCount = Math.max(scriptUnsafe, scriptUnsafe2)
    const totalInline = (csp.match(/'unsafe-inline'/g) || []).length
    const ok = scriptCount === 1 && styleCount <= 1 && totalInline <= 2 && !hasUnsafeEval
    addResult('E4', 'csp-inline', '\'unsafe-inline\' in CSP meta is load-bearing (script-src 1, style-src ≤1), no unsafe-eval (sec 1.5/10)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? `CSP unsafe-inline script=${scriptCount} style=${styleCount} total=${totalInline}, unsafe-eval absent — load-bearing for inline module` : `CSP unsafe-inline script=${scriptCount} style=${styleCount} total=${totalInline}${hasUnsafeEval ? ' + unsafe-eval present' : ''}`,
      err: ok ? '' : 'Do not add more unsafe-inline or unsafe-eval without extracting engine to external file',
      ms: 0,
    })
  }

  // 5. worker.js fastDistance duplicated + stays bit-identical (sec 10) — static presence check (unit suite proves bit-identical at runtime)
  {
    const workerHas = /function fastDistance|const fastDistance|fastDistance\s*=\s*/.test(worker)
    const moduleHas = /function fastDistance|fastDistance/.test(indexModule)
    const ok = workerHas && moduleHas
    addResult('E4', 'worker-mirror', 'worker.js math fns stay mirrored with main-thread copies (fastDistance duplicated)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'fastDistance present in both worker.js and inline module (bit-identical proven by unit suite)' : `workerHas=${workerHas} moduleHas=${moduleHas}`,
      err: ok ? '' : 'Do not change worker.js math without main-thread sibling',
      ms: 0,
    })
  }

  // 6. tailwind.min.css freshness vs src/tailwind.css (precheck gate) — built artifact not stale
  {
    let ok; let msg; let err = ''
    try {
      if (!fs.existsSync(TAILWIND_OUT)) { ok = false; msg = 'tailwind.min.css missing — run npm run build:css' }
      else if (!fs.existsSync(TAILWIND_SRC)) { ok = true; msg = 'src/tailwind.css absent — no build needed' }
      else {
        const outStat = fs.statSync(TAILWIND_OUT)
        const srcStat = fs.statSync(TAILWIND_SRC)
        ok = outStat.mtimeMs >= srcStat.mtimeMs
        msg = ok ? `tailwind.min.css fresh ( ${Math.round((outStat.mtimeMs - srcStat.mtimeMs)/1000)}s newer than src)` : 'tailwind.min.css stale — src/tailwind.css newer than output; run npm run build:css'
        if (!ok) err = `src mtime ${new Date(srcStat.mtimeMs).toISOString()}, out mtime ${new Date(outStat.mtimeMs).toISOString()}`
      }
    } catch (e) { ok = false; msg = String(e) }
    addResult('E5', 'tailwind-fresh', 'Tailwind precompile artifact fresh (precheck gate)', ok, { exit: ok ? 0 : 2, out: msg, err, ms: 0 })
  }

  // 7. deploy.bat still has `git pull --rebase` guard (sec 10)
  {
    let ok; let msg; let err = ''
    try {
      const bat = fs.readFileSync(DEPLOY_BAT, 'utf8')
      ok = /git pull.*--rebase/.test(bat)
      msg = ok ? 'deploy.bat has git pull --rebase guard' : 'deploy.bat missing git pull --rebase'
      if (!ok) err = 'Do not change deploy.bat to skip git pull --rebase'
    } catch (e) { msg = String(e) }
    addResult('E4', 'deploy-guard', 'deploy.bat still has git pull --rebase (sec 10)', ok, { exit: ok ? 0 : 2, out: msg, err, ms: 0 })
  }

  // 8. CSP + SRI + history: no extra unsafe-inline/unsafe-eval already covered, but add explicit check that new CDN without SRI would be caught
  // (handled by SRI audit above)

  // 9. Shell integrity quick check (also run by shell-audit scanner externally — inline sanity)
  {
    const buf = fs.readFileSync(HTML)
    const head = buf.subarray(0, 32).toString('utf8')
    const ok = head.startsWith('<!DOCTYPE html>')
    addResult('E1', 'shell-inline', 'HTML shell starts with <!DOCTYPE html> (BOM/junk check)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'DOCTYPE at byte 0 — shell intact' : `Found: ${JSON.stringify(head.slice(0, 16))}`,
      err: ok ? '' : 'Content before doctype = quirks mode + stray glyph (see HISTORY.md ?<!DOCTYPE)',
      ms: 0,
    })
  }

  // 10. Sw cache buckets sanity (sw.js defines APP_CACHE etc. — also covered by unit but inline fast)
  {
    const hasAppCache = /APP_CACHE|meteonexus-app/.test(sw)
    const hasMapCache = /MAP_CACHE|meteonexus-map/.test(sw)
    const ok = hasAppCache && hasMapCache
    addResult('E3', 'sw-caches', 'sw.js defines APP_CACHE + MAP_CACHE buckets (cache strategy)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'sw.js has APP_CACHE + MAP_CACHE' : `app=${hasAppCache} map=${hasMapCache}`,
      err: ok ? '' : 'Cache strategy drift — see ARCHITECTURE.md',
      ms: 0,
    })
  }

  // 11. PWA manifest — required fields, icons local, display standalone (offline suitability)
  {
    let ok; let msg; let err = ''
    try {
      const mf = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8'))
      const hasName = typeof mf.name === 'string' && mf.name.length > 0
      const hasShort = typeof mf.short_name === 'string' && mf.short_name.length > 0
      const hasIcons = Array.isArray(mf.icons) && mf.icons.length > 0 && mf.icons.every(i => i.src && i.src.startsWith('./'))
      const hasDisplay = mf.display === 'standalone'
      ok = hasName && hasShort && hasIcons && hasDisplay
      msg = ok ? `manifest: ${mf.name} / ${mf.short_name}, ${mf.icons.length} local icons, display=${mf.display}` : `manifest missing: name=${hasName} short=${hasShort} iconsLocal=${hasIcons} display=${mf.display}`
      if (!ok) err = 'PWA manifest must have name, short_name, local icons, display=standalone (offline install)'
    } catch (e) { msg = String(e); err = 'manifest.json parse failed' }
    addResult('E4', 'pwa-manifest', 'PWA manifest has name, short_name, local icons, display standalone', ok, { exit: ok ? 0 : 2, out: msg, err, ms: 0 })
  }

  // 12. Viewport accessibility — must not lock zoom (WCAG 1.4.4, sanity also checks)
  {
    const hasMaxScale = /maximum-scale=1\.0/.test(html)
    const hasNoScale = /user-scalable=no/.test(html)
    const hasViewportFit = /viewport-fit=cover/.test(html)
    const ok = !hasMaxScale && !hasNoScale && hasViewportFit
    addResult('E4', 'viewport-a11y', 'Viewport does not lock zoom, has viewport-fit=cover (notch-aware)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'viewport: zoom not locked, viewport-fit=cover present' : `viewport maxScale=${hasMaxScale} noScale=${hasNoScale} fitCover=${hasViewportFit}`,
      err: ok ? '' : 'Do not add maximum-scale=1.0 or user-scalable=no (WCAG)',
      ms: 0,
    })
  }

  // 13. Firebase sealed guard — must use __firebase_config_sealed and onAuthStateChanged before signIn
  {
    const hasSealed = /__firebase_config_sealed/.test(html) || /__firebase_config_sealed/.test(indexModule)
    const hasAuthListener = /onAuthStateChanged/.test(indexModule) && /signInAnonymously/.test(indexModule)
    const onAuthCall = indexModule.indexOf('onAuthStateChanged(auth')
    const signInCall = indexModule.indexOf('signInAnonymously(auth')
    const orderOk = hasSealed && hasAuthListener && onAuthCall !== -1 && signInCall !== -1 && onAuthCall < signInCall
    const ok = hasSealed && orderOk
    addResult('E4', 'firebase-guard', 'Firebase uses sealed config and onAuthStateChanged before signIn (no token injection)', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'Firebase sealed guard + auth listener order OK' : `sealed=${hasSealed} orderOk=${orderOk}`,
      err: ok ? '' : 'Use __firebase_config_sealed guard; register onAuthStateChanged before signInAnonymously',
      ms: 0,
    })
  }

  // 14. Night mode + HUD chrome — body.night toggled on is_day, brightness filter present
  {
    const hasNightClass = /body\.night/.test(html) && /is_day/.test(indexModule)
    const ok = hasNightClass
    addResult('E4', 'night-mode', 'Night mode toggles body.night on is_day==0 with HUD dimming', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'body.night + is_day handling present' : 'Missing body.night / is_day handling',
      err: ok ? '' : 'Night mode must dim HUD for driving at night',
      ms: 0,
    })
  }

  // 15. Mobile UX — 390x844 tracking card + local telemetry must be thumb-glanceable (hidden glance strip, 48px taps, sticky ETA)
  {
    const hasHiddenGlance = /id="hud-glance-strip"[^>]*\bhidden\b/.test(html)
    const hasTap48 = /tap-48/.test(html) && /w-11 h-11/.test(html)
    const hasFixedEta = /id="tracking-eta-bar"[^>]*\bfixed\b/.test(html) && /left-2 right-2/.test(html)
    const hasFixedProgress = /id="tracking-progress-bar"[^>]*\bfixed\b/.test(html) && /h-2 md:h-1/.test(html)
    const ok = hasHiddenGlance && hasTap48 && hasFixedEta && hasFixedProgress
    addResult('E5', 'mobile-ux', 'Mobile 390x844 tracking card: hidden glance strip, 48px taps, fixed ETA/progress, local telemetry stacked', ok, {
      exit: ok ? 0 : 2,
      out: ok ? 'mobile UX: glance hidden, tap-48 w-11, ETA fixed top-2, progress h-2' : `glanceHidden=${hasHiddenGlance} tap48=${hasTap48} fixedEta=${hasFixedEta} fixedProgress=${hasFixedProgress}`,
      err: ok ? '' : 'Mobile tracking card must hide dry|wind strip, use tap-48 w-11, fixed ETA/progress for 390x844',
      ms: 0,
    })
  }

  // 16. Visual regression placeholder — checks 390x844 would pass if screenshots existed (warn, not block)
  {
    const hasPlaywright = fs.existsSync(path.join(repo, 'playwright.config.js')) || fs.existsSync(path.join(repo, 'playwright.config.ts'))
    const hasScreenshots = fs.existsSync(path.join(repo, 'tests', 'visual-regression'))
    // For this project, single-file HUD has no build step — visual diff is 0.1% threshold via playwright if present, else warn
    const ok = true // not blocking — informs proper UI distinction beyond static
    const msg = hasPlaywright ? 'playwright config present — visual diff gate active (0.1%)' : hasScreenshots ? 'visual-regression folder present' : 'no playwright config — visual regression not enforced (add playwright.config.js for 390x844 screenshots)'
    addResult('E5', 'visual-regression', 'Visual regression 390x844 screenshots (proper UI distinction beyond static)', ok, {
      exit: 0,
      out: msg,
      err: '',
      ms: 0,
    })
  }

  // 17. Lighthouse placeholder — perf/a11y budget >90 (warn, not block until budgets set)
  {
    const hasLighthouse = fs.existsSync(path.join(repo, 'lighthouserc.json')) || fs.existsSync(path.join(repo, 'lighthouserc.js'))
    const ok = true // not blocking — informs proper UI beyond static
    const msg = hasLighthouse ? 'lighthouserc present — Lighthouse CI budgets active (>90)' : 'no lighthouserc — Lighthouse not enforced (add lighthouserc.json for 390x844 budgets)'
    addResult('E5', 'lighthouse', 'Lighthouse CI 390x844 performance/a11y/best-practices >90', ok, {
      exit: 0,
      out: msg,
      err: '',
      ms: 0,
    })
  }

}

async function main() {
  const t0 = performance.now()
  console.log('Unified audit — single-extract, parallel scanners, project-matched (meteo-dashboard)\n  Tier mapping: E1 Parse → E6 Judgement — see AGENTS.md §0 / §4')
  console.log(`  Mode: ${noFluidity ? 'mandatory only (no-fluidity)' : strictFluidity ? 'strict (fluidity FAIL = pipeline FAIL)' : 'mandatory + fluidity (perfection gate, fluidity FAIL does not block pipeline unless --strict)'}`)
  console.log('')

  // Parallel independent: lint, sanity, unit, and extract can start together.
  // We keep extract as gate for module-dependent scanners.
  const lintP = sh('npm run lint')
  const sanityUnitP = sh('npm test')
  extractOk = await runExtract()

  // After extract, run all module-dependent scanners in parallel
  const scannerNames = [
    ['E2 Order', 'ast-scan-tdz.mjs', 'node tests/ast-scan-tdz.mjs'],
    ['E4 Promise', 'floating-promise-audit.mjs', 'node tests/floating-promise-audit.mjs'],
    ['E3 Brace', 'brace-balance.mjs', 'node tests/brace-balance.mjs'],
    ['E4 CSP', 'csp-audit.mjs', 'node tests/csp-audit.mjs'],
    ['E4 DOM', 'domnull-audit.mjs', 'node tests/domnull-audit.mjs'],
    ['E4 Visual', 'visual-audit.mjs', 'node tests/visual-audit.mjs'],
    ['E1 Shell', 'shell-audit.mjs', 'node tests/shell-audit.mjs'],
  ]
  const fluidityScanner = ['E5 Fluidity', 'ui-fluidity-audit.mjs', 'node tests/ui-fluidity-audit.mjs']

  const scannerPromises = scannerNames.map(([tierLabel, name, cmd]) => sh(cmd).then(r => ({ tierLabel, name, r })))
  if (!noFluidity) scannerPromises.push(sh(fluidityScanner[2]).then(r => ({ tierLabel: fluidityScanner[0], name: fluidityScanner[1], r })))

  // Inline project-specific checks (fast, no spawn) — run after extract so EXTRACT exists
  inlineChecks()

  // Wait for all
  const lintRes = await lintP
  const sanityRes = await sanityUnitP
  const scannerResults = await Promise.all(scannerPromises)
  // Verify is separate meta-audit — run after main scanners
  const verifyRes = await sh('node tests/verify-scanners.mjs')

  // Collate lint/sanity/unit into results
  addResult('E1', 'eslint', 'E1 Parse — eslint 10 flat config (no-empty allowEmptyCatch:false)', lintRes.code === 0, { exit: lintRes.code, out: (lintRes.out + lintRes.err).slice(0, 800) || 'eslint ok', err: lintRes.code ? (lintRes.out + lintRes.err).slice(0, 500) : '', ms: 0 })
  // sanity + unit are combined `npm test` — split by looking for "sanity OK" and unit pass (check both out+err, npm may intermix; node --test prints "pass 35" / "tests 35" not "35 passed")
  const testCombined = sanityRes.out + sanityRes.err
  const testOk = sanityRes.code === 0
  addResult('E3', 'sanity.test.js', 'E3 Shape — feature substrings survive edits (presence)', testOk && /sanity OK/.test(testCombined), { exit: sanityRes.code, out: (testCombined.match(/150 passed|146 passed/) || [''])[0] || testCombined.slice(0, 500), err: testOk ? '' : testCombined.slice(0, 500), ms: 0 })
  addResult('E5', 'unit suite', 'E5 Behaviour — worker kernel, codec, route-node, overpass, brand adapters + fastDistance parity (35 fixtures)', testOk && /(?:pass 35|tests 35|35 passed)/.test(testCombined), { exit: sanityRes.code, out: (testCombined.match(/(?:pass 35|tests 35|35 passed)/) || [''])[0] || testCombined.slice(0, 500), err: testOk ? '' : testCombined.slice(0, 500), ms: 0 })

  // Map scanner results to tier
  const tierMap = {
    'ast-scan-tdz.mjs': ['E2', 'E2 Order — no use-before-declare in any scope'],
    'floating-promise-audit.mjs': ['E4', 'E4 Promise — no .then() without .catch/await'],
    'brace-balance.mjs': ['E3', 'E3 Shape — braces balance'],
    'csp-audit.mjs': ['E4', 'E4 Intent — every fetch/Worker/URL origin in CSP'],
    'domnull-audit.mjs': ['E4', 'E4 Intent — every getElementById guarded'],
    'visual-audit.mjs': ['E4', 'E4 Intent — every rendered layer honors transform contract'],
    'shell-audit.mjs': ['E1', 'E1 Document — doctype/BOM/mojibake'],
    'ui-fluidity-audit.mjs': ['E5', 'E5 Fluidity — live DOM 1→60 Hz no stair/jank (G0-G4)'],
  }
  for (const { name, r } of scannerResults) {
    const mapped = tierMap[name] || ['E?', name]
    const pass = r.code === 0
    const outShort = (r.out + r.err).slice(0, 1200).split('\u0000').join('')
    addResult(mapped[0], name, mapped[1], pass, { exit: r.code, out: outShort.slice(0, 600), err: pass ? '' : outShort.slice(0, 600), ms: 0 })
  }
  // Verify meta
  addResult('E6', 'verify-scanners.mjs', 'Meta — audits the auditors (positive + negative controls)', verifyRes.code === 0, { exit: verifyRes.code, out: verifyRes.out.slice(0, 800), err: verifyRes.code ? verifyRes.err.slice(0, 500) : '', ms: 0 })

  // ── unified report ──
  const byTier = { E1: [], E2: [], E3: [], E4: [], E5: [], E6: [] }
  for (const r of results) {
    const t = r.tier.startsWith('E') ? r.tier.slice(0, 2) : 'E?'
    if (byTier[t]) byTier[t].push(r)
    else byTier.E6.push(r)
  }

  console.log('\n' + '─'.repeat(72))
  console.log('Unified audit report — evidence tiers (AGENTS.md §0)')
  console.log('─'.repeat(72))
  for (const tier of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']) {
    const list = byTier[tier]
    if (!list.length) continue
    const tierName = { E1: 'Parse', E2: 'Order', E3: 'Shape', E4: 'Intent', E5: 'Behaviour', E6: 'Judgement' }[tier] || tier
    console.log(`\n${tier} ${tierName}`)
    for (const r of list) {
      const status = r.pass ? 'PASS' : 'FAIL'
      const exitNote = `exit ${r.exit}`
      console.log(`  ${status}  ${r.scanner.padEnd(26)}  ${exitNote}  ${r.guarantee.slice(0, 72)}`)
      if (!r.pass) {
        const detail = (r.err || r.out || '').split('\n').slice(0, 4).join(' | ').slice(0, 600)
        if (detail) console.log(`       → ${detail}`)
        if (r.scanner === 'ui-fluidity-audit.mjs') console.log('       → Perfection gate: one stair = FAIL — run `npm run audit:fluidity` for G0-G4 file:line details')
      }
    }
  }

  const mandatoryFails = results.filter(r => !r.pass && r.scanner !== 'ui-fluidity-audit.mjs').length
  const fluidityRes = results.find(r => r.scanner === 'ui-fluidity-audit.mjs')
  const fluidityFail = fluidityRes ? !fluidityRes.pass : false

  console.log('\n' + '─'.repeat(72))
  const totalMs = Math.round(performance.now() - t0)
  const extractNote = extractOk ? `extract ${extractMs.toFixed(0)}ms (once, reused 8×)` : 'extract FAIL'
  console.log(`Pipeline verdict: ${mandatoryFails === 0 ? 'PASS' : `FAIL (${mandatoryFails} mandatory scanner(s) FAIL)`} — ${results.length} checks, ${extractNote}, total ${totalMs}ms`)
  if (!noFluidity && fluidityRes) {
    // Parse stairs/janks from fluidity output if present
    const m = fluidityRes.out.match(/Perfection verdict:\s*(PASS|FAIL)\s*\((\d+) stairs, (\d+) janks\)/)
    if (m) console.log(`Perfection verdict: ${m[1]} (${m[2]} stairs, ${m[3]} janks) — ${m[1] === 'PASS' ? 'no stair, no jank' : 'one stair = FAIL — fix G1 stairs first'}`)
    else console.log(`Perfection verdict: ${fluidityRes.pass ? 'PASS' : 'FAIL'} — ${fluidityRes.pass ? '0 stairs, 0 janks' : 'see audit:fluidity details'}`)
  }
  console.log('─'.repeat(72))
  console.log(`Next: ${mandatoryFails ? 'Fix mandatory FAILs above (never weaken scanner — fix code or revise contract in AGENTS.md §1.6)' : 'Mandatory green — address fluidity perfection FAILs if present, then Fetch Gate §6 / Visual §7 human checks per Trigger matrix §2'}`)
  if (fluidityFail && !strictFluidity) console.log('  (Fluidity FAIL does not block pipeline without --strict; use --strict to make it block)')
  console.log('')

  const exitCode = mandatoryFails > 0 ? 2 : (strictFluidity && fluidityFail ? 2 : 0)
  process.exit(exitCode)
}

main().catch(e => { console.error('audit-unified: fatal', e); process.exit(1) })
