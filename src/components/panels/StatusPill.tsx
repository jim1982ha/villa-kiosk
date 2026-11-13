// src/components/panels/StatusPill.tsx
// THE state pill of a device window (.status-pill, 03-panels.css): its tone, its icon, its words, on its own centred
// line (.status-line); `info`: what it means, behind the app's (i), which a tap opens (common/InfoTip).
//
// ⚠️ IT WAS FIVE COPIES (owner, 2026-11-10: "only 1 definition for all similar UI elements"): the lock's, the blind's,
// the lost-contact notice's two and a reading's each wrote the span and their own line around it, four margins and two
// sizes written inline. One line, one pill, one size; `inline` inside a line of readings (a group's members), where the
// line is its place's. ⚠️ ONE SIZE, EVERY WINDOW (owner, 2026-11-13: "the same style"): a sensor's pill was larger.
// Every device window draws it at its top, above its controls (ControlFrame), its capitals by its tone (03-panels).

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import InfoTip from "@/components/common/InfoTip";

export default function StatusPill({ tone, icon: Icon, inline = false, info, children }: {
  /** A `.status-pill` tone (utils/stateColors STATUS_PILL_CLASS): "usual", "active", "transitional", "warn", "danger", "unavailable", "novalue". */
  tone: string;
  icon?: LucideIcon;
  inline?: boolean;
  /** The (i) beside it: its name for a screen reader, and what its card says. */
  info?: { label: string; text: ReactNode };
  children: ReactNode;
}) {
  const pill = (
    <span className={`status-pill ${tone}`}>
      {Icon && <Icon size={16} />}
      {children}
    </span>
  );
  if (inline) return pill;
  return (
    <div className="status-line">
      {pill}
      {info && <InfoTip label={info.label}>{info.text}</InfoTip>}
    </div>
  );
}
