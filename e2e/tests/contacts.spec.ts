import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, call, goTo, answerDialogs, FUNDED, OTHER, expectClipboard } from "../fixtures";

/** Addresses of keys 3 and 4, for contacts that are no account of the wallet. */
const ALICE = { name: "Alice", address: "0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69", note: "Rent, monthly" };
const BOB = { name: "Bob", address: "0x1efF47bc3a10a45D4B230B5d10E37751FE6AA718", note: "" };

/** Adds contacts through the backend, then shows the Contacts page with them. */
async function seedContacts(page: Page, ...list: { name: string; address: string; note: string }[]) {
  for (const c of list) await call(page, "ContactAdd", c);
  await page.reload();
  await goTo(page, "Contacts");
  await expect(page.getByRole("heading", { name: "All contacts" })).toBeVisible();
}

/** A contact's row, by its name: the button that opens it. */
const row = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}\\b`) });

test.describe("contacts", () => {
  test("adding the first contact from the empty page", async ({ page }) => {
    await goTo(page, "Contacts");
    await expect(page.getByRole("heading", { name: "No contacts yet" })).toBeVisible();
    // Nothing to export yet
    await expect(page.getByRole("button", { name: "Export" })).toHaveCount(0);

    await page.getByRole("button", { name: "Add contact" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add contact" })).toBeVisible();
    const save = dialog.getByRole("button", { name: "Add contact" });
    await expect(save).toBeDisabled();

    await dialog.getByLabel("Name").fill(ALICE.name);
    await dialog.getByLabel("Address").fill("0x1234");
    await expect(dialog.getByText("Not a valid address.")).toBeVisible();
    await expect(save).toBeDisabled();

    await dialog.getByLabel("Address").fill(ALICE.address);
    await expect(dialog.getByText("Not a valid address.")).toHaveCount(0);
    await dialog.getByLabel("Note").fill(ALICE.note);
    await expect(dialog.getByText(`${ALICE.note.length} / 500`)).toBeVisible();
    await save.click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "All contacts" })).toBeVisible();
    await expect(row(page, ALICE.name)).toBeVisible();
    await expect(page.getByText(`· ${ALICE.note}`)).toBeVisible();
    const saved = await call<{ name: string; address: string; note: string }[]>(page, "Contacts");
    expect(saved).toEqual([expect.objectContaining(ALICE)]);
  });

  test("the form refuses a taken address or name and a bad checksum, and knows the wallet's own account", async ({
    page,
  }) => {
    await seedContacts(page, ALICE);
    await page.getByRole("button", { name: "Add contact" }).click();
    const dialog = page.getByRole("dialog");
    const save = dialog.getByRole("button", { name: "Add contact" });

    await dialog.getByLabel("Name").fill("Someone");
    await dialog.getByLabel("Address").fill(ALICE.address.toLowerCase());
    await expect(dialog.getByText(`Already in your contacts as ${ALICE.name}.`)).toBeVisible();
    await expect(save).toBeDisabled();

    await dialog.getByLabel("Address").fill(BOB.address);
    await dialog.getByLabel("Name").fill(" alice ");
    await expect(dialog.getByText("Another contact already has this name.")).toBeVisible();
    await expect(save).toBeDisabled();

    // A mixed-case address must match its checksum: the backend's to say, as it's saved
    await dialog.getByLabel("Name").fill(BOB.name);
    await dialog.getByLabel("Address").fill(BOB.address.replace("0x1e", "0x1E"));
    await save.click();
    await expect(dialog.getByText("This address fails its checksum: a character is likely wrong.")).toBeVisible();

    // The wallet's own account may be saved, and is said to be it
    await dialog.getByLabel("Address").fill(FUNDED.address);
    await expect(dialog.getByText(`This is your own account “${FUNDED.name}”.`)).toBeVisible();
    await expect(save).toBeEnabled();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await call<unknown[]>(page, "Contacts")).toHaveLength(1);
  });

  test("a contact opens to its details, is edited, starred and removed", async ({ page }) => {
    await seedContacts(page, ALICE, BOB);
    await row(page, ALICE.name).click();
    await expect(row(page, ALICE.name)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Not yet")).toBeVisible();
    await expect(page.getByText(ALICE.note, { exact: true })).toBeVisible();

    // Edit: the form opens with its values; a name and a note changed
    await page.getByRole("button", { name: "Edit contact" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name")).toHaveValue(ALICE.name);
    await expect(dialog.getByLabel("Address")).toHaveValue(ALICE.address);
    await dialog.getByLabel("Name").fill("Alice Landlord");
    await dialog.getByLabel("Note").fill("Rent, every first of the month");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, "Alice Landlord")).toBeVisible();
    await expect(page.getByText("Rent, every first of the month", { exact: true })).toBeVisible();

    // Starred: a favourite tile on top, the row marked
    await page.getByRole("button", { name: "Add to favorites" }).click();
    await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send to Alice Landlord" })).toBeVisible();
    await page.getByRole("button", { name: "Remove from favorites" }).click();
    await expect(page.getByRole("heading", { name: "Favorites" })).toHaveCount(0);

    // Removed, after asking
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Remove Alice Landlord from your contacts?")).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(row(page, "Alice Landlord")).toBeVisible();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await confirm.getByRole("button", { name: "Remove" }).click();
    await expect(row(page, "Alice Landlord")).toHaveCount(0);
    await expect(row(page, BOB.name)).toBeVisible();
    expect(await call<{ name: string }[]>(page, "Contacts")).toEqual([expect.objectContaining({ name: BOB.name })]);
  });

  test("search filters by name, address and note", async ({ page }) => {
    await seedContacts(page, ALICE, BOB);
    const search = page.getByLabel("Search by name, address or note");

    await search.fill("bob");
    await expect(page.getByText("1 of 2 contacts")).toBeVisible();
    await expect(row(page, BOB.name)).toBeVisible();
    await expect(row(page, ALICE.name)).toHaveCount(0);

    await search.fill(ALICE.address.slice(2, 10).toLowerCase());
    await expect(row(page, ALICE.name)).toBeVisible();
    await expect(row(page, BOB.name)).toHaveCount(0);

    await search.fill("monthly");
    await expect(row(page, ALICE.name)).toBeVisible();

    await search.fill("nobody");
    await expect(page.getByText("No contacts match “nobody”.")).toBeVisible();

    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(row(page, ALICE.name)).toBeVisible();
    await expect(row(page, BOB.name)).toBeVisible();
  });

  test("copying a contact's address, and sending to it", async ({ app, page }) => {
    await seedContacts(page, ALICE);
    await row(page, ALICE.name).click();
    // The opened contact's, not the sidebar account's
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Copy" }).click();
    await expect(main.getByRole("button", { name: "Copied" })).toBeVisible();
    await expectClipboard(app, ALICE.address);

    // Send in the row opens Send to them, said by name
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    await expect(page).toHaveURL(new RegExp(`/send\\?to=${ALICE.address}`));
    await expect(page.getByText(`Sending to ${ALICE.name}`)).toBeVisible();
  });

  test("a favourite's tile sends to it", async ({ page }) => {
    const alice = await call<{ id: string }>(page, "ContactAdd", ALICE);
    await call(page, "ContactSetFavorite", alice.id, true);
    await page.reload();
    await goTo(page, "Contacts");
    await page.getByRole("button", { name: `Send to ${ALICE.name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/send\\?to=${ALICE.address}`));
    await expect(page.getByText(`Sending to ${ALICE.name}`)).toBeVisible();
  });

  test("exporting as JSON and as CSV writes the file picked", async ({ app, page, home }) => {
    const alice = await call<{ id: string }>(page, "ContactAdd", ALICE);
    await call(page, "ContactSetFavorite", alice.id, true);
    await seedContacts(page, BOB);

    const json = path.join(home, "contacts.json");
    await answerDialogs(app, json);
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Export as JSON…" }).click();
    await expect(page.getByText("Exported 2 contacts.")).toBeVisible();
    const book = JSON.parse(fs.readFileSync(json, "utf8")) as { contacts: { name: string; favorite: boolean }[] };
    expect(book.contacts).toEqual([
      expect.objectContaining({ name: ALICE.name, address: ALICE.address, note: ALICE.note, favorite: true }),
      expect.objectContaining({ name: BOB.name, address: BOB.address, favorite: false }),
    ]);
    // Private to the user, as a backup is
    expect(fs.statSync(json).mode & 0o777).toBe(0o600);

    const csv = path.join(home, "contacts.csv");
    await answerDialogs(app, csv);
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Export as CSV…" }).click();
    await expect(page.getByText("Exported 2 contacts.")).toBeVisible();
    expect(fs.readFileSync(csv, "utf8").trim().split("\n")).toEqual([
      "name,address,note,favorite",
      `${ALICE.name},${ALICE.address},"${ALICE.note}",yes`,
      `${BOB.name},${BOB.address},,`,
    ]);

    // Cancelling the dialog writes nothing and says nothing
    await page.getByRole("button", { name: "Close" }).click();
    await answerDialogs(app, null);
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Export as JSON…" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByText("Exported 2 contacts.")).toHaveCount(0);
  });

  test("importing a CSV adds what's new, skips what's there and reports what isn't valid", async ({ page }) => {
    await seedContacts(page, ALICE);
    const file = [
      "name,address,note,favorite",
      `${ALICE.name},${ALICE.address},,`,
      `${BOB.name},${BOB.address},Lunch,yes`,
      "Nobody,0xnot-an-address,,",
    ].join("\n");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await (await chooser).setFiles({ name: "book.csv", mimeType: "text/csv", buffer: Buffer.from(file) });

    await expect(page.getByText("Import finished")).toBeVisible();
    await expect(page.getByText("1 added · 1 already in your contacts · 1 not valid")).toBeVisible();
    await expect(page.getByText(/^Entry 3: /)).toBeVisible();
    await expect(row(page, BOB.name)).toBeVisible();
    await expect(page.getByRole("button", { name: `Send to ${BOB.name}` })).toBeVisible();
    expect(await call<unknown[]>(page, "Contacts")).toHaveLength(2);
  });

  test("importing into an empty book, and a file that isn't contacts", async ({ page }) => {
    await goTo(page, "Contacts");
    let chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import contacts…" }).click();
    await (
      await chooser
    ).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just some notes\nnothing more") });
    await expect(
      page.getByText("That isn't a contacts file. Use a JSON or CSV export with name and address columns."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "No contacts yet" })).toBeVisible();

    const json = JSON.stringify([
      { name: ALICE.name, address: ALICE.address, note: ALICE.note },
      { name: OTHER.name, address: OTHER.address },
    ]);
    chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import contacts…" }).click();
    await (await chooser).setFiles({ name: "book.json", mimeType: "application/json", buffer: Buffer.from(json) });
    await expect(page.getByText("2 added")).toBeVisible();
    await expect(row(page, ALICE.name)).toBeVisible();
    await expect(row(page, OTHER.name)).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Import finished")).toHaveCount(0);
  });
});
