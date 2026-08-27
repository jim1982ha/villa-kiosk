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

import InfoHint from "@/components/common/InfoHint";
import { TierIntro, TIERS, FAMILIES } from "./tiers";
import { useHA } from "@/ha/HAStateStore";
import type { ReportsDiagnostics } from "@/reports/reportsApi";

/** What a family that emits NO events has actually been doing, read from Home
 *  Assistant's own automations.
 *
 *  ⚠️ THE COUNT BESIDE `control` COULD ONLY EVER SAY "nothing yet", AND DID
 *  (2026-08-28, reported: "i am surprise to see that Control is not reporting
 *  anything… how can you factually prove me that it's working"). Every count on
 *  this tab came from the collector's tally of `vesta_<family>_event`, and a
 *  control automation ACTS — it turns the fan on — and emits nothing. So the
 *  cell was structurally pinned at zero while four of these ran that same day.
 *  A number with one possible value is not a status, it is decoration; this app
 *  removed a lifecycle chip for exactly that reason.
 *
 *  ⚠️ SO IT ASKS A DIFFERENT SOURCE, WHICH IS THE ONLY HONEST ONE AVAILABLE.
 *  Home Assistant stamps `last_triggered` on every automation, so "did this
 *  fire, and when" is a fact already on the wire — no new plumbing, no event
 *  the blueprints would have to start emitting, and it keeps working for
 *  automations an owner wrote themselves as long as they follow the naming.
 *
 *  ⚠️ MATCHED ON THE FAMILY PREFIX, which is the SAME convention the event
 *  names use (`vesta_<family>_event` is derived from the blueprint's filename
 *  stem). Nothing villa-specific: `control` is this project's own stem, and the
 *  friendly name is whatever the owner's instance carries after it. */
function actedFrom(entities: Record<string, { state?: string; attributes?: Record<string, unknown> }>,
                   family: string): { configured: number; on: number; fired: number; today: number } {
  const out = { configured: 0, on: 0, fired: 0, today: 0 };
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const [id, e] of Object.entries(entities ?? {})) {
    if (!id.startsWith("automation.")) continue;
    const name = String(e?.attributes?.friendly_name ?? "");
    if (!name.startsWith(`${family}_`)) continue;
    out.configured += 1;
    if (String(e?.state ?? "") === "on") out.on += 1;
    const last = String(e?.attributes?.last_triggered ?? "");
    const at = last ? Date.parse(last) : NaN;
    if (Number.isFinite(at)) {
      out.fired += 1;
      if (at >= dayAgo) out.today += 1;
    }
  }
  return out;
}

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
  const { entities } = useHA();
  // ⚠️ ONLY WHAT ACTS BY ITSELF. This listed EVERY blueprint family the
  // collector knows about — including `maintenance` and `roi`, which are
  // retired detection the assistant replaced, and `audit`, which is a channel
  // test. None of them acts on anything. Tier 0's whole definition is "acts on
  // its own, in under a second, with no AI", so a family that only REPORTS has
  // no business on this tab; listing it invited the reader to think this tier
  // still does the villa's detecting. Reported as confusing and irrelevant, and
  // it was both.
  const families = (c?.blueprintCategories ?? [])
    .filter((cat) => FAMILIES[cat]?.reflex);
  return (
    <div className="reports-pane">
      <TierIntro tier={TIERS.reflex} />

      <h3 className="settings-section-title">What acts on its own</h3>
      {/* ⚠️ ABOVE THE TABLE, NOT UNDER IT. Nothing follows a table anywhere else
          in this app, and this paragraph is the ANSWER to the question the table
          raises rather than a footnote to it: these are the only rules left, and
          the assistant does not depend on them. `sources.build_document` — the
          only thing triage ever reads — is the observation journal, salience,
          the open concerns, the facility ledger and coverage. No blueprint
          output reaches it. */}
      <p className="muted body-text">
        These act by themselves, with no assistant and no internet. Everything
        else the villa notices is judged by the assistant instead.
        <InfoHint label="Why these stay">
          <p>
            A leak has to close a valve in under a second, with no internet and
            nothing thinking about it first — no assistant can promise that.
          </p>
          <p>
            The rules that only REPORTED have been retired, and nothing is lost:
            the assistant never read their output. It watches the villa&apos;s
            own readings directly, so switching one off takes nothing away from
            what it can notice.
          </p>
        </InfoHint>
      </p>
      {/* ⚠️ A GRID, NOT `.reports-list`. Each row carried a name, a chip, a
          sentence and a count in one flex line, so on a phone every row wrapped
          differently and the counts landed under the prose instead of in a
          column — reported as barely readable. Three tracks give the name, the
          role and the count one position each, right-aligned with tabular
          figures so the numbers line up. */}
      <dl className="reflex-table">
        {families.map((cat) => {
          const seen = c?.seenTypes[`vesta_${cat}_event`] ?? 0;
          const fam = FAMILIES[cat];
          // ⚠️ A FAMILY THAT REPORTS NOTHING IS COUNTED FROM ITS AUTOMATIONS
          // INSTEAD, not left at zero. See `actedFrom`. `acted` is null for
          // every family that DOES emit events, so their cells are unchanged
          // byte for byte and the collector stays their one source.
          const acted = fam?.silent ? actedFrom(entities, cat) : null;
          const live = acted ? acted.today || acted.fired || acted.configured : seen;
          return (
            <div key={cat} className={`reflex-row${live ? "" : " muted"}`}>
              <dt>{cat}</dt>
              {/* ⚠️ NEVER BLANK. An unlisted family rendered an empty cell, which
                  reads as "this family does nothing" rather than "nobody has
                  described it" — `control` and `vesta` both showed that way. */}
              <dd className="reflex-role">{fam?.role ?? "not yet described"}</dd>
              {/* ⚠️ THE MOST RECENT TRUE THING, not a running total. For a
                  reporting family the total IS the answer; for an acting one
                  "4 acted today" answers "is this alive", which is the question
                  a reader opens this tab with. The full breakdown is the
                  tooltip, so the column stays one short phrase wide. */}
              <dd className="reflex-count"
                  title={acted
                    ? `${acted.configured} set up, ${acted.on} switched on, `
                      + `${acted.fired} have ever fired, ${acted.today} in the `
                      + `last 24 hours. Counted from Home Assistant's own `
                      + `automations, because this family acts rather than `
                      + `reports and so emits nothing to count.`
                    : undefined}>
                {acted
                  ? (acted.today ? `${num(acted.today)} acted today`
                    : acted.fired ? `${num(acted.fired)} have fired`
                    : acted.configured ? `${num(acted.configured)} set up`
                    : "none installed")
                  : (seen ? `${num(seen)} so far` : "nothing yet")}
              </dd>
            </div>
          );
        })}
        {families.length === 0 && (
          <p className="muted body-text">
            None are installed, so nothing on this property acts by itself.
            The assistant still watches and tells you; it just cannot close a
            valve for you.
          </p>
        )}
      </dl>
    </div>
  );
}

