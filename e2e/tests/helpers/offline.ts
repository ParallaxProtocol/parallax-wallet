import { expect, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { call, launchApp, mainWindow, refresh, writeConfig, PASSWORD } from "../../fixtures";

/** A second app, beside the fixture's: an offline signer holding one key. */
export type Signer = { app: ElectronApplication; page: Page; close: () => Promise<void> };

/**
 * Starts an offline signer in a home of its own, as the fixture starts the
 * app (fixtures.ts), with `key` imported under `name` and the wallet
 * unlocked: the offline round trip needs two computers.
 */
export async function launchSigner(name: string, key: string): Promise<Signer> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-e2e-signer-"));
  writeConfig(home, {
    bootstrapped: true,
    dataDir: path.join(home, ".parallax"),
    offlineSigner: true,
    autoStartNode: false,
    noUpdateCheck: true,
    disableAnimations: true,
    notifications: false,
    httpRpcEnabled: false,
    mcpEnabled: false,
  });
  const app = await launchApp(home);
  const close = async () => {
    await app.close().catch(() => {});
    fs.rmSync(home, { recursive: true, force: true });
  };
  try {
    const page = await mainWindow(app);
    await call(page, "WalletSetupPassword", PASSWORD);
    await call(page, "WalletImportPrivateKey", name, key);
    await refresh(page);
    await expect(page.getByRole("heading", { name: "This computer signs offline" })).toBeVisible();
    return { app, page, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/** Picks `file` in the file chooser the button named `name` opens (the scanners' Open file…). */
export async function openFile(page: Page, file: string, name = "Open file…") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name }).click();
  await (await chooser).setFiles(file);
}

/** Puts `text` on the clipboard, as copying it from somewhere else would. */
export async function setClipboard(app: ElectronApplication, text: string) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
}
