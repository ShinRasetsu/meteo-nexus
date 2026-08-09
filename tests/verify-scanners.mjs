// Verify each audit scanner catches its target bug class.
// Mutates tests/_module_extract.mjs in-place, runs the scanner, restores.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const extractPath = path.join(here, '_module_extract.mjs');
const original = fs.readFileSync(extractPath, 'utf8');

let pass = 0, fail = 0;
const results = [];

function restore() { fs.writeFileSync(extractPath, original, 'utf8'); }
function runScanner(script) {
  try {
    const out = execFileSync('node', [path.join(here, script)], { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: out || '', err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}
function writeMutation(content) { fs.writeFileSync(extractPath, content, 'utf8'); }

function check(label, script, expectedExit, expectedFragment, mutate) {
  let mutError = null;
  try {
    mutate();
  } catch (e) { mutError = e.message; }
  const r = runScanner(script);
  restore();
  const ok = r.code === expectedExit && (expectedFragment === null || r.err.includes(expectedFragment) || r.out.includes(expectedFragment));
  if (ok) { pass++; results.push(`  PASS  ${label} (exit=${r.code})`); }
  else {
    fail++;
    results.push(`  FAIL  ${label} (exit=${r.code}, expected ${expectedExit})` + (mutError ? ` MUTATE-ERR: ${mutError}` : ''));
    results.push(`        stdout: ${r.out.slice(0, 200).replace(/\n/g, ' | ')}`);
    results.push(`        stderr: ${r.err.slice(0, 300).replace(/\n/g, ' | ')}`);
  }
}

// ---------- Phase 1: node --check (syntax error) ----------
// extract-module.mjs rebuilds the extract from index.html on every run, so a
// mutation written to _module_extract.mjs before invoking extract-module.mjs
// would be silently overwritten before `node --check` runs. The previous
// PHASE 1 case therefore ALWAYS passed regardless of the mutation (the
// `check('PHASE 1 syntax error ...', 'extract-module.mjs', ...)` wrapper ran
// extract-module.mjs, which rebuilt a clean extract, then exited 0). That
// case has been removed; what remains is the direct `node --check` test,
// which mutates the extract and runs `node --check` against it directly
// (bypassing the rebuild). That is the only meaningful PHASE 1 self-test.
{
  writeMutation(original + '\nfunction broken( {\n');
  try {
    execFileSync('node', ['--check', extractPath], { encoding: 'utf8', stdio: 'pipe' });
    fail++; results.push('  FAIL  PHASE 1 direct node --check (expected nonzero exit)');
  } catch (e) {
    pass++; results.push('  PASS  PHASE 1 direct node --check (exit=' + (e.status ?? 1) + ')');
  }
  restore();
}

// ---------- Phase 1 negative control: clean extract parses ----------
{
  try {
    execFileSync('node', ['--check', extractPath], { encoding: 'utf8', stdio: 'pipe' });
    pass++; results.push('  PASS  PHASE 1 negative control (clean extract) -> node --check 0');
  } catch (e) {
    fail++; results.push('  FAIL  PHASE 1 negative control (clean extract) -> node --check nonzero: ' + (e.stderr ?? '').slice(0, 200).replace(/\n/g, ' | '));
  }
}

// ---------- Phase 2: TDZ scan ----------
// Inject a const-use-before-declare in a fresh scope at the end.
check('PHASE 2 use-before-declare -> tdz scanner nonzero',
  'ast-scan-tdz.mjs', 2, 'TDZ', () => {
    writeMutation(original + '\nfunction tdzTest() { if (x > 0) return x; const x = 1; return x; }\n');
  });

// ---------- Phase 3: brace balance ----------
check('PHASE 3 missing } -> brace-balance nonzero',
  'brace-balance.mjs', 2, 'MISMATCH', () => {
    // remove one closing brace near the end of a function — find the very last `}` and drop it
    const i = original.lastIndexOf('}');
    writeMutation(original.slice(0, i) + original.slice(i + 1));
  });

// ---------- Phase 4: CSP audit ----------
check('PHASE 4 CSP missing origin -> csp-audit nonzero',
  'csp-audit.mjs', 2, 'FAIL', () => {
    writeMutation(original + "\nfetch('https://not-in-csp.example.com/data.json');\n");
  });

// ---------- Phase 5: DOM null-guard ----------
check('PHASE 5 unguarded getElementById -> domnull-audit nonzero',
  'domnull-audit.mjs', 2, 'FAIL', () => {
    writeMutation(original + "\nfunction domTest() { const el = document.getElementById('missing-xyz'); el.classList.add('x'); }\n");
  });

// ---------- Phase 2 negative control: const declared BEFORE use ----------
check('PHASE 2 negative control (declared first) -> tdz scanner 0',
  'ast-scan-tdz.mjs', 0, 'violations: 0', () => {
    writeMutation(original + '\nfunction tdzNeg() { const y = 1; return y; }\n');
  });

// ---------- Phase 5 negative control: guarded getElementById ----------
check('PHASE 5 negative control (guarded) -> domnull-audit 0',
  'domnull-audit.mjs', 0, 'PASS', () => {
    writeMutation(original + "\nfunction domNeg() { const el = document.getElementById('missing-xyz'); if (el) el.classList.add('x'); }\n");
  });

// ---------- Phase 3 negative control: balanced braces -> brace-balance 0 ----------
// The clean extract already balances to depth 0; mutating with a balanced
// addition (e.g. an extra IIFE) must keep depth=0 so the scanner returns 0.
check('PHASE 3 negative control (balanced addition) -> brace-balance 0',
  'brace-balance.mjs', 0, 'depth=0', () => {
    writeMutation(original + '\n(function neg() { const a = { b: 1, c: 2 }; if (a.b) { return a.c; } return a; })();\n');
  });

// ---------- Phase 4 negative control: origin already in CSP -> csp-audit 0 ----------
// api.open-meteo.com is in the CSP connect-src allowlist, so fetching it
// must not be flagged as a gap.
check('PHASE 4 negative control (allowed origin) -> csp-audit 0',
  'csp-audit.mjs', 0, 'PASS', () => {
    writeMutation(original + "\nfetch('https://api.open-meteo.com/v1/forecast?test=1').then(r => r.json());\n");
  });

// ---------- Phase 2b: floating-promise scanner ----------
// A `.then(...)` without `.catch` and without `await` must be flagged. This is
// the new Phase 2b scanner introduced to close AGENTS.md blind spot #4.
check('PHASE 2b floating .then -> floating-promise-audit nonzero',
  'floating-promise-audit.mjs', 2, 'floating-promise findings', () => {
    writeMutation(original + "\nfunction fpPos() { fetch('https://api.open-meteo.com/x').then(r => r.json()); }\n");
  });

// ---------- Phase 2b negative control: .then().catch() chain ----------
// A pair of `.then(...).catch(...)` must NOT be flagged.
check('PHASE 2b negative control (.catch present) -> floating-promise-audit 0',
  'floating-promise-audit.mjs', 0, 'findings: 0', () => {
    writeMutation(original + "\nfunction fpNegCatch() { fetch('https://api.open-meteo.com/x').then(r => r.json()).catch(e => console.error(e)); }\n");
  });

// ---------- Phase 2b negative control: await'd .then ----------
// `await fetch(...).then(...)` is guarded — the rejection surfaces to the
// caller, so the scanner must NOT flag it.
check('PHASE 2b negative control (await) -> floating-promise-audit 0',
  'floating-promise-audit.mjs', 0, 'findings: 0', () => {
    writeMutation(original + "\nasync function fpNegAwait() { await fetch('https://api.open-meteo.com/x').then(r => r.json()); }\n");
  });

// ---------- Phase 5b: optional-chaining DOM guard ----------
// `el?.foo` after `getElementById` is now treated as a guard (domnull extension).
// Previously this would have been flagged. Per AGENTS.md blind spot #6.
check('PHASE 5b optional-chaining guard -> domnull-audit 0',
  'domnull-audit.mjs', 0, 'PASS', () => {
    writeMutation(original + "\nfunction domOpt() { const el = document.getElementById('missing-opt'); el?.classList.add('x'); }\n");
  });

// ---------- Phase 5b negative control: plain access still flagged ----------
// Even with the optional-chaining extension in place, a plain `el.foo`
// (no `?.`) must still be flagged. Confirms the new code did not weaken
// the original `if (el)` / `if (!el)` behaviour.
check('PHASE 5b plain access still flagged -> domnull-audit nonzero',
  'domnull-audit.mjs', 2, 'FAIL', () => {
    writeMutation(original + "\nfunction domPlain() { const el = document.getElementById('missing-plain'); el.classList.add('x'); }\n");
  });

// ---------- Phase 4b: dynamic import() CSP gap ----------
// A dynamic `import('https://not-in-csp.example.com/m.js')` must be flagged
// as a script-src gap. Previously dynamic import() was not scanned at all
// (AGENTS.md blind spot #5).
check('PHASE 4b dynamic import() missing origin -> csp-audit nonzero',
  'csp-audit.mjs', 2, 'FAIL', () => {
    writeMutation(original + "\nimport('https://not-in-csp.example.com/m.js');\n");
  });

// ---------- Phase 4b negative control: dynamic import() allowed origin ----------
// `import('https://cdn.jsdelivr.net/...')` is in script-src, so it must NOT
// be flagged.
check('PHASE 4b negative control (allowed script-src) -> csp-audit 0',
  'csp-audit.mjs', 0, 'PASS', () => {
    writeMutation(original + "\nimport('https://cdn.jsdelivr.net/npm/foo.js');\n");
  });

restore();
console.log('Scanner verification results:');
console.log(results.join('\n'));
console.log(`\nTotal: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);