import { test, expect, call, goTo, FUNDED, OTHER } from "../fixtures";
import { LAX, balance, fillSend, openSend, sendViaUi } from "./helpers/wallet";

test("sends LAX to another address, through review to the confirmation", async ({ page }) => {
  await openSend(page);
  await fillSend(page, OTHER.address, "12.5");

  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Review and sign")).toBeVisible();
  await expect(page.getByText("12.5", { exact: true })).toBeVisible();
  await expect(page.getByText("Check every character against the address you were given.")).toBeVisible();
  await expect(page.locator("dl")).toContainText("21,000 gas at 1 gwei");
  await expect(page.locator("dl")).toContainText("Main");

  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();
  await expect(page.getByText("12.5 LAX is on its way")).toBeVisible();
  await expect(page.getByText(/^0x[0-9a-f]{64}$/)).toBeVisible();

  // Done returns to the overview, where the balance has dropped by the amount and the fee
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("999,987.49", { exact: false }).first()).toBeVisible();

  await expect.poll(() => balance(page, OTHER.address)).toBe((125n * LAX) / 10n);
  const left = await balance(page, FUNDED.address);
  expect(left).toBeLessThan(1_000_000n * LAX - (125n * LAX) / 10n);
  expect(left).toBeGreaterThan(1_000_000n * LAX - 13n * LAX);
});

test("refuses a recipient that isn't an address, and says so of the account itself", async ({ page }) => {
  await openSend(page);
  const review = page.getByRole("button", { name: "Review" });

  await fillSend(page, "0x1234", "1");
  await expect(page.getByText("Not a valid address.")).toBeVisible();
  await expect(review).toBeDisabled();

  // One character's case off: the node refuses it for its checksum
  await fillSend(page, OTHER.address.replace("2B5A", "2b5A"), "1");
  await review.click();
  await expect(page.getByText("Couldn't review this send")).toBeVisible();
  await expect(page.getByText("This address fails its checksum: a character is likely wrong.")).toBeVisible();

  // Its own address goes through, with the review saying only the fee is spent
  await fillSend(page, FUNDED.address, "1");
  await expect(page.getByText("This is your own account “Main”.")).toBeVisible();
  await review.click();
  await expect(page.getByText("Sending to this same account")).toBeVisible();
  await expect(page.getByText("This sends to the same account: only the fee is spent.")).toBeVisible();
});

test("refuses an amount that isn't one, nothing, and more than the balance", async ({ page }) => {
  await openSend(page);
  const review = page.getByRole("button", { name: "Review" });

  await fillSend(page, OTHER.address, "abc");
  await expect(page.getByText("Not a valid amount.")).toBeVisible();
  await expect(review).toBeDisabled();

  await fillSend(page, OTHER.address, "0");
  await expect(review).toBeDisabled();

  // More than there is: the review says so and won't sign
  await fillSend(page, OTHER.address, "2000000");
  await review.click();
  await expect(page.getByText("Not enough LAX")).toBeVisible();
  await expect(page.getByText("The balance doesn't cover the amount and the fee.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and send" })).toBeDisabled();

  // Back keeps what was typed
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Amount")).toHaveValue("2000000");
});

test("Max fills in all the balance can send after the fee", async ({ page }) => {
  await openSend(page);
  await fillSend(page, OTHER.address, "");
  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByLabel("Amount")).toHaveValue(/^999999\.99/);

  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.locator("dl")).toContainText("Total1000000 LAX");
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();

  // Everything went: the account is left empty
  await expect.poll(() => balance(page, FUNDED.address)).toBe(0n);
});

