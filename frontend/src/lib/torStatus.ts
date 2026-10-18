import { createContext, useContext } from "react";
import type { TorStatus } from "./api";

/**
 * The Tor switch and how Tor is doing (backend/tor.go), for Settings and
 * the node bar: null until first read. TorProvider keeps it.
 */
export const TorContext = createContext<TorStatus | null>(null);

export const useTorStatus = () => useContext(TorContext);

export type TorBarKind = "off" | "starting" | "failed" | "nodeRestart" | "readyOnion" | "ready";

/** torBarKind is the message the node bar shows of Tor for st. */
export function torBarKind(st: TorStatus | null): TorBarKind {
  if (!st?.enabled) return "off";
  if (st.state === "starting") return "starting";
  if (st.state === "failed") return "failed";
  if (st.state === "ready" && st.nodeRunning && !st.nodeBehind) return "nodeRestart";
  return st.onionOnly ? "readyOnion" : "ready";
}
