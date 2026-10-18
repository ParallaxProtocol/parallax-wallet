import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, ChevronRight } from "lucide-react";
import { api, openExternal, type ReleaseNotes } from "../lib/api";
import { useLang, useT } from "../i18n";
import { Modal } from "./ui/Modal";
import { Markdown } from "./ui/Markdown";
import { ActivitySpinner } from "./ui/ActivitySpinner";
import { Notice } from "./ui/bits";
import { SPRING } from "../lib/motion";

/** Where every release's page is, for the notes the app can't read. */
const RELEASES_URL = "https://github.com/ParallaxProtocol/parallax-wallet/releases";

/** Releases About's notes leave out: the first release's, which has nothing to say of the app since. */
const HIDDEN_RELEASES = new Set(["1.0.0"]);

/**
 * ReleaseNotesList is releases' notes as they have them, newest first, each
 * under its name and date, parted by a line across the dialog, as its
 * header and footer are. The update's dialog and About's both show them so.
 * Each folds under its name: those `expanded` picks start open (all of
 * them without it), the rest folded.
 */
export function ReleaseNotesList({
  releases,
  expanded,
}: {
  releases: ReleaseNotes[];
  expanded?: (version: string) => boolean;
}) {
  return (
    <div className="flex flex-col divide-y divide-border-strong">
      {releases.map((r) => (
        <Release key={r.version} release={r} initiallyOpen={expanded ? expanded(r.version) : true} />
      ))}
    </div>
  );
}

/** Release is one release's notes, folding under its name and date as Settings' Advanced does. */
function Release({ release: r, initiallyOpen }: { release: ReleaseNotes; initiallyOpen: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const [open, setOpen] = useState(initiallyOpen);
  const d = r.publishedAt ? new Date(r.publishedAt) : null;
  const date = d && !isNaN(d.getTime()) ? d.toLocaleDateString(lang, { dateStyle: "long" }) : "";
  return (
    <section>
      {/* The heading holds the button, as an accordion's does: its name stays a heading */}
      <h3>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-5 py-5 text-left transition-colors hover:bg-hover focus-visible:-outline-offset-2"
        >
          <span className="text-xl font-semibold tracking-tight">
            {t("updater.availableDesc", { version: r.version })}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            {date}
            <motion.span animate={{ rotate: open ? 90 : 0 }} transition={SPRING} className="flex">
              <ChevronRight className="size-4" />
            </motion.span>
          </span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="notes"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            {/* Its padding inside what folds, so the space folds with it */}
            <div className="px-5 pb-5">
              {r.notes.trim() ? (
                <Markdown text={r.notes} className="selectable" />
              ) : (
                <p className="text-muted-foreground">{t("updater.noNotes")}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * ReleaseNotesModal is About's release notes: every release up to the one
 * running, newest first, read from GitHub (through Tor while it's on) as
 * it opens, the running one's open and the older ones' folded.
 */
export function ReleaseNotesModal({ open, onClose, version }: { open: boolean; onClose: () => void; version: string }) {
  const t = useT();
  const [read, setRead] = useState<ReleaseNotes[] | null>(null);
  // Left out as they're shown, so a list kept from before (the last opening's) never shows them either
  const releases = read && read.filter((r) => !HIDDEN_RELEASES.has(r.version));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setErr(null);
    api
      .releaseNotes()
      .then((r) => alive && setRead(r ?? []))
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t("settings.about.notes")}
      subtitle={version ? `Parallax Wallet ${version}` : undefined}
      icon={<BookOpen />}
      footer={
        <div className="flex border-t border-border bg-surface/60 px-5 py-3">
          <button type="button" onClick={() => openExternal(RELEASES_URL)} className="btn btn-ghost -ml-2">
            {t("updater.viewOnGitHub")}
          </button>
        </div>
      }
    >
      {err ? (
        <div className="p-5">
          <Notice tone="critical" title={t("settings.about.notesFailed")}>
            {err}
          </Notice>
        </div>
      ) : releases === null ? (
        <div className="grid place-items-center py-16 text-foreground/70">
          <ActivitySpinner size={32} label={t("splash.loading")} />
        </div>
      ) : releases.length === 0 ? (
        <p className="p-5 text-muted-foreground">{t("updater.noNotes")}</p>
      ) : (
        // The version running open, the rest folded; a version not in the list (a development build's), the newest
        <ReleaseNotesList
          releases={releases}
          expanded={(v) => (releases.some((r) => r.version === version) ? v === version : v === releases[0].version)}
        />
      )}
    </Modal>
  );
}
