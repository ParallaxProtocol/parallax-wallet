import { test, expect, call, goTo, FUNDED, OTHER, expectClipboard } from "../fixtures";

test("shows the account's whole address, as a QR code too, to copy", async ({ app, page }) => {
  await goTo(page, "Receive");
  const card = page.getByLabel("Your address");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Main");
  // In full, in groups of four to check against: never shortened
  await expect(card).toContainText(FUNDED.address);
  await expect(card.getByRole("img", { name: "QR code of the address" })).toBeVisible();
  await expect(card).toContainText("Share this address to receive LAX.");

  await card.getByRole("button", { name: "Copy" }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  await expectClipboard(app, FUNDED.address);
  // It turns back after a moment
  await expect(card.getByRole("button", { name: "Copy" })).toBeVisible();
});

test("follows the account selected in the sidebar", async ({ page }) => {
  await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
  await call(page, "WalletSelect", FUNDED.address);
  await page.reload();
  await goTo(page, "Receive");
  const card = page.getByLabel("Your address");
  await expect(card).toContainText(FUNDED.address);

  // The account card at the sidebar's top switches the account
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Accounts" })
    .getByRole("option", { name: /^Savings/ })
    .click();
  await expect(card).toContainText(OTHER.address);
  await expect(card).toContainText("Savings");
  await expect(card).not.toContainText(FUNDED.address);
});
