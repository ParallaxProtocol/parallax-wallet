import { lazy, ReactNode, Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Power,
  RadioTower,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, formatInt } from "../../lib/format";
import { nodeState, syncProgress, useNode, useRefresh } from "../../lib/live";
import { useT } from "../../i18n";
import { NodeSheetContext, useNodeSheet } from "../../lib/nodeSheet";
import { Indicator, type Grade } from "../ui/Indicator";
import { Meter } from "../ui/bits";
import { Counter } from "../ui/Counter";
import { Tooltip } from "../ui/Tooltip";
import { TOP_BAR_HEIGHT } from "./TopBar";
import { useAssistant } from "../../lib/assistantContext";
import { NodeSwitchContext, useNodeSwitch } from "../../lib/nodeSwitch";
import { BAR_FADE, BAR_GLASS, BAR_SURFACE } from "./barSurface";
import { torBarKind, useTorStatus } from "../../lib/torStatus";
import { OnionSymbol } from "../ui/symbols";
import { ActivitySpinner } from "../ui/ActivitySpinner";
import { FADE_IN, FADE_OUT } from "../../lib/motion";

const NodePage = lazy(() => import("../../pages/Overview"));

/** The node's icon, wherever the app shows it: the bar, and setup's choice to run one. */
export const NODE_ICON: LucideIcon = RadioTower;
/** Its stroke, lighter than Lucide's 2, and the offline signer's shield's beside or in place of it. */
export const NODE_ICON_STROKE = 1.5;

/** The bar's height, collapsed. */
export const NODE_BAR_HEIGHT = 64;
/** How far the collapsed bar floats from the window's edges. */
export const NODE_BAR_GAP = 12;
/** The room the shell keeps at the window's foot for the floating bar. */
export const NODE_BAR_ROOM = NODE_BAR_HEIGHT + 2 * NODE_BAR_GAP;

const STATE_GRADE: Record<ReturnType<typeof nodeState>, Grade> = {
  stopped: "off",
  syncing: "info",
  synced: "good",
};

/**
 * Swap is a line of the bar changing in place, keyed by what it says: the
 * old one rising away as the new one rises in, as the save bar's message.
 */
