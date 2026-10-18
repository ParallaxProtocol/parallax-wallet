import type { Page } from "@playwright/test";
import fs from "node:fs";
import { test, expect } from "../fixtures";
import { group, openSettings, setConfig, sheet } from "./helpers/settings";

// Settings' account of what protects the wallet (Security) and what you
// do (Privacy), each row with its status as it stands. The statuses are
// Linux's, where the suite runs (CI too): a development build, with
// runtime/secret (the Makefile's).

test.skip(process.platform !== "linux", "the statuses checked are Linux's");

const SECURITY = "How Parallax Wallet protects your wallet";
const PRIVACY = "How Parallax Wallet protects your privacy";

/** A row's status pill, in its group. */
const status = (page: Page, of: string, row: string, value: string) =>
  group(sheet(page), of).getByLabel(`${row}: ${value}`, { exact: true });

test("Security says how each protection of the wallet stands", async ({ page }) => {
  await openSettings(page, "Security");
  const protections = group(sheet(page), SECURITY);
  await expect(protections).toBeVisible();

  // Built in
  await expect(status(page, SECURITY, "Encrypted wallet", "Always on")).toBeVisible();
  await expect(status(page, SECURITY, "Cryptographically verified updates", "Always on")).toBeVisible();
  // Keys from the kernel's generator, with the processor's hardware source where it has one
  await expect(status(page, SECURITY, "Keys from secure randomness", "Always on")).toBeVisible();
  await expect(protections.getByText(/from the Linux kernel's random generator/)).toBeVisible();
  const hardware = /\b(rdrand|rdseed|rng)\b/.test(fs.readFileSync("/proc/cpuinfo", "utf8"));
  await expect(protections.getByText(/adds a hardware random source to it\./)).toHaveCount(hardware ? 1 : 0);
  // Locked memory, and on Linux (read from the backend) secrets wiped after use as well
  await expect(status(page, SECURITY, "Secrets protected in memory", "Always on")).toBeVisible();
  await expect(protections.getByText(/also wiped from memory right after use\.$/)).toBeVisible();
  // Read from the backend: the process neither dumped nor readable
  await expect(status(page, SECURITY, "Shielded from other programs", "On")).toBeVisible();
  await expect(protections.getByText(/can't read its memory without administrator rights\.$/)).toBeVisible();
  // Each row says what's in effect here: on Linux, locking at sleep, and no screenshot row at all
  await expect(status(page, SECURITY, "Locks when you step away", "On")).toBeVisible();
  await expect(protections.getByText("The wallet locks when the computer goes to sleep.")).toBeVisible();
  await expect(protections.getByText("Hidden from screenshots")).toHaveCount(0);
  await expect(protections.getByText("Not on this system")).toHaveCount(0);
  // The window sandboxed and isolated, but a development build isn't sealed
  await expect(status(page, SECURITY, "Isolated window", "Partly on")).toBeVisible();
  await expect(protections.getByText(/^This development build isn't sealed/)).toBeVisible();
  await expect(status(page, SECURITY, "Locks itself", "On")).toBeVisible();
  // Windows' own Memory integrity is Windows' alone
  await expect(protections.getByText("Windows memory integrity")).toHaveCount(0);
  // What's about privacy is Privacy's
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
