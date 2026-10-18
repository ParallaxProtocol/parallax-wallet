import { contextBridge, ipcRenderer } from "electron";

/**
 * The frontend's whole view of the outside world, as window.parallax: calls
 * to the backend, its events, opening links in the default browser, and
 * the native theme. Runs sandboxed; the renderer gets no Node access.
 */

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

/**
 * Calls go to the backend sealed (bridge_seal.go): passwords, recovery
 * phrases and keys, and what comes back, pass through the shell's main
 * process encrypted, never in the clear. A session's key comes of an
 * X25519 exchange with the backend, derived here into an AES-256-GCM key
 * that can't be read back out of Web Crypto, nor leaves this process.
 */
const SEAL_INFO = "parallax-bridge-seal 1";
const UNKNOWN_SESSION = "sealed: unknown session";
type Sealed = { s: string; n: string; c: string };
type Session = { id: string; key: CryptoKey };
const text = new TextEncoder();
const subtle = globalThis.crypto.subtle;

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function invoke(method: string, args: unknown[]) {
  return (await ipcRenderer.invoke("backend:call", method, args)) as { result?: any; error?: string };
}

/** Opens a sealed session with the backend. */
async function openSession(): Promise<Session> {
  const pair = (await subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;
  const own = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const res = await invoke("BridgeOpen", [toBase64(own)]);
  if (res.error) throw new Error(res.error);
  const theirs = fromBase64(res.result.key);
  const peer = await subtle.importKey("raw", theirs, { name: "X25519" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: peer }, pair.privateKey, 256));
  const material = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  shared.fill(0);
  const salt = new Uint8Array(own.length + theirs.length);
  salt.set(own);
  salt.set(theirs, own.length);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: text.encode(SEAL_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { id: res.result.session, key };
}

// One session for every call, opened on the first and again if the backend loses it
let session: Promise<Session> | null = null;

/** A call to the backend, sealed both ways. */
async function sealedCall(method: string, args: unknown[]): Promise<{ result?: unknown; error?: string }> {
  for (let attempt = 0; ; attempt++) {
    const current = (session ??= openSession().catch((e) => {
      session = null;
      throw e;
    }));
    const { id, key } = await current;
    const plain = text.encode(JSON.stringify({ method, args }));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await subtle.encrypt({ name: "AES-GCM", iv, additionalData: text.encode("call") }, key, plain),
    );
    plain.fill(0);
    const res = await invoke("Sealed", [{ s: id, n: toBase64(iv), c: toBase64(sealed) } satisfies Sealed]);
    if (res.error === UNKNOWN_SESSION && attempt === 0) {
      // The backend started again: a new session, and the call once more
      if (session === current) session = null;
      continue;
    }
    if (res.error) return { error: res.error };
    const back = res.result as Sealed;
    const opened = new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(back.n), additionalData: text.encode("result") },
        key,
        fromBase64(back.c),
      ),
    );
    const response = JSON.parse(new TextDecoder().decode(opened));
    opened.fill(0);
    return response;
  }
}

ipcRenderer.on("backend:event", (_e, name: string, data: unknown) => {
  listeners.get(name)?.forEach((cb) => cb(data));
});

contextBridge.exposeInMainWorld("parallax", {
  /** Calls a backend method (an exported method of App in app.go). */
  async call(method: string, args: unknown[]): Promise<unknown> {
    const res = await sealedCall(method, args);
    if (res.error) throw new Error(res.error);
    return res.result;
  },
  /** Subscribes to a backend event; returns the unsubscribe function. */
  on(name: string, cb: Listener): () => void {
    let set = listeners.get(name);
    if (!set) listeners.set(name, (set = new Set()));
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke("shell:openExternal", url);
  },
  setTheme(pref: "system" | "light" | "dark") {
    ipcRenderer.send("theme:set", pref);
  },
  /**
   * How the window is kept apart from the system, as it stands: its
   * renderer sandboxed, the page apart from this script, and the packaged
   * build's sealed binary.
   */
  async security(): Promise<{ sandboxed: boolean; isolated: boolean; packaged: boolean }> {
    return {
      sandboxed: process.sandboxed === true,
      isolated: process.contextIsolated === true,
      packaged: (await ipcRenderer.invoke("security:packaged")) === true,
    };
  },
  /** Opens Windows Security at Core isolation, where Memory integrity is turned on (Windows). */
  openCoreIsolation() {
    ipcRenderer.send("security:openCoreIsolation");
  },
  /** Whether the app starts at login; `supported` is false in development. */
  loginItem(): Promise<{ supported: boolean; enabled: boolean }> {
    return ipcRenderer.invoke("login:get");
  },
  setLoginItem(on: boolean): Promise<void> {
    return ipcRenderer.invoke("login:set", on);
  },
  /** Saves an account's encrypted keystore file where the user picks; false if cancelled. */
  saveBackup(fileName: string, contents: string): Promise<boolean> {
    return ipcRenderer.invoke("wallet:saveBackup", fileName, contents);
  },
  /** Saves exported contacts where the user picks; false if cancelled. */
  exportContacts(format: "json" | "csv", contents: string): Promise<boolean> {
    return ipcRenderer.invoke("contacts:export", format, contents);
  },
  /** Asks where to save an account's exported activity: a .csv path, or null if cancelled. */
  pickHistoryPath(fileName: string): Promise<string | null> {
    return ipcRenderer.invoke("history:savePath", fileName);
  },
  /** Saves a signing request or signed transaction where the user picks; false if cancelled. */
  saveSigningDoc(fileName: string, contents: string): Promise<boolean> {
    return ipcRenderer.invoke("offline:save", fileName, contents);
  },
  /** Asks for a folder (the node's data, or where to move a store), opened at start; null if cancelled. */
  pickFolder(title: string, start: string): Promise<string | null> {
    return ipcRenderer.invoke("storage:pickFolder", title, start);
  },
  /** Asks for the camera where the OS needs asking (macOS); whether it may be used. */
  cameraAccess(): Promise<boolean> {
    return ipcRenderer.invoke("camera:access");
  },
  /** Keeps the window out of screen captures while on (macOS and Windows). */
  protectContent(on: boolean) {
    ipcRenderer.send("window:protect", on);
  },
  /** Holds off system sleep while on. */
  keepAwake(on: boolean) {
    ipcRenderer.send("power:keepAwake", on);
  },
  platform: process.platform,
});
