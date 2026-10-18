import { defineConfig } from "@playwright/test";

// End-to-end tests of the desktop app: each test starts the real app
// (Electron, the Go backend and the built frontend) in a home of its own,
// on the development chain (fixtures.ts). Build first: make e2e does.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  // Every test starts its own app, node and chain; a few at once is what a machine (or a CI runner) takes
  workers: process.env.CI ? 2 : 4,
  fullyParallel: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  // A run that breaks everywhere says so in its first failures: CI stops there, rather than wait out every test
  maxFailures: process.env.CI ? 10 : 0,
  // A failed test's trace and screenshot are kept by the fixture (Electron isn't a browser Playwright's `use` reaches)
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  projects: [
    { name: "app", grepInvert: /@clipboard/ },
    // What the clipboard holds is the desktop's, shared by every app running: the tests that
    // copy to it, paste from it or see it cleared (tagged @clipboard) run once the others are
    // done, one after another
    { name: "clipboard", grep: /@clipboard/, dependencies: ["app"], workers: 1 },
  ],
});