test("a custom fee is what the review signs, and a dear one is warned of", async ({ page }) => {
  await openSend(page);
  await fillSend(page, OTHER.address, "1");

  const fee = page.getByRole("radiogroup", { name: "Network fee" });
  await expect(fee.getByRole("radio", { name: "Suggested" })).toHaveAttribute("aria-checked", "true");
  await fee.getByRole("radio", { name: "Custom" }).click();
  await expect(page.getByLabel("Gas price")).toBeFocused();

  // Custom with no price can't be reviewed
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await page.getByLabel("Gas price").fill("5");
  await page.getByRole("button", { name: "Review" }).click();

  await expect(page.locator("dl")).toContainText("21,000 gas at 5 gwei");
  await expect(page.getByText("High fee")).toBeVisible();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();

  // The fee paid is the price chosen: 21,000 gas at 5 gwei
  await expect.poll(() => balance(page, OTHER.address)).toBe(LAX);
  expect(await balance(page, FUNDED.address)).toBe(1_000_000n * LAX - LAX - 21_000n * 5n * 10n ** 9n);
});

test("picks a contact by name, and the review names them", async ({ page }) => {
  await call(page, "ContactAdd", { name: "Alice", address: OTHER.address, note: "" });
  // The contacts are read as the window opens
  await page.reload();
  await openSend(page);

  const recipient = page.getByRole("combobox", { name: "To" });
  await recipient.click();
  await recipient.fill("ali");
  await page.getByRole("option", { name: /Alice/ }).click();
  await expect(page.getByText("Sending to Alice")).toBeVisible();

  await page.getByLabel("Amount").fill("3");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Alice", { exact: true })).toBeVisible();
  await expect(page.getByText("Contact", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();
  await expect(page.locator("dl")).toContainText("Alice");

  // Sent to, the contact is noted as such
  await expect
    .poll(async () => (await call<{ lastSentAt: number }[]>(page, "Contacts"))[0].lastSentAt)
    .toBeGreaterThan(0);
});

test("offers the wallet's other accounts, and the review says it's one", async ({ page }) => {
  // Imported, an account is the one selected: Main sends again
  await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
  await call(page, "WalletSelect", FUNDED.address);
  await page.reload();
  await openSend(page);

  const recipient = page.getByRole("combobox", { name: "To" });
  await recipient.click();
  await page.getByRole("radio", { name: "My accounts" }).click();
  await page.getByRole("option", { name: /Savings/ }).click();
  await expect(page.getByText("This is your own account “Savings”.")).toBeVisible();

  await page.getByLabel("Amount").fill("2");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Your account", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expect(page.getByRole("heading", { name: "Sent" })).toBeVisible();
  await expect.poll(() => balance(page, OTHER.address)).toBe(2n * LAX);
});

test("waits for the node: stopped, Send says to connect and keeps what's typed", async ({ page }) => {
  await openSend(page);
  await fillSend(page, OTHER.address, "1");
  await call(page, "StopNode");

  await expect(page.getByText("Sending goes through your node.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await expect(page.getByLabel("Amount")).toHaveValue("1");
});

test("a waiting send can be sped up, then canceled, and the cancel is what's mined", async ({ page }) => {
  // Blocks held: what's sent waits in the pool
  await call(page, "DevSetHold", true);
  await sendViaUi(page, OTHER.address, "7");

  await goTo(page, "History");
  await expect(page.getByText("Waiting for a block")).toBeVisible();
  await expect(page.getByText("Unconfirmed")).toBeVisible();

  await page.getByRole("button", { name: "Speed up" }).click();
  const speedUp = page.getByRole("dialog", { name: "Speed up this transaction" });
  await expect(speedUp).toContainText("Nonce 0");
  await speedUp.getByRole("button", { name: "Speed up" }).click();
  await expect(speedUp).toBeHidden();

  await page.getByRole("button", { name: "Cancel" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancel this transaction" });
  await cancel.getByRole("button", { name: "Cancel transaction" }).click();
  await expect(cancel).toBeHidden();
  await expect(page.getByText("Canceling")).toBeVisible();

  // Let go, the cancel is sealed: nothing reaches the recipient
  await call(page, "DevSetHold", false);
  await expect(page.getByText("Canceled")).toBeVisible();
  await expect(page.getByText("Waiting for a block")).toBeHidden();
  expect(await balance(page, OTHER.address)).toBe(0n);
});
