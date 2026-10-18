import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, OTHER } from "../fixtures";
import { openSettings } from "./helpers/accounts";

// A key or a recovery phrase pasted in to be imported leaves the clipboard
// once it's imported (desktop/src/main.ts clipboard:clearIf), the window
// telling the main process its hash alone. What else is there stays.
//
// The tests share one clipboard with the others running beside them: what
// they check is that it no longer holds the secret, not that it's empty.

const PHRASE = "test test test test test test test test test test test junk";

const clipboard = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());
const copy = (app: ElectronApplication, text: string) =>
  app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);

async function importKey(page: Page, key: string) {
  await openSettings(page, "Accounts");
  await page.getByRole("button", { name: "Import accounts" }).click();
  await page.getByRole("button", { name: /^Import a key/ }).click();
  await page.getByRole("radio", { name: "Private key" }).click();
  await page.getByLabel("Private key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Single keys" })).toBeVisible();
}

test(
  "a private key pasted in leaves the clipboard once it's imported",
  { tag: "@clipboard" },
  async ({ app, page }) => {
    // As copied from elsewhere: a newline after it, which the field's value hasn't
    const pasted = `${OTHER.key}\n`;
    await copy(app, pasted);
    await importKey(page, OTHER.key);
    await expect.poll(() => clipboard(app)).not.toBe(pasted);
  },
);

test("a key the clipboard doesn't hold leaves what it holds", { tag: "@clipboard" }, async ({ app, page }) => {
  const other = `not a key, copied ${Date.now()}`;
  await copy(app, other);
  await importKey(page, OTHER.key);
  // Cleared at once if at all: a moment for it, then what was there is still there
  await expect.poll(() => clipboard(app), { timeout: 2_000 }).toBe(other);
});

test(
  "a recovery phrase pasted in leaves the clipboard once it's imported",
  { tag: "@clipboard" },
  async ({ app, page }) => {
    // In capitals, as some write it down, and spaced as pasted from a note
    const pasted = `  ${PHRASE.toUpperCase().split(" ").join("  ")}\n`;
    await copy(app, pasted);
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Import accounts" }).click();
    await page.getByRole("button", { name: /^Import a recovery phrase/ }).click();
    await page.getByLabel("Recovery phrase", { exact: true }).fill(PHRASE);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Choose accounts" })).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recovery phrases" })).toBeVisible();
    await expect.poll(() => clipboard(app)).not.toBe(pasted);
  },
);
