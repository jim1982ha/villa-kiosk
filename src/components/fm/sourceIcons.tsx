// src/components/fm/sourceIcons.tsx
// THE icon of each source of a problem (fm/issueSource), its word and what it means — the Open issues cards draw it in
// place of the warning sign (owner, 2026-10-14), the (i) beside "Open a ticket" lists them all (FaultTiming). One
// table: a card and its legend can never disagree.

import { Bot, CalendarCog, MessageCircle, MoonStar, Radio, Siren, UserRound } from "lucide-react";
import type { AriaAttributes, ComponentType } from "react";
import { ROLE_INITIALS, type Role } from "@/auth/roles";
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
  live: Radio, alert: Siren, night: MoonStar, chat: MessageCircle, agent: Bot,
  owner: roleBadge("owner"), fm: roleBadge("ops"), person: UserRound, guest: roleBadge("guest"), schedule: CalendarCog,
};

/** [its word, what it means] — the (i)'s legend. */
export const SOURCE_WORDS: Record<IssueSource, readonly [string, string]> = {
  live: ["Live", "What Home Assistant reports right now (unavailable, not in Home Assistant, unlocked…): goes by itself"],
  alert: ["Alert", "A VESTA alert from a Home Assistant rule, numbered as on Telegram (#5)"],
  night: ["Night check", "Found by the VESTA Agent's nightly check (offline, battery, energy use, Wi-Fi drops…)"],
  chat: ["Chat", "Created from a Telegram chat with the VESTA Agent (\"Create this fault\")"],
  agent: ["VESTA Agent", "Made by the VESTA Agent before it said from where"],
  owner: ["Owner", "A ticket the Owner opened"],
  fm: ["Facility manager", "A ticket the Facility manager opened"],
  person: ["Person", "A ticket opened in the Kiosk"],
  guest: ["Guest", "A problem a guest reported"],
  schedule: ["Schedule", "Maintenance overdue (Schedule tab)"],
};

/** A problem's source icons, stacked when a line holds two (a device's live state and its fault). Each in its own
 *  status colour (`kinds`: the class suffix — the status vocabulary: amber lost contact or due, red a confirmed
 *  problem). */
export function SourceIcons({ sources, kinds, size = 16 }: {
  sources: readonly IssueSource[];
  kinds: readonly string[];
  size?: number;
}) {
  return (
    <span className="cockpit-source-icons" aria-label={sources.map((s) => SOURCE_WORDS[s][0]).join(" and ")}>
      {sources.map((s, i) => {
        const Icon = SOURCE_ICON[s];
        return <Icon key={`${s}-${i}`} size={size} aria-hidden className={`cockpit-attention-icon cockpit-attention-${kinds[i] ?? kinds[0]}`} />;
      })}
    </span>
  );
}
