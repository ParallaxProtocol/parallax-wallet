import { test, expect, call, nodeRunning, goTo, FUNDED, OTHER } from "../fixtures";

// The main window's frame around every page: the sidebar, the title bar's
// controls, and the node's bar along the foot.

/** The page's title in the toolbar. */
const title = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

test("every sidebar link opens its page", async ({ page }) => {
  await expect(title(page, "Overview")).toBeVisible();
  for (const name of ["Send", "Receive", "History", "Contacts", "Sign message", "Verify message", "Overview"]) {
    await goTo(page, name);
    await expect(title(page, name)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("the sidebar's Settings opens Settings", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings.getByRole("navigation", { name: "Settings" })).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toBeHidden();
});

test("the sidebar collapses to a rail and expands again", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  // In the rail the links are named by their label alone, their text faded
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Send", exact: true })).toHaveAttribute("aria-label", "Send");
  await nav.getByRole("link", { name: "History", exact: true }).click();
  await expect(title(page, "History")).toBeVisible();

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Send", exact: true })).not.toHaveAttribute("aria-label", "Send");
});

test("the account switcher lists the accounts and switches between them", async ({ page }) => {
  await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
  // The wallet's accounts are read as the window loads; a new one is the one chosen
  await page.reload();
  await expect(page.getByRole("region", { name: OTHER.name })).toContainText(/Balance\s*0\s*LAX/);

  await page.getByRole("button", { name: OTHER.name, exact: true }).click();
  const list = page.getByRole("listbox", { name: "Accounts" });
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list.getByRole("option", { name: new RegExp(OTHER.name) })).toHaveAttribute("aria-selected", "true");
  await list.getByRole("option", { name: new RegExp(FUNDED.name) }).click();
  await expect(list).toBeHidden();

  // The pages follow the chosen account
  await expect(page.getByRole("button", { name: FUNDED.name, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: FUNDED.name })).toContainText("1,000,000");
  await expect
    .poll(async () => (await call<{ selected: string }>(page, "WalletInfo")).selected.toLowerCase())
    .toBe(FUNDED.address.toLowerCase());
  await goTo(page, "Receive");
  await expect(page.getByRole("main")).toContainText(FUNDED.address);
});

test("the account switcher's Manage accounts opens Settings' accounts", async ({ page }) => {
  await page.getByRole("button", { name: FUNDED.name, exact: true }).click();
  await page.getByRole("button", { name: "Manage accounts…" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings.getByRole("button", { name: "Accounts", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(settings.getByText(FUNDED.name).first()).toBeVisible();
});

test("the notifications start empty and tell of a confirmed send", async ({ page }) => {
  await nodeRunning(page);
  const bell = page.getByRole("button", { name: "Notifications" });
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByText(/^Nothing new\./)).toBeVisible();
  await bell.click();
  await expect(panel).toBeHidden();

  // The development chain seals the send into the next block, which the window hears of
  await call(page, "WalletSend", {
    from: FUNDED.address,
    to: OTHER.address,
    valueWei: "1500000000000000000",
    gasPriceWei: "1000000000",
    gasLimit: 21000,
  });
  await bell.click();
  await expect(panel.getByText("Sent 1.5 LAX")).toBeVisible();
  await panel.getByRole("button", { name: /^Sent 1\.5 LAX\. Show it in History$/ }).click();
  await expect(title(page, "History")).toBeVisible();

  await bell.click();
  await panel.getByRole("button", { name: "Clear" }).click();
  await expect(panel.getByText(/^Nothing new\./)).toBeVisible();
});

test("the lock button locks the wallet", async ({ page }) => {
  await page.getByRole("button", { name: "Lock wallet" }).click();
  // The window gives way to the lock screen, asking for the password
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Parallax Wallet" })).toBeVisible();
  await expect.poll(async () => (await call<{ locked: boolean }>(page, "WalletInfo")).locked).toBe(true);
});

test("the node bar shows the node synced, and disconnects and connects it", async ({ page }) => {
  await nodeRunning(page);
  const bar = page.getByRole("region", { name: "Network" });
  await expect(bar.getByText("Synced")).toBeVisible();
  await expect(bar.getByText(/Block 0 · 0 peers/)).toBeVisible();

  await bar.getByRole("button", { name: "Disconnect" }).click();
  await expect(bar.getByText("Offline")).toBeVisible();
  await expect(bar.getByText("Connect to see your balance and send LAX.")).toBeVisible();
  await expect.poll(async () => (await call<{ running: boolean }>(page, "NodeStatus")).running).toBe(false);
  // The overview says what's missing while it's off
  await expect(page.getByText("Read from the node once it runs")).toBeVisible();
  await expect(page.getByText("Connect to see this account's transactions.")).toBeVisible();

  await bar.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(bar.getByText("Synced")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("At block #0")).toBeVisible();
});

test("the node bar opens into the node's page and closes again", async ({ page }) => {
  await nodeRunning(page);
  const bar = page.getByRole("region", { name: "Network" });
  await bar.getByRole("button", { name: "Show the node" }).click();
  await expect(bar.getByRole("button", { name: "Hide the node" })).toHaveAttribute("aria-expanded", "true");
  // Its figures: peers, the mempool, the fee and the uptime
  for (const label of ["Peers", "Mempool", "Recommended fee", "Uptime"]) {
    await expect(bar.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await bar.getByRole("button", { name: /^Peers: View$/ }).click();
  await expect(bar.getByRole("button", { name: /^Peers: Hide$/ })).toBeVisible();
  await bar.getByRole("button", { name: /^Peers: Hide$/ }).click();

  // Escape in the mempool's search clears it, and only it: the page stays open
  await bar.getByRole("button", { name: /^Mempool: View$/ }).click();
  const search = bar.getByRole("textbox", { name: "Search by hash or address" });
  await search.fill("0xabc");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(bar.getByRole("button", { name: "Hide the node" })).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: "Show the node" })).toHaveAttribute("aria-expanded", "false");
});

test("the node's page offers to connect while the node is off", async ({ page }) => {
  await nodeRunning(page);
  const bar = page.getByRole("region", { name: "Network" });
  await bar.getByRole("button", { name: "Disconnect" }).click();
  await expect(bar.getByText("Offline")).toBeVisible();
  await bar.getByRole("button", { name: "Show the node" }).click();
  await expect(bar.getByText("You're not connected")).toBeVisible();
  await bar.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(bar.getByText("Peers", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
});

test("with Tor off, the node bar shows nothing of Tor", async ({ page }) => {
  await expect(title(page, "Overview")).toBeVisible();
  await expect(page.getByText(/Connect(ed|ing) (through|to) Tor/)).toHaveCount(0);
  await expect(page.getByText("Tor isn't connected: nothing goes out")).toHaveCount(0);
});

test.describe("a node that couldn't start", () => {
  // The development chain funding what isn't an address: the app's start of the node fails
  test.use({ config: { devFundAddress: "nonsense" } });

  test("the node bar says why, and the node's page in full", async ({ page }) => {
    const bar = page.getByRole("region", { name: "Network" });
    await expect(bar.getByText("Offline")).toBeVisible();
    const reason = 'development chain: "nonsense" is not an address';
    await expect(bar.getByText(`Couldn't start: ${reason}`)).toBeVisible();
    await expect(bar.getByText("Connect to see your balance and send LAX.")).toHaveCount(0);

    await bar.getByRole("button", { name: "Show the node" }).click();
    await expect(bar.getByText(`The node couldn't start the last time it tried: ${reason}`)).toBeVisible();
  });
});
