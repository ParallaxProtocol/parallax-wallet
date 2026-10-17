import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, call, goTo, answerDialogs, FUNDED, OTHER } from "../fixtures";
import { sendRaw } from "./helpers/wallet";

/**
 * Main and Savings with a transfer each way: Main sends Savings 5 LAX,
 * Savings sends 2 back. Main is selected, its History open. Returns the
 * two transactions' hashes.
 */
async function twoWays(page: Page) {
  await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
  const out = await sendRaw(page, FUNDED.address, OTHER.address, 5n);
  const back = await sendRaw(page, OTHER.address, FUNDED.address, 2n);
  await call(page, "WalletSelect", FUNDED.address);
  await page.reload();
  await goTo(page, "History");
  return { out, back };
}

const row = (page: Page, name: RegExp) => page.getByRole("button", { name });

test("lists what was sent and received, each named by its counterparty", async ({ page }) => {
  await twoWays(page);
  await expect(row(page, /^Sent Block \d+ · to Savings/)).toBeVisible();
  await expect(row(page, /^Received Block \d+ · from Savings/)).toBeVisible();
  await expect(page.getByText("−5", { exact: false })).toBeVisible();
  await expect(page.getByText("+2", { exact: false })).toBeVisible();

  // The other side's history, from Savings
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Accounts" })
    .getByRole("option", { name: /^Savings/ })
    .click();
  await expect(row(page, /^Received Block \d+ · from Main/)).toBeVisible();
  await expect(row(page, /^Sent Block \d+ · to Main/)).toBeVisible();
});

test("filters by what was received or sent", async ({ page }) => {
  await twoWays(page);
  const filter = page.getByRole("radiogroup").filter({ has: page.getByRole("radio", { name: "Mined" }) });
  const sent = row(page, /^Sent Block/);
  const received = row(page, /^Received Block/);

  await filter.getByRole("radio", { name: "Sent" }).click();
  await expect(sent).toBeVisible();
  await expect(received).toBeHidden();

  await filter.getByRole("radio", { name: "Received" }).click();
  await expect(received).toBeVisible();
  await expect(sent).toBeHidden();

  // Nothing mined by this account: the list says so, and Clear brings everything back
  await filter.getByRole("radio", { name: "Mined" }).click();
  await expect(page.getByText("Nothing in this account's history matches.")).toBeVisible();
  await filter.getByRole("radio", { name: "All" }).click();
  await expect(sent).toBeVisible();
  await expect(received).toBeVisible();
});

test("searches by a counterparty's name, by block, and by transaction", async ({ page }) => {
  const { out } = await twoWays(page);
  const search = page.getByRole("combobox", { name: "Search by contact, address, transaction or block" });

  // A name: the suggestion narrows the history to what went with it
  await search.fill("Sav");
  await page.getByRole("option", { name: /Savings/ }).click();
  await expect(page.getByText("With Savings")).toBeVisible();
  await expect(row(page, /^Sent Block/)).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).last().click();
  await expect(page.getByText("With Savings")).toBeHidden();

  // A name nobody has
  await search.fill("nobody");
  await search.press("Enter");
  await expect(page.getByText("No contact or account by that name.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // A transaction's hash: the history starts from it, opened
  await search.fill(out);
  await search.press("Enter");
  await expect(page.getByText(/^From transaction 0x/)).toBeVisible();
  await expect(row(page, /^Sent Block/)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Value5 LAX")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).last().click();

  // A block number: the history starts from that block, older items only
  const name = await row(page, /^Received Block/).getAttribute("aria-labelledby");
  const label = await page.locator(`[id="${name}"]`).textContent();
  const block = Number(label!.match(/Block (\d+)/)![1]);
  await search.fill(`#${block - 1}`);
  await search.press("Enter");
  await expect(page.getByText(`From block ${block - 1}`)).toBeVisible();
  await expect(row(page, /^Sent Block/)).toBeVisible();
  await expect(row(page, /^Received Block/)).toBeHidden();
});

test("opens a transaction's details", async ({ page }) => {
  const { out } = await twoWays(page);
  const sent = row(page, /^Sent Block/);
  await sent.click();
  await expect(sent).toHaveAttribute("aria-expanded", "true");

  // The list is virtualized: the opened row is the one whose button it is
  const details = page.locator("div", { has: sent }).filter({ hasText: "Block hash" }).last();
  await expect(details.getByText(/^\d+ confirmations?$/)).toBeVisible();
  await expect(details).toContainText("Value5 LAX");
  await expect(details).toContainText("Nonce0");
  await expect(details).toContainText(out.slice(0, 10));

  await sent.click();
  await expect(sent).toHaveAttribute("aria-expanded", "false");
});

test("exports what's shown as a CSV file", async ({ app, page, home }) => {
  const { out, back } = await twoWays(page);
  const file = path.join(home, "activity.csv");
  await answerDialogs(app, file);

  const exportButton = page.getByRole("button", { name: "Export" });
  // Once the history is indexed
  await expect(exportButton).toBeEnabled({ timeout: 60_000 });
  await exportButton.click();
  await expect(page.getByText("Exported 2 rows.")).toBeVisible();

  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  expect(lines[0]).toContain("Date (UTC),Block,Type,Status,From,To,Counterparty,Amount (LAX)");
  expect(lines).toHaveLength(3);
  const csv = lines.join("\n");
  expect(csv).toContain(out);
  expect(csv).toContain(back);
  expect(csv).toContain("Savings");
});

test("an export cancelled at the dialog writes nothing", async ({ app, page, home }) => {
  await twoWays(page);
  await answerDialogs(app, null);
  const exportButton = page.getByRole("button", { name: "Export" });
  await expect(exportButton).toBeEnabled({ timeout: 60_000 });
  await exportButton.click();
  await expect(page.getByText(/^Exported/)).toBeHidden();
  expect(fs.readdirSync(home).filter((f) => f.endsWith(".csv"))).toEqual([]);
});
