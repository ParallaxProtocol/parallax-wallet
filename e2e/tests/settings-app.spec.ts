import { test, expect, nodeRunning } from "../fixtures";
import {
  closeSettings,
  config,
  openSettings,
  row,
  saveBar,
  savedAs,
  sheet,
  showSection,
  type Section,
} from "./helpers/settings";

const SECTIONS: Section[] = [
  "General",
  "Appearance",
  "Privacy",
  "Storage",
  "Accounts",
  "Security",
  "Node",
  "Network",
  "RPC",
  "Overview",
  "Permissions",
  "Diagnostics",
  "About",
];

test("every section opens under its heading, and Settings closes and opens at General again", async ({ page }) => {
  await openSettings(page);
  await expect(sheet(page).getByRole("heading", { level: 2, name: "General" })).toBeVisible();
  for (const s of SECTIONS) await showSection(page, s);

  // Escape shrinks it back into its button
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await openSettings(page);
  await expect(sheet(page).getByRole("heading", { level: 2, name: "General" })).toBeVisible();
  await closeSettings(page);
});

test("a theme applies to the window at once and is saved", async ({ page }) => {
  await openSettings(page, "Appearance");
  const html = page.locator("html");

  await sheet(page).getByRole("radio", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await savedAs(page, "theme", "light");

  await sheet(page).getByRole("radio", { name: "Dark" }).click();
  await expect(html).not.toHaveAttribute("data-theme", "light");
  await savedAs(page, "theme", "dark");

  // Kept: the dark theme is still chosen when Settings opens again, and after a reload
  await closeSettings(page);
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme", "light");
  await openSettings(page, "Appearance");
  await expect(sheet(page).getByRole("radio", { name: "Dark" })).toBeChecked();

  await sheet(page).getByRole("radio", { name: "System" }).click();
  await savedAs(page, "theme", "system");
  // Nothing in Appearance waits for the save bar
  await expect(saveBar.unsaved(page)).toBeHidden();
});

test("the avatar style and the animations switch save as they change", async ({ page }) => {
  await openSettings(page, "Appearance");
  await sheet(page).getByRole("radio", { name: "Blockies" }).click();
  await savedAs(page, "avatarStyle", "blockies");

  // The fixture starts the app without animations
  const animations = sheet(page).getByRole("switch", { name: "Disable animations" });
  await expect(animations).toHaveAttribute("aria-checked", "true");
  await animations.click();
  await expect(animations).toHaveAttribute("aria-checked", "false");
  await savedAs(page, "disableAnimations", false);
  await animations.click();
  await savedAs(page, "disableAnimations", true);

  await closeSettings(page);
  await openSettings(page, "Appearance");
  await expect(sheet(page).getByRole("radio", { name: "Blockies" })).toBeChecked();
  await expect(saveBar.unsaved(page)).toBeHidden();
});

test("General's switches save at once, without the save bar, and are kept", async ({ page }) => {
  await openSettings(page, "General");
  const awake = sheet(page).getByRole("switch", { name: "Keep the computer awake" });
  const notifications = sheet(page).getByRole("switch", { name: "Notifications" });
  const autoStart = sheet(page).getByRole("switch", { name: "Auto-start node" });

  await awake.click();
  await notifications.click();
  await autoStart.click();
  await expect(saveBar.unsaved(page)).toBeHidden();
  await savedAs(page, "preventSleep", true);
  await savedAs(page, "notifications", true);
  await savedAs(page, "autoStartNode", false);

  await closeSettings(page);
  await page.reload();
  await openSettings(page, "General");
  await expect(awake).toHaveAttribute("aria-checked", "true");
  await expect(notifications).toHaveAttribute("aria-checked", "true");
  await expect(autoStart).toHaveAttribute("aria-checked", "false");
});

test("the offline signer waits for Save, its fee cap unfolding beneath it, and Discard takes it back", async ({
  page,
}) => {
  await openSettings(page, "General");
  const signer = sheet(page).getByRole("switch", { name: "Offline signer" });
  const feeCap = sheet(page).getByRole("textbox", { name: "Fee cap" });
  await expect(feeCap).toBeHidden();

  await signer.click();
  await expect(feeCap).toBeVisible();
  await expect(feeCap).toHaveValue("1");
  await expect(saveBar.unsaved(page)).toBeVisible();
  // Not saved: it takes the node down, so it's a decision for Save
  expect((await config(page)).offlineSigner).toBeFalsy();

  await saveBar.discard(page).click();
  await expect(signer).toHaveAttribute("aria-checked", "false");
  await expect(feeCap).toBeHidden();
  await expect(saveBar.unsaved(page)).toBeHidden();
  expect((await config(page)).autoStartNode).toBe(true);
});

test("the interface language changes the app's words, and is kept", async ({ page }) => {
  await openSettings(page, "General");
  await sheet(page).getByRole("button", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();
  // Settings itself is named in it
  const settings = page.getByRole("region", { name: "Einstellungen" });
  await expect(settings.getByRole("heading", { level: 2, name: "Allgemein" })).toBeVisible();

  // Kept across a reload
  await page.reload();
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await expect(settings.getByRole("heading", { level: 2, name: "Allgemein" })).toBeVisible();

  await settings.getByRole("button", { name: "Sprache der Oberfläche" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(sheet(page).getByRole("heading", { level: 2, name: "General" })).toBeVisible();
});

test("Privacy's Tor switch waits for Save while the node runs, its options unfolding until discarded", async ({
  page,
}) => {
  await nodeRunning(page);
  await openSettings(page, "Privacy");
  const tor = sheet(page).getByRole("switch", { name: "Use Tor" });
  await expect(tor).toHaveAttribute("aria-checked", "false");
  await expect(row(sheet(page), "Peers over Tor")).toBeHidden();

  await tor.click();
  await expect(row(sheet(page), "Peers over Tor")).toBeVisible();
  await expect(row(sheet(page), "Use Tor").getByText("Restart", { exact: true })).toBeVisible();
  await expect(saveBar.unsaved(page)).toBeVisible();
  await expect(saveBar.needsRestart(page)).toBeVisible();

  await saveBar.discard(page).click();
  await expect(tor).toHaveAttribute("aria-checked", "false");
  await expect(row(sheet(page), "Peers over Tor")).toBeHidden();
  await expect(saveBar.unsaved(page)).toBeHidden();
  expect((await config(page)).tor).toBeFalsy();
});

test("a setting's Read more opens its explanation with the command-line flag", async ({ page }) => {
  await openSettings(page, "Node");
  await row(sheet(page), "Sync mode").getByRole("button", { name: "Read more" }).click();
  const drawer = page.getByRole("dialog", { name: "Sync mode" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Command-line equivalent")).toBeVisible();
  await expect(drawer.getByText("--syncmode", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // The drawer took the Escape: Settings is still open
  await expect(sheet(page)).toBeVisible();
});
