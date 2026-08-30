// ui-fluidity.test.js — plug-in runner for UI Fluidity Auditor
// ────────────────────────────────────────────────────────────────────
// Runs the ui-fluidity audit with zero extra setup (also usable as
// `node tests/ui-fluidity.test.js` in other projects).
// For other projects, copy this file + ui-fluidity-audit.mjs, edit CONFIG.liveIds
// in the audit file to your {{liveIds}}, set {{sourceRateHz}}→{{renderRateHz}}Hz,
// and run `node tests/ui-fluidity.test.js`.
//
// Behaviour: ensures tests/_module_extract.mjs exists (via extract-module.mjs),
// then spawns the audit and mirrors its output. Exits 0 on PASS, 2 on FAIL
// so it integrates with `npm test` and `npm run audit`.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const extractMjs = path.join(here, 'extract-module.mjs')
const auditMjs = path.join(here, 'ui-fluidity-audit.mjs')

// Ensure extract exists (other audits do `node tests/extract-module.mjs` first)
let extract = spawnSync('node', [extractMjs], { cwd: repo, encoding: 'utf8' })
if (extract.status !== 0) {
  console.error('ui-fluidity.test.js: extract-module failed')
  console.error(extract.stderr || extract.stdout)
}

let r = spawnSync('node', [auditMjs], { cwd: repo, encoding: 'utf8' })
if (r.stdout) process.stdout.write(r.stdout)
if (r.stderr) process.stderr.write(r.stderr)

// Also verify the audit file itself exists and is parseable
try { fs.accessSync(auditMjs, fs.constants.R_OK) } catch { console.error('ui-fluidity.test.js: missing ui-fluidity-audit.mjs'); process.exit(1) }

process.exit(r.status ?? 0)
