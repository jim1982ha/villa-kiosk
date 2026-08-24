// src/components/agent/ReflexObserve.tsx
//
// The two deterministic tiers underneath the agent: what acts by itself, and
// what is being recorded. Neither involves a model and both work with no
// internet, which is the fact each tab leads with.
//
// ⚠️ THEY SHARE A FILE BECAUSE THEY SHARE A SOURCE. Both read the single
// diagnostics document the dialog already fetches, and neither is big enough to
// earn its own module; splitting them would mean two files importing the same
// payload and the same helpers to render four numbers each.

import { TierIntro, TIERS, FAMILIES } from "./tiers";
import SourceChip from "@/components/common/SourceChip";
import type { ReportsDiagnostics } from "@/reports/reportsApi";

/** ⚠️ ONE FORMATTER, BOTH TABS. A count rendered "1,284" in one place and
 *  "1284" three lines below reads as two different systems reporting. */
const num = (n: number) => n.toLocaleString();

/** "3 minutes ago" from an ISO stamp, or "" when there is nothing to say.
 *  ⚠️ RELATIVE, BECAUSE THE QUESTION IS ALWAYS "IS THIS STILL HAPPENING". An
 *  absolute timestamp makes the reader do the subtraction, and on a wall tablet
 *  they are standing up. */
function ago(iso: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} days ago`;
}

export function ReflexTab({ diagnostics }: {
  diagnostics: ReportsDiagnostics | null;
}) {
  const c = diagnostics?.collector;
  const families = c?.blueprintCategories ?? [];
  return (
    <div className="reports-pane">
      <TierIntro tier={TIERS.reflex} />

      <h3 className="settings-section-title">What acts on its own</h3>
      {/* ⚠️ THE COUNT IS EVIDENCE THEY ARE WIRED, AND THE ROLE IS WHY THEY ARE
          KEPT. Those are opposite questions and this list used to answer only
          the first: a family that has never fired looks identical to one that
          does not exist, and a family being retired looked identical to one
          that is permanent. */}
      <ul className="reports-list">
        {families.map((cat) => {
          const seen = c?.seenTypes[`vesta_${cat}_event`] ?? 0;
          const fam = FAMILIES[cat];
          return (
            <li key={cat} className={`reports-item${seen ? "" : " muted"}`}>
              <span>{cat}</span>
              {fam?.reflex && <SourceChip source="reflex" />}
              {fam && <span className="muted body-text">{fam.role}</span>}
              <span>{seen ? `${num(seen)} so far` : "nothing yet"}</span>
            </li>
          );
        })}
        {families.length === 0 && (
          <li className="reports-item muted">
            None are installed. Nothing on this property acts by itself, and the
            checks in Briefings do the watching instead.
          </li>
        )}
      </ul>
      <p className="muted body-text">
        These are the only automations that survive the move to an assistant, and
        they are kept deliberately: a leak has to close a valve in under a
        second, with no internet and nothing thinking about it first. They act —
        they no longer file reports, because everything above reads the villa
        directly.
      </p>
    </div>
  );
}

export function ObserveTab({ diagnostics }: {
  diagnostics: ReportsDiagnostics | null;
}) {
  const c = diagnostics?.collector;
  return (
    <div className="reports-pane">
      <TierIntro tier={TIERS.observe} />

      {/* ⚠️ "IS ANYTHING LISTENING" IS THE FIRST QUESTION AND THE ONLY ONE THAT
          INVALIDATES THE REST. Everything above this tier judges a window; if
          the window was empty, every judgement in it is wrong in a way nobody
          can see. `connected`, NEVER `onlineSince` — the latter is persisted and
          reads true forever after the first connect, which is the exact lie
          `connected` was added to replace. */}
      <div className={`fm-banner${c?.connected ? "" : " warn"}`}>
        {c?.connected
          ? `Listening. Last change seen ${ago(c.lastEventAt) || "recently"}.`
          : "Not listening — nothing is being recorded, so anything above this "
            + "is judging an empty window."}
      </div>

      <h3 className="settings-section-title">What is being recorded</h3>
      <dl className="reports-facts">
        <div>
          <dt>Changes buffered</dt>
          <dd>{num(c?.buffered ?? 0)}</dd>
        </div>
        {/* ⚠️ DROPS ARE SHOWN EVEN AT ZERO, unlike most counters here. A gap in
            the record is the one fault that makes the tiers above quietly
            wrong, so its absence has to be readable as "checked, none" rather
            than as "not measured". */}
        <div>
          <dt>Changes missed</dt>
          <dd>{num(c?.drops ?? 0)}</dd>
        </div>
        <div>
          <dt>Listening since</dt>
          <dd>{ago(c?.connectedSince ?? "") || "—"}</dd>
        </div>
      </dl>
      <p className="muted body-text">
        Every material change is written to a rolling record on the property, and
        each reading is scored against that device's own recent history rather
        than against a number somebody typed in. That is what lets the villa
        watch roughly 1,250 things without anyone tuning a threshold — and why a
        device behaving oddly <em>for itself</em> is noticed even when its value
        looks ordinary.
      </p>

      {c?.silentTypes && c.silentTypes.length > 0 && (
        <>
          <h3 className="settings-section-title">Heard nothing from</h3>
          {/* ⚠️ A ZERO IS AMBIGUOUS AND MUST SAY SO: either nothing of that kind
              happened, or that source does not report at all. The second is what
              once hid an entire alert tier. */}
          <p className="muted body-text">
            Nothing has arrived from {c.silentTypes.join(", ")} in this window.
            That is either a quiet villa or a source that is not reporting, and
            from here the two look the same.
          </p>
        </>
      )}
    </div>
  );
}