export function ObserveTab({ diagnostics }: {
  diagnostics: ReportsDiagnostics | null;
}) {
  const c = diagnostics?.collector;
  // ⚠️ TWO DIFFERENT INPUTS, AND CONFLATING THEM IS WHAT THIS TAB DID. `c` is
  // the blueprint-event collector; `j` is the journal of entity state changes,
  // which is the one the checks reason over.
  const j = diagnostics?.journal;
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
          ? `Recording. Last change seen ${ago(c.lastEventAt) || "recently"}.`
          : "Not recording — so every check above this one is reading an "
            + "empty window."}
      </div>

      {/* ⚠️ THE JOURNAL, NOT THE COLLECTOR. This block showed `collector` —
          which counts BLUEPRINT EVENTS (`vesta_*_event`, `telegram_text`) and
          is not subscribed to `state_changed` at all — under a heading claiming
          it was what the checks read. So a light turning on moved nothing here,
          and the owner asked why. The checks read the JOURNAL: every entity
          polled on the observation cycle, every material change written down.
          The collector is a separate input and is nearly silent now that the
          blueprints it listens to are retired, which is why it is one line
          below rather than three tiles. */}
      <h3 className="settings-section-title">What the checks read</h3>
      <dl className="reports-facts">
        <div>
          <dt>Changes recorded</dt>
          <dd>{num(j?.entries ?? 0)}</dd>
        </div>
        <div>
          <dt>Devices watched</dt>
          <dd>{num(j?.entities ?? 0)}</dd>
        </div>
        <div>
          {/* ⚠️ THE DEPTH ON HAND, NOT THE DESIGN FIGURE. `salience` is built
              around 28 days; what the villa actually holds is whatever fits the
              ring at its own change rate. Saying the design number here is the
              claim this screen was corrected for once already. */}
          <dt>History held</dt>
          <dd>{j?.spanDays
            ? `${j!.spanDays.toFixed(1)} days` : "—"}</dd>
        </div>
      </dl>
      {/* ⚠️ THE RING IS BOUNDED AND SAYS SO WHEN IT BINDS. At the bound the
          oldest changes are being dropped, which silently shortens every window
          the checks reason over — the one fact about this store that changes
          what the tiers above can conclude. */}
      {j?.atBound && (
        <p className="body-text sev-warning" role="status">
          The record is full at {num(j!.bound)} changes, so the oldest are
          being dropped. Checks can only reason over what is left.
        </p>
      )}
      {/* ⚠️ "FOUR WEEKS OF HISTORY" WAS A CLAIM THIS SCREEN CANNOT KEEP, and it
          was mine. Four weeks is the scoring window's DESIGN figure; what the
          villa actually holds is whatever fits in the rolling record, which at
          the reference property's change rate is about two days. Stating the
          design figure as though it were the depth on hand is the shape of
          error dry-audit Part 3 exists for — a sentence read as authority that
          quietly stopped being true. Say the rule, and let the count above say
          the depth. */}
      <p className="muted body-text">
        Each reading is scored against that device's own past, not against a
        threshold anybody typed in.
        <InfoHint label="How the record works">
          Every material change is written to a rolling record on the property.
          Scoring each reading against that device's own history is what lets
          the villa watch everything it can see without anyone tuning a number —
          and why a device behaving oddly <em>for itself</em> is noticed even
          when its value looks ordinary. How far back it can look is bounded by
          the record above: once that is full, the oldest changes are dropped to
          make room.
        </InfoHint>
      </p>

      {c?.silentTypes && c.silentTypes.length > 0 && (
        <>
          <h3 className="settings-section-title">Blueprint events not seen</h3>
          {/* ⚠️ A ZERO IS AMBIGUOUS AND MUST SAY SO: either nothing of that kind
              happened, or that source does not report at all. The second is what
              once hid an entire alert tier. */}
          <p className="muted body-text">
            Nothing has arrived from {c.silentTypes.join(", ")} in this window.
            {/* ⚠️ THE AMBIGUITY MOVES, IT IS NOT DROPPED. A zero here means
                either outcome and saying so is the whole value of the line;
                what it does not need is a second sentence of screen. */}
            <InfoHint label="Heard nothing from">
              That is either a quiet villa or a source that is not reporting,
              and from here the two look the same. Worth checking only if you
              expected that kind of event recently.
            </InfoHint>
          </p>
        </>
      )}
    </div>
  );
}