function Swap({ swap, className = "", children }: { swap: string; className?: string; children: ReactNode }) {
  return (
    <span className={`relative flex min-w-0 ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={swap}
          className="block min-w-0 truncate"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: FADE_IN }}
          exit={{ opacity: 0, y: -6, transition: FADE_OUT }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function NodeSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <NodeSheetContext.Provider value={{ open, setOpen }}>{children}</NodeSheetContext.Provider>;
}

export { useNodeSheet };

/** NodeSwitchProvider holds the node's power switch for the whole shell: the bar, the node's page and Send's Connect show one state. */
export function NodeSwitchProvider({ children }: { children: ReactNode }) {
  const node = useNode();
  const refresh = useRefresh();
  const running = !!node?.running;
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // With Tor on, the node starts once Tor is connected, never before
  const t = useT();
  const tor = useTorStatus();
  const waiting =
    running || !tor?.enabled || tor.state === "ready"
      ? null
      : tor.state === "starting"
        ? t("node.waitTor", { n: tor.progress })
        : t("node.waitTorFailed");
  const toggle = async () => {
    if (!running && waiting) return;
    setBusy(true);
    setErr(null);
    try {
      if (running) await api.stopNode();
      else await api.startNode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const restart = async () => {
    setRestarting(true);
    setErr(null);
    try {
      await api.stopNode();
      await api.startNode();
    } finally {
      setRestarting(false);
      refresh();
    }
  };
  return (
    <NodeSwitchContext.Provider value={{ busy: busy || restarting, err, toggle, restarting, restart, waiting }}>
      {children}
    </NodeSwitchContext.Provider>
  );
}

/**
 * NodeBar floats along the window's foot, under the sidebar too: the node at
 * a glance from every page (its state, the sync's progress, the best
 * block, peers and uptime) and its power switch, in a capsule as the
 * assistant bar beside it. Opened, it rises into a
 * floating panel up to the window's title bar and becomes the node's page,
 * its bar staying on as the page's header; closed, it sinks back. Escape
 * closes it.
 */
export default function NodeBar() {
  const t = useT();
  const node = useNode();
  const { open, setOpen } = useNodeSheet();
  const state = nodeState(node);
  const progress = syncProgress(node);
  const running = !!node?.running;
  const { busy, err, toggle, restarting, restart, waiting } = useNodeSwitch();
  // With Tor on, the bar takes Tor's tint and says how Tor is doing
  const tor = useTorStatus();
  const torKind = torBarKind(tor);
  const torOn = torKind !== "off";
  // What the bar's right end says. Restarting with Tor on, that the node
  // comes back behind it, rather than Tor's state between the stop and the
  // start. Tor not connected, that first: a restart would only wait on it.
  // Tor connected with the node offline, that the node connects through it
  const note = restarting
    ? torOn
      ? "restarting"
      : null
    : torKind === "starting" || torKind === "failed" || torKind === "nodeRestart"
      ? torKind
      : running && node.restartPending
        ? "settings"
        : torOn
          ? running
            ? torKind
            : torKind === "readyOnion"
              ? "standbyOnion"
              : "standby"
          : null;
  // The window's height, which the open panel fills under the title bar
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // The assistant bar sits at the right end of the foot: this bar keeps
  // clear of it, moving aside as it opens on a request. Opened into the
  // node's page it takes the whole width, the assistant bar stepping
  // away meanwhile, unless a request has it open
  const { width: assistantWidth, shown, sent } = useAssistant();
  const asking = !!shown || !!sent;
  const right = NODE_BAR_GAP + (assistantWidth > 0 && (!open || asking) ? assistantWidth + NODE_BAR_GAP : 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // What inside the page takes its own Escape (its search) keeps it
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const switchLabel = restarting
    ? t("node.restarting")
    : busy
      ? running
        ? t("node.stopping")
        : t("node.starting")
      : running
        ? t("node.stop")
        : t("node.start");
  const openLabel = open ? t("node.collapse") : t("node.expand");

  return (
    <>
      <motion.section
        aria-label={t("nav.network")}
        // At rest the cards' glass, as the empty wallet's Settings pill, lit under the pointer as it opens on a click; opened, the page's thicker glass
        className={`no-drag fixed z-40 flex flex-col overflow-hidden ${open ? BAR_SURFACE : `${BAR_GLASS} hover:bg-[var(--glass-hover)]`} ${torOn ? "border-tor-edge" : ""} ${BAR_FADE}`}
        style={{ left: NODE_BAR_GAP, bottom: NODE_BAR_GAP }}
        initial={false}
        // A capsule at rest, as the assistant bar; opened, a panel's corners
        animate={{
          right,
          height: open ? Math.max(NODE_BAR_HEIGHT, vh - TOP_BAR_HEIGHT - NODE_BAR_GAP) : NODE_BAR_HEIGHT,
          borderRadius: open ? 16 : NODE_BAR_HEIGHT / 2,
        }}
        transition={{ type: "spring", bounce: 0, visualDuration: 0.35 }}
      >
        {/* The bar: a click anywhere on it opens the page, whose header it then is.
            Its buttons sit as far from the end as from the top and bottom,
            their circles concentric with the capsule's; its symbol, bare as
            Apple leaves a status's, is inset as a glyph in the capsule's curve */}
        <div
          className={`flex shrink-0 items-center gap-5 border-b pr-[15px] pl-5 text-sm text-muted-foreground tabular-nums transition-colors ${
            open ? "border-border" : "border-transparent"
          } ${torOn ? "bg-tor-tint" : ""}`}
          style={{ height: NODE_BAR_HEIGHT }}
          onClick={(e) => {
            if (!open && !(e.target as HTMLElement).closest("button")) setOpen(true);
          }}
        >
          {/* What the node is doing: its symbol, the state led by its live dot
            (as System Settings marks a connection), and a line of figures under
            it, starting where the dot does */}
          {/* The symbol as far from its text as the buttons at the other end are apart */}
          <span className="flex min-w-0 items-center gap-5">
            {/* Restarting, a spinner in the symbol's place, the one between them crossfading */}
            <span className="relative grid size-5 shrink-0 place-items-center">
              <AnimatePresence initial={false}>
                <motion.span
                  key={restarting ? "spinner" : "icon"}
                  className="absolute inset-0 grid place-items-center"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1, transition: FADE_IN }}
                  exit={{ opacity: 0, scale: 0.6, transition: FADE_OUT }}
                >
                  {restarting ? (
                    <ActivitySpinner size={20} className="text-info-ink" />
                  ) : (
                    <NODE_ICON className="size-5" strokeWidth={NODE_ICON_STROKE} aria-hidden />
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                {/* Restarting, it's on its way back rather than offline, between its stop and its start too */}
                <Indicator
                  grade={restarting ? "info" : STATE_GRADE[state]}
                  ping={running || restarting}
                  cause={restarting ? "restarting" : state}
                />
                {(() => {
                  const title = open
                    ? t("nav.network")
                    : restarting
                      ? t("node.state.restarting")
                      : t(`node.state.${state}`);
                  return (
                    <Swap swap={title} className="text-[15px] font-semibold text-foreground">
                      {title}
                    </Swap>
                  );
                })()}
              </span>
              <Swap
                swap={
                  restarting ? "restarting" : running ? "running" : node?.startError && !open ? "failed" : "offline"
                }
                className="text-sm"
              >
                {restarting ? (
                  t("node.restartingHint")
                ) : running ? (
                  <>
                    <Tooltip content={t("clock.bestBlock")}>
                      <span>
                        {t("status.block")}{" "}
                        <Counter value={node.currentBlock} format={(v) => formatInt(Math.round(v))} />
                      </span>
                    </Tooltip>
                    {" · "}
                    {t(node.peers === 1 ? "node.peer" : "node.peers", { n: node.peers })}
                    <span className="hidden lg:inline">
                      {" · "}
                      {t("status.uptime", { time: formatDuration(node.uptimeSeconds) })}
                    </span>
                  </>
                ) : node?.startError && !open ? (
                  // Its last start failed (an auto-start's has no one else to tell): why, whole in the tooltip
                  <Tooltip content={node.startError}>
                    <span className="text-warn-ink">{t("node.startFailed", { reason: node.startError })}</span>
                  </Tooltip>
                ) : (
                  // Opened, the page under it says why and offers the switch
                  node && !open && t("node.offlineHint")
                )}
              </Swap>
            </span>
          </span>

          {running && !restarting && state === "syncing" && (
            <span className="flex items-center gap-2.5">
              <Meter value={progress} live thick className="w-56" label={t("node.state.syncing")} />
              <Counter
                value={progress * 100}
                format={(v) => `${v.toFixed(1)}%`}
                className="font-medium text-foreground"
              />
            </span>
          )}

          <span className="flex-1" />

          {/* What waits on the node, one thing at a time: how Tor is doing,
              everything the app sends going through it, or why nothing goes
              out yet; or that the running node waits on a restart, to go
              behind Tor or for a saved setting it reads only as it starts,
              with the restart at hand */}
          {note && (
            <Swap
              swap={note}
              className={`shrink font-medium ${note === "settings" ? "text-foreground" : "text-tor-ink"}`}
            >
              <span className="flex min-w-0 items-center gap-2" role="status">
                {note === "settings" ? (
                  <Indicator grade="warn" />
                ) : note === "failed" ? (
                  <TriangleAlert className="size-4 shrink-0" aria-hidden />
                ) : (
                  <OnionSymbol
                    className={`size-4 shrink-0 ${note === "restarting" || note === "starting" ? "animate-pulse" : ""}`}
                    aria-hidden
                  />
                )}
                <span className="truncate">
                  {note === "settings"
                    ? t("node.restartPending")
                    : note === "restarting"
                      ? t("tor.banner.nodeRestarting")
                      : note === "starting"
                        ? t("tor.banner.starting", { n: tor?.progress ?? 0 })
                        : t(`tor.banner.${note}`)}
                </span>
                {(note === "nodeRestart" || note === "settings") && (
                  <button
                    type="button"
                    className="btn btn-tinted shrink-0 rounded-full px-3"
                    onClick={() =>
                      restart().catch(() => {
                        /* the bar shows why it didn't start */
                      })
                    }
                  >
                    {t("settings.save.restart")}
                  </button>
                )}
              </span>
            </Swap>
          )}

          {/* A failed switch: its symbol, the message on hover. Opened on a
              stopped node, the page shows the error by its button */}
          {err && (running || !open) && (
            <Tooltip content={err}>
              <span
                className="grid shrink-0 place-items-center text-critical-ink"
                role="img"
                aria-label={err}
                tabIndex={0}
              >
                <TriangleAlert className="size-4" />
              </span>
            </Tooltip>
          )}

          {running || restarting ? (
            <Tooltip content={switchLabel}>
              <button
                type="button"
                className="btn btn-tinted btn-icon"
                onClick={toggle}
                disabled={busy || !node}
                aria-label={switchLabel}
              >
                {busy && !restarting ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              </button>
            </Tooltip>
          ) : (
            // Opened, the page's own button is the one; a second would compete with it
            node &&
            !open && (
              <button
                type="button"
                className="btn btn-primary rounded-full px-4"
                onClick={toggle}
                disabled={busy || !!waiting}
              >
                {/* Waiting on Tor, the line beside it says so */}
                {(busy || (waiting && !torOn)) && <Loader2 className="size-3.5 animate-spin" />}
                {waiting && !torOn ? waiting : switchLabel}
              </button>
            )
          )}
          <Tooltip content={openLabel}>
            <button
              type="button"
              className="btn btn-tinted btn-icon"
              onClick={() => setOpen(!open)}
              aria-label={openLabel}
              aria-expanded={open}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </button>
          </Tooltip>
        </div>

        {/* The node's page, arriving as the bar rises */}
        <AnimatePresence>
          {open && (
            <motion.div
              key="page"
              className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <Suspense fallback={null}>
                <NodePage />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </>
  );
}

/**
 * OfflineBar takes the node bar's place when the app is an offline signer:
 * there is no node to show, only the promise that nothing goes online.
 */
export function OfflineBar() {
  const t = useT();
  return (
    <section
      aria-label={t("offline.mode")}
      className={`no-drag fixed z-40 flex items-center gap-5 pr-[15px] pl-5 text-sm text-muted-foreground ${BAR_GLASS}`}
      style={{
        left: NODE_BAR_GAP,
        right: NODE_BAR_GAP,
        bottom: NODE_BAR_GAP,
        height: NODE_BAR_HEIGHT,
        borderRadius: NODE_BAR_HEIGHT / 2,
      }}
    >
      <ShieldCheck className="size-5 shrink-0 text-good-ink" strokeWidth={NODE_ICON_STROKE} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-foreground">{t("offline.mode")}</span>
        <span className="truncate">{t("offline.mode.bar")}</span>
      </span>
    </section>
  );
}
