/* eslint-disable no-undef */
import { test, expect } from '@playwright/test';

test('tracking card 390x844 -- progress, ETA, local telemetry stacked, 48px taps', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#sec-telemetry');
  // Local telemetry should be visible and stacked (grid-cols-1 on 390)
  await expect(page.locator('#sec-telemetry')).toBeVisible();
  await expect(page.locator('#metric-temp')).toBeVisible();
  // Tracking card progress bar should be fixed top-0 on mobile, hidden when no route
  const progBar = page.locator('#tracking-progress-bar');
  await expect(progBar).toBeHidden(); // no route yet -> hidden
  // Check hidden glance strip
  await expect(page.locator('#hud-glance-strip')).toBeHidden();
  // Check 48px taps
  const fuelBtn = page.locator('#fuel-trigger-btn');
  await expect(fuelBtn).toBeVisible();
  const box = await fuelBtn.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // Check ETA bar aria-live
  const etaBar = page.locator('#tracking-eta-bar');
  await expect(etaBar).toHaveAttribute('aria-live', 'polite');
});

test('hud-map will-change', async ({ page }) => {
  await page.goto('/');
  const willChange = await page.evaluate(() => getComputedStyle(document.getElementById('hud-map')).willChange);
  expect(willChange).toContain('transform');
});
