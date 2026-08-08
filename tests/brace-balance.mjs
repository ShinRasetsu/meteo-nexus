// PHASE 3 audit — brace-balance scanner.
//
// Counts `{` and `}` in the extracted inline <script type="module"> block
// ignoring braces inside strings, template literals, comments, AND regex
// literals. A final depth != 0 means a curly brace is missing — exactly
// the bug that shipped 1.3.0 where a missing `}` in `smoothVisualsLoop`
// silently nested the rest of the script inside a never-returning RAF loop.
//
// FSM handles:
//   - line comments  // ...
//   - block comments /* ... */
//   - string literals '...' "..."
//   - template literals `...`, including ${ expr } interpolations
//   - regex literals  /.../  (with character class support)
//
// Regex detection uses a "previous significant character" heuristic: a `/`
// is treated as the start of a regex literal iff the last non-whitespace,
// non-comment character is NOT an identifier, digit, `)`, `]`, `}` (which
// would mean division).
//
// Usage:  node tests/extract-module.mjs && node tests/brace-balance.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(here, '_module_extract.mjs');

if (!fs.existsSync(modulePath)) {
  console.error('brace-scan: run `node tests/extract-module.mjs` first.');
  process.exit(1);
}

const src = fs.readFileSync(modulePath, 'utf8');

let state = 'NORMAL', quote = '', inTplExpr = 0, inClass = false;
let depth = 0, maxDepth = 0, minDepth = 0;
const depthByLine = [];
let curLine = 0;
let lastSignificant = '\n';   // last non-whitespace, non-comment char

function isRegexPrecedeContext(prev) {
  // After these chars, a `/` starts a regex literal, not division.
  return (
    prev === '(' || prev === ',' || prev === '=' || prev === '!' ||
    prev === '?' || prev === ':' || prev === ';' || prev === '&' ||
    prev === '|' || prev === '^' || prev === '~' || prev === '<' ||
    prev === '>' || prev === '+' || prev === '-' || prev === '*' ||
    prev === '%' || prev === '/' || prev === '{' || prev === '[' ||
    prev === '}' || prev === '\n' || prev === '?' || prev === ''
  );
  // After identifiers, digits, ')', ']', '`' (template close), string close — division.
}

for (let i = 0; i < src.length; i++) {
  const c = src[i], c2 = src[i + 1];

  switch (state) {
    case 'NORMAL':
      if (c === '/' && c2 === '/') { state = 'SL'; i++; break; }
      if (c === '/' && c2 === '*') { state = 'ML'; i++; break; }
      if (c === '"' || c === "'") { state = 'STR'; quote = c; break; }
      if (c === '`') { state = 'TPL'; break; }
      if (c === '/') {
        // Heuristic: only treat as regex if previous significant char
        // supports regex start context.
        if (isRegexPrecedeContext(lastSignificant)) {
          state = 'REGEX'; inClass = false; break;
        }
        // else: division operator — fall through, no state change
        break;
      }
      if (c === '{') { depth++; if (depth > maxDepth) maxDepth = depth; break; }
      if (c === '}') { depth--; if (depth < minDepth) minDepth = depth; break; }
      break;
    case 'SL':
      if (c === '\n') { state = 'NORMAL'; curLine++; }
      break;
    case 'ML':
      if (c === '*' && c2 === '/') { state = 'NORMAL'; i++; }
      break;
    case 'STR':
      if (c === '\\') { i++; break; }
      if (c === quote) state = 'NORMAL';
      break;
    case 'TPL':
      if (c === '\\') { i++; break; }
      if (c === '`') { state = 'NORMAL'; break; }
      if (c === '$' && c2 === '{') { state = 'TPL_EXPR'; i++; inTplExpr = 1; break; }
      break;
    case 'TPL_EXPR':
      if (c === '\\') { i++; break; }
      if (c === '{') inTplExpr++;
      if (c === '}') { inTplExpr--; if (inTplExpr === 0) state = 'TPL'; }
      break;
    case 'REGEX':
      if (c === '\\') { i++; break; }
      if (c === '[') { inClass = true; break; }
      if (c === ']' && inClass) { inClass = false; break; }
      if (c === '/' && !inClass) { state = 'NORMAL'; break; }
      if (c === '\n') { state = 'NORMAL'; curLine++; }
      break;
  }

  // Track last significant char only when in NORMAL (or end of certain states).
  if (state === 'NORMAL') {
    if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') lastSignificant = c;
  } else if (state === 'STR' || state === 'TPL' || state === 'REGEX') {
    // close-quote / close-regex / close-template resets lastSignificant
    // to a value that the next `/` will see as division (assuming identifier-like)
    lastSignificant = 'a';   // pretend we ended in an identifier-ish char so `/` after isn't regex
  }

  if (c === '\n') {
    depthByLine[curLine] = depth;
    curLine++;
  }
}

if (src.length > 0 && src[src.length - 1] !== '\n') {
  depthByLine[curLine] = depth;
}

console.log(`brace balance: depth=${depth}  max=${maxDepth}  min=${minDepth}`);
if (depth !== 0) {
  console.error('BRACE MISMATCH — the script block is imbalanced.');
  for (let li = 0; li < depthByLine.length; li++) {
    if (depthByLine[li] < 0) console.error('  Negative depth at line', li + 1, '(value:', depthByLine[li], ')');
  }
  process.exit(2);
}