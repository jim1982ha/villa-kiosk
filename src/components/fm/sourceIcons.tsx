// src/components/fm/sourceIcons.tsx
// THE icon of each source of a problem (fm/issueSource), its word and what it means — the Open issues cards draw it in
// place of the warning sign (owner, 2026-10-14), the (i) beside "Open a ticket" lists them all (FaultTiming). One
// table: a card and its legend can never disagree.

import { CalendarCog, MessageCircle, MoonStar, Radio, Siren, UserRound } from "lucide-react";
import type { AriaAttributes, ComponentType } from "react";
import { ROLE_INITIALS, type Role } from "@/auth/roles";
import type { AttentionSeverity } from "@/config/attention";
import type { IssueSource } from "@/fm/issueSource";

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
  owner: "Owner", fm: "Facility manager", person: "Person", guest: "Guest", schedule: "Schedule",
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
        return <Icon key={`${s}-${i}`} size={size} aria-hidden className={`cockpit-attention-icon cockpit-attention-${severities[i] ?? severities[0]}`} />;
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
        return <Icon key={s} size={size} aria-hidden className={`cockpit-attention-icon cockpit-attention-${severity}`} />;
      })}
    </span>
  );
}
