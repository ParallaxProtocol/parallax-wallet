import fs from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, call, answerDialogs, unlockForm, FUNDED, OTHER, PASSWORD } from "../fixtures";
import { accountRow, answerQuiz, dialog, openSettings, revealedWords, rowAction } from "./helpers/accounts";

// Settings' Accounts section: the accounts the wallet holds, grouped by
// what keeps their keys, and the pages that add them

/** A recovery phrase whose first standard account is known (the one test tools use). */
const PHRASE = "test test test test test test test test test test test junk";
const PHRASE_FIRST = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const PHRASE_SECOND = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

type Info = {
  accounts: { address: string; name: string; backedUp: boolean; fromSeed: boolean; watchOnly: boolean }[];
  seeds: { id: string; name: string; confirmed: boolean; accounts: number }[];
};
const walletInfo = (page: Page) => call<Info>(page, "WalletInfo");

/** Lets the window read the wallet again after a setup made behind its back (it would on its next poll). */
async function reread(page: Page) {
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}
const lower = (s: string) => s.toLowerCase();

test.describe("adding accounts", () => {
  test("a new single key, its backup saved as it's made", async ({ page, app }, testInfo) => {
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Create accounts" }).click();
    await page.getByRole("button", { name: /^New single key/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Account created")).toBeVisible();

    const file = testInfo.outputPath("account-2.json");
    await answerDialogs(app, file);
    await page.getByRole("button", { name: "Save backup", exact: true }).click();
    await expect(page.getByText("Backup saved")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    // Back in the list, under the single keys, backed up
    await expect(page.getByRole("heading", { name: "Accounts", level: 2 })).toBeVisible();
    const row = accountRow(page, "Account 2");
    await expect(row).toBeVisible();
    await expect(row.getByText("No backup")).toHaveCount(0);
    const made = (await walletInfo(page)).accounts.find((a) => a.name === "Account 2")!;
    const keyfile = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(lower(keyfile.address)).toBe(lower(made.address).slice(2));
    expect(keyfile.crypto ?? keyfile.Crypto).toBeTruthy();
  });

  test("a new recovery phrase, its words typed back", async ({ page }) => {
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Create accounts" }).click();
    await page.getByRole("button", { name: /^New recovery phrase/ }).click();
    await page.getByRole("switch", { name: "Use 12 words instead" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    const words = await revealedWords(page.locator("body"));
    expect(words).toHaveLength(12);
    await page.getByRole("button", { name: "I've written it down" }).click();
    // A wrong word holds the step back
    const confirm = page.getByRole("button", { name: "Confirm", exact: true });
    await expect(confirm).toBeDisabled();
    await answerQuiz(page.locator("body"), words);
    await confirm.click();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Recovery phrases" })).toBeVisible();
    await expect(page.getByText("Confirmed · 1 account")).toBeVisible();
    await expect(accountRow(page, "Account 2")).toBeVisible();
    const seeds = (await walletInfo(page)).seeds;
    expect(seeds).toHaveLength(1);
    expect(seeds[0].confirmed).toBe(true);
  });

  test("a recovery phrase, picking which of its accounts come in", async ({ page }) => {
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Import accounts" }).click();
    await page.getByRole("button", { name: /^Import a recovery phrase/ }).click();
    const continueButton = page.getByRole("button", { name: "Continue" });
    // Not a phrase's length yet
    await page.getByLabel("Recovery phrase", { exact: true }).fill("test test test");
    await expect(continueButton).toBeDisabled();
    await page.getByLabel("Recovery phrase", { exact: true }).fill(PHRASE);
    await expect(page.getByText("12 words")).toBeVisible();
    await continueButton.click();

    // The first account is offered picked; the second is picked here too
    await expect(page.getByRole("heading", { name: "Choose accounts" })).toBeVisible();
    const boxes = page.getByRole("checkbox");
    await expect(boxes.first()).toBeChecked();
    await expect(page.getByText("m/44'/60'/0'/0/1")).toBeVisible();
    await boxes.nth(1).check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Recovery phrases" })).toBeVisible();
    await expect(page.getByText("Confirmed · 2 accounts")).toBeVisible();
    const addresses = (await walletInfo(page)).accounts.filter((a) => a.fromSeed).map((a) => lower(a.address));
    expect(addresses.sort()).toEqual([lower(PHRASE_FIRST), lower(PHRASE_SECOND)].sort());

    // Finding more of it ticks off those it has
    await page.getByRole("button", { name: "Find accounts" }).click();
    await expect(page.getByText("Already in the wallet")).toHaveCount(2);
  });

  test("a private key, after one that isn't", async ({ page }) => {
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Import accounts" }).click();
    await page.getByRole("button", { name: /^Import a key/ }).click();
    await page.getByRole("radio", { name: "Private key" }).click();
    const key = page.getByLabel("Private key", { exact: true });
    const importButton = page.getByRole("button", { name: "Import", exact: true });

    await key.fill("0x1234");
    await expect(page.getByText("Not a valid private key.")).toBeVisible();
    await expect(importButton).toBeDisabled();

    // One the wallet has already
    await key.fill(FUNDED.key);
    await importButton.click();
    await expect(page.getByText("This account is already in the wallet.")).toBeVisible();

    await key.fill(OTHER.key);
    await importButton.click();
    await expect(page.getByRole("heading", { name: "Single keys" })).toBeVisible();
    await expect(accountRow(page, "Account 2")).toBeVisible();
    const accounts = (await walletInfo(page)).accounts.map((a) => lower(a.address));
    expect(accounts).toContain(lower(OTHER.address));
  });

  test("a keystore file, opened with its own password", async ({ page }, testInfo) => {
    // A keystore file of OTHER's, as a backup of it saved elsewhere would be
    await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
    const backup = await call<{ fileName: string; keyfile: string }>(page, "WalletBackup", OTHER.address);
    await call(page, "WalletRemove", OTHER.address, PASSWORD);
    const file = testInfo.outputPath(backup.fileName);
    fs.writeFileSync(file, backup.keyfile);

    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Import accounts" }).click();
    await page.getByRole("button", { name: /^Import a key/ }).click();
    await expect(page.getByRole("radio", { name: "Keystore file" })).toBeChecked();
    await page.getByLabel("File", { exact: true }).setInputFiles(file);
    await expect(page.getByText(backup.fileName)).toBeVisible();

    const importButton = page.getByRole("button", { name: "Import", exact: true });
    await page.getByLabel("File password").fill("not the password");
    await importButton.click();
    await expect(page.getByRole("alert")).toHaveText("Wrong password for the keystore file.");

    await page.getByLabel("File password").fill(PASSWORD);
    await importButton.click();
    await expect(page.getByRole("heading", { name: "Single keys" })).toBeVisible();
    const accounts = (await walletInfo(page)).accounts.map((a) => lower(a.address));
    expect(accounts).toContain(lower(OTHER.address));
  });

  test("a keystore file that isn't one", async ({ page }, testInfo) => {
    const file = testInfo.outputPath("notes.txt");
    fs.writeFileSync(file, "not a keystore");
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Import accounts" }).click();
    await page.getByRole("button", { name: /^Import a key/ }).click();
    await page.getByLabel("File", { exact: true }).setInputFiles(file);
    await expect(page.getByText("Not a valid keystore file.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  });

  test("a watch-only address, then stopped watching", async ({ page }) => {
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Import accounts" }).click();
    await page.getByRole("button", { name: /^Watch an address/ }).click();
    const address = page.getByLabel("Address", { exact: true });
    const add = page.getByRole("button", { name: "Add account" });

    await address.fill("0x1234");
    await expect(page.getByText("Not a valid address.")).toBeVisible();
    await expect(add).toBeDisabled();
    await address.fill(OTHER.address);
    await add.click();

    await expect(page.getByRole("heading", { name: "Watch-only" })).toBeVisible();
    await expect(accountRow(page, "Account 2")).toBeVisible();
    // Nothing to back up: its key is elsewhere
    await expect(accountRow(page, "Account 2").getByRole("button", { name: "Save backup" })).toHaveCount(0);

    await rowAction(page, "Account 2", "Remove account");
    const remove = dialog(page, "Remove watch-only account");
    await remove.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(remove).toBeHidden();
    await expect(page.getByRole("heading", { name: "Watch-only" })).toHaveCount(0);
    expect((await walletInfo(page)).accounts.map((a) => lower(a.address))).not.toContain(lower(OTHER.address));
  });

  test("a hardware wallet, with none connected", async ({ page }) => {
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Import accounts" }).click();
    await page.getByRole("button", { name: /^Connect a hardware wallet/ }).click();
    await expect(page.getByRole("heading", { name: "Connect a hardware wallet", level: 3 })).toBeAttached();
    await expect(page.getByText("Connect your Ledger or Trezor")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    // Back comes to the choice of where accounts come from
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Import a recovery phrase/ })).toBeVisible();
  });
});

test.describe("an account's actions", () => {
  test("renamed in place, and picked as the one the app shows", async ({ page }) => {
    await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
    await reread(page);
    await openSettings(page, "Accounts");

    await rowAction(page, FUNDED.name, "Rename");
    const name = page.getByRole("textbox", { name: "Name" });
    await name.fill("Spending");
    await name.press("Enter");
    await expect(accountRow(page, "Spending")).toBeVisible();
    // A rename Cancelled leaves the name as it was
    await rowAction(page, OTHER.name, "Rename");
    await page.getByRole("textbox", { name: "Name" }).fill("Never kept");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(accountRow(page, OTHER.name)).toBeVisible();
    expect((await walletInfo(page)).accounts.map((a) => a.name).sort()).toEqual(["Savings", "Spending"]);

    const show = page.getByRole("button", { name: `Show ${OTHER.name}`, exact: true });
    await show.click();
    await expect(show).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Show Spending", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect
      .poll(async () => lower((await call<{ selected: string }>(page, "WalletInfo")).selected))
      .toBe(lower(OTHER.address));
  });

  test("backed up to a keystore file, a cancelled save changing nothing", async ({ page, app }, testInfo) => {
    // A key made here has no backup (an imported one is kept elsewhere already)
    const made = await call<{ address: string }>(page, "WalletCreate", "Fresh");
    await reread(page);
    await openSettings(page, "Accounts");
    const row = accountRow(page, "Fresh");
    await expect(row.getByText("No backup")).toBeVisible();

    await answerDialogs(app, null);
    await row.getByRole("button", { name: "Save backup", exact: true }).click();
    const backup = dialog(page, "Back up account");
    await backup.getByRole("button", { name: "Save backup" }).click();
    // Cancelled: the dialog stays, the account still has no backup
    await expect(backup.getByRole("button", { name: "Save backup" })).toBeEnabled();
    await expect(backup.getByText("Backup saved")).toHaveCount(0);

    const file = testInfo.outputPath("fresh.json");
    await answerDialogs(app, file);
    await backup.getByRole("button", { name: "Save backup" }).click();
    await expect(backup.getByText("Backup saved")).toBeVisible();
    await backup.getByRole("button", { name: "Done" }).click();
    await expect(backup).toBeHidden();
    await expect(row.getByText("No backup")).toHaveCount(0);

    const keyfile = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(lower(keyfile.address)).toBe(lower(made.address).slice(2));
    expect((await walletInfo(page)).accounts.find((a) => a.name === "Fresh")?.backedUp).toBe(true);
  });

  test("removed with the password, once its loss is acknowledged", async ({ page }) => {
    await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
    await reread(page);
    await openSettings(page, "Accounts");
    await rowAction(page, OTHER.name, "Remove account");
    const remove = dialog(page, "Remove account");
    const submit = remove.getByRole("button", { name: "Remove from this computer" });
    const password = remove.getByLabel("Wallet password");

    // The password opens only once the loss is acknowledged
    await expect(password).toBeDisabled();
    await expect(submit).toBeDisabled();
    await remove.getByRole("checkbox", { name: /I understand/ }).click();
    await password.fill("not the password");
    await submit.click();
    await expect(remove.getByText("Wrong password.")).toBeVisible();

    await password.fill(PASSWORD);
    await submit.click();
    await expect(remove).toBeHidden();
    await expect(accountRow(page, OTHER.name)).toHaveCount(0);
    expect((await walletInfo(page)).accounts.map((a) => lower(a.address))).toEqual([lower(FUNDED.address)]);
  });
});

test.describe("a recovery phrase's actions", () => {
  test("left for later, then shown with the password and confirmed", async ({ page }) => {
    await openSettings(page, "Accounts");
    await page.getByRole("button", { name: "Create accounts" }).click();
    await page.getByRole("button", { name: /^New recovery phrase/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "I'll do it later" }).click();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Not confirmed yet · 1 account")).toBeVisible();

    await page.getByRole("button", { name: "Show and confirm", exact: true }).click();
    const reveal = dialog(page, "Show recovery phrase");
    await reveal.getByLabel("Wallet password").fill("not the password");
    await reveal.getByRole("button", { name: "Show", exact: true }).click();
    await expect(reveal.getByText("Wrong password.")).toBeVisible();
    await reveal.getByLabel("Wallet password").fill(PASSWORD);
    await reveal.getByRole("button", { name: "Show", exact: true }).click();

    const words = await revealedWords(reveal);
    expect(words).toHaveLength(24);
    await reveal.getByRole("button", { name: "I've written it down" }).click();
    await answerQuiz(reveal, words);
    await reveal.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(reveal.getByText("Recovery phrase confirmed")).toBeVisible();
    await reveal.getByRole("button", { name: "Done" }).click();

    await expect(page.getByText("Confirmed · 1 account")).toBeVisible();
    expect((await walletInfo(page)).seeds[0].confirmed).toBe(true);
  });

  test("gives another account, then is renamed and removed with its accounts", async ({ page }) => {
    await call(page, "WalletCreateSeedWords", "Account 2", PHRASE, "", true);
    await reread(page);
    await openSettings(page, "Accounts");
    await expect(page.getByText("Confirmed · 1 account")).toBeVisible();

    await page.getByRole("button", { name: "New account from this phrase" }).click();
    const derive = dialog(page, "New account");
    await derive.getByRole("button", { name: "Create account" }).click();
    await expect(derive).toBeHidden();
    await expect(page.getByText("Confirmed · 2 accounts")).toBeVisible();
    expect((await walletInfo(page)).accounts.filter((a) => a.fromSeed).map((a) => lower(a.address))).toContain(
      lower(PHRASE_SECOND),
    );

    // The phrase's own row heads its group, before its accounts: pointing at
    // its name opens its actions, its Rename the first of the list's
    const seedName = (await walletInfo(page)).seeds[0].name;
    await page.getByText(seedName, { exact: true }).hover();
    await page.getByRole("button", { name: "Rename", exact: true }).first().click();
    const name = page.getByRole("textbox", { name: "Name" });
    await name.fill("Test phrase");
    await name.press("Enter");
    await expect(page.getByText("Test phrase", { exact: true })).toBeVisible();

    await page.getByText("Test phrase", { exact: true }).hover();
    await page.getByRole("button", { name: "Remove recovery phrase" }).click();
    const remove = dialog(page, "Remove recovery phrase");
    await remove.getByRole("checkbox", { name: /I understand/ }).click();
    await remove.getByLabel("Wallet password").fill(PASSWORD);
    await remove.getByRole("button", { name: "Remove phrase and accounts" }).click();
    await expect(remove).toBeHidden();
    await expect(page.getByRole("heading", { name: "Recovery phrases" })).toHaveCount(0);
    const info = await walletInfo(page);
    expect(info.seeds).toHaveLength(0);
    expect(info.accounts.map((a) => lower(a.address))).toEqual([lower(FUNDED.address)]);
  });
});

test.describe("wallet security", () => {
  const NEW_PASSWORD = "a different passphrase";

  test("the password changed, after a wrong one and a short one, then unlocking with it", async ({ page }) => {
    await openSettings(page, "Security");
    await page.getByRole("button", { name: "Change password" }).click();
    const change = dialog(page, "Change password");
    const submit = change.getByRole("button", { name: "Change password" });
    const current = change.getByLabel("Current password");
    const next = change.getByLabel("Password", { exact: true });
    const again = change.getByLabel("Confirm password");

    await current.fill(PASSWORD);
    await next.fill("short");
    await expect(change.getByText("The password must be at least 8 characters.")).toBeVisible();
    await expect(submit).toBeDisabled();
    await next.fill(NEW_PASSWORD);
    await again.fill(NEW_PASSWORD + "!");
    await expect(change.getByText("The passwords don't match")).toBeVisible();
    await expect(submit).toBeDisabled();
    await again.fill(NEW_PASSWORD);

    await current.fill("not the password");
    await submit.click();
    await expect(change.getByText("Wrong password.")).toBeVisible();

    // Back from the check, everything typed is kept: only the current password is put right
    await expect(current).toHaveValue("not the password");
    await expect(next).toHaveValue(NEW_PASSWORD);
    await expect(again).toHaveValue(NEW_PASSWORD);
    await current.fill(PASSWORD);
    await submit.click();
    await expect(change).toBeHidden();

    // Locked, only the new password opens it again
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Lock wallet" }).click();
    // Locked by hand, the lock screen shows the name alone; the field comes out at the first key typed
    await expect(page.getByRole("button", { name: "Lock wallet" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Parallax Wallet", level: 1 })).toBeVisible();
    const unlock = await unlockForm(page);
    await unlock.fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("alert")).toHaveText("Wrong password.");
    await unlock.fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect((await call<{ locked: boolean }>(page, "WalletInfo")).locked).toBe(false);
  });

  test("how long the wallet stays unlocked, saved as it's picked", async ({ page }) => {
    await openSettings(page, "Security");
    const autoLock = page.getByRole("button", { name: "Lock automatically" });
    // 15 minutes unless set
    await expect(autoLock).toHaveText(/After 15 minutes/);
    await autoLock.click();
    await page.getByRole("option", { name: "After 5 minutes" }).click();
    await expect(autoLock).toHaveText(/After 5 minutes/);
    await expect.poll(async () => (await call<{ autoLockMinutes: number }>(page, "GetConfig")).autoLockMinutes).toBe(5);

    await autoLock.click();
    await page.getByRole("option", { name: "Never" }).click();
    await expect
      .poll(async () => (await call<{ autoLockMinutes: number }>(page, "GetConfig")).autoLockMinutes)
      .toBe(-1);
  });

  test("the wallet's data deleted, the word typed and the password given, back to first-run", async ({
    page,
    app,
    home,
  }) => {
    // The wipe restarts the app: kept running here instead, to see what it comes back to
    await app.evaluate(({ app }) => {
      const g = globalThis as { quitAsked?: boolean; realQuit?: () => void };
      g.realQuit = app.quit.bind(app);
      app.quit = () => {
        g.quitAsked = true;
      };
      app.relaunch = () => {};
    });
    try {
      await openSettings(page, "Storage");
      // The wallet's is the last Delete, in the danger zone at the section's foot
      await page.getByRole("button", { name: "Delete", exact: true }).last().click();
      const wipe = dialog(page, "Delete wallet data");
      const submit = wipe.getByRole("button", { name: "Delete wallet data" });
      const password = wipe.getByLabel("Wallet password");

      // The password opens once the word is typed
      await expect(password).toBeDisabled();
      await wipe.getByLabel("Type DELETE to confirm").fill("delete it");
      await expect(password).toBeDisabled();
      await wipe.getByLabel("Type DELETE to confirm").fill("DELETE");
      await password.fill("not the password");
      await submit.click();
      await expect(wipe.getByText("Wrong password.")).toBeVisible();
      expect((await walletInfo(page)).accounts).toHaveLength(1);

      await password.fill(PASSWORD);
      await submit.click();
      // The dialog stays, saying the app restarts, and the app asks to restart
      await expect(wipe.getByText("Restarting…").first()).toBeVisible();
      await expect.poll(() => app.evaluate(() => !!(globalThis as { quitAsked?: boolean }).quitAsked)).toBe(true);
      await expect(wipe).toBeVisible();

      const info = await call<{ accounts: unknown[]; hasPassword: boolean }>(page, "WalletInfo");
      expect(info.accounts).toHaveLength(0);
      expect(info.hasPassword).toBe(false);
      expect(fs.readdirSync(`${home}/.config/Parallax/keystore`).filter((f) => !f.startsWith("."))).toEqual([]);

      // Started again, the app asks for a new password, as on a first launch
      await page.reload();
      await expect(page.getByText("Set a wallet password to start using your wallet.")).toBeVisible();
    } finally {
      // Quitting works again for the fixture to close the app (still without starting another)
      await app.evaluate(({ app }) => {
        const g = globalThis as { realQuit?: () => void };
        if (g.realQuit) app.quit = g.realQuit;
      });
    }
  });
});
