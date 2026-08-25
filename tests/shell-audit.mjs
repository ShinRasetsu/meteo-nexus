// SHELL AUDIT — HTML document integrity (the tier that was blind).
//
// The PowerShell encoding incident shipped a literal "?" in front of the
// doctype: quirks mode + a stray top-left glyph, invisible to every existing
// scanner because they all audit the extracted JS MODULE, never the HTML
// document around it. This scanner audits the shell itself.
//
// Checks:
//   S1 DOCTYPE  — file must start exactly with <!DOCTYPE html> (no BOM, no
//                 leading junk). Anything before it = quirks mode + stray text.
//   S2 CHARSET  — <meta charset="UTF-8"> must appear within the first 10 lines.
//   S3 U+FFFD   — zero replacement characters anywhere (lossy transcoding mark).
//   S4 MOJIBAKE — zero double-encoding signatures (â€, Ã‚, Â°, Â±, Â· …):
//                 the cp1252-reinterpretation artifacts of the common
//                 typographic charset this project uses (— ° ± · ≈ ×).
//
// Usage:
//   node tests/shell-audit.mjs [path]     (default: ../index.html)
// The optional path exists so verify-scanners.mjs can run positive/negative
// controls against a mutated TEMP COPY — the main file is never touched.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.argv[2] || path.join(here, '..', 'index.html')

if (!fs.existsSync(target)) {
  console.error(`shell-audit: target not found: ${target}`)
  process.exit(1)
}

const buf = fs.readFileSync(target)
const findings = []

// S1 — DOCTYPE must be the very first bytes (no BOM, no junk).
const head = buf.subarray(0, 32).toString('utf8')
if (!head.startsWith('<!DOCTYPE html>')) {
  if (head.charCodeAt(0) === 0xFEFF) {
    findings.push('file starts with a UTF-8 BOM — this project is BOM-free by convention; strip it (byte-exact tools only)')
  } else {
    findings.push(`file must start with "<!DOCTYPE html>" — found: ${JSON.stringify(head.slice(0, 16))} (content before doctype = quirks mode + stray rendered text)`)
  }
}

const src = buf.toString('utf8')

// S2 — charset declaration early.
const firstLines = src.split('\n', 10).join('\n')
if (!/<meta\s+charset=["']?utf-8["']?/i.test(firstLines)) {
  findings.push('<meta charset="UTF-8"> missing within the first 10 lines')
}

// S3 — replacement character = lossy transcoding happened somewhere.
const fffd = (src.match(/\uFFFD/g) || []).length
if (fffd > 0) {
  findings.push(`${fffd} U+FFFD replacement character(s) — lossy byte transcoding occurred; locate and restore from history`)
}

// S4 — double-encoding signatures for this project's typographic set.
// (UTF-8 bytes of — ° ± · ≈ × reinterpreted as cp1252 produce these prefixes.)
const mojibake = src.match(/â€|Ã‚|Â°|Â±|Â·|Ã¢|Ã‚Â/g) || []
if (mojibake.length > 0) {
  findings.push(`${mojibake.length} mojibake signature(s) (â€ / Â° / Ã‚ …) — UTF-8 was decoded as cp1252 and re-encoded`)
}

if (findings.length === 0) {
  console.log('shell-audit: PASS - HTML document integrity intact (doctype, charset, no lossy artifacts)')
  process.exit(0)
}

console.error('shell-audit: FAIL - HTML shell integrity violations:')
for (const f of findings) console.error('  [HIGH] ' + f)
console.error('Recover from git history or reverse the transcoding; never hand-patch symptoms.')
process.exit(2)
