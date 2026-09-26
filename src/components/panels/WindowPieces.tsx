// src/components/panels/WindowPieces.tsx
// The pieces the Weather and Energy windows share, written once: the window
// itself (DataWindow), a figure (a label over a value) and a row of
// observation cards. They were copied between the two windows, markup and all
// (round-6 candidate 6, 2.496.119; the window shell round 9, 2.496.145).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, LineChart as LineChartIcon } from "lucide-react";
import BasePanel from "./BasePanel";
import type { Observation } from "@/config/observation";

/**
 * A data window from the summary bar (Weather, Energy): a NOW screen and a
 * HISTORY AND TRENDS screen. The window owns what both copied — which screen
 * is shown, opening each at its top (the body is one scroll area, so History
 * opened wherever Now had been scrolled to), the back arrow, the header's
 * live note or period picker, and the footer button (in Settings' "Advanced
 * Settings" style, visible however far the body scrolls). Each window passes
 * only its content; each screen mounts only while shown.
 */
export function DataWindow({ title, icon, live, picker, className, onClose, now, history }: {
  title: string; icon: ReactNode;
  /** The header on the Now screen (a live note). */
  live: ReactNode;
  /** The header on the History screen (the period picker). */
  picker: ReactNode;
  /** Beside `summary-group-modal data-window` — the window's own styling hook. */
  className?: string;
  onClose: () => void;
  now: () => ReactNode;
  history: () => ReactNode;
}) {
  const [view, setView] = useState<"now" | "history">("now");
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { topRef.current?.closest(".panel-body")?.scrollTo({ top: 0 }); }, [view]);
  const back = (
    <button type="button" className="data-window-back" onClick={() => setView("now")} aria-label={`Back to ${title}`}>
      <ChevronLeft size={22} />
    </button>
  );
  return (
    <BasePanel
      title={view === "now" ? title : "History and trends"}
      icon={view === "now" ? icon : back}
      className={`summary-group-modal data-window${className ? ` ${className}` : ""}`}
      history={false}
      onClose={onClose}
      headerActions={view === "now" ? live : picker}
      footerLeading={view === "now" && (
        <button type="button" className="btn ghost" onClick={() => setView("history")}>
          <LineChartIcon size={18} /> History and trends
        </button>
      )}
    >
      <div ref={topRef} />
      {view === "now" ? now() : history()}
    </BasePanel>
  );
}

/** The header's quiet live note ("live · 16 s ago", "Home Assistant Energy"). */
export function LiveNote({ children }: { children: ReactNode }) {
  return <span className="data-window-live">{children}</span>;
}

/** A card: good (✓), neutral (·), caution or bad (!) — config/observation. */
export type ObservationCard = Observation;

const MARK = { good: "✓", neutral: "·", caution: "!", bad: "!" } as const;

/** The observation cards, sharing their row however many there are. */
export function ObservationCards({ cards }: { cards: readonly ObservationCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="weather-advice">
      {cards.map((a) => (
        <div key={a.title} className={`weather-advice-card tone-${a.tone}`}>
          <div className="weather-advice-title"><span className="weather-advice-mark" aria-hidden="true">{MARK[a.tone]}</span>{a.title}</div>
          <div className="weather-advice-detail">{a.detail}</div>
        </div>
      ))}
    </div>
  );
}

/** A figure: its label, then its value. */
export function Figure({ label, value }: { label: string; value: string }) {
  return <div className="weather-figure"><div className="weather-figure-l">{label}</div><div className="weather-figure-v">{value}</div></div>;
}
