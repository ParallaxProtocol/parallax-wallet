import { test, expect, call, nodeRunning } from "../fixtures";
import { config, freePort, openSettings, row, savedAs, setConfig, sheet, showSection } from "./helpers/settings";

test("assistant access turns on from Permissions, and the server's address and token show in the Overview", async ({
  page,
}) => {
  await nodeRunning(page);
  // The server binds its port: one of its own, as other tests' apps run beside it
  const port = await freePort();
  await setConfig(page, { mcpPort: port });

  await openSettings(page, "Permissions");
  await expect(sheet(page).getByText("Assistant access is off.")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Turn on" }).click();
  await savedAs(page, "mcpEnabled", true);
  await expect(sheet(page).getByText("Assistant access is off.")).toBeHidden();

  await showSection(page, "Overview");
  await expect(sheet(page).getByRole("switch", { name: "Assistant access" })).toHaveAttribute("aria-checked", "true");
  const address = row(sheet(page), "Address");
  await expect(address).toContainText(`127.0.0.1:${port}`);
  const token = row(sheet(page), "Access token");
  await expect(token).toBeVisible();
  await expect(sheet(page).getByText("Connect an assistant")).toBeVisible();
  // Claude Code's command by default, the token shown by its ends only
  await expect(sheet(page).getByText(/^claude mcp add --transport http parallax-wallet-app/)).toBeVisible();

  // A new token replaces the old one
  const shown = await token.locator("code").innerText();
  const before = (await call<{ token: string }>(page, "MCPStatus")).token;
  await token.getByRole("button", { name: "New token" }).click();
  await expect.poll(async () => (await call<{ token: string }>(page, "MCPStatus")).token).not.toBe(before);
  await expect(token.locator("code")).not.toHaveText(shown);

  // Turned off, its rows fold away
  await sheet(page).getByRole("switch", { name: "Assistant access" }).click();
  await savedAs(page, "mcpEnabled", false);
  await expect(address).toBeHidden();
  await expect(sheet(page).getByText("Connect an assistant")).toBeHidden();
});

test("while the node is stopped, the Overview says the node is off", async ({ page }) => {
  await nodeRunning(page);
  await setConfig(page, { mcpPort: await freePort(), mcpEnabled: true });
  await call(page, "StopNode");
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await openSettings(page, "Overview");
  await expect(
    sheet(page).getByText("Assistants stay connected, but chain and node tools answer only once the node starts."),
  ).toBeVisible();
});

test("permissions save as they're chosen, and are kept", async ({ page }) => {
  await openSettings(page, "Permissions");
  const wallet = row(sheet(page), "Wallet");
  await wallet.getByRole("radio", { name: "Allow" }).click();
  await expect.poll(async () => (await config(page)).mcpAllow?.wallet).toBe("allow");

  const send = row(sheet(page), "Send transactions");
  await expect(send.getByRole("radio", { name: "Allow" })).toHaveCount(0);
  await send.getByRole("radio", { name: "Block" }).click();
  await expect.poll(async () => (await config(page)).mcpAllow?.sendTransactions).toBe("block");

  const explorer = sheet(page).getByRole("switch", { name: "Block explorer" });
  const was = (await explorer.getAttribute("aria-checked")) === "true";
  await explorer.click();
  await expect.poll(async () => !!(await config(page)).mcpAllow?.explorer).toBe(!was);

  // None of it waits for the save bar
  await expect(sheet(page).getByText(/^Unsaved changes/)).toBeHidden();
  await page.keyboard.press("Escape");
  await openSettings(page, "Permissions");
  await expect(row(sheet(page), "Wallet").getByRole("radio", { name: "Allow" })).toBeChecked();
  await expect(row(sheet(page), "Send transactions").getByRole("radio", { name: "Block" })).toBeChecked();
  await expect(sheet(page).getByRole("heading", { level: 3, name: "Never" })).toBeVisible();
});
