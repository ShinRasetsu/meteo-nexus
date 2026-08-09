// PHASE 3 audit - CSP completeness scanner.
//
// Parses the CSP meta tag from index.html, scans all string-literal URLs
// passed to fetch/new Worker/serviceWorker.register/new URL in both the
// HTML source and the extracted inline module, and cross-checks every
// origin against the relevant connect-src / worker-src directive.
//
// A new API endpoint added without updating CSP is silently blocked with
// no console error in many browsers. This scanner catches the gap.
//
// Usage:  node tests/extract-module.mjs && node tests/csp-audit.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(here, '..', 'index.html');
const EXTRACT = path.join(here, '_module_extract.mjs');

if (!fs.existsSync(HTML)) {
  console.error('csp-audit: index.html not found');
  process.exit(1);
}
const htmlSrc = fs.readFileSync(HTML, 'utf8');

// --------------- helpers ---------------

function parseCSP(s) {
  const k = 'http-equiv="Content-Security-Policy"';
  const i = s.indexOf(k);
  if (i < 0) return null;
  const rest = s.slice(i + k.length);
  const c = rest.indexOf('content="');
  if (c < 0) return null;
  let raw = rest.slice(c + 9);
  const end = raw.indexOf('"');
  if (end >= 0) raw = raw.slice(0, end);
  const out = {};
  for (const d of raw.split(';')) {
    const t = d.trim();
    if (!t) continue;
    const sp = t.indexOf(' ');
    if (sp < 0) { out[t] = []; continue; }
    out[t.slice(0, sp)] = t.slice(sp + 1).split(/\s+/).filter(Boolean);
  }
  return out;
}

function hostsOf(d, src) {
  const v = d[src] || d['default-src'] || [];
  return v
    .map(function(x) { return x.replace(/^['"]|['"]$/g, ''); })
    .filter(function(x) {
      return x !== "'self'" && x !== 'self' && x !== 'blob:' && x !== 'blob' && x !== 'data:' && x !== 'data' && x !== 'https:';
    });
}

function isAllowed(host, allowed) {
  for (var i = 0; i < allowed.length; i++) {
    var a = allowed[i];
    if (a === host || a === 'https://' + host) return true;
    if (a.startsWith('*.') && host.endsWith(a.slice(1))) return true;
  }
  return false;
}

function getHost(u) {
  try { return new URL(u).host; } catch { return null; }
}
function lineOf(src, pos) {
  return src.slice(0, pos).split('\n').length;
}

// ---------- scan ----------

var dir = parseCSP(htmlSrc);
if (!dir) {
  console.log('csp-audit: error - no CSP meta tag found');
  process.exit(99);
}

var findings = [];

function add(h, rawUrl, label, pos, directive) {
  findings.push({ host: h, raw: rawUrl, src: label, line: lineOf(htmlSrc, pos), dir: directive });
}

// Pattern: match a function call with a quoted string literal as first arg.
function scan(src, label) {
  // 1) fetch( '...'  )
  var fre = /fetch\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  var m;
  while ((m = fre.exec(src)) !== null) {
    var arg = m[1].slice(1, -1);
    if (arg.indexOf('://') >= 0) check(m.index, arg, label, 'connect-src');
  }
  // helper
  function check(pos, arg, lbl, directive) {
    var h = getHost(arg);
    if (!h) return;
    var a = hostsOf(dir, directive);
    if (!isAllowed(h, a)) add(h, arg, lineOf(src, pos), lbl, directive);
  }
  // 2) new Worker( '...')
  var wre = /new Worker\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  while ((m = wre.exec(src)) !== null) {
    var warg = m[1].slice(1, -1);
    if (warg.charAt(0) !== '/' && warg.charAt(0) !== '.' && warg.indexOf('://') >= 0) check(m.index, warg, label, 'worker-src');
  }
  // 3) navigator.serviceWorker.register( '...')
  var sre = /navigator\.serviceWorker\.register\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  while ((m = sre.exec(src)) !== null) {
    var sarg = m[1].slice(1, -1);
    if (sarg[0] !== '/' && sarg[0] !== '.' && sarg.indexOf('://') >= 0) check(m.index, sarg, label, 'worker-src');
  }
  // 4) new URL( '...')
  var ure = /new\s+URL\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  while ((m = ure.exec(src)) !== null) {
    var uer = m[1].slice(1, -1);
    if (uer.indexOf('://') >= 0) check(m.index, uer, label, 'connect-src');
  }
  // 5) dynamic import('...') — AGENTS.md blind spot #5. A dynamic
  // `import('https://...')` is gated by the `script-src` directive, not
  // `connect-src`, and was previously not scanned here. Lowering the bar
  // to add a new dynamic import would otherwise silently break in CSP-
  // enforcing browsers with no console error in some cases.
  // Static `import x from 'https://...'` is blocked by the spec for HTTP(S)
  // anyway, so we only need to handle the dynamic `ImportExpression` form.
  var ire = /\bimport\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  while ((m = ire.exec(src)) !== null) {
    var iarg = m[1].slice(1, -1);
    if (iarg.indexOf('://') >= 0) check(m.index, iarg, label, 'script-src');
  }
}

scan(htmlSrc, 'html');

var modSrc = null;
try { modSrc = fs.readFileSync(EXTRACT, 'utf8'); } catch { /* file missing ok */ }
if (modSrc) scan(modSrc, 'module');

// ---------- report ----------

if (findings.length === 0) {
  console.log('csp-audit: PASS - 0 origin gaps found');
  process.exit(0);
}

console.error('csp-audit: FAIL - ' + findings.length + ' origin(s) not in CSP directives:');
for (var i = 0; i < findings.length; i++) {
  var f = findings[i];
  console.error('  [HIGH] ' + f.dir + ': ' + f.host + '  (' + f.src + ':line ' + f.line + ', raw="' + f.raw + '")');
}
console.error('Add missing origins to the CSP meta tag in index.html.');
process.exit(2);