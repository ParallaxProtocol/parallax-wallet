import fs from "node:fs";
import path from "node:path";
import { test, expect, answerDialogs, call, nodeRunning, PASSWORD, configDir } from "../fixtures";
import { config, openSettings, row, savedAs, sheet } from "./helpers/settings";

test("Storage shows where the wallet and the node keep their data", async ({ page, home }) => {
  await openSettings(page, "Storage");
  const folder = row(sheet(page), "Wallet folder");
  await expect(folder).toContainText(configDir(home));
  await expect(
    sheet(page).getByRole("button", { name: `Data directory: ${path.join(home, ".parallax")}` }),
  ).toBeVisible();
  // In Storage the node's finer options are all in view, with its move and delete
  await expect(row(sheet(page), "Ancient data directory")).toBeVisible();
  await expect(row(sheet(page), "Move data").getByRole("button", { name: "Move" })).toBeVisible();
  await expect(row(sheet(page), "Delete chain data").getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(sheet(page).getByRole("heading", { level: 3, name: "Danger zone" })).toBeVisible();
});

test("the node's data moves to a folder picked, and the data directory says where", async ({ app, page, home }) => {
  await nodeRunning(page);
  const to = path.join(home, "moved");
  fs.mkdirSync(to);
  await answerDialogs(app, to);

  await openSettings(page, "Storage");
  await row(sheet(page), "Move data").getByRole("button", { name: "Move" }).click();
  const dialog = page.getByRole("dialog", { name: "Move the node's data" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(to, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  await savedAs(page, "dataDir", to);
  await expect(sheet(page).getByRole("button", { name: `Data directory: ${to}` })).toBeVisible();
});

test("a cancelled folder pick moves nothing", async ({ app, page, home }) => {
  await answerDialogs(app, null);
  await openSettings(page, "Storage");
  await row(sheet(page), "Move data").getByRole("button", { name: "Move" }).click();
  await row(sheet(page), "Move wallet").getByRole("button", { name: "Move" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await config(page)).dataDir).toBe(path.join(home, ".parallax"));
});

test("the chain data is deleted once confirmed, and the node runs again", async ({ page }) => {
  await nodeRunning(page);
  await openSettings(page, "Storage");
  await row(sheet(page), "Delete chain data").getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete the chain data" });
  await expect(dialog).toBeVisible();

  // Cancelled first: nothing happens
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await row(sheet(page), "Delete chain data").getByRole("button", { name: "Delete" }).click();
  await dialog.getByRole("button", { name: "Delete chain data" }).click();
  // Done, or refused with why; either way the node is started again after
  const refused = dialog.getByRole("alert");
  await expect(async () => expect((await dialog.isHidden()) || (await refused.isVisible())).toBe(true)).toPass({
    timeout: 60_000,
  });
  await nodeRunning(page);
  const tail = await call<{ msg: string }[]>(page, "GetLogTail", 1000);
  expect(tail.some((l) => l.msg.includes("Cleared the node's chain data"))).toBe(true);
  await expect(refused).toHaveCount(0);
  await expect(dialog).toBeHidden();
});

test("moving the wallet asks first, and shows where it goes", async ({ app, page, home }) => {
  const to = path.join(home, "wallet-elsewhere");
  fs.mkdirSync(to);
  await answerDialogs(app, to);
  await openSettings(page, "Storage");
  await row(sheet(page), "Move wallet").getByRole("button", { name: "Move" }).click();
  const dialog = page.getByRole("dialog", { name: "Move the wallet" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(to, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Move and restart" })).toBeEnabled();
  // Moving restarts the app, which the test's Electron wouldn't survive: cancelled here
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await config(page)).walletDir ?? "").toBe("");
});

test("Delete wallet data needs the word typed, then the password", async ({ page }) => {
  await openSettings(page, "Storage");
  await sheet(page).getByRole("button", { name: "Delete", exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: "Delete wallet data" });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Delete wallet data" });
  const word = dialog.getByLabel("Type DELETE to confirm");
  const password = dialog.getByLabel("Wallet password", { exact: true });

  await expect(submit).toBeDisabled();
  await expect(password).toBeDisabled();
  await word.fill("DELET");
  await expect(password).toBeDisabled();
  // Any case will do
  await word.fill("delete");
  await expect(password).toBeEnabled();
  await expect(submit).toBeDisabled();
  await password.fill(PASSWORD);
  await expect(submit).toBeEnabled();

  // Deleting restarts the app, which the test's Electron wouldn't survive: cancelled here
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await call<{ hasPassword: boolean }>(page, "WalletInfo")).hasPassword).toBe(true);
});
