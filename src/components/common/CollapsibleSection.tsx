// src/components/common/CollapsibleSection.tsx
//
// A section title that doubles as a collapse toggle.
//
// ⚠️ IT MOVED OUT OF `ConfigEditorModal` AND ITS JOB NARROWED (v2.653.0). It
// was wrapping whole SECTIONS of Advanced Settings — the entity table, grouped
// devices, telemetry — so a tab opened on nothing but headings and every visit
// began with a click that revealed how much there was. Those three now show
// their first few rows instead (`common/TruncatedList`), which states the size
// of a list by showing it.
//
// What is left is the case a collapse is actually right for: a block that is
// not a list and is not what the reader came for — the raw telemetry log under
// the buttons that copy and download it. Collapsed by default, because reading
// it is a deliberate act.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function CollapsibleSection({
  title, defaultOpen = false, children,
}: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        className="settings-section-title settings-section-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {title}
      </button>
      {open && children}
    </>
  );
}
