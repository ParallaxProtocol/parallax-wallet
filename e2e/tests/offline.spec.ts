import fs from "node:fs";
import { test, expect, call, answerDialogs, goTo, nodeRunning, unlockForm, FUNDED, OTHER, PASSWORD } from "../fixtures";
import { launchSigner, openFile, setClipboard } from "./helpers/offline";
import type { Page } from "@playwright/test";

// The offline signer: an app that holds keys and never goes online, and a
// wallet online that follows its accounts as watch-only. What travels
// between them is carried here as files; scanning QR codes needs a camera,
// which the tests haven't.

/** Adds `address` as a watch-only account from Settings › Accounts, which selects it. */
async function addWatchOnly(page: Page, address: string) {
  await page.getByRole("button", { name: FUNDED.name, exact: true }).click();
  await page.getByRole("button", { name: "Manage accounts…" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Import accounts" }).click();
  await settings.getByRole("button", { name: /^Watch an address/ }).click();
  await settings.getByRole("textbox", { name: "Address" }).fill(address);
  await settings.getByRole("button", { name: "Add account" }).click();
  await expect(settings.getByRole("heading", { name: "Watch-only 1" })).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
}

/** Makes a signing request on the Send page for `amount` LAX to FUNDED, and returns its fingerprint. */
async function makeRequest(page: Page, amount: string) {
  await goTo(page, "Send");
  const main = page.getByRole("main");
  await main.getByRole("textbox", { name: "Amount" }).fill(amount);
  await main.getByRole("combobox", { name: "To" }).fill(FUNDED.address);
  await main.getByRole("button", { name: "Review" }).click();
  await main.getByRole("button", { name: "Create signing request" }).click();
  await expect(main.getByRole("heading", { name: "Sign this on your offline signer" })).toBeVisible();
  return main.getByText(/^[0-9A-F]{4}-[0-9A-F]{4}$/).innerText();
}

test.describe("online and offline", () => {
  // The chain funds the account only the signer holds the key of
  test.use({ config: { devFundAddress: OTHER.address } });

  test("a transfer goes from a watch-only wallet to the signer and back, and confirms", async ({ app, page }, info) => {
    const signer = await launchSigner(OTHER.name, OTHER.key);
    try {
      await nodeRunning(page);
      await addWatchOnly(page, OTHER.address);
      // The watch-only account sends by signing request, and is broadcast from its own page
      await expect(page.getByRole("link", { name: "Broadcast" })).toBeVisible();

      // Online: the request, saved as a file to carry over
      const fingerprint = await makeRequest(page, "5");
      const request = info.outputPath("request.json");
      await answerDialogs(app, request);
      await page.getByRole("main").getByRole("button", { name: "Save file…" }).click();
      await expect(page.getByRole("main").getByRole("button", { name: "Saved" })).toBeVisible();

      // Offline: the request opened, checked and signed
      const s = signer.page;
      await s.getByRole("link", { name: "Scan a signing request" }).click();
      await openFile(s, request);
      const review = s.getByRole("main");
      await expect(review.getByText("Compare before you sign")).toBeVisible();
      await expect(review.getByText(fingerprint)).toBeVisible();
      await expect(review.getByText("5", { exact: true })).toBeVisible();
      await expect(review.getByText("Development chain")).toBeVisible();
      await review.getByRole("button", { name: "Sign", exact: true }).click();
      await expect(review.getByRole("heading", { name: "Signed" })).toBeVisible();
      const signed = info.outputPath("signed.json");
      await answerDialogs(signer.app, signed);
      await review.getByRole("button", { name: "Save file…" }).click();
      await expect(review.getByRole("button", { name: "Saved" })).toBeVisible();

      // Opening the same request again says it was signed here before
      await review.getByRole("button", { name: "Sign another" }).click();
      await openFile(s, request);
      await expect(review.getByText("Signed here before", { exact: true })).toBeVisible();

      // Online: the signed transaction matched to its request and broadcast
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "Scan signed transaction" }).click();
      await openFile(page, signed);
      await expect(main.getByText("This answers your signing request")).toBeVisible();
      await main.getByRole("button", { name: "Broadcast", exact: true }).click();
      await expect(main.getByRole("heading", { name: "Broadcast" })).toBeVisible();

      // The development chain seals it at once: FUNDED has the 5 LAX
      await expect
        .poll(async () => (await call<Record<string, string>>(page, "WalletBalances"))[FUNDED.address])
        .toBe("5000000000000000000");
      await main.getByRole("button", { name: "Done" }).click();
      await expect(
        page
          .getByRole("main")
          .getByText(/^999,994\.99/)
          .first(),
      ).toBeVisible();
    } finally {
      await signer.close();
    }
  });

  test("the signer refuses a request it can't sign", async ({ app, page }, info) => {
    // A signer that holds FUNDED, not the watch-only account the request is from
    const signer = await launchSigner(FUNDED.name, FUNDED.key);
    try {
      await nodeRunning(page);
      await addWatchOnly(page, OTHER.address);
      await makeRequest(page, "1");
      const request = info.outputPath("request.json");
      await answerDialogs(app, request);
      await page.getByRole("main").getByRole("button", { name: "Save file…" }).click();
      await expect(page.getByRole("main").getByRole("button", { name: "Saved" })).toBeVisible();

      const s = signer.page;
      await s.getByRole("link", { name: "Scan a signing request" }).click();

      // What isn't a signing request is turned away before the signer looks at it
      const junk = info.outputPath("junk.json");
      fs.writeFileSync(junk, "{ not a request");
      await openFile(s, junk);
      await expect(s.getByText("That isn't a signing request. Scan the code your online wallet shows.")).toBeVisible();

      // A request from an account whose key isn't here, pasted as copied from the wallet online
      await setClipboard(signer.app, fs.readFileSync(request, "utf8"));
      await s.getByRole("button", { name: "Paste" }).click();
      await expect(s.getByText("That code can't be used")).toBeVisible();
      await expect(s.getByText("This signer doesn't hold the key for that account.")).toBeVisible();

      // A request changed after it was made no longer matches its fingerprint
      const doc = JSON.parse(fs.readFileSync(request, "utf8"));
      const tampered = info.outputPath("tampered.json");
      fs.writeFileSync(tampered, JSON.stringify({ ...doc, valueWei: "2" + doc.valueWei }));
      await openFile(s, tampered);
      await expect(s.getByText(/doesn't match its fingerprint/)).toBeVisible();
      // Still on the first step: nothing was taken to review
      await expect(s.getByRole("heading", { name: "Scan a signing request" })).toBeVisible();
    } finally {
      await signer.close();
    }
  });

  test("Broadcast refuses what isn't a signed transaction", async ({ app, page }, info) => {
    await nodeRunning(page);
    await addWatchOnly(page, OTHER.address);
    await goTo(page, "Broadcast");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Scan the signed transaction" })).toBeVisible();

    // A signing request is the other half of the trip
    await makeRequest(page, "1");
    const request = info.outputPath("request.json");
    await answerDialogs(app, request);
    await main.getByRole("button", { name: "Save file…" }).click();
    await expect(main.getByRole("button", { name: "Saved" })).toBeVisible();
    await goTo(page, "Broadcast");
    await openFile(page, request);
    await expect(main.getByRole("alert")).toHaveText(
      "That isn't a signed transaction. Scan the code your offline signer shows.",
    );

    // Raw bytes shaped like a transaction, that aren't one
    await setClipboard(app, "0x" + "ab".repeat(60));
    await main.getByRole("button", { name: "Paste" }).click();
    await expect(main.getByText("That code can't be used")).toBeVisible();
    await expect(main.getByRole("heading", { name: "Scan the signed transaction" })).toBeVisible();
  });
});

test.describe("signer mode", () => {
  test("Settings turns the offline signer on, which stops the node, and off again", async ({ page }) => {
    await nodeRunning(page);
    await goTo(page, "Settings");
    const settings = page.getByRole("region", { name: "Settings" });
    const toggle = settings.getByRole("switch", { name: "Offline signer" });
    await toggle.click();
    // Taking the node down waits for Save, as a decision does
    await expect(settings.getByText("Unsaved changes")).toBeVisible();
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(toggle).toBeChecked();
    await expect.poll(async () => (await call<{ running: boolean }>(page, "NodeStatus")).running).toBe(false);
    await settings.getByRole("button", { name: "Close" }).click();

    // The app as a signer: its own home and pages, no node, nothing sent from here
    await expect(page.getByRole("region", { name: "Offline signer" })).toContainText(
      "This app never goes online: no node, no update checks.",
    );
    await expect(page.getByRole("heading", { name: "This computer signs offline" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Signer" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign", exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: FUNDED.name });
    await expect(nav.getByRole("link", { name: "Send", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Network" })).toHaveCount(0);
    expect((await call<{ offlineSigner: boolean; autoStartNode: boolean }>(page, "GetConfig")).autoStartNode).toBe(
      false,
    );

    // And back to a wallet online
    await goTo(page, "Settings");
    await toggle.click();
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(toggle).not.toBeChecked();
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("region", { name: "Offline signer" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Send", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Network" })).toBeVisible();
  });

  test.describe("started as a signer", () => {
    test.use({ config: { offlineSigner: true, autoStartNode: false } });

    test("shows its accounts to follow as watch-only, and locks", async ({ page }) => {
      await expect(page.getByRole("heading", { name: "This computer signs offline" })).toBeVisible();
      expect((await call<{ running: boolean }>(page, "NodeStatus")).running).toBe(false);

      // Each account's address, as the code a wallet online scans
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Accounts 1" })).toBeVisible();
      await main.getByRole("button", { name: "Show for watch-only" }).click();
      const shown = page.getByRole("dialog", { name: "Show for watch-only" });
      await expect(shown.getByRole("img", { name: "QR code of the address" })).toBeVisible();
      await expect(shown).toContainText(FUNDED.address.slice(2, 6));
      await page.keyboard.press("Escape");
      await expect(shown).toHaveCount(0);

      // Locked, it signs nothing until the password is given
      await page.getByRole("button", { name: "Lock wallet" }).click();
      // Locked by hand, the first key typed brings its form in
      const password = await unlockForm(page);
      await password.fill("not the password");
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page.getByText("Wrong password.")).toBeVisible();
      await password.fill(PASSWORD);
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page.getByRole("heading", { name: "This computer signs offline" })).toBeVisible();
    });
  });
});
