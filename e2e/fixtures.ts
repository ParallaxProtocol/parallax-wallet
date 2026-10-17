import { test as base, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "desktop");
// Electron as the desktop package has it, fetched there on first use
const electronPath = createRequire(path.join(desktop, "package.json"))("electron") as string;

/** The wallet password the seeded wallet is set up with. */
export const PASSWORD = "correct horse battery";

/**
 * Accounts of known keys. FUNDED is the one the development chain's
 * genesis gives a million LAX; OTHER is a second, empty one to send to.
 */
export const FUNDED = {
  name: "Main",
  key: "0x0000000000000000000000000000000000000000000000000000000000000001",
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
};
export const OTHER = {
  name: "Savings",
  key: "0x0000000000000000000000000000000000000000000000000000000000000002",
  address: "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF",
};

/**
 * What a test starts from:
 * - "fresh": a first launch, nothing set up, the greeting showing.
 * - "wallet": the node set up on the development chain, a wallet with a
 *   password and FUNDED in it, unlocked, the main window showing.
 */
export type Seed = "fresh" | "wallet";

type Options = {
  seed: Seed;
  /** Settings of gui.json over the seed's own, for a test that needs the app started otherwise. */
  config: Record<string, unknown>;
};

type Fixtures = {
  /** The app's home: its config in .config/Parallax, the node's chain in .parallax. */
  home: string;
  app: ElectronApplication;
  /** The main window. */
  page: Page;
};

/**
 * The config a seeded app starts with: set up, on the development chain
 * funding FUNDED, with nothing that reaches out of the machine or holds a
 * port another test's app would want, and no animations to wait out.
 */
function seedConfig(home: string, seed: Seed, extra: Record<string, unknown>) {
  writeConfig(home, {
    noUpdateCheck: true,
    disableAnimations: true,
    notifications: false,
    httpRpcEnabled: false,
    mcpEnabled: false,
    ...(seed === "wallet" && {
      bootstrapped: true,
      dataDir: path.join(home, ".parallax"),
      autoStartNode: true,
      devChain: true,
      devFundAddress: FUNDED.address,
    }),
    ...extra,
  });
}

/** Where the app keeps its config and wallet in `home`: the user's config directory, as Go's os.UserConfigDir has it. */
export const configDir = (home: string) =>
  process.platform === "win32"
    ? path.join(home, "AppData", "Roaming", "Parallax")
    : path.join(home, ".config", "Parallax");

/** Writes the app's config (gui.json) in `home`, for an app about to be launched there. */
export function writeConfig(home: string, cfg: Record<string, unknown>) {
  const dir = configDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "gui.json"), JSON.stringify(cfg, null, 2));
}

/**
 * Starts the app in `home`, as the fixture does: a test that needs a second
 * app (an offline signer beside an online wallet) launches it with this.
 */
export async function launchApp(home: string): Promise<ElectronApplication> {
  return _electron.launch({
    executablePath: electronPath,
    args: [
      desktop,
      // A window behind others still runs at full speed: tests run several apps at once
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      // Linux CI runners can't give Chromium its sandbox; elsewhere it stays, as released
      ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      // Windows' per-user folders, where the app, the backend and the node keep their state there
      ...(process.platform === "win32" && {
        USERPROFILE: home,
        APPDATA: path.join(home, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(home, "AppData", "Local"),
      }),
      // The development build: the development chain may run (backend/devchain.go)
      PARALLAX_DEV: "1",
      LANG: "en_US.UTF-8",
    },
  });
}

/** The app's first window, sized as every test sees it, once the backend answers calls. */
export async function mainWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    // One size everywhere, whatever the screen, so layouts match locally and in CI
    win?.setSize(1440, 900);
    // Frames keep coming for a window under the others' (Electron pauses them otherwise),
    // which Playwright waits on to see an element hold still
    win?.webContents.setBackgroundThrottling(false);
  });
  await backendReady(page);
  return page;
}

/** Calls a backend method from the window, as the frontend does (lib/api.ts). */
export async function call<T = unknown>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([m, a]) =>
      (window as unknown as { parallax: { call(m: string, a: unknown[]): Promise<unknown> } }).parallax.call(m, a),
    [method, args] as const,
  ) as Promise<T>;
}

