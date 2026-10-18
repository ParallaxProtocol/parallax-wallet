import { test, expect, call, nodeRunning } from "../fixtures";
import { advanced, config, group, openSettings, row, saveBar, savedAs, sheet } from "./helpers/settings";

test("a node setting waits for Save while the node runs, then for the node's restart", async ({ page }) => {
  await nodeRunning(page);
  await openSettings(page, "Node");

  await sheet(page).getByRole("radio", { name: "Full" }).click();
  await expect(row(sheet(page), "Sync mode").getByText("Restart", { exact: true })).toBeVisible();
  await expect(saveBar.unsaved(page)).toBeVisible();
  await expect(saveBar.needsRestart(page)).toBeVisible();
  expect((await config(page)).syncMode).toBe("snap");

  await saveBar.save(page).click();
  await savedAs(page, "syncMode", "full");
  // The node bar asks for the restart, the save bar gone once it says it saved
  const nodeBar = page.locator('section[aria-label="Network"]');
  const restartPending = nodeBar.getByText("Restart to apply your changes", { exact: true });
  await expect(restartPending).toBeVisible();
  await expect(saveBar.unsaved(page)).toBeHidden();

  await nodeBar.getByRole("button", { name: "Restart node" }).click();
  await expect(restartPending).toBeHidden({ timeout: 60_000 });
  await nodeRunning(page);
  await expect(row(sheet(page), "Sync mode").getByText("Restart", { exact: true })).toBeHidden();
  await expect(sheet(page).getByRole("radio", { name: "Full" })).toBeChecked();
});

test("while the node is stopped, a typed node setting saves once the typing pauses", async ({ page }) => {
  await nodeRunning(page);
  await call(page, "StopNode");
  // As the app sees it: a change made while it still thinks the node runs waits for Save
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();

  await openSettings(page, "Network");
  await row(sheet(page), "Node name").getByRole("textbox").fill("e2e-node");
  await savedAs(page, "nodeName", "e2e-node");
  // It read the setting as the node next starts: nothing waits on a restart
  await expect(saveBar.unsaved(page)).toBeHidden();
  await expect(row(sheet(page), "Node name").getByText("Restart", { exact: true })).toBeHidden();
});

test("Discard puts a changed number back, and the save bar goes", async ({ page }) => {
  await nodeRunning(page);
  await openSettings(page, "Network");
  const peers = row(sheet(page), "Max peers").getByRole("spinbutton");
  const was = await peers.inputValue();
  await peers.fill("7");
  await expect(saveBar.unsaved(page)).toBeVisible();

  await saveBar.discard(page).click();
  await expect(peers).toHaveValue(was);
  await expect(saveBar.unsaved(page)).toBeHidden();
  expect((await config(page)).maxPeers).toBe(Number(was));
});

test("Advanced folds a group's finer options, counts the customized ones, and stays open", async ({ page }) => {
  await nodeRunning(page);
  await openSettings(page, "Node");
  const performance = group(sheet(page), "Performance");
  const more = advanced(performance);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(performance.getByRole("switch", { name: "State prefetching" })).toBeHidden();

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const prefetch = performance.getByRole("switch", { name: "State prefetching" });
  await expect(prefetch).toHaveAttribute("aria-checked", "true");
  await expect(more).toHaveAccessibleName("Advanced");

  // Changed from its default: counted on the row, closed or not
  await prefetch.click();
  await expect(more).toHaveAccessibleName("Advanced 1 customized");
  await more.click();
  await expect(prefetch).toBeHidden();
  await expect(more).toHaveAccessibleName("Advanced 1 customized");

  await saveBar.discard(page).click();
  await expect(more).toHaveAccessibleName("Advanced");

  // Left open, it's open again next time
  await more.click();
  await page.keyboard.press("Escape");
  await openSettings(page, "Node");
  await expect(advanced(group(sheet(page), "Performance"))).toHaveAttribute("aria-expanded", "true");
  await expect(advanced(group(sheet(page), "Sync and history"))).toHaveAttribute("aria-expanded", "false");
});

test("a saved customized option is counted when Settings opens", async ({ page }) => {
  await nodeRunning(page);
  await call(page, "UpdateConfig", { ...(await config(page)), gpoBlocks: 30, gpoPercentile: 50 });
  await openSettings(page, "Node");
  await expect(advanced(group(sheet(page), "Fee estimation"))).toHaveAccessibleName("Advanced 2 customized");
});

test("HTTP-RPC's port unfolds beneath its switch, and a public address is warned of", async ({ page }) => {
  await nodeRunning(page);
  await openSettings(page, "RPC");
  const http = group(sheet(page), "HTTP");
  const rpc = http.getByRole("switch", { name: "Enable HTTP-RPC" });
  // The fixture starts the app with it off: no fixed port shared between tests
  await expect(rpc).toHaveAttribute("aria-checked", "false");
  await expect(row(http, "Port")).toBeHidden();

  await rpc.click();
  await expect(row(http, "Port")).toBeVisible();
  await expect(row(http, "Enable HTTP-RPC").getByText("Restart", { exact: true })).toBeVisible();

  await advanced(http).click();
  const exposed = http.getByText(/^The RPC server listens beyond this computer/);
  await expect(exposed).toBeHidden();
  await row(http, "Listen address").getByRole("textbox").fill("0.0.0.0");
  await expect(exposed).toBeVisible();
  await row(http, "Listen address").getByRole("textbox").fill("127.0.0.1");
  await expect(exposed).toBeHidden();

  await saveBar.discard(page).click();
  await expect(rpc).toHaveAttribute("aria-checked", "false");
  expect((await config(page)).httpRpcEnabled).toBe(false);
});

test("metrics wait on a restart of the whole app", async ({ page }) => {
  await nodeRunning(page);
  await openSettings(page, "Diagnostics");
  const metrics = sheet(page).getByRole("switch", { name: "Metrics", exact: true });
  const was = (await metrics.getAttribute("aria-checked")) === "true";
  await metrics.click();
  await expect(row(sheet(page), "Metrics").getByText("Restart app", { exact: true })).toBeVisible();
  await expect(saveBar.unsaved(page)).toBeVisible();

  await saveBar.save(page).click();
  await savedAs(page, "metrics", !was);
  await expect(saveBar.appRestartRequired(page)).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Restart app" })).toBeEnabled();
});

test("the log level applies at once and is saved", async ({ page }) => {
  await openSettings(page, "Diagnostics");
  await sheet(page).getByRole("button", { name: "Log level" }).click();
  await page.getByRole("option", { name: "Debug" }).click();
  await savedAs(page, "logLevel", 4);
  await expect(sheet(page).getByRole("button", { name: "Log level" })).toHaveText(/Debug/);

  await sheet(page).getByRole("switch", { name: "Clear logs on startup" }).click();
  await savedAs(page, "clearLogsOnStartup", true);
  await expect(saveBar.unsaved(page)).toBeHidden();
});
