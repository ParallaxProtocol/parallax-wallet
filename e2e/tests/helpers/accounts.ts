import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect, goTo } from "../../fixtures";

/** Opens Settings at a section of its sidebar ("Accounts", "Security", "Storage"…). */
export async function openSettings(page: Page, section: string) {
  await goTo(page, "Settings");
  const nav = page.getByRole("navigation", { name: "Settings" });
  await nav.getByRole("button", { name: section, exact: true }).click();
  await expect(page.getByRole("heading", { name: section, exact: true, level: 2 })).toBeVisible();
}

/** An account's row in Settings' Accounts list, by the name it shows. */
export function accountRow(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Show ${name}`, exact: true }) });
}

/**
 * Takes a row's quieter action ("Rename", "Remove account"…): they fold
 * open only while the row is pointed at.
 */
export async function rowAction(page: Page, name: string, action: string) {
  const row = accountRow(page, name);
  await row.hover();
  await row.getByRole("button", { name: action, exact: true }).click();
}

/** The dialog open over the window, by its title. */
export function dialog(page: Page, title: string) {
  return page.getByRole("dialog", { name: title });
}

/**
 * The words a recovery phrase shows once revealed, in order: each item of
 * the grid reads its number, then its word.
 */
export async function revealedWords(scope: Locator): Promise<string[]> {
  await scope.getByRole("button", { name: "Click to show the words" }).click();
  // The grid is the list whose items are a number and a word (the flow's progress is a list too)
  const grid = scope.getByRole("list").filter({
    has: scope
      .page()
      .getByRole("listitem")
      .filter({ hasText: /^\s*1\s*[a-z]+\s*$/ }),
  });
  const items = grid.getByRole("listitem");
  await expect(items.first()).toBeVisible();
  const words = (await items.allInnerTexts()).map((s) => s.trim().replace(/^\d+\s*/, ""));
  expect([12, 24]).toContain(words.length);
  return words;
}

/** Types back the words the confirm step asks for ("Word 3", "Word 7"…). */
export async function answerQuiz(scope: Locator, words: string[]) {
  const fields = scope.getByLabel(/^Word \d+$/);
  await expect(fields).toHaveCount(3);
  for (const field of await fields.all()) {
    const label = await field.evaluate((el) => document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "");
    const n = Number(/\d+/.exec(label)?.[0]);
    await field.fill(words[n - 1]);
  }
}

/** Keeps the app from starting itself again (a wipe restarts it), so the test sees it stop. */
export async function noRelaunch(app: ElectronApplication) {
  await app.evaluate(({ app }) => {
    app.relaunch = () => {};
  });
}
