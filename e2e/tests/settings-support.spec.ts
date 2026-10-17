import type { ElectronApplication } from "@playwright/test";
import { test, expect, nodeRunning } from "../fixtures";
import { group, openSettings, row, sheet } from "./helpers/settings";

/** Keeps the links the app opens in the browser, rather than opening them. */
async function catchLinks(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { opened: string[] }).opened = opened;
    shell.openExternal = (async (url: string) => {
      opened.push(url);
    }) as typeof shell.openExternal;
  });
  return () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
}

test("the logs show the node's and the app's lines, filtered, paused and cleared", async ({ page }) => {
  await nodeRunning(page);
  await openSettings(page, "Diagnostics");
  const logs = group(sheet(page), "Logs");
  await expect(logs.getByText("Live", { exact: true })).toBeVisible();
  // The node's lines, the development chain's among them
  await expect(logs.getByText(/Allocated cache and file handles/).first()).toBeVisible();

  await logs.getByRole("radio", { name: "App" }).click();
  await expect(logs.getByText("Set the wallet password").first()).toBeVisible();
  await logs.getByRole("radio", { name: "Node" }).click();

  const filter = logs.getByPlaceholder("Filter…");
  await filter.fill("Allocated trie memory caches");
  await expect(logs.getByText(/Allocated trie memory caches/).first()).toBeVisible();
  await expect(logs.getByText(/Allocated cache and file handles/)).toHaveCount(0);
  await filter.fill("nothing logs this line");
  await expect(logs.getByText("No log lines yet.")).toBeVisible();
  // Escape clears the filter, and only the filter: Settings stays open
  await filter.press("Escape");
  await expect(filter).toHaveValue("");
  await expect(logs.getByText(/Allocated cache and file handles/).first()).toBeVisible();
  await expect(sheet(page)).toBeVisible();

  await logs.getByRole("button", { name: "Pause" }).click();
  await expect(logs.getByText("Paused", { exact: true })).toBeVisible();
  await logs.getByRole("button", { name: "Resume" }).click();
  await expect(logs.getByText("Live", { exact: true })).toBeVisible();

  await logs.getByRole("button", { name: "Clear" }).click();
  await expect(logs.getByText("No log lines yet.")).toBeVisible();
});

test("About shows the app's and the client's versions and the Tor it uses", async ({ page }) => {
  await openSettings(page, "About");
  await expect(sheet(page).getByRole("heading", { level: 3, name: "Parallax Wallet" })).toBeVisible();
  await expect(sheet(page).getByText(/^Version \d+\.\d+\.\d+/)).toBeVisible();
  await expect(row(sheet(page), "Daemon version")).toContainText(/v\d+\.\d+\.\d+/);
  // The app's own Tor by its version, or the one on this computer where the build has none (CI)
  await expect(row(sheet(page), "Tor")).toContainText(/Included with Parallax Wallet|Tor on this computer/);
  await expect(row(sheet(page), "Updates").getByRole("button", { name: "Check for updates" })).toBeEnabled();
});

test("About's release notes open in a dialog, and close", async ({ page }) => {
  await openSettings(page, "About");
  await row(sheet(page), "Release notes").getByRole("button", { name: "Show" }).click();
  const notes = page.getByRole("dialog", { name: "Release notes" });
  await expect(notes).toBeVisible();
  // Read from GitHub: what came, or why it couldn't, whichever the network allows
  await expect(notes.getByRole("button", { name: "View on GitHub" })).toBeVisible();
  await notes.getByRole("button", { name: "Close" }).click();
  await expect(notes).toBeHidden();
  await expect(sheet(page)).toBeVisible();
});

test("About's links open in the browser, a problem's report with the version and system filled in", async ({
  app,
  page,
}) => {
  const opened = await catchLinks(app);
  await openSettings(page, "About");
  await row(sheet(page), "Parallax Website").getByRole("button", { name: "Open" }).click();
  await row(sheet(page), "Report a problem").getByRole("button", { name: "Report" }).click();
  await row(sheet(page), "Request a feature").getByRole("button", { name: "Request" }).click();

  await expect.poll(opened).toHaveLength(3);
  const [site, bug, feature] = await opened();
  expect(site).toBe("https://parallaxprotocol.org/");
  const report = new URL(bug);
  expect(report.pathname).toBe("/ParallaxProtocol/parallax-gui/issues/new");
  expect(report.searchParams.get("template")).toBe("bug_report.yml");
  expect(report.searchParams.get("os")).toBe("Linux");
  expect(report.searchParams.get("version")).toMatch(/^\d+\.\d+\.\d+/);
  expect(new URL(feature).searchParams.get("template")).toBe("feature_request.yml");
});
