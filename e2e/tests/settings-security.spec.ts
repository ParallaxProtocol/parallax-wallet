import type { Page } from "@playwright/test";
import fs from "node:fs";
import { test, expect } from "../fixtures";
import { group, openSettings, setConfig, sheet } from "./helpers/settings";

// Settings' account of what protects the wallet (Security) and what you
// do (Privacy), each row with its status as it stands: a development
// build's, on each system the suite runs on. The backend is built by
// make backend: with runtime/secret on Linux, signed with the hardened
// runtime on macOS (the Makefile).

const platform = process.platform;
const SECURITY = "How Parallax Wallet protects your wallet";
const PRIVACY = "How Parallax Wallet protects your privacy";

/** A row's status pill, in its group. */
const status = (page: Page, of: string, row: string, value: string) =>
  group(sheet(page), of).getByLabel(`${row}: ${value}`, { exact: true });

test("Security says how each protection of the wallet stands", async ({ page }) => {
  await openSettings(page, "Security");
  const protections = group(sheet(page), SECURITY);
  await expect(protections).toBeVisible();
  const shown = (text: string | RegExp, on: boolean) => expect(protections.getByText(text)).toHaveCount(on ? 1 : 0);

  // Built in, everywhere
  await expect(status(page, SECURITY, "Encrypted wallet", "Always on")).toBeVisible();
  await expect(status(page, SECURITY, "Cryptographically verified updates", "Always on")).toBeVisible();
  await expect(status(page, SECURITY, "Secrets protected in memory", "Always on")).toBeVisible();
  await expect(status(page, SECURITY, "Locks itself", "On")).toBeVisible();
  // The system's own generator, named; with the processor's hardware source where Linux shows one
  await expect(status(page, SECURITY, "Keys from secure randomness", "Always on")).toBeVisible();
  const generator = { linux: "the Linux kernel's", darwin: "macOS's system", win32: "Windows' system" }[
    platform as string
  ];
  await shown(new RegExp(`from ${generator} random generator`), true);
  const hardware = platform === "linux" && /\b(rdrand|rdseed|rng)\b/.test(fs.readFileSync("/proc/cpuinfo", "utf8"));
  await shown(/adds a hardware random source to it\./, hardware);
  // Secrets wiped after use where Go's runtime/secret erases: Linux
  await shown(/also wiped from memory right after use\.$/, platform === "linux");
  // The engine shielded as the system lets it: no crash dumps, no reading its memory, and on Windows
  // no code but Microsoft's loaded into it
  await expect(status(page, SECURITY, "Shielded from other programs", "On")).toBeVisible();
  await shown(/can't read its memory without administrator rights\.( Only code signed by Microsoft|$)/, true);
  await shown(/Only code signed by Microsoft can be loaded into it\.$/, platform === "win32");
  // Locking as the computer sleeps, and as its screen locks where the system says so (not Linux)
  await expect(status(page, SECURITY, "Locks when you step away", "On")).toBeVisible();
  await shown("The wallet locks when the computer goes to sleep.", platform === "linux");
  await shown("The wallet locks when the computer goes to sleep or its screen locks.", platform !== "linux");
  // Kept out of screenshots where the system can (not Linux)
  if (platform === "linux") await shown("Hidden from screenshots", false);
  else await expect(status(page, SECURITY, "Hidden from screenshots", "On")).toBeVisible();
  // The window sandboxed and isolated, but a development build isn't sealed
  await expect(status(page, SECURITY, "Isolated window", "Partly on")).toBeVisible();
  await shown(/^This development build isn't sealed/, true);
  // Windows' own Memory integrity is Windows' alone (windows-shell.spec.ts tries it)
  if (platform !== "win32") await shown("Windows memory integrity", false);
  // Nothing said of what a system hasn't, and what's about privacy is Privacy's
  await shown("Not on this system", false);
  await expect(protections.getByText("Tor", { exact: true })).toHaveCount(0);
});

test("auto-lock set to never shows as off, at once", async ({ page }) => {
  await openSettings(page, "Security");
  await page.getByRole("button", { name: "Lock automatically" }).click();
  await page.getByRole("option", { name: "Never" }).click();
  await expect(status(page, SECURITY, "Locks itself", "Off")).toBeVisible();
  await expect(group(sheet(page), SECURITY).getByText(/^Set to never: the wallet stays unlocked/)).toBeVisible();

  await page.getByRole("button", { name: "Lock automatically" }).click();
  await page.getByRole("option", { name: "After 5 minutes" }).click();
  await expect(status(page, SECURITY, "Locks itself", "On")).toBeVisible();
});

test("Privacy says how each protection of what you do stands", async ({ page }) => {
  await openSettings(page, "Privacy");
  await expect(group(sheet(page), PRIVACY)).toBeVisible();
  await expect(status(page, PRIVACY, "Your own node", "Always on")).toBeVisible();
  await expect(status(page, PRIVACY, "Tor", "Off")).toBeVisible();
  await expect(status(page, PRIVACY, "No tracking", "On")).toBeVisible();
  await expect(status(page, PRIVACY, "Private logs", "Always on")).toBeVisible();
  await expect(status(page, PRIVACY, "AI assistants ask first", "Not in use")).toBeVisible();
});

test("shared network stats are said, with where to stop them", async ({ page }) => {
  await setConfig(page, { reportStats: true });
  await openSettings(page, "Privacy");
  await expect(status(page, PRIVACY, "No tracking", "Stats shared")).toBeVisible();
  await group(sheet(page), PRIVACY).getByRole("button", { name: "Network settings" }).click();
  await expect(sheet(page).getByRole("heading", { level: 2, name: "Network", exact: true })).toBeVisible();
});