/** Waits for the backend to answer calls. */
export async function backendReady(page: Page) {
  await expect
    .poll(
      async () =>
        call<boolean>(page, "BootstrapNeeded").then(
          () => true,
          () => false,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

export const test = base.extend<Fixtures & Options>({
  seed: ["wallet", { option: true }],
  config: [{}, { option: true }],

  home: async ({}, use) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-e2e-"));
    await use(home);
    fs.rmSync(home, { recursive: true, force: true });
  },

  app: async ({ home, seed, config }, use, testInfo) => {
    seedConfig(home, seed, config);
    const app = await launchApp(home);
    const log: string[] = [];
    app.process().stdout?.on("data", (d) => log.push(String(d)));
    app.process().stderr?.on("data", (d) => log.push(String(d)));
    await app.context().tracing.start({ screenshots: true, snapshots: true });

    await use(app);

    // What a failed test leaves behind; each step on its own, as the app may be gone or hung by then
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) {
      await testInfo.attach("app log", { body: log.join(""), contentType: "text/plain" });
      const win = app.windows()[0];
      const shot = await win?.screenshot({ timeout: 5_000 }).catch(() => null);
      if (shot) await testInfo.attach("screenshot", { body: shot, contentType: "image/png" });
      const trace = testInfo.outputPath("trace.zip");
      if (
        await app
          .context()
          .tracing.stop({ path: trace })
          .then(
            () => true,
            () => false,
          )
      ) {
        await testInfo.attach("trace", { path: trace, contentType: "application/zip" });
      }
    } else {
      await app
        .context()
        .tracing.stop()
        .catch(() => {});
    }
    await app.close().catch(() => {});
  },

  page: async ({ app, seed }, use) => {
    const page = await mainWindow(app);
    if (seed === "wallet") {
      await call(page, "WalletSetupPassword", PASSWORD);
      const acc = await call<{ address: string }>(page, "WalletImportPrivateKey", FUNDED.name, FUNDED.key);
      expect(acc.address.toLowerCase()).toBe(FUNDED.address.toLowerCase());
      // The app decided what to show before the wallet had a password: let it look again
      await refresh(page);
    }
    await use(page);
  },
});

export { expect };

/**
 * Answers the native save and open dialogs from the main process, as the
 * user picking `file` (or cancelling, with null) would.
 */
export async function answerDialogs(app: ElectronApplication, file: string | null) {
  await app.evaluate(({ dialog }, f) => {
    const picked =
      f === null
        ? { canceled: true, filePath: undefined, filePaths: [] }
        : { canceled: false, filePath: f, filePaths: [f] };
    dialog.showSaveDialog = (async () => picked) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => picked) as typeof dialog.showOpenDialog;
  }, file);
}

/** Waits for the node to be running and to have made its first blocks (the development chain seals on demand). */
export async function nodeRunning(page: Page) {
  await expect
    .poll(
      async () =>
        (await call<{ running?: boolean }>(page, "NodeStatus").catch(() => ({}) as { running?: boolean })).running,
      {
        timeout: 60_000,
      },
    )
    .toBe(true);
}

/** Opens a page from the sidebar by its name ("Send", "Contacts", "Settings"…). */
export async function goTo(page: Page, name: string) {
  const exact = { name, exact: true };
  await page.getByRole("link", exact).or(page.getByRole("button", exact)).first().click();
}

/**
 * Reloads the window. What a test sets up through call() reaches the UI
 * only at its next refresh, which can be many seconds off: reload after it.
 */
export async function refresh(page: Page) {
  await page.reload();
  await backendReady(page);
}

/**
 * Waits for the clipboard to hold `text`. Copy buttons write it
 * asynchronously, and apps running side by side share the one clipboard.
 */
export async function expectClipboard(app: ElectronApplication, text: string) {
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(text);
}

/**
 * Brings in the lock screen's password form, as the first key typed does
 * once the wallet is locked by hand, and returns its field holding that
 * key ("x"). The key is pressed again until the form shows: one typed
 * before the lock screen listens is lost.
 */
export async function unlockForm(page: Page) {
  const field = page.getByLabel("Wallet password");
  await expect(async () => {
    await page.keyboard.press("x");
    await expect(field).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return field;
}
