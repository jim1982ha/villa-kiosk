// src/components/panels/WindowPieces.tsx
// The pieces the Weather and Energy windows share, written once: a figure
// (a label over a value) and a row of observation cards. They were copied
// between the two windows, markup and all (round-6 candidate 6, 2.496.119).

import type { Observation } from "@/config/observation";

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
