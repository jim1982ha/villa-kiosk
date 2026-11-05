// src/components/fm/sourceIcons.tsx
// THE icon of each source of a problem (fm/issueSource), its word and what it means — the Open issues cards draw it in
// place of the warning sign (owner, 2026-10-14), the (i) beside "Open a ticket" lists them all (FaultTiming). One
// table: a card and its legend can never disagree.

//
// ⚠️ EACH ICON ITS OWN TIP (owner, 2026-11-06: "the same way each icon has a specific line in the tooltip table, make
// sure each card shows the specific icon's tooltip"): every source icon a card draws, and the Watch card's check, is
// the button of a tip (IconTip, the one (i) card: common/InfoTip) holding THAT icon's row of the table, from the same
// rows (fm/faultTiming timingRow): its icon and name, What it is, Appears, Goes. Two icons, two tips.

import { CalendarCog, CheckCircle2, MessageCircle, MoonStar, Radio, Siren, UserRound } from "lucide-react";
import type { AriaAttributes, ComponentType, ReactNode } from "react";
import { ROLE_INITIALS, ROLE_LABELS, type Role } from "@/auth/roles";
import type { AttentionSeverity } from "@/config/attention";
import type { IssueSource } from "@/fm/issueSource";
import type { AgentCadence } from "@/agent/agentApi";
import { useAgentCadence } from "@/agent/AgentContext";
import { confirmingRow, timingRow, TIMING_HEADS, type TimingKey } from "@/fm/faultTiming";
import InfoTip from "@/components/common/InfoTip";

type IconProps = { size?: number | string; className?: string; "aria-hidden"?: AriaAttributes["aria-hidden"] };
type IconType = ComponentType<IconProps>;

/** A profile as the top bar's signed-in badge draws it — its letter(s) in a circle (HUD .hud-role-badge, ROLE_INITIALS)
 *  — at an icon's size and outlined in the line's status colour, as every other source icon (owner, 2026-10-14: "re-use
 *  the same style as the connected profile"). */
const roleBadge = (role: Role): IconType => function RoleBadge({ size = 16, className, ...rest }: IconProps) {
  const text = ROLE_INITIALS[role];
  return (
    <span {...rest} className={`source-role-badge${text.length > 1 ? " two" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: Number(size) + 2, height: Number(size) + 2 }}>{text}</span>
  );
};

export const SOURCE_ICON: Record<IssueSource, IconType> = {
  live: Radio, alert: Siren, night: MoonStar, chat: MessageCircle,
  owner: roleBadge("owner"), fm: roleBadge("ops"), person: UserRound, guest: roleBadge("guest"), schedule: CalendarCog,
};

/** Its word — the (i)'s table says what it is and when it comes and goes (fm/faultTiming). ⚠️ "MAINTENANCE CHECK", NOT
 *  "NIGHT CHECK" (owner, 2026-10-19): the VESTA Agent's maintenance skill also opens a fault within minutes for a device
 *  that goes offline and reads its faults again every few minutes, so "night" named only one of its runs. The moon stays
 *  (owner: "keep the night icon so that user knows it has been created by the nightly check"). */
export const SOURCE_WORDS: Record<IssueSource, string> = {
  live: "Live", alert: "Alert", night: "Maintenance check", chat: "Chat",
  // a profile's source is its name, from the one role table (architecture review round 8, 2026-10-30)
  owner: ROLE_LABELS.owner, fm: ROLE_LABELS.ops, person: "Person", guest: ROLE_LABELS.guest, schedule: "Schedule",
};

/** A problem's source icons, stacked when a line holds two (a device's live state and its fault). Each in its
 *  problem's severity (config/attention.attentionSeverity — the class suffix: amber a warning, red danger). */
export function SourceIcons({ sources, severities, size = 16 }: {
  sources: readonly IssueSource[];
  severities: readonly AttentionSeverity[];
  size?: number;
}) {
  return (
    <span className="cockpit-source-icons" aria-label={sources.map((s) => SOURCE_WORDS[s]).join(" and ")}>
      {sources.map((s, i) => {
        const Icon = SOURCE_ICON[s];
        return <IconTip key={`${s}-${i}`} k={s}
          icon={<Icon size={size} aria-hidden className={`cockpit-attention-icon cockpit-attention-${severities[i] ?? severities[0]}`} />} />;
      })}
    </span>
  );
}

/** The sources of several faults on one line ("Check the ⏾ ⚑ faults in Messages", the Recap's readiness) — side by
 *  side, each in the line's severity (a fault is a warning: amber, owner 2026-10-18), named for a screen reader. */
export function SourceIconRow({ sources, severity, size = 15 }: {
  sources: readonly IssueSource[];
  severity: AttentionSeverity;
  size?: number;
}) {
  return (
    <span className="source-icon-row" aria-label={sources.map((s) => SOURCE_WORDS[s]).join(", ")}>
      {sources.map((s) => {
        const Icon = SOURCE_ICON[s];
        return <IconTip key={s} k={s} icon={<Icon size={size} aria-hidden className={`cockpit-attention-icon cockpit-attention-${severity}`} />} />;
      })}
    </span>
  );
}

/** The check a cleared problem on the Watch list wears in place of its source (owner, 2026-10-23), in the status green:
 *  the Watch card's and the (i)'s table's. */
export function WatchedIcon({ size }: { size: number }) {
  return <CheckCircle2 size={size} className="fault-watched-icon" aria-hidden="true" />;
}

/** What a tip names: its icon's word, the Watch check's "On watch" (fm/faultTiming confirmingRow). */
export const timingWords = (k: TimingKey): string => (k === "watch" ? confirmingRow(null).words : SOURCE_WORDS[k]);

/** An icon and its name, as the (i)'s table's first column and an icon's tip draw it. */
export function TimingName({ k }: { k: TimingKey }) {
  const Icon = k === "watch" ? null : SOURCE_ICON[k];
  return (
    <span className="info-pop-source">
      {Icon ? <Icon size={15} aria-hidden /> : <WatchedIcon size={15} />} <b>{timingWords(k)}</b>
    </span>
  );
}

/** ONE icon's tip, drawn from its row (timingRow) and the Agent's cadence: its name, then What it is, Appears, Goes.
 *  Pure: tests/oracles/source_tips.mjs draws it beside the table. */
export function SourceTipCard({ k, cadence }: { k: TimingKey; cadence: AgentCadence | null }) {
  const row = timingRow(k, cadence);
  return (
    <div className="source-tip">
      <TimingName k={k} />
      <dl className="source-tip-lines">
        {(Object.keys(TIMING_HEADS) as (keyof typeof TIMING_HEADS)[]).map((c) => (
          <div key={c}><dt>{TIMING_HEADS[c]}</dt><dd>{row[c]}</dd></div>
        ))}
      </dl>
    </div>
  );
}

/** The tip with the Agent's own timing, as the (i)'s table reads it (FaultTiming). */
function SourceTip({ k }: { k: TimingKey }) {
  return <SourceTipCard k={k} cadence={useAgentCadence()} />;
}

/** The tip's width: one row, three short lines. */
const SOURCE_TIP_WIDTH = 320;

/** An icon on a card that opens its own row of the table, on hover with a mouse and on a tap (the one (i) card:
 *  common/InfoTip, its icon the button). */
export function IconTip({ k, icon }: { k: TimingKey; icon: ReactNode }) {
  return (
    <InfoTip label={`${timingWords(k)}: what it means`} trigger={icon} className="source-icon-tip" width={SOURCE_TIP_WIDTH}>
      <SourceTip k={k} />
    </InfoTip>
  );
}
