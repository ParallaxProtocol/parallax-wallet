import { useEffect, useState, type ReactNode } from "react";
import {
  AppWindow,
  Dices,
  EyeOff,
  HardDrive,
  LockKeyhole,
  MemoryStick,
  Moon,
  PackageCheck,
  ScreenShareOff,
  ScrollText,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { api, CONFIG_UPDATED_EVENT, type GUIConfig, type SecurityStatus, type WindowSecurity } from "../../lib/api";
import { useTorStatus } from "../../lib/torStatus";
import { useAssistant } from "../../lib/assistantContext";
import { useSettingsSheet } from "../../lib/settingsSheet";
import { useT } from "../../i18n";
import { Rows } from "../../components/ui/Panel";
import { Pill } from "../../components/ui/Pill";
import type { Tone } from "../../components/ui/tone";
import { OnionSymbol, SparklesSymbol } from "../../components/ui/symbols";

type Status = { label: string; tone: Tone };

/**
 * Protections is Settings' account of what guards the wallet (Security)
 * or what you do (Privacy), each with whether it's working now: what can
 * be read from the backend (SecurityStatus), the window (WindowSecurity),
 * the platform and the settings shows as it stands; what is built in
 * shows as always on.
 */
export default function Protections({ kind }: { kind: "security" | "privacy" }) {
  const t = useT();
  const tor = useTorStatus();
  const { status: assistants } = useAssistant();
  const { setSection } = useSettingsSheet();
  const [backend, setBackend] = useState<SecurityStatus | null>(null);
  const [win, setWin] = useState<WindowSecurity | null>(null);
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const platform = window.parallax?.platform ?? "";

  useEffect(() => {
    let alive = true;
    if (kind === "security") {
      api
        .securityStatus()
        .then((s) => alive && setBackend(s))
        .catch(() => {});
      window.parallax
        ?.security()
        .then((s) => alive && setWin(s))
        .catch(() => {});
    }
    // The settings it reports on change elsewhere (auto-lock, just above): read again as they do
    const load = () =>
      api
        .getConfig()
        .then((c) => alive && setCfg(c))
        .catch(() => {});
    load();
    window.addEventListener(CONFIG_UPDATED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(CONFIG_UPDATED_EVENT, load);
    };
  }, [kind]);

  const on: Status = { label: t("protect.status.on"), tone: "good" };
  const always: Status = { label: t("protect.status.always"), tone: "good" };
  const partly: Status = { label: t("protect.status.partly"), tone: "warn" };
  const off: Status = { label: t("protect.status.off"), tone: "neutral" };

  if (kind === "privacy") {
    return (
      <Rows>
        <Protection icon={HardDrive} title={t("protect.ownNode")} desc={t("protect.ownNode.desc")} status={always} />
        {/* Its switch is this section's own, above */}
        <Protection
          icon={OnionSymbol}
          title={t("protect.tor")}
          desc={t("protect.tor.desc")}
          status={tor && (tor.enabled ? on : off)}
        />
        <Protection
          icon={EyeOff}
          title={t("protect.tracking")}
          desc={t("protect.tracking.desc")}
          status={cfg && (cfg.reportStats ? { label: t("protect.status.shared"), tone: "info" } : on)}
          note={cfg?.reportStats ? t("protect.tracking.shared") : null}
          action={
            cfg?.reportStats ? (
              <button type="button" className="btn btn-flat btn-sm" onClick={() => setSection("network")}>
                {t("protect.tracking.cta")}
              </button>
            ) : null
          }
        />
        <Protection icon={ScrollText} title={t("protect.logs")} desc={t("protect.logs.desc")} status={always} />
        <Protection
          icon={SparklesSymbol}
          title={t("protect.assistants")}
          desc={t("protect.assistants.desc")}
          status={
            cfg &&
            ((assistants?.enabled ?? cfg.mcpEnabled) ? on : { label: t("protect.status.notInUse"), tone: "neutral" })
          }
        />
      </Rows>
    );
  }

  // What a platform hasn't isn't listed: each row says what is in effect on this computer
  const mac = platform === "darwin";
  const windows = platform === "win32";
  const lockMinutes = cfg ? cfg.autoLockMinutes || 15 : null;
  return (
    <Rows>
      <Protection
        icon={LockKeyhole}
        title={t("protect.encryption")}
        desc={t("protect.encryption.desc")}
        status={always}
      />
      {/* Every key and phrase comes from crypto/rand: the system's own generator, which Go never lets fail quietly */}
      <Protection
        icon={Dices}
        title={t("protect.random")}
        desc={[
          t(windows ? "protect.random.windows" : mac ? "protect.random.mac" : "protect.random.linux"),
          backend?.hardwareRandom ? t("protect.random.hardware") : "",
          t("protect.random.failClosed"),
        ]
          .filter(Boolean)
          .join(" ")}
        status={always}
      />
      {/* Locked memory everywhere; wiped after use too where Go's runtime/secret erases (Linux) */}
      <Protection
        icon={MemoryStick}
        title={t("protect.memory")}
        desc={
          backend?.secretErasing ? `${t("protect.memory.desc")} ${t("protect.memory.erase")}` : t("protect.memory.desc")
        }
        status={always}
      />
      {backend && (backend.noCoreDumps || backend.noMemoryReads) && (
        <Protection
          icon={ShieldCheck}
          title={t("protect.process")}
          desc={backend.noMemoryReads ? t("protect.process.desc") : t("protect.process.dumps")}
          status={on}
        />
      )}
      <Protection
        icon={Timer}
        title={t("protect.autoLock")}
        desc={t("protect.autoLock.desc")}
        status={lockMinutes === null ? null : lockMinutes > 0 ? on : { label: t("protect.status.off"), tone: "warn" }}
        note={lockMinutes !== null && lockMinutes < 0 ? t("protect.autoLock.never") : null}
      />
      {/* Linux desktops tell apps of sleep, not of the screen locking */}
      {platform && (
        <Protection
          icon={Moon}
          title={t("protect.away")}
          desc={mac || windows ? t("protect.away.desc") : t("protect.away.sleep")}
          status={on}
        />
      )}
      {(mac || windows) && (
        <Protection icon={ScreenShareOff} title={t("protect.capture")} desc={t("protect.capture.desc")} status={on} />
      )}
      <Protection
        icon={AppWindow}
        title={t("protect.isolation")}
        desc={t("protect.isolation.desc")}
        status={win && (win.sandboxed && win.isolated ? (win.packaged ? on : partly) : off)}
        note={win && win.sandboxed && win.isolated && !win.packaged ? t("protect.isolation.dev") : null}
      />
      <Protection icon={PackageCheck} title={t("protect.updates")} desc={t("protect.updates.desc")} status={always} />
    </Rows>
  );
}

/**
 * Protection is one row: its symbol, what it is and does, a note on how it
 * stands where it isn't fully on, and its status (none until it's known),
 * with what changes it beside it.
 */
function Protection({
  icon: Icon,
  title,
  desc,
  status,
  note,
  action,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  status: Status | null;
  note?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3">
      <Icon className="size-5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{title}</span>
        <span className="text-sm text-muted-foreground">{desc}</span>
        {/* What holds it back: a warning where the status is one, else an explanation */}
        {note && (
          <span className={`text-sm ${status?.tone === "warn" ? "text-warn-ink" : "text-muted-foreground"}`}>
            {note}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {status && (
          <Pill tone={status.tone} aria-label={`${title}: ${status.label}`}>
            {status.label}
          </Pill>
        )}
      </div>
    </div>
  );
}
