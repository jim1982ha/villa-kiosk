// src/components/ai/AiModal.tsx
// The AI layer, as a screen. Opened from Settings' footer (owner/facility
// manager only).
//
// ⚠️ THIS EXISTS BECAUSE THE PLAN HAD NO UI AT ALL. Thirty tickets built an
// engine whose entire surface was Home Assistant entities, notifications and
// Markdown files edited in a separate add-on — and the owner, on installing it,
// asked where the screens were. docs/adr/0015 and 0016 record the change of
// direction: one add-on, and the kiosk is its face.
//
// Two tabs, because there are exactly two questions: is it working, and what is
// it watching. It renders what the layer publishes and edits the files the
// layer reads; it holds no model client, no API key and no agent code.

import { useState } from "react";
import { Activity, BookOpen } from "lucide-react";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useHA } from "@/ha/HAStateStore";
import { AI_STATUS_ENTITY, readAiStatus } from "@/ai/aiLayer";
import AiStatusPanel from "./AiStatusPanel";
import AiSkillsPanel from "./AiSkillsPanel";

type AiTab = "status" | "skills";

const TABS: readonly ModalTab<AiTab>[] = [
  { id: "status", label: "Status", icon: Activity },
  { id: "skills", label: "Skills", icon: BookOpen },
];

export default function AiModal({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<AiTab>("status");
  const { entities } = useHA();
  const status = readAiStatus(entities[AI_STATUS_ENTITY]);
  const dialogRef = useModalA11y(onBack);

  return (
    <div className="modal-backdrop" onClick={onBack}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="VESTA AI"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <div className="settings-title">VESTA AI</div>
          <ModalTabs tabs={TABS} active={tab} onSelect={setTab} label="AI sections" />
        </div>
        <div className="settings-body">
          {tab === "status"
            ? <AiStatusPanel status={status} />
            : <AiSkillsPanel />}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onBack}>Back</button>
        </div>
      </div>
    </div>
  );
}
