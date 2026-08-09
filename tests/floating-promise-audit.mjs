// PHASE 2b audit — floating-promise scanner.
//
// AST walker that flags `.then(...)` calls whose enclosing expression chain
// does NOT also include a `.catch(...)` AND which are NOT preceded by `await`.
//
// This closes the documented blind spot in AGENTS.md:61-72:
//   "Unhandled promise rejections — every `then(...)` chain without `.catch`
//    evades the audit. Prefer `async/await + try/catch`."
//
// The v1.3.3 lesson generalised: a swallowed ReferenceError inside a `.then`
// callback produces an unhandled rejection that no static check in the existing
// pipeline caught. The CSP / TDZ / brace / DOM scanners all operate on shape;
// this scanner operates on the await/catch contract.
//
// What counts as GUARDED (not flagged):
//   - `fetch(x).then(...).catch(...)`       — chain contains `.catch`
//   - `await fetch(x).then(...)`           — `await` surfaces the rejection
//   - `return fetch(x).then(...)` inside an `async` function — the rejection
//     propagates to the caller's contract; the caller bears responsibility.
//   - `Promise.all([...]).then(...).catch(...)` — same as the first rule.
//
// What is FLAGGED:
//   - `fetch(x).then(...)`                 — no catch, no await
//   - `somePromise.then(...)`              — no catch, no await
//
// False-positive guard: if a `.then(...)` is itself followed by a `.catch(...)`
// via a chained MemberExpression on the SAME root, the chain is guarded. We
// walk the chain via the `rootChain` helper to find any `.catch` callee.
//
// Usage:  node tests/extract-module.mjs && node tests/floating-promise-audit.mjs
// Expected output: "floating-promise findings: 0"

import * as acorn from 'acorn';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(here, '_module_extract.mjs');

if (!fs.existsSync(modulePath)) {
  console.error('floating-promise-audit: run `node tests/extract-module.mjs` first.');
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
  console.error('floating-promise-audit: parse failed:', e.message);
  process.exit(1);
}

function lineOf(n) { return n.loc ? n.loc.start.line : -1; }

// Walk up the chain a `.then` lives in, returning true if any link is a
// `.catch` call. For `fetch(x).then(a).catch(b)`:
//   the `then` node's parent chain is:  then -> MemberExpression(.then) -> CallExpression(fetch(x))
//   We instead walk DOWN from the root CallExpression, looking at every
//   `.then` / `.catch` link appended to it.
//
// Acorn shape for `a.b().c()`:
//   CallExpression
//     callee: MemberExpression (.c)
//       object: CallExpression
//         callee: MemberExpression (.b)
//           object: Identifier (a)
//
// So the root of a `.then` chain is the OUTERMOST CallExpression whose callee
// is a MemberExpression; we walk down (object side) until we hit a non-Call
// node, collecting every property name along the way.
//
// Implementation: we build a parent map of the parsed AST (acorn does not set
// parent pointers by default), then walk UP from each `.then` to its outermost
// chained ancestor before walking DOWN to find any `.catch`.

// Build a parent map by walking the AST once.
const parentOf = new WeakMap();
function indexParents(node, parent) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) indexParents(c, parent); return; }
  parentOf.set(node, parent);
  for (const key in node) {
    if (['parent', 'loc', 'range', 'type', 'start', 'end'].includes(key)) continue;
    const v = node[key];
    if (v && typeof v === 'object') indexParents(v, node);
  }
}
indexParents(ast, null);

// From a `.then` CallExpression, walk UP through MemberExpression.callee-
// containing CallExpressions to find the outermost chained call, then walk
// DOWN its chain to collect every property name.
function chainHasCatch(thenCall) {
  // Walk up: find the topmost ancestor whose parent is NOT a MemberExpression
  // used as a `callee` of another CallExpression. That ancestor is the
  // outermost chained call.
  let top = thenCall;
  for (;;) {
    const p = parentOf.get(top);
    if (!p) break;
    // Stop if parent is not the callee-object of an outer `.foo()` call.
    // p is a MemberExpression whose .object === top AND p is the callee of
    // a CallExpression -> then top is a link in a larger chain.
    if (p.type === 'MemberExpression' && p.object === top) {
      const gp = parentOf.get(p);
      if (gp && gp.type === 'CallExpression' && gp.callee === p) {
        top = gp;
        continue;
      }
    }
    break;
  }
  // Now walk DOWN the chain from `top` collecting property names.
  const names = [];
  let cur = top;
  while (cur && cur.type === 'CallExpression' &&
         cur.callee && cur.callee.type === 'MemberExpression' &&
         cur.callee.property && cur.callee.property.type === 'Identifier') {
    names.push(cur.callee.property.name);
    cur = cur.callee.object;
  }
  return names.includes('catch');
}

// Track whether a `.then` call is preceded by `await` on the SAME chain.
// We do this by checking the parent: if the `.then` CallExpression's parent
// is an AwaitExpression, it's guarded. Per AGENTS.md, `await` surfaces the
// rejection to the enclosing async try/catch.
function isAwaited(call) {
  const p = parentOf.get(call);
  return p && p.type === 'AwaitExpression';
}

// Track whether the `.then` is the operand of a `return` inside an async
// function — the rejection then propagates to the caller. Conservative: we
// only accept `return <call>` directly, not `return foo + <call>` etc.
function isReturnedInAsync(call) {
  // The call may be wrapped by the chain; we only care about the OUTERMOST
  // chain ancestor's parent.
  let top = call;
  for (;;) {
    const pp = parentOf.get(top);
    if (!pp) break;
    if (pp.type === 'MemberExpression' && pp.object === top) {
      const gp = parentOf.get(pp);
      if (gp && gp.type === 'CallExpression' && gp.callee === pp) {
        top = gp;
        continue;
      }
    }
    break;
  }
  const p = parentOf.get(top);
  if (!p || p.type !== 'ReturnStatement') return false;
  // Walk up from the ReturnStatement to find the nearest enclosing function.
  let cur = p;
  for (;;) {
    const par = parentOf.get(cur);
    if (!par) return false;
    if (par.type === 'FunctionDeclaration' ||
        par.type === 'FunctionExpression' ||
        par.type === 'ArrowFunctionExpression') {
      return par.async === true;
    }
    cur = par;
  }
}

const findings = [];

function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) walk(c); return; }

  // Detect `.then(...)` calls: CallExpression whose callee is a
  // MemberExpression with property name `then`.
  if (node.type === 'CallExpression' &&
      node.callee && node.callee.type === 'MemberExpression' &&
      node.callee.property && node.callee.property.type === 'Identifier' &&
      node.callee.property.name === 'then') {
    if (!chainHasCatch(node) && !isAwaited(node) && !isReturnedInAsync(node)) {
      findings.push({ line: lineOf(node) });
    }
  }

  for (const key in node) {
    if (['parent', 'loc', 'range', 'type', 'start', 'end'].includes(key)) continue;
    const v = node[key];
    if (v && typeof v === 'object') walk(v);
  }
}
walk(ast);

const seen = new Set();
const dedup = [];
for (const f of findings) {
  if (!seen.has(f.line)) { seen.add(f.line); dedup.push(f); }
}

console.log('floating-promise findings:', dedup.length);
for (const f of dedup) console.log('  .then(...) without .catch/await/return @ line', f.line);
if (dedup.length > 0) process.exit(2);
