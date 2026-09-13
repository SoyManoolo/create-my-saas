import { defineConfig } from '@playwright/test';

const combination = `${process.env.E2E_BACKEND ?? 'fastapi'}-${process.env.E2E_FRONTEND ?? 'nextjs'}`;

export default defineConfig({
  testDir: './tests/browser',
  outputDir: `test-results/${combination}`,
  globalTimeout: 20 * 60 * 1_000,
  timeout: 2 * 60 * 1_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
