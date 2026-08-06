// PHASE 2 audit — AST-based use-before-declare scanner.
//
// Walks the parse tree (via acorn) of the extracted module from
// tests/extract-module.mjs and reports any `const`/`let`/`var` whose
// declaration site appears AFTER a reference site IN THE SAME BLOCK SCOPE.
//
// Why AST, not regex: the 1.3.3 blow-up bug was a `const now = Date.now()`
// declared on line N but referenced on line N-1 inside a surrounding try block
// whose catch swallowed the ReferenceError. ESLint's `no-use-before-define`
// rule does NOT flag same-block-scope references, and Node's parser does NOT
// catch ReferenceErrors at parse time. The only way to detect this class of
// bug is via an AST walker that tracks lexical scope and emits the
// declaration line as a binding, then flags Identifier uses above that line
// in the same scope.
//
// Usage:  node tests/extract-module.mjs && node tests/ast-scan-tdz.mjs
// Expected: "TDZ violations: 0"

import * as acorn from 'acorn';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(here, '_module_extract.mjs');

if (!fs.existsSync(modulePath)) {
  console.error('ast-scan-tdz: run `node tests/extract-module.mjs` first.');
  process.exit(1);
}

const src = fs.readFileSync(modulePath, 'utf8');

let ast;
try {
  ast = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  });
} catch (e) {
  console.error('ast-scan-tdz: parse failed:', e.message);
  process.exit(1);
}

// Scope model — chain of function/block scopes with bindgen maps.
function newScope(parent, kind) { return { parent, kind, bindings: new Map() }; }
const root = newScope(null, 'module');
let cur = root;
const violations = [];

function bindParam(p, scope) {
  if (!p) return;
  if (p.type === 'Identifier') scope.bindings.set(p.name, { declLine: p.loc ? p.loc.start.line - 1 : -1, isParam: true });
  else if (p.type === 'AssignmentPattern') bindParam(p.left, scope);
  else if (p.type === 'RestElement') bindParam(p.argument, scope);
  else if (p.type === 'ObjectPattern' || p.type === 'ArrayPattern') {
    for (const prop of (p.properties || p.elements || [])) bindParam(prop, scope);
  }
}
function lineOf(n) { return n.loc ? n.loc.start.line - 1 : -1; }

// First pass: mark property-key Identifiers so we don't false-positive on
// `{ foo: bar }` literals where `foo` is a key, not a binding reference.
function markPropKeys(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) markPropKeys(c); return; }
  if (node.type === 'Property' && node.key && node.key.type === 'Identifier' && !node.computed) {
    node.key.isPropertyKey = true;
  }
  for (const key in node) {
    if (['parent', 'loc', 'range', 'type', 'start', 'end', 'isPropertyKey'].includes(key)) continue;
    markPropKeys(node[key]);
  }
}
markPropKeys(ast);

// Main walk
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) walk(c); return; }
  const type = node.type;
  let pushed = null;
  if (type === 'FunctionDeclaration' || type === 'FunctionExpression' ||
      type === 'ArrowFunctionExpression' || type === 'MethodDefinition') {
    pushed = newScope(cur, 'function'); cur = pushed;
    for (const p of (node.params || [])) bindParam(p, cur);
  } else if (type === 'BlockStatement') {
    pushed = newScope(cur, 'block'); cur = pushed;
  } else if (type === 'CatchClause') {
    pushed = newScope(cur, 'block'); cur = pushed;
    if (node.param && node.param.name) cur.bindings.set(node.param.name, { declLine: lineOf(node), isParam: true });
  }

  if (type === 'VariableDeclarator' && node.id && node.id.name) {
    cur.bindings.set(node.id.name, { declLine: lineOf(node) });
  }

  if (type === 'Identifier' && node.name && !node.isPropertyKey) {
    const refLine = lineOf(node);
    let scope = cur, found = null;
    while (scope) {
      if (scope.bindings.has(node.name)) { found = scope.bindings.get(node.name); break; }
      scope = scope.parent;
    }
    if (found && found.declLine > refLine && !found.isParam) {
      violations.push({ name: node.name, refLine: refLine + 1, declLine: found.declLine + 1 });
    }
  }

  for (const key in node) {
    if (['parent', 'loc', 'range', 'type', 'start', 'end', 'isPropertyKey'].includes(key)) continue;
    walk(node[key]);
  }
  if (pushed) cur = pushed.parent;
}

walk(ast);

const seen = new Set();
const dedup = [];
for (const v of violations) {
  const k = v.name + ':' + v.refLine + ':' + v.declLine;
  if (!seen.has(k)) { seen.add(k); dedup.push(v); }
}
console.log('TDZ (same-scope use-before-declare) violations:', dedup.length);
for (const v of dedup) console.log(' ', v.name, 'used @ line', v.refLine, '(declared @', v.declLine + ')');
if (dedup.length > 0) process.exit(2);  // non-zero exit so CI / pre-commit can gate on it
