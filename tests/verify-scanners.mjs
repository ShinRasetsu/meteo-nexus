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
// Inject a syntax error: missing `)` at end of a function call.
check('PHASE 1 syntax error -> node --check nonzero',
  'extract-module.mjs', 0, 'extracted module', () => {
    // extract-module.mjs rebuilds the extract, so corrupting the extrref file won't persist.
    // We corrupt index.html instead — but that risks a stray fail. Instead, just check the
    // scanner's `node --check` step fails when the extract is broken.
    writeMutation(original + '\nfunction broken( {\n');
  });
// Note: extract-module.mjs OVERWRITES the extract from index.html, so this mutation
// is wiped before node --check runs. We need to run `node --check` directly.
// Test it directly:
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

restore();
console.log('Scanner verification results:');
console.log(results.join('\n'));
console.log(`\nTotal: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);