import type { Page } from "@playwright/test";
import { test, expect, call, unlockForm, PASSWORD } from "../fixtures";

// The lock screen: the wallet locked from the toolbar, or found locked as
// the window opens, and unlocked again with its password.

const locked = async (page: Page) => (await call<{ locked: boolean }>(page, "WalletInfo")).locked;

/** Locks the wallet from the toolbar. */
async function lock(page: Page) {
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Lock wallet" }).click();
  await expect.poll(() => locked(page)).toBe(true);
}

test("locking from the toolbar hides the app until the password is typed", async ({ page }) => {
  await lock(page);
  // Nothing of the app stays behind the lock screen
  await expect(page.getByRole("heading", { name: "Parallax Wallet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Send", exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("Wallet password")).toHaveCount(0);

  // The first key brings the form in, and goes in the field
  const field = await unlockForm(page);
  await expect(page.getByText("Enter your wallet password to unlock it.")).toBeVisible();
  await expect(field).toHaveValue("x");
  await field.fill(PASSWORD);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(await locked(page)).toBe(false);
});

test("a wrong password is refused and the field cleared", async ({ page }) => {
  await lock(page);
  const field = await unlockForm(page);
  await field.fill("not the password");
  const unlock = page.getByRole("button", { name: "Unlock" });
  await unlock.click();

  await expect(page.getByRole("alert")).toHaveText("Wrong password.");
  await expect(field).toHaveValue("");
  await expect(unlock).toBeDisabled();
  expect(await locked(page)).toBe(true);

  // Typing again clears the error
  await field.fill(PASSWORD);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await unlock.click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

// The window reloaded while locked is the app as it starts with a locked wallet: the lock screen opens anew
test("opened locked, it asks to be unlocked, the form coming in by itself", async ({ page }) => {
  await lock(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Unlock wallet" })).toBeVisible({ timeout: 30_000 });
  const field = page.getByPlaceholder("Wallet password");
  await expect(field).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeDisabled();
  await field.fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(await locked(page)).toBe(false);
});
