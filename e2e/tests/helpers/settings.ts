import { expect, type Locator, type Page } from "@playwright/test";
import net from "node:net";
import { call, goTo } from "../../fixtures";

/** Settings' sections, by the name each has in its list. */
export type Section =
  | "General"
  | "Appearance"
  | "Privacy"
  | "Storage"
  | "Accounts"
  | "Security"
  | "Node"
  | "Network"
  | "RPC"
  | "Overview"
  | "Permissions"
  | "Diagnostics"
  | "About";

/** The Settings panel, grown out of its button at the sidebar's foot. */
export const sheet = (page: Page) => page.getByRole("region", { name: "Settings" });

/** Opens Settings, at a section if one is given. */
export async function openSettings(page: Page, section?: Section) {
  await goTo(page, "Settings");
  await expect(sheet(page)).toBeVisible();
  if (section) await showSection(page, section);
}

/** Shows a section from Settings' list, by its heading. */
export async function showSection(page: Page, section: Section) {
  await sheet(page)
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: section, exact: true })
    .click();
  await expect(sheet(page).getByRole("heading", { level: 2, name: section, exact: true })).toBeVisible();
}

/** Closes Settings with its collapse button. */
export async function closeSettings(page: Page) {
  await sheet(page).getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(sheet(page)).toBeHidden();
}

/**
 * A setting's row, by its title: the title and its description on the
 * left, its control on the right. Its title stands on its own beside the
 * row's restart badge, if any.
 */
export function row(scope: Page | Locator, title: string): Locator {
  return scope.locator(`xpath=//div[./div/div[text()[normalize-space()=${xpathString(title)}]]]`);
}

/** A group of settings, by its heading: its rows and its Advanced options. */
export function group(scope: Page | Locator, title: string): Locator {
  return scope.locator(`xpath=//section[./div/div/h3[normalize-space()=${xpathString(title)}]]`);
}

/** A group's Advanced row, which folds its finer options and counts the customized ones. */
export const advanced = (scope: Locator) => scope.getByRole("button", { name: /^Advanced/ });

/** The save bar at Settings' foot, while it shows. */
export const saveBar = {
  // Its message holds the restart it needs, when it needs one
  unsaved: (page: Page) => sheet(page).getByText(/^Unsaved changes/),
  needsRestart: (page: Page) => sheet(page).getByText("Will require node restart", { exact: true }),
  appRestartRequired: (page: Page) => sheet(page).getByText("Restart the app to apply changes", { exact: true }),
  save: (page: Page) => sheet(page).getByRole("button", { name: "Save", exact: true }),
  discard: (page: Page) => sheet(page).getByRole("button", { name: "Discard", exact: true }),
};

/** The saved config, as the backend has it. */
export const config = (page: Page) => call<Record<string, any>>(page, "GetConfig");

/** Waits for a saved setting to read `value`. */
export async function savedAs(page: Page, key: string, value: unknown) {
  await expect.poll(async () => (await config(page))[key]).toEqual(value);
}

/** A port nothing listens on now, for a server a test turns on beside other tests'. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Saves settings over the current config, before a test opens Settings to see them. */
export async function setConfig(page: Page, patch: Record<string, unknown>) {
  await call(page, "UpdateConfig", { ...(await config(page)), ...patch });
}

function xpathString(s: string) {
  return s.includes("'") ? `concat('${s.split("'").join(`', "'", '`)}')` : `'${s}'`;
}
