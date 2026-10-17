import { test, expect, call, unlockForm, OTHER, PASSWORD } from "../fixtures";

// The window's calls pass through the shell's main process sealed
// (bridge_seal.go): what it carries, recorded at its IPC handler, never
// holds a password or a key, and names no method but the sealed ones.

test("the main process carries the window's calls sealed, never a secret in the clear", async ({ app, page }) => {
  // Records every call the main process relays, then relays it as before
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })
      ._invokeHandlers;
    const relay = handlers.get("backend:call")!;
    const seen: string[] = [];
    (globalThis as { sealSeen?: string[] }).sealSeen = seen;
    ipcMain.removeHandler("backend:call");
    ipcMain.handle("backend:call", async (event: unknown, method: unknown, args: unknown) => {
      const result = await relay(event, method, args);
      seen.push(JSON.stringify({ method, args, result }));
      return result;
    });
  });

  // Secrets on their way in: a private key imported, the wallet locked and unlocked with the password
  await call(page, "WalletImportPrivateKey", OTHER.name, OTHER.key);
  await page.getByRole("button", { name: "Lock wallet" }).click();
  const field = await unlockForm(page);
  await field.fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  const seen = await app.evaluate(() => (globalThis as { sealSeen?: string[] }).sealSeen ?? []);
  expect(seen.length).toBeGreaterThan(0);
  const carried = seen.join("\n");
  expect(carried).not.toContain(PASSWORD);
  expect(carried).not.toContain(OTHER.key.slice(2));
  const methods = new Set(seen.map((s) => (JSON.parse(s) as { method: string }).method));
  expect([...methods].every((m) => m === "BridgeOpen" || m === "Sealed")).toBe(true);
  expect(methods.has("Sealed")).toBe(true);
});
