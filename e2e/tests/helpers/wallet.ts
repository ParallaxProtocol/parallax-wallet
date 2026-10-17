import type { Page } from "@playwright/test";
import { expect, call, goTo, nodeRunning } from "../../fixtures";

/** One LAX in wei. */
export const LAX = 10n ** 18n;

/**
 * An address's balance in wei, as the node has it. The wallet reads only
 * its own accounts', so an address it hasn't is added as watch-only first:
 * call this once what's under test is done.
 */
export async function balance(page: Page, address: string): Promise<bigint> {
  const find = (all: Record<string, string>) =>
    Object.entries(all).find(([a]) => a.toLowerCase() === address.toLowerCase())?.[1];
  let wei = find(await call<Record<string, string>>(page, "WalletBalances"));
  if (wei === undefined) {
    await call(page, "WalletAddWatchOnly", "Checked", address);
    wei = find(await call<Record<string, string>>(page, "WalletBalances"));
  }
  return BigInt(wei ?? "0");
}

/** Sends from one of the wallet's accounts through the backend, for a test's setup: the transaction's hash. */
export async function sendRaw(page: Page, from: string, to: string, lax: bigint): Promise<string> {
  await nodeRunning(page);
  const q = await call<{ gasPriceWei: string; gasLimit: number }>(page, "WalletQuote", from, to, String(lax * LAX), "");
  const tx = await call<{ hash: string }>(page, "WalletSend", {
    from,
    to,
    valueWei: String(lax * LAX),
    gasPriceWei: q.gasPriceWei,
    gasLimit: q.gasLimit,
  });
  return tx.hash;
}

/** The Send page, with the node up so its Review button can go. */
export async function openSend(page: Page) {
  await nodeRunning(page);
  await goTo(page, "Send");
  await expect(page.getByLabel("Amount")).toBeVisible();
}

/** Fills the Send form: the recipient, then the amount. */
export async function fillSend(page: Page, to: string, amount: string) {
  const recipient = page.getByRole("combobox", { name: "To" });
  await recipient.fill(to);
  await recipient.press("Escape");
  await page.getByLabel("Amount").fill(amount);
}

/** Sends from the Send page through review to the confirmation, returning the transaction's hash. */
export async function sendViaUi(page: Page, to: string, amount: string): Promise<string> {
  await openSend(page);
  await fillSend(page, to, amount);
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();
  const hash = await page.getByText(/^0x[0-9a-f]{64}$/).textContent();
  return hash!;
}
