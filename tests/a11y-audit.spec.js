// a11y-audit.spec.js — E5 fixture: axe-core accessibility scan on the 390x844 rig.
//
// GUARANTEE: axe-core (the engine behind Lighthouse a11y, run with its FULL
// ruleset) analyzes the real booted app surface. This fixture has two jobs:
//   1. FAIL on any violation NOT in the KNOWN_VIOLATION_IDS pin — new a11y
//      regressions are loud, never silent.
//   2. Track the pinned set (the documented 1.14.0 Lighthouse fail-set):
//      each pinned id carries its disposition. The pin shrinks as fixes
//      land; adding an id requires a charter-cited rationale (§1.6).
//
// This is the primary a11y instrument on this box: both Lighthouse paths
// are unavailable (danielsogl runner: Windows \\?\ EPERM, 3 reproductions;
// chrome-devtools wrapper: audits chrome-error://, 2026-10-04 session) —
// recorded in HISTORY 1.14.3.

/* eslint-disable no-undef */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Pin history: the 1.14.3 fail-set (color-contrast, landmark-one-main,
// region) was FIXED in 1.15.0 (gray-500/600 → gray-400 sweep, <main
// id="app-main"> landmark, footer badge opacity) and the pin shrank to
// EMPTY — zero tolerance from 1.15.0 on. Adding an id back requires a
// §1.6 charter-cited rationale in HISTORY.
const KNOWN_VIOLATION_IDS = new Set([]);

test('axe-core a11y: zero undocumented violations on the 390x844 boot surface', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2500); // SW install -> clients.claim -> controllerchange self-reload window
  // RIG ARTIFACT (documented 2026-10-08, headless-shell only): the app's
  // first-install controllerchange reload (index.html:9214) fires during SW
  // activation and lands on chrome-error:// IN CHROME-HEADLESS-SHELL ONLY —
  // settled SW serves fresh navigations and manual reloads fine (probed:
  // 200 + intact title). One re-navigation is the documented workaround; the
  // device/headed surface is unaffected. Deferred hardening candidate
  // (defer the reload out of the activation window) rides the 1.15.0 batch.
  if (page.url().startsWith('chrome-error')) {
    const retry = await page.goto('/', { timeout: 20000 });
    console.log('post-artifact re-navigation status:', retry && retry.status());
  }
  await page.waitForTimeout(4000); // boot: markers, glance strip, SWR settle

  const results = await new AxeBuilder({ page }).analyze();
  const diag = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    lang: document.documentElement.getAttribute('lang'),
    titleEl: !!document.querySelector('head > title'),
    h1: !!document.querySelector('h1'),
    h1Visible: (() => { const h = document.querySelector('h1'); return !!h && !!(h.offsetParent || h.getClientRects().length); })(),
    main: !!document.querySelector('main'),
  }));
  console.log('page diagnostics:', JSON.stringify(diag));
  const pinned = [];
  const unknown = [];
  for (const v of results.violations) {
    if (KNOWN_VIOLATION_IDS.has(v.id)) pinned.push(`${v.id}(${v.impact}, ${v.nodes.length} nodes)`);
    else unknown.push(`${v.id}(${v.impact}, ${v.nodes.length} nodes)`);
  }
  console.log('axe pinned (documented):', pinned.join(' | ') || 'none');
  console.log('axe unknown (new):', unknown.join(' | ') || 'none');
  // Failure context: node-level detail for every remaining violation —
  // the pin review uses this (targets + computed contrast data).
  for (const v of results.violations) {
    const detail = v.nodes.map((n) => ({
      t: Array.isArray(n.target) ? n.target.join(' ') : n.target,
      ratio: n.any && n.any[0] && n.any[0].data ? Math.round(n.any[0].data.contrastRatio * 100) / 100 : null,
      fg: n.any && n.any[0] && n.any[0].data ? n.any[0].data.fgColor : null,
    }));
    console.log(`axe violation detail [${v.id}]:`, JSON.stringify(detail).slice(0, 600));
  }

  expect(unknown, `NEW a11y violations must be fixed before ship: ${unknown.join(', ')}`).toEqual([]);
});
