// PHASE 3 audit — brace-balance scanner.
//
// Counts `{` and `}` in the extracted inline <script type="module"> block
// ignoring braces inside strings, template literals, and comments. A final
// depth != 0 means a curly brace is missing — exactly the bug that shipped
// 1.3.0 where a missing `}` in `smoothVisualsLoop` silently nested the
// rest of the script inside a never-returning RAF loop.
//
// Usage:  node tests/extract-module.mjs && node tests/brace-scan.mjs

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

let state = 'NORMAL', quote = '', inTplExpr = 0;
let depth = 0, maxDepth = 0, minDepth = 0;
const depthByLine = [];
let curLine = 0;

for (let i = 0; i < src.length; i++) {
  const c = src[i], c2 = src[i + 1];
  if (c === '\n') {
    depthByLine[curLine] = depth;
    curLine++;
    continue;
  }

  switch (state) {
    case 'NORMAL':
      if (c === '/' && c2 === '/') { state = 'SL'; i++; continue; }
      if (c === '/' && c2 === '*') { state = 'ML'; i++; continue; }
      if (c === '"' || c === "'") { state = 'STR'; quote = c; continue; }
      if (c === '`') { state = 'TPL'; continue; }
      if (c === '{') { depth++; if (depth > maxDepth) maxDepth = depth; continue; }
      if (c === '}') { depth--; if (depth < minDepth) minDepth = depth; continue; }
      break;
    case 'SL':
      if (c === '\n') state = 'NORMAL';
      break;
    case 'ML':
      if (c === '*' && c2 === '/') { state = 'NORMAL'; i++; }
      break;
    case 'STR':
      if (c === '\\') { i++; continue; }
      if (c === quote) state = 'NORMAL';
      break;
    case 'TPL':
      if (c === '\\') { i++; continue; }
      if (c === '`') state = 'NORMAL';
      if (c === '$' && c2 === '{') { state = 'TPL_EXPR'; i++; inTplExpr = 1; continue; }
      break;
    case 'TPL_EXPR':
      if (c === '\\') { i++; continue; }
      if (c === '{') inTplExpr++;
      if (c === '}') { inTplExpr--; if (inTplExpr === 0) state = 'TPL'; }
      break;
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