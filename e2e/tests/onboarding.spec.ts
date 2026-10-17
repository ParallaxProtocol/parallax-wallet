import type { Page } from "@playwright/test";
import { test, expect, call, PASSWORD } from "../fixtures";

// A first launch: the greeting, the node's setup, then the wallet's
// password and its recovery phrase. The seeded config keeps the node on
// the development chain, which the setup saves on with the rest.
test.use({ seed: "fresh", config: { devChain: true } });

/** The standard test phrase, and the first account it derives (m/44'/60'/0'/0/0). */
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PHRASE_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

const continueButton = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });

/** Goes through the node's setup, as an online wallet, to where the wallet's own setup begins. */
async function setUpNode(page: Page) {
  await expect(page.getByText("Let's set up your node. It only takes a minute.")).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();

  await expect(page.getByRole("heading", { name: "Choose your language" })).toBeVisible();
  await page.getByRole("radio", { name: "English" }).click();
  await continueButton(page).click();

  await expect(page.getByRole("heading", { name: "How will you use this computer?" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Wallet with my own node/ })).toHaveAttribute("aria-checked", "true");
  await continueButton(page).click();

  await expect(page.getByRole("heading", { name: "Where should we keep your data?" })).toBeVisible();
  await continueButton(page).click();

  await expect(page.getByRole("heading", { name: "Help the network" })).toBeVisible();
  await page.getByRole("button", { name: "Start node" }).click();

  // The development chain is its own head from the start
  await expect(page.getByRole("heading", { name: "Your node is in sync" })).toBeVisible({ timeout: 60_000 });
  await continueButton(page).click();

  await expect(page.getByRole("heading", { name: "Set up your wallet" })).toBeVisible();
  await page.getByRole("button", { name: "Create wallet password" }).click();
}

/** Chooses the wallet password, types it again and acknowledges it can't be recovered. */
async function setPassword(page: Page) {
  await expect(page.getByRole("heading", { name: "Create a wallet password" })).toBeVisible();
  await page.getByPlaceholder("Wallet password").fill(PASSWORD);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Type it again" })).toBeVisible();
  await page.getByPlaceholder("Confirm password").fill(PASSWORD);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "One last thing" })).toBeVisible();
  await page.getByRole("checkbox", { name: /if I lose this password/ }).click();
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("heading", { name: "Set up your recovery phrase" })).toBeVisible();
}

/** Waits out "Your wallet is ready" for the main window. */
async function arrive(page: Page) {
  await expect(page.getByRole("heading", { name: "Your wallet is ready" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 15_000 });
}

/** The words of the phrase on screen, once revealed. */
async function shownWords(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "Click to show the words" }).click();
  const items = page.getByRole("listitem");
  await expect(items).toHaveCount(24);
  // Each item is its position, then the word
  return (await items.allInnerTexts()).map((s) => s.trim().split(/\s+/).pop()!);
}

test("a new install sets up the node on the development chain and a new recovery phrase, typed back", async ({
  page,
}) => {
  await setUpNode(page);
  await setPassword(page);

  await page.getByRole("button", { name: /Create recovery phrase/ }).click();
  await expect(page.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible();
  const words = await shownWords(page);
  await page.getByRole("button", { name: "I've written it down" }).click();

  // The quiz asks for some of the words by position: a wrong one holds it back
  await expect(page.getByRole("heading", { name: "Confirm your recovery phrase" })).toBeVisible();
  const asked = page.getByLabel(/^Word \d+$/);
  const n = await asked.count();
  expect(n).toBeGreaterThan(0);
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  for (let i = 0; i < n; i++) {
    const label = await asked.nth(i).evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? "");
    const word = words[Number(label.match(/\d+/)![0]) - 1];
    // The first one mistyped at first
    await asked.nth(i).fill(i === 0 ? word + "x" : word);
  }
  await expect(confirm).toBeDisabled();
  const first = await asked.first().evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? "");
  await asked.first().fill(words[Number(first.match(/\d+/)![0]) - 1]);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByRole("heading", { name: "Add a passphrase?" })).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await arrive(page);

  // The node runs on the development chain, as the seeded config had it
  const status = await call<{ running: boolean; devChain: boolean }>(page, "NodeStatus");
  expect(status.devChain).toBe(true);
  expect(status.running).toBe(true);
  const info = await call<{ accounts: { name: string }[]; seeds: { confirmed: boolean }[]; locked: boolean }>(
    page,
    "WalletInfo",
  );
  expect(info.accounts).toHaveLength(1);
  expect(info.seeds).toHaveLength(1);
  expect(info.seeds[0].confirmed).toBe(true);
  expect(info.locked).toBe(false);
  await expect(page.getByText(info.accounts[0].name).first()).toBeVisible();
});

test("the password must be long enough and typed the same twice", async ({ page }) => {
  await setUpNode(page);
  await expect(page.getByRole("heading", { name: "Create a wallet password" })).toBeVisible();

  const field = page.getByPlaceholder("Wallet password");
  await field.fill("short");
  await expect(continueButton(page)).toBeDisabled();
  await field.fill(PASSWORD);
  await continueButton(page).click();

  const again = page.getByPlaceholder("Confirm password");
  await expect(page.getByRole("heading", { name: "Type it again" })).toBeVisible();
  await again.fill(PASSWORD + "!");
  await expect(continueButton(page)).toBeDisabled();
  await again.fill(PASSWORD);
  await expect(continueButton(page)).toBeEnabled();

  // Back keeps the password chosen
  await page.getByRole("button", { name: "Back" }).click();
  await expect(field).toHaveValue(PASSWORD);
  await continueButton(page).click();
  await page.getByPlaceholder("Confirm password").fill(PASSWORD);
  await continueButton(page).click();

  // Set only once it's understood that it can't be recovered
  const set = page.getByRole("button", { name: "Set password" });
  await expect(set).toBeDisabled();
  await page.getByRole("checkbox", { name: /if I lose this password/ }).click();
  await set.click();
  await expect(page.getByRole("heading", { name: "Set up your recovery phrase" })).toBeVisible();
  expect((await call<{ hasPassword: boolean }>(page, "WalletInfo")).hasPassword).toBe(true);
});

test("a recovery phrase can be left to back up later, with a passphrase", async ({ page }) => {
  await setUpNode(page);
  await setPassword(page);

  await page.getByRole("button", { name: /Create recovery phrase/ }).click();
  await expect(page.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible();
  await page.getByRole("button", { name: "Back up later" }).click();

  await expect(page.getByRole("heading", { name: "Add a passphrase?" })).toBeVisible();
  const create = page.getByRole("button", { name: "Create account" });
  await page.getByRole("switch", { name: "Add a passphrase (advanced)" }).click();
  // Typed twice: until both match, nothing is made
  await expect(create).toBeDisabled();
  await page.getByLabel("Passphrase", { exact: true }).fill("extra words");
  await page.getByLabel("Confirm passphrase").fill("extra word");
  await expect(page.getByRole("alert")).toHaveText("The passphrases don't match");
  await expect(create).toBeDisabled();
  await page.getByLabel("Confirm passphrase").fill("extra words");
  await create.click();
  await arrive(page);

  const info = await call<{ accounts: unknown[]; seeds: { confirmed: boolean; hasPassphrase: boolean }[] }>(
    page,
    "WalletInfo",
  );
  expect(info.accounts).toHaveLength(1);
  expect(info.seeds).toHaveLength(1);
  expect(info.seeds[0].hasPassphrase).toBe(true);
  // Not typed back: not counted as backed up
  expect(info.seeds[0].confirmed).toBe(false);
});

test("a recovery phrase can be imported, its accounts chosen", async ({ page }) => {
  await setUpNode(page);
  await setPassword(page);

  await page.getByRole("button", { name: /Import recovery phrase/ }).click();
  await expect(page.getByRole("heading", { name: "Import recovery phrase" })).toBeVisible();
  const go = continueButton(page);
  // Not a phrase's length yet
  await page.getByPlaceholder("word word word …").fill("abandon abandon abandon");
  await expect(go).toBeDisabled();
  await page.getByPlaceholder("word word word …").fill(PHRASE);
  await expect(page.getByText("12 words")).toBeVisible();
  await go.click();

  await expect(page.getByRole("heading", { name: "Choose accounts" })).toBeVisible();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await arrive(page);

  const info = await call<{ accounts: { address: string }[] }>(page, "WalletInfo");
  expect(info.accounts.map((a) => a.address.toLowerCase())).toEqual([PHRASE_ADDRESS.toLowerCase()]);
});

test("a hardware wallet waits for a device to be connected", async ({ page }) => {
  await setUpNode(page);
  await setPassword(page);

  await page.getByRole("button", { name: /Connect a hardware wallet/ }).click();
  await expect(page.getByRole("heading", { name: "Connect a hardware wallet" })).toBeVisible();
  // No device: nothing to read accounts from
  await expect(continueButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Set up your recovery phrase" })).toBeVisible();
});

test("the language chosen applies at once", async ({ page }) => {
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("radio", { name: "Deutsch" }).click();
  await expect(page.getByRole("radio", { name: "Deutsch" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Weiter" })).toBeVisible();
  await page.getByRole("radio", { name: "English" }).click();
  await expect(continueButton(page)).toBeVisible();
});

test("the data directory can't be left empty", async ({ page }) => {
  await page.getByRole("button", { name: "Get started" }).click();
  await continueButton(page).click();
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Where should we keep your data?" })).toBeVisible();
  const dir = page.getByLabel("Data directory");
  await expect(dir).not.toHaveValue("");
  await dir.fill("   ");
  await expect(continueButton(page)).toBeDisabled();
});

test("an offline signer skips the node and goes to the wallet", async ({ page }) => {
  await page.getByRole("button", { name: "Get started" }).click();
  await continueButton(page).click();
  await page.getByRole("radio", { name: /Offline signer/ }).click();
  await continueButton(page).click();

  await expect(page.getByRole("heading", { name: "Set up your wallet" })).toBeVisible();
  await page.getByRole("button", { name: "Create wallet password" }).click();
  await setPassword(page);
  // An offline signer holds keys only: no hardware wallet offered
  await expect(page.getByRole("button", { name: /Connect a hardware wallet/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Create recovery phrase/ }).click();
  await page.getByRole("button", { name: "Back up later" }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your wallet is ready" })).toBeVisible();

  const cfg = await call<{ offlineSigner: boolean; bootstrapped: boolean }>(page, "GetConfig");
  expect(cfg.offlineSigner).toBe(true);
  expect(cfg.bootstrapped).toBe(true);
  expect((await call<{ running: boolean }>(page, "NodeStatus")).running).toBe(false);
});
