// Unit suite — executes adaptWeightsBySkill for real (not scanned).
//
// The function lives in the inline module (index.html), which cannot be
// imported (browser globals). This file slices the EXACT shipped function
// out of index.html by brace counting and runs it in a vm sandbox — so the
// fixtures exercise the shipped bytes, not a copy (the worker.test.mjs
// sliceFunction precedent). The function is pure by contract (args + Math
// + Object only); keep it that way or the slicer and the sandbox both
// break loudly. Its body must stay free of unbalanced braces inside
// strings or comments.
//
// Fixture provenance: the "live log" case replays real measured Brier
// means from .playwright-mcp/console-2026-09-26T09-42-32-892Z.log:139
// (n=24 at the pin: EU 0.300 / US 0.948 / DE 0.573 / JP 0.337 / CA 0.500),
// with n lifted to 40 so the default minObs=30 gate engages. The log shows
// the static tables mispricing GFS vs JMA at this pin — the exact gap the
// closed loop exists to close.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

// Slice a top-level function out of a source string by brace counting.
// The shipped function carries no unbalanced braces in strings/comments
// (contract, pinned in-code), so naive counting is exact.
function sliceFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in source`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`${name}: unbalanced braces`);
  return src.slice(start, i + 1);
}

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const fnSrc = sliceFunction(html, 'adaptWeightsBySkill');
const adaptWeightsBySkill = vm.runInNewContext(`${fnSrc}\nadaptWeightsBySkill;`, {});

// east_asia regime table (the pin's regime) — the adaptation input shape.
const EAST_ASIA = { ecmwf_ifs025: 0.34, gfs_seamless: 0.21, icon_seamless: 0.13, jma_seamless: 0.26, gem_seamless: 0.06 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
// The shipped function runs in a vm realm, so its return values carry the
// vm realm's Object.prototype — node:assert/strict deepEqual compares
// prototypes and would fail on identical values. Normalize through JSON
// (all values are plain numbers) before structural comparison.
const plain = (o) => JSON.parse(JSON.stringify(o));

test('null skill summary returns base values unchanged (cold start neutrality)', () => {
  const out = adaptWeightsBySkill(null, EAST_ASIA, null);
  assert.deepEqual(plain(out), EAST_ASIA);
  assert.ok(approx(sum(out), 1));
});

test('empty base returns empty object without throwing', () => {
  assert.deepEqual(plain(adaptWeightsBySkill({ a: { brier: 0.2, n: 50 } }, {}, null)), {});
  assert.deepEqual(plain(adaptWeightsBySkill(null, {}, null)), {});
});

test('all models below minObs returns base unchanged (evidence gate)', () => {
  const thin = {
    ecmwf_ifs025: { brier: 0.1, n: 29 }, gfs_seamless: { brier: 0.9, n: 29 },
    icon_seamless: { brier: 0.5, n: 29 }, jma_seamless: { brier: 0.2, n: 29 },
    gem_seamless: { brier: 0.5, n: 29 }
  };
  assert.deepEqual(plain(adaptWeightsBySkill(thin, EAST_ASIA, null)), EAST_ASIA);
});

test('unanimous skill returns base unchanged (no churn on ties)', () => {
  const tied = {};
  for (const m of Object.keys(EAST_ASIA)) tied[m] = { brier: 0.4, n: 50 };
  assert.deepEqual(plain(adaptWeightsBySkill(tied, EAST_ASIA, null)), EAST_ASIA);
});

test('live-log replay: ECMWF/JMA rise, GFS falls, weights still sum to 1', () => {
  const live = {
    ecmwf_ifs025: { brier: 0.300, n: 40 }, gfs_seamless: { brier: 0.948, n: 40 },
    icon_seamless: { brier: 0.573, n: 40 }, jma_seamless: { brier: 0.337, n: 40 },
    gem_seamless: { brier: 0.500, n: 40 }
  };
  const out = adaptWeightsBySkill(live, EAST_ASIA, null);
  assert.ok(approx(sum(out), 1, 1e-12), 'renormalized to 1');
  assert.ok(out.ecmwf_ifs025 > 0.40 && out.ecmwf_ifs025 < 0.43, `EU up, got ${out.ecmwf_ifs025}`);
  assert.ok(out.gfs_seamless > 0.10 && out.gfs_seamless < 0.12, `US down, got ${out.gfs_seamless}`);
  assert.ok(out.jma_seamless > 0.30 && out.jma_seamless < 0.33, `JP up, got ${out.jma_seamless}`);
});

test('clamps engage on extreme gaps (factors bounded 0.6x..1.4x)', () => {
  const base = { a: 0.5, b: 0.5 };
  const out = adaptWeightsBySkill({ a: { brier: 0, n: 100 }, b: { brier: 0.99, n: 100 } }, base, null);
  assert.ok(approx(out.a, 0.7, 1e-12) && approx(out.b, 0.3, 1e-12), `unclamped would be ~0.99/0.01, got ${out.a}/${out.b}`);
  assert.ok(approx(sum(out), 1, 1e-12));
});

test('hysteresis: sub-threshold gaps keep static tables', () => {
  const close = {
    ecmwf_ifs025: { brier: 0.40, n: 100 }, gfs_seamless: { brier: 0.41, n: 100 },
    icon_seamless: { brier: 0.42, n: 100 }, jma_seamless: { brier: 0.43, n: 100 },
    gem_seamless: { brier: 0.44, n: 100 }
  };
  assert.deepEqual(plain(adaptWeightsBySkill(close, EAST_ASIA, null)), EAST_ASIA);
});

test('degenerate inputs abstain (null/NaN/out-of-range Brier, missing models)', () => {
  const junk = {
    ecmwf_ifs025: { brier: null, n: 100 }, gfs_seamless: { brier: NaN, n: 100 },
    icon_seamless: { brier: 1.5, n: 100 }, jma_seamless: { brier: 0.3, n: 0 }
    // gem_seamless absent entirely
  };
  assert.deepEqual(plain(adaptWeightsBySkill(junk, EAST_ASIA, null)), EAST_ASIA);
});

test('never mutates the input table (REGIONAL_WEIGHTS aliasing guard)', () => {
  const frozen = Object.freeze({ ...EAST_ASIA });
  const live = {
    ecmwf_ifs025: { brier: 0.300, n: 40 }, gfs_seamless: { brier: 0.948, n: 40 },
    icon_seamless: { brier: 0.573, n: 40 }, jma_seamless: { brier: 0.337, n: 40 },
    gem_seamless: { brier: 0.500, n: 40 }
  };
  const out = adaptWeightsBySkill(live, frozen, null);
  assert.deepEqual(frozen, EAST_ASIA);
  assert.notDeepEqual(plain(out), EAST_ASIA);
});

test('custom opts respected: minObs gate is configurable, not hardcoded', () => {
  const base = { a: 0.5, b: 0.5 };
  const skill = { a: { brier: 0, n: 5 }, b: { brier: 0.9, n: 5 } };
  assert.deepEqual(plain(adaptWeightsBySkill(skill, base, null)), base, 'default minObs=30 abstains at n=5');
  const out = adaptWeightsBySkill(skill, base, { minObs: 5 });
  assert.ok(approx(out.a, 0.7, 1e-12) && approx(out.b, 0.3, 1e-12), `adapts at minObs=5, got ${out.a}/${out.b}`);
});
