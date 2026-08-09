// PHASE 3 audit — DOM null-guard scanner.
//
// The 1.3.4 cacheMapBtn crash was caused by DOM.cacheMapBtn receiving null
// from getElementById, then being used with .addEventListener without a null
// guard. This scanner detects the same pattern anywhere in the extracted
// module.
//
// Usage:  node tests/extract-module.mjs && node tests/domnull-audit.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const EXTRACT = path.join(here, '_module_extract.mjs')

if (!fs.existsSync(EXTRACT)) {
  console.error('domnull-audit: run node tests/extract-module.mjs first.')
  process.exit(1)
}

const src = fs.readFileSync(EXTRACT, 'utf8')

// --------------- collect all = document.getElementById(...) ---------------

const GEB_SINGLE = /(\w+)\s*[:=]\s*document\.getElementById\s*\(\s*'([^']+)'/g
const GEB_DOUBLE = /(\w+)\s*[:=]\s*document\.getElementById\s*\(\s*"([^"]+)"/g

const calls = []

function lineNo(pos) { return src.slice(0, pos).split('\n').length }

for (const m of src.matchAll(GEB_SINGLE)) {
  calls.push({ key: m[1], id: m[2], pos: m.index, line: lineNo(m.index) })
}
for (const m of src.matchAll(GEB_DOUBLE)) {
  calls.push({ key: m[1], id: m[2], pos: m.index, line: lineNo(m.index) })
}

// --------------- check each call ---------------

const findings = []

for (const c of calls) {
  const searchWindow = src.slice(c.pos + 1, c.pos + 2000)
  const winLines = searchWindow.split('\n')

  let guardFound = false
  let firstAccessLine = -1

  const keyEsc = c.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Optional-chaining guard: treat `el?.foo` as a null-safe property
  // access, per AGENTS.md blind spot #6. Previously only `if (el)` and
  // `if (!el)` shapes counted, so code like
  //   const el = document.getElementById('x'); el?.addEventListener(...)
  // was flagged as unguarded even though it is null-safe. The `?.`
  // short-circuits the entire member-expression chain including any
  // subsequent `.foo` reads on the same chain.
  const optChainRe = new RegExp('\\b' + keyEsc + '\\s*\\?\\.[-a-zA-Z0-9_$]')
  // Plain property access on the root variable (NOT optional-chained):
  // matches `el.foo` but NOT `el?.foo` (the `\?` would have to be missing).
  const plainAccessRe = new RegExp('\\b' + keyEsc + '\\.[a-zA-Z_$]')

  for (let i = 0; i < Math.min(winLines.length, 15); i++) {
    const wl = winLines[i]
    // match both:  if (key)   and   if (!key)
    if (new RegExp('\\bif\\s*\\(\\s*!?\\s*' + keyEsc + '\\b').test(wl)) { guardFound = true; break }
    if (new RegExp('\\bif\\s*\\(\\s*' + keyEsc + '\\?').test(wl)) { guardFound = true; break }
    // optional-chaining: `key?.foo` is itself a guard, so the access on
    // this line is null-safe AND any subsequent access is fine — we treat
    // both findings and the line itself as guarded.
    if (optChainRe.test(wl)) { guardFound = true; break }

    // Only flag a PLAIN access (`el.foo`) — `el?.foo` matched above never
    // reaches here. Use the stricter plain-access regex instead of the
    // generic `\bkey\.` from `accessRe` so we do not false-positive on
    // optional-chained lines we already handled.
    if (plainAccessRe.test(wl) && !guardFound && firstAccessLine === -1) {
      firstAccessLine = c.line + i + 1
    }
  }

  if (firstAccessLine !== -1 && !guardFound) {
    findings.push({
      key: c.key,
      id: c.id,
      line: c.line,
      accessLine: firstAccessLine
    })
  }
}

// --------------- report ---------------

if (findings.length === 0) {
  console.log('domnull-audit: PASS - 0 unguarded property accesses found')
  process.exit(0)
}

console.error(`domnull-audit: FAIL - ${findings.length} unguarded DOM reference(s):`)
for (const f of findings) {
  console.error('  [MEDIUM] key=' + f.key + ' (id=' + f.id + ', declared line ' + f.line + ', access line ' + f.accessLine + ')')
}
console.error('Add if (!varname) return; guard after the assignment.')
process.exit(2)