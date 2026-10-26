import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run their own copies of both servers, on different ports from your dev servers,
// so they always start from fresh sample data.
export default defineConfig({
  testDir: './e2e',
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node src/e2e-server.ts',
      cwd: '../api',
      env: { PORT: '3100' },
      url: 'http://localhost:3100/health',
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      env: { API_PORT: '3100' },
      url: 'http://localhost:5174',
    },
  ],
});
