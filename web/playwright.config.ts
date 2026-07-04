import { defineConfig, devices } from '@playwright/test';

// E2E runs against a real Vite dev server pointed at a real Supabase project
// (staging by default) — no mocking. `--mode staging` makes Vite load
// web/.env.staging (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for the
// staging project); the prod-test run (npm run test:e2e:prod) instead sets
// PLAYWRIGHT_VITE_MODE=prod-test to load web/.env.prod-test. Fixtures for
// both are seeded/torn down by the matching web/scripts/{seed,reset}-*.mjs
// before/after the run — see tests/e2e/global-setup.ts.
const viteMode = process.env.PLAYWRIGHT_VITE_MODE ?? 'staging';
const port = 5183;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // shares one seeded sentinel dataset across specs
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --mode ${viteMode} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
