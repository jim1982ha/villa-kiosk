// src/components/fm/ReadinessTab.tsx
// "Is the villa fit for the next guest?"
//
// Every check is derived, never hand-ticked: the point is that it reflects the
// villa's ACTUAL live state, which is the one thing a paper checklist can't do.
// A failing check names the devices behind it and opens them directly.

import type { ReactNode } from "react";
import SaveButton from "@/components/common/SaveButton";
import { CheckCircle2, AlertTriangle, XCircle, ChevronRight, Camera, Download } from "lucide-react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useMonthlyDocument } from "@/fm/useMonthlyDocument";
import type { DocumentInputs } from "@/fm/monthlyDocument";
import SavedDocumentsList from "./SavedDocumentsList";
import MarkdownPreview from "./MarkdownPreview";
import { SourceIconRow } from "./sourceIcons";
import { CHECK_WORDS, VERDICT_WORDS, type CheckLink, type CheckState, type CheckTarget, type ReadinessCheck, type ReadinessResult } from "@/fm/readiness";
import { pillClass, toneClass } from "@/fm/tone";
import RecordCard from "./RecordCard";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";

const ICON: Record<CheckState, typeof CheckCircle2> = {
  pass: CheckCircle2, warn: AlertTriangle, fail: XCircle,
};

/** Chips before "Show all": a row of chips holds more than a list's first three rows, and eight fit a phone's two lines. */
const CHECK_CHIPS = 8;

export default function ReadinessTab({
  inputs, onOpenEntity, onOpenCheck, onGo,
}: {
  /** What the snapshot is made from — the live readiness among it (monthlyDocument.DocumentInputs). */
  inputs: DocumentInputs;
  onOpenEntity: (id: string) => void;
  /** Opens a check's own devices as a list (readiness.CheckTarget) — every
   *  check the same way. */
  onOpenCheck: (target: CheckTarget) => void;
  /** Opens the place a check's linked word names (readiness.CheckLink). */
  onGo: (to: CheckLink["to"]) => void;
}) {
  const label = useEntityLabel();
  // Freezing the check turns it from a live readout into evidence (see
  // buildReadinessSnapshot): made and saved in one tap, then shown, saved,
  // reopened and downloaded like the recap and the statement.
  const snapshot = useMonthlyDocument("readiness", inputs);
  const { readiness } = inputs;
  return (
    <div className="fm-stack">
      <ReadinessChecks readiness={readiness} label={label} onOpenEntity={onOpenEntity} onOpenCheck={onOpenCheck} onGo={onGo}
        save={<SaveButton saved={snapshot.saved} label="Save snapshot" icon={<Camera size={16} />} style={{ marginLeft: "auto" }}
          onClick={() => void snapshot.generateAndSave()} />} />

      <SavedDocumentsList kind="readiness" onOpen={snapshot.reopen} />
      {snapshot.markdown && (
        <div className="fm-stack">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={snapshot.close}>Close snapshot</button>
            <button className="btn ghost" onClick={snapshot.download}>
              <Download size={16} /> Download .md
            </button>
          </div>
          <MarkdownPreview markdown={snapshot.markdown} />
        </div>
      )}
    </div>
  );
}

/** The verdict and, under it, the checks — each with its own devices' button (readiness.CheckTarget) and a chip per
 *  device. Drawn by tests/oracles/readiness_checks.mjs. */
