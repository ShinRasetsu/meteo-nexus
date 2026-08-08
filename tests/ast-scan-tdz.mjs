// PHASE 2 audit — AST-based use-before-declare scanner (TDZ).
//
// Single-pass AST walker with hoisting-per-scope:
//   For each scope (function / block / catch / module), FIRST register every
//   binding in that scope (const/let/var/function declaration/function params),
//   THEN walk the body in source order, checking Identifier references against
//   the binding declLine.
//
//   This mirrors runtime hoisting: function names and `var` are hoisted to
//   the top of their enclosing function scope, and `const`/`let` bindings are
//   registered (in TDZ) at the start of their block scope. A reference before
//   the declaration line, in the same scope, IS a TDZ violation.
//
//   References INSIDE a nested function are NOT flagged, because the nested
//   function executes later, after the outer scope's bindings have been
//   initialized. (foundScope !== walkScope for those references.)
//
// Why AST, not regex: the 1.3.3 blow-up bug was a `const now = Date.now()`
// declared on line N but referenced on line N-1 inside a surrounding try
// block whose catch swallowed the ReferenceError. ESLint's
// `no-use-before-define` rule does NOT flag same-block-scope references,
// and Node's parser does NOT catch ReferenceErrors at parse time. An AST
// walker that pre-registers bindings per-scope is the only way to detect
// this class of bug.
//
// Usage:  node tests/extract-module.mjs && node tests/ast-scan-tdz.mjs
// Expected output: "TDZ violations: 0"

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

function lineOf(n) { return n.loc ? n.loc.start.line : -1; }
function startOf(n) { return n.start !== undefined ? n.start : -1; }

// Mark property keys so we don't false-positive on `{ foo: bar }` literals.
function markPropKeys(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) markPropKeys(c); return; }
  if (node.type === 'Property' && node.key && node.key.type === 'Identifier' && !node.computed) {
    node.key.isPropertyKey = true;
  }
  // Member expression property — also not a variable reference.
  if (node.type === 'MemberExpression' && node.property &&
      node.property.type === 'Identifier' && !node.computed) {
    node.property.isPropertyKey = true;
  }
  // OptionalMemberExpression (acorn emits this for `x?.foo`).
  if (node.type === 'OptionalMemberExpression' && node.property &&
      node.property.type === 'Identifier' && !node.computed) {
    node.property.isPropertyKey = true;
  }
  for (const key in node) {
    if (['parent', 'loc', 'range', 'type', 'start', 'end', 'isPropertyKey'].includes(key)) continue;
    markPropKeys(node[key]);
  }
}
markPropKeys(ast);

// ---------- Register all bindings (const/let/var/fn/params) in a scope ----------

function registerPattern(node, scope, kind, declLine, declStart) {
  if (!node) return;
  if (node.type === 'Identifier') {
    scope.bindings.set(node.name, { declLine, declStart, kind });
  } else if (node.type === 'ObjectPattern') {
    for (const prop of (node.properties || [])) if (prop.value) registerPattern(prop.value, scope, kind, declLine, declStart);
  } else if (node.type === 'ArrayPattern') {
    for (const el of (node.elements || [])) if (el) registerPattern(el, scope, kind, declLine, declStart);
  } else if (node.type === 'AssignmentPattern' && node.left) {
    registerPattern(node.left, scope, kind, declLine, declStart);
  } else if (node.type === 'RestElement' && node.argument) {
    registerPattern(node.argument, scope, kind, declLine, declStart);
  }
}
function registerParams(node, scope) {
  for (const p of (node.params || [])) {
    if (!p) continue;
    if (p.type === 'Identifier') {
      scope.bindings.set(p.name, { declLine: lineOf(p), declStart: startOf(p), kind: 'param' });
    }
    registerPattern(p, scope, 'param', lineOf(p), startOf(p));
  }
}

// Hoist all VariableDeclaration / FunctionDeclaration in a list of body nodes.
// Doesn't recurse into nested blocks — only same-scope declarations are hoisted.
function hoistDeclarations(body, scope) {
  if (!body) return;
  if (Array.isArray(body)) {
    for (const stmt of body) hoistOne(stmt, scope);
  } else {
    hoistOne(body, scope);
  }
}
function hoistOne(node, scope) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclaration') {
    const kind = node.kind;
    for (const d of node.declarations) {
      registerPattern(d.id, scope, kind, lineOf(d), startOf(d));
    }
  } else if (node.type === 'FunctionDeclaration' && node.id) {
    scope.bindings.set(node.id.name, { declLine: lineOf(node), declStart: startOf(node), kind: 'fn' });
  }
  // We do NOT recurse into IfStatement / ForStatement / etc. here because
  // those introduce sub-scopes (block scope, etc.) whose bindings belong to
  // the sub-scope. Hoisting only the immediate-scope declarations mirrors
  // JS semantics. (Note: `var` hoists to the enclosing function scope, but
  // for TDZ purposes we treat var as no-flag so the precision doesn't matter.)
}

