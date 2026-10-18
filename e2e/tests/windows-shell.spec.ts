import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, goTo, unlockForm, PASSWORD } from "../fixtures";
import { group, openSettings, sheet } from "./helpers/settings";

// On Windows the backend gives the shell's own processes the access list
// it gives itself (backend/harden_windows.go HardenShell): another program
// of the same user can wait on them, ask about them and end them, but not
// read or write their memory, start a thread in them, take their handles
// or change that. Tried here with tools/probe, as such a program would,
// and the app used under it, so what Chromium needs of its own processes
// is seen to hold.

test.skip(process.platform !== "win32", "Windows' access lists");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let probe = "";

test.beforeAll(() => {
  probe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "parallax-probe-")), "probe.exe");
  execFileSync("go", ["build", "-o", probe, "./e2e/tools/probe"], { cwd: root, stdio: "inherit" });
});

type Given = Record<
  "readMemory" | "writeMemory" | "startThread" | "takeHandles" | "rewriteACL" | "waitQueryEnd",
  boolean
>;
// What the probe says of itself goes to stderr, kept with the test's output
const tryProcess = (pid: number): Given =>
  JSON.parse(execFileSync(probe, [String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));

/** Waits for a process to be shielded, then checks all it gives and keeps. */
async function shielded(pid: number) {
  await expect.poll(() => tryProcess(pid).readMemory, { timeout: 30_000 }).toBe(false);
  expect(tryProcess(pid)).toEqual({
    readMemory: false,
    writeMemory: false,
    startThread: false,
    takeHandles: false,
    rewriteACL: false,
    waitQueryEnd: true,
  });
}

test("the shell's processes are shielded, and the app works under it", async ({ app, page }) => {
  const renderer = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getOSProcessId());
  // The main process by its own word, as it asks the backend to shield it (not the process Playwright started)
  const main = await app.evaluate(() => process.pid);
  console.log(`main process ${main} (Playwright started ${app.process().pid}), window's ${await renderer()}`);
  await shielded(main);
  await shielded(await renderer());

  // The app goes on as before: pages, sealed calls, the lock and unlock
  await goTo(page, "Contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await goTo(page, "Send");
  await expect(page.getByRole("heading", { name: "Send" })).toBeVisible();
  await goTo(page, "Overview");
  await page.getByRole("button", { name: "Lock wallet" }).click();
  const field = await unlockForm(page);
  await field.fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // Loaded again, the window is shielded again, a new renderer as much as the old
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await shielded(await renderer());
});

test("Security says whether Windows' Memory integrity runs, and opens where it's turned on", async ({ app, page }) => {
  // Where the button would send the user, caught rather than opened on the runner
  await app.evaluate(({ shell }) => {
    const g = globalThis as { opened?: string[] };
    g.opened = [];
    shell.openExternal = (async (url: string) => void g.opened!.push(url)) as typeof shell.openExternal;
  });
  await openSettings(page, "Security");
  const protections = group(sheet(page), "How Parallax Wallet protects your wallet");
  const status = protections.getByLabel(/^Windows memory integrity: (On|Off)$/);
  await expect(status).toBeVisible();
  console.log(`Memory integrity: ${await status.textContent()}`);
  if ((await status.textContent()) === "Off") {
    await protections.getByRole("button", { name: "Open Windows Security" }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(["windowsdefender://coreisolation"]);
  }
});
