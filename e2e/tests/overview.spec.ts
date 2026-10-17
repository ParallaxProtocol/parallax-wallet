import { test, expect, call, nodeRunning, PASSWORD, FUNDED, OTHER, expectClipboard } from "../fixtures";

// The Overview, the wallet's home: the account's card, its balance and its
// latest activity, read from the node on the development chain.

const send = (page: import("@playwright/test").Page, lax: string) =>
  call<{ hash: string }>(page, "WalletSend", {
    from: FUNDED.address,
    to: OTHER.address,
    valueWei: (BigInt(Math.round(Number(lax) * 1e6)) * 10n ** 12n).toString(),
    gasPriceWei: "1000000000",
    gasLimit: 21000,
  });

test("the account card shows the account, its address and its balance", async ({ page, app }) => {
  await nodeRunning(page);
  const card = page.getByRole("region", { name: FUNDED.name });
  await expect(card.getByText(FUNDED.name, { exact: true })).toBeVisible();
  // The address in full, in groups of four
  await expect(card).toContainText(FUNDED.address);
  await expect(card.getByText("1,000,000")).toBeVisible();
  await expect(card.getByText("At block #0")).toBeVisible();

  await card.getByRole("button", { name: "Copy" }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  await expectClipboard(app, FUNDED.address);
});

test("Send and Receive open their pages", async ({ page }) => {
  const card = page.getByRole("region", { name: FUNDED.name });
  await card.getByRole("link", { name: "Send" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Send" })).toBeVisible();
  await page.goBack();
  await card.getByRole("link", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Receive" })).toBeVisible();
});

test("recent activity starts empty, then lists a send with its block", async ({ page }) => {
  await nodeRunning(page);
  await expect(page.getByText("No transactions for this account yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See all" })).toHaveCount(0);

  await send(page, "2.5");
  const row = page.getByRole("button", { name: /^Sent\s+Block 1/ });
  await expect(row).toBeVisible();
  await expect(page.getByText("−2.5 LAX")).toBeVisible();
  // The balance follows: the amount and the fee gone
  await expect(page.getByText("At block #1")).toBeVisible();
  const balance = await call<Record<string, string>>(page, "WalletBalances");
  expect(BigInt(balance[FUNDED.address])).toBeLessThan(999_997_500_000_000_000_000_000n);

  // Opened, the row unfolds its details; See all goes on to History
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("link", { name: "See all" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
});

test("a send waiting for a block shows as pending until it's sealed", async ({ page }) => {
  await nodeRunning(page);
  // Held, the development chain leaves what's sent in the pool, as mainnet does between blocks
  await call(page, "DevSetHold", true);
  await send(page, "1");
  const card = page.getByRole("region", { name: FUNDED.name });
  await expect(card.getByText("Waiting · 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Pending\s*1$/ })).toBeVisible();
  await expect(page.getByText("Waiting for a block")).toBeVisible();
  await expect(page.getByRole("button", { name: "Speed up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

  await call(page, "DevSetHold", false);
  await expect(card.getByText(/^Waiting · /)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Pending/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Sent\s+Block 1/ })).toBeVisible();
});

test.describe("with no account yet", () => {
  // Set up on the development chain, the password chosen, no account made
  test.use({ seed: "fresh", config: { bootstrapped: true, devChain: true, autoStartNode: false } });

  test("the window asks for the first account", async ({ page }) => {
    await call(page, "WalletSetupPassword", PASSWORD);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Add your first account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Create an account/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import an account/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Add a watch-only account/ })).toBeVisible();
    // Each opens Settings at the accounts
    await page.getByRole("button", { name: /^Create an account/ }).click();
    await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  });
});