export function ReadinessChecks({ readiness, label, onOpenEntity, onOpenCheck, onGo, save }: {
  readiness: ReadinessResult;
  /** A device's name on its chip. */
  label: (id: string) => string;
  onOpenEntity: (id: string) => void;
  onOpenCheck: (target: CheckTarget) => void;
  onGo: (to: CheckLink["to"]) => void;
  /** The verdict line's Save snapshot. */
  save?: ReactNode;
}) {
  // ⚠️ THE CHECKS ARE ALWAYS SHOWN (owner, 2026-11-05: "always expanded, remove the capability to collapse"): they
  // folded under their verdict while the monthly recap was under them (owner, 2026-10-14); the recap is the Spend tab's

  // the verdict's ONE sentence (readiness.VERDICT_WORDS — the saved snapshot's too)
  const headline = VERDICT_WORDS[readiness.overall];

  const HeadlineIcon = ICON[readiness.overall];

  return (
    <>
      {/* Freezing the check turns it from a live readout into evidence — see
          buildReadinessSnapshot. Same generate-and-keep shape as the recap
          and spend statement, and it lands in the same saved-documents store,
          so a handover pack can include the check actually run on the day. */}
      <div className={`fm-headline ${toneClass(CHECK_WORDS[readiness.overall].tone)}`}>
        <span className="fm-headline-icon"><HeadlineIcon size={22} /></span>
        <span className="fm-headline-text">
          <strong>{headline}</strong>
          <span className="muted">{readiness.passed} of {readiness.total} checks passing</span>
        </span>
        {save}
      </div>

      <div className="fm-list">
        {readiness.checks.map((c) => {
          const Icon = ICON[c.state];
          const opens = c.entityIds?.length ? c.opens : undefined;
          // Every check names its devices as chips, the devices not reporting too (owner, 2026-10-18: "the same way the
          // unlocked device or on lights are shown as pills"); the first few, then the rest by pages (CheckDevices).
          const chips = !!c.entityIds?.length;
          return (
            // THE Cockpit card (RecordCard), as every list (owner, 2026-10-22: "wherever there is a card, the same style")
            // its word in its strip, as every card's state ("Pass", "Warning", "Fail"), and what it opens a segment of its
            // bar: every button of a card is in its bar (the "Status on top" card; it sat beside the title)
            <RecordCard key={c.id} tone={toneClass(CHECK_WORDS[c.state].tone)}
              status={{ text: CHECK_WORDS[c.state].word, tone: pillClass(CHECK_WORDS[c.state].tone) }}
              lead={<span className={`fm-check-icon ${c.state}`}><Icon size={16} /></span>}
              title={c.label}
              actions={opens ? (
                <button className="btn ghost" onClick={() => onOpenCheck(opens)}>
                  {opens.label} <ChevronRight size={16} />
                </button>
              ) : undefined}
              body={<>
                <div className="fm-row-sub muted"><CheckDetail check={c} onGo={onGo} /></div>
                {chips && c.entityIds && <CheckDevices ids={c.entityIds} label={label} onOpenEntity={onOpenEntity} />}
              </>} />
          );
        })}
      </div>

    </>
  );
}

/** A check's line — its linked words opening the place they name (readiness.CheckLink: "faults" Open issues, "tickets"
 *  the Tickets tab, owner 2026-11-05), the open faults' source icons before "faults", as the Overview shows them (owner,
 *  2026-10-14). */
function CheckDetail({ check, onGo }: { check: ReadinessCheck; onGo: (to: CheckLink["to"]) => void }) {
  const out: ReactNode[] = [];
  let rest = check.detail;
  for (const link of check.goes ?? []) {
    const at = rest.search(new RegExp(`\\b${link.word}\\b`));
    if (at < 0) continue;
    out.push(rest.slice(0, at));
    if (link.word === "faults" && check.sources?.length) {
      out.push(<SourceIconRow key={`${link.word}-icons`} sources={check.sources} severity={check.state === "fail" ? "danger" : "warn"} />, " ");
    }
    out.push(<button key={link.word} type="button" className="fm-text-link" onClick={() => onGo(link.to)}>{link.word}</button>);
    rest = rest.slice(at + link.word.length);
  }
  return <>{out}{rest}</>;
}

/** A check's devices as chips: the first eight, then the rest a page of ten at a time, with a way back (the one
 *  truncated list, common/TruncatedList). ⚠️ "+N MORE" COULD NOT BE TAPPED (architecture review 2026-10-31 round 12
 *  #3): past eight, a device not reporting was named nowhere on the screen. */
function CheckDevices({ ids, label, onOpenEntity }: {
  ids: string[]; label: (id: string) => string; onOpenEntity: (id: string) => void;
}) {
  const list = useTruncated(ids, CHECK_CHIPS);
  return (
    <>
      <div className="fm-chiprow">
        {list.visible.map((id) => (
          <button key={id} className="fm-entity-chip" onClick={() => onOpenEntity(id)}>
            {label(id)}
          </button>
        ))}
      </div>
      <ShowAll list={list} noun="device" />
    </>
  );
}