// ---------- Scope-tree single-pass walk ----------

function newScope(parent, kind) {
  return { parent, kind, bindings: new Map(), depth: parent ? parent.depth + 1 : 0 };
}

const root = newScope(null, 'module');
hoistDeclarations(ast.body, root);

const violations = [];

function checkRef(ident, scope) {
  // No need for foundScope === scope — we are walking in the scope where the
  // reference lives; lookup walks the parent chain. Same-scope (block)
  // bindings naturally have foundScope === scope; ancestor bindings have
  // foundScope !== scope and are skipped via the check below.
  if (!ident || ident.type !== 'Identifier' || !ident.name) return;
  if (ident.isPropertyKey) return;
  const refLine = lineOf(ident);
  let s = scope, foundScope = null, found = null;
  while (s) {
    if (s.bindings.has(ident.name)) { found = s.bindings.get(ident.name); foundScope = s; break; }
    s = s.parent;
  }
  if (!found) return;
  if (found.kind === 'var' || found.kind === 'fn' || found.kind === 'param') return;
  // Skip REFERENCE if the binding is in a scope separated from the
  // reference's scope by a FUNCTION boundary — that means the reference is
  // in a callback that runs later, after the outer scope has initialized.
  // Block scopes are NOT execution boundaries; a reference inside a nested
  // block to a const/let in an OUTER block of the same function still TDZs.
  let cur = scope;
  let crossedFunctionBoundary = false;
  while (cur && cur !== foundScope) {
    if (cur.kind === 'function') { crossedFunctionBoundary = true; break; }
    cur = cur.parent;
  }
  if (crossedFunctionBoundary) return;
  // Ordering check: use char offset for same-line TDZ, line for human output.
  if (found.declLine > refLine || (found.declLine === refLine && found.declStart > startOf(ident))) {
    violations.push({ name: ident.name, refLine, declLine: found.declLine });
  }
}

function walk(node, scope) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const c of node) walk(c, scope); return; }

  const t = node.type;
  if (t === 'FunctionDeclaration' && node.id) {
    // Body executes in a NEW function scope with params pre-bound.
    const fnScope = newScope(scope, 'function');
    registerParams(node, fnScope);
    // Hoist any inner VariableDeclarations / FunctionDeclarations in the body.
    if (node.body && node.body.type === 'BlockStatement') {
      hoistDeclarations(node.body.body, fnScope);
    }
    walk(node.body, fnScope);
    // Don't walk node.id as a reference - it's a binding.
    return;
  }
  if (t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
    const fnScope = newScope(scope, 'function');
    if (node.id) fnScope.bindings.set(node.id.name, { declLine: lineOf(node), declStart: startOf(node), kind: 'fn' });
    registerParams(node, fnScope);
    if (node.body && node.body.type === 'BlockStatement') {
      hoistDeclarations(node.body.body, fnScope);
    }
    walk(node.body, fnScope);
    return;
  }
  if (t === 'BlockStatement') {
    const blockScope = newScope(scope, 'block');
    hoistDeclarations(node.body, blockScope);
    for (const c of node.body) walk(c, blockScope);
    return;
  }
  if (t === 'CatchClause') {
    const catchScope = newScope(scope, 'block');
    if (node.param && node.param.name) {
      catchScope.bindings.set(node.param.name, { declLine: lineOf(node), declStart: startOf(node), kind: 'param' });
    }
    if (node.body && node.body.type === 'BlockStatement') {
      hoistDeclarations(node.body.body, catchScope);
    }
    walk(node.body, catchScope);
    return;
  }

  if (t === 'Identifier') checkRef(node, scope);

  // generic recursive walk of all child properties
  for (const key in node) {
    if (['parent', 'loc', 'range', 'type', 'start', 'end', 'isPropertyKey'].includes(key)) continue;
    const v = node[key];
    if (v && typeof v === 'object') walk(v, scope);
  }
}

for (const stmt of ast.body) walk(stmt, root);

// ---------- report ----------

const seen = new Set();
const dedup = [];
for (const v of violations) {
  const k = v.name + ':' + (v.refLine + 1) + ':' + (v.declLine + 1);
  if (!seen.has(k)) { seen.add(k); dedup.push(v); }
}

console.log('TDZ (same-scope use-before-declare) violations:', dedup.length);
for (const v of dedup) console.log(' ', v.name, 'used @ line', v.refLine + 1, '(declared @', v.declLine + 1 + ')');
if (dedup.length > 0) process.exit(2);