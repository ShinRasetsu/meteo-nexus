import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /visual-regression\.spec\.js|a11y-audit\.spec\.js/,
  timeout: 30_000,
  expect: { timeout: 5000 },
  use: {
    // 127.0.0.1 explicit: chrome-headless-shell fails name-resolution on
    // 'localhost' (lands on chrome-error://chromewebdata/ — found 2026-10-08
    // when wiring the a11y fixture; loopback is always proxy-bypassed).
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile-390x844',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npx serve . -l 3000 --no-clipboard --no-port-switching',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
