// csp-evaluator-gate.mjs — E4 Intent scanner: CSP bypass/weakness analysis
// via Google's csp_evaluator (dist/evaluator.js).
//
// GUARANTEE: the csp-audit.mjs origin-coverage scanner proves every fetch/
// Worker/URL origin is allow-listed. This gate proves the POLICY itself has
// no undocumented bypasses/weaknesses (missing base-uri, object-src gaps,
// injection vectors, syntax errors) — a different, deeper claim.
//
// CONTRACT: FAIL (exit 2) on any HIGH / SYNTAX / MEDIUM finding that is not
// in the DOCUMENTED_EXCEPTIONS list below. Every exception must carry a
// charter rationale (AGENTS.md §1.5 / §10) — adding one without a charter
// citation is weakening the scanner and is forbidden (§1.6). Advisory
// classes (HIGH_MAYBE 40, STRICT_CSP 45, MEDIUM_MAYBE 50, INFO 60) are
// printed for the inventory but do not block.
//
// LIMITATIONS: static analysis of the policy string only — it cannot see
// markup context (which inline script exists) or runtime header overrides.
// The 'unsafe-inline' pair remains the documented architectural ceiling
// until the engine is extracted to an external file (§1.5, ARCHITECTURE.md).

import { readFileSync } from 'node:fs';
import cspEvals from 'csp_evaluator';
import { CspParser } from 'csp_evaluator/dist/parser.js';
import { Severity } from 'csp_evaluator/dist/finding.js';

const { CspEvaluator } = cspEvals;

// Optional argv[2]: target HTML (verify-scanners PHASE CE runs temp copies);
// default = the production shell.
const html = readFileSync(process.argv[2] ?? new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i);
if (!m) {
  console.error('csp-evaluator: FAIL - CSP meta tag not found in index.html');
  process.exit(2);
}
const policy = m[1].replace(/"/g, '"').replace(/&/g, '&');

let parsed;
try {
  parsed = new CspParser(policy).csp;
} catch (e) {
  console.error('csp-evaluator: FAIL - policy does not parse: ' + e.message);
  process.exit(2);
}
const findings = new CspEvaluator(parsed).evaluate();

// Charter-documented exceptions — each entry cites the charter section that
// accepts the finding. Extend ONLY with a charter revision (§1.6).
const DOCUMENTED_EXCEPTIONS = [
  {
    test: (f) => f.directive === 'script-src' && f.value === "'unsafe-inline'",
    why: 'AGENTS.md §1.5 load-bearing: the inline <script type="module"> engine (index.html:880-10557) requires it; removal is gated on extracting the engine to an external file first.',
  },
  {
    test: (f) => f.directive === 'style-src' && f.value === "'unsafe-inline'",
    why: 'AGENTS.md §1.5: the inline <style> block requires it; same extraction gate.',
  },
  {
    test: (f) => f.directive === 'script-src' && ['https://cdn.jsdelivr.net', 'https://www.gstatic.com', 'https://cdnjs.cloudflare.com', 'https://unpkg.com'].includes(f.value),
    why: 'Compensating control (1.14.3): every CDN script tag carries SRI sha384 + crossorigin=anonymous — mechanically enforced by the sanity negative-pair guards and audit-unified sri-audit; the app renders no user-authored HTML (no injection sink). Removal path: self-host the CDN libraries into the SW precache (documented future major).',
  },
];

let documented = 0;
let advisory = 0;
const blocking = [];
for (const f of findings) {
  const sev = Severity[f.severity] ?? f.severity;
  const exc = DOCUMENTED_EXCEPTIONS.find((e) => e.test(f));
  if (f.severity <= Severity.MEDIUM) {
    if (exc) {
      documented += 1;
      console.log(`[DOCUMENTED ${sev}] ${f.directive}${f.value ? ' ' + f.value : ''} :: ${exc.why}`);
    } else {
      blocking.push(f);
    }
  } else {
    advisory += 1;
    console.log(`[advisory ${sev}] ${f.directive}${f.value ? ' ' + f.value : ''} :: ${String(f.description).split('\n')[0]}`);
  }
}

if (blocking.length > 0) {
  console.error(`csp-evaluator: FAIL - ${blocking.length} undocumented HIGH/SYNTAX/MEDIUM finding(s):`);
  for (const f of blocking) {
    console.error(`  - [${Severity[f.severity]}] ${f.directive}${f.value ? ' ' + f.value : ''}: ${String(f.description).split('\n')[0]}`);
  }
  process.exit(2);
}
console.log(`csp-evaluator: PASS - ${findings.length} finding(s): ${documented} documented (charter-cited), ${advisory} advisory, 0 undocumented blocking`);
