// src/components/common/ToolGroup.tsx
// THE group of tool buttons (owner, 2026-11-06: "the header's icon buttons the same style as the Settings header's
// theme control"): Advanced Settings' Upload Model and Log Out All, the telemetry's Refresh · Copy · Download · Clear ·
// Diagnose. One track in the segmented control's look (SegmentedGroup's .segmented, the same height, padding and
// radius), each tool a segment with its glyph and, where there is room, its word (.btn-label, hidden on a phone; its
// name stays its aria-label and title). A tool is pressed, never chosen: nothing in it is ever "selected".
import type { ReactNode } from "react";

export default function ToolGroup({ label, className = "", children }: {
  /** The group's name for assistive technology ("Device telemetry"). */
  label: string;
  className?: string;
  /** The tools: <button>s, each a glyph and a .btn-label word. */
  children: ReactNode;
}) {
  return <div className={`tool-group${className ? ` ${className}` : ""}`} role="group" aria-label={label}>{children}</div>;
}
