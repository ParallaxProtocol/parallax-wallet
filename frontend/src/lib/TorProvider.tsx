import { ReactNode, useEffect, useState } from "react";
import { api, onEvent, type TorStatus } from "./api";
import { TorContext } from "./torStatus";

/**
 * TorProvider follows the Tor switch and how Tor is doing: at once on each
 * change the backend sends of Tor or the node, and every few seconds
 * besides, for the node's onion address, which comes up after Tor does.
 */
export function TorProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<TorStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .torStatus()
        .then((s) => alive && setSt(s))
        .catch(() => {});
    load();
    const offTor = onEvent("tor", load);
    const offNode = onEvent("node", load);
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      offTor();
      offNode();
      window.clearInterval(timer);
    };
  }, []);
  return <TorContext.Provider value={st}>{children}</TorContext.Provider>;
}
