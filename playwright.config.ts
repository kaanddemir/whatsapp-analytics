/* Real-browser regressions for what jsdom cannot see: layout, focus, pointer
   capture, history and the saved PNG. `npm run test:browser`; needs the Chromium
   and WebKit builds of the pinned Playwright. Chats are synthetic and in memory. */
import { defineConfig, devices } from "@playwright/test";

const PORT = 4179;

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  // One browser at a time by default: fine on an ordinary laptop. `--workers=2` when memory is free.
  workers: 1,
  forbidOnly: true,
  reporter: [["list"]],
  outputDir: "node_modules/.cache/playwright",
  use: { baseURL: `http://127.0.0.1:${PORT}/`, viewport: { width: 1280, height: 800 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    env: { BASE_PATH: "/" },
    reuseExistingServer: false,
  },
});
