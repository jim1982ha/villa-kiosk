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
// ⚠️ ITS CHROME IS THE CONFIG EDITOR'S, DELIBERATELY. Same backdrop, same
// `.settings-header` with the h2 carrying `data-autofocus`, same tab strip
// OUTSIDE the scrolling body, same `ModalFooter`. A settings surface that looks
// like a different app is one the owner has to learn twice.

import { useCallback, useState } from "react";
import { Activity, BookOpen, SlidersHorizontal } from "lucide-react";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import ModalFooter, { type ModalCommit } from "@/components/common/ModalFooter";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability, type Capability } from "@/auth/permissions";
import { AI_STATUS_ENTITY, readAiStatus } from "@/ai/aiLayer";
import AiStatusPanel from "./AiStatusPanel";
import AiSkillsPanel from "./AiSkillsPanel";
import AiSettingsPanel, { type AiSettingsHandle } from "./AiSettingsPanel";

type AiTab = "status" | "skills" | "settings";

const TABS: (ModalTab<AiTab> & { owner?: true })[] = [
  { id: "status", label: "Status", icon: Activity },
  { id: "skills", label: "Skills", icon: BookOpen },
  // Only the owner sets the credential and the spend limit; a facility manager
  // maintains what the property watches, which is the Skills tab.
  { id: "settings", label: "Settings", icon: SlidersHorizontal, owner: true },
];

export default function AiModal({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<AiTab>("status");
  const [settings, setSettings] = useState<AiSettingsHandle | null>(null);
  const { entities } = useHA();
  const { role } = useProfile();
  const can = (c: Capability) => role != null && hasCapability(role, c);
  const status = readAiStatus(entities[AI_STATUS_ENTITY]);
  const dialogRef = useModalA11y(onBack);

  const tabs = TABS.filter((t) => !t.owner || can("editConfig"));

  // ⚠️ ONLY THE SETTINGS TAB HAS A DRAFT. Status renders what the layer
  // publishes and Skills saves each file as you go, so passing a commit on
  // those would put a permanently-clean Save button under two screens that can
  // lose nothing — and would make the tab strip ask about unsaved work that
  // does not exist.
  const commit: ModalCommit | null = tab === "settings" && settings
    ? {
      dirty: settings.dirty,
      saving: settings.saving,
      error: settings.error,
      save: () => settings.save(),
      discard: settings.discard,
    }
    : null;

  const onSettingsState = useCallback((h: AiSettingsHandle) => setSettings(h), []);

  return (
    <div className="modal-backdrop" onClick={onBack}>
      <div
        ref={dialogRef}
        className="modal settings-modal config-editor-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="VESTA AI"
      >
        <div className="settings-header">
          {/* tabIndex={-1} + data-autofocus, for the same reason the Config
              Editor does it: the heading is the conventional dialog-open focus
              target, and without it focus lands on the first control instead. */}
          <h2 tabIndex={-1} data-autofocus>VESTA AI</h2>
        </div>

        {/* Outside `.settings-body`: the strip is chrome and the body scrolls.
            Inside, it would scroll out of reach on the long tabs. */}
        <ModalTabs
          tabs={tabs}
          active={tab}
          onSelect={setTab}
          label="AI sections"
          commit={commit}
        />

        <div className="settings-body">
          {tab === "status" && <AiStatusPanel status={status} />}
          {tab === "skills" && <AiSkillsPanel />}
          {tab === "settings" && <AiSettingsPanel onState={onSettingsState} />}
        </div>

        <ModalFooter commit={commit} onClose={onBack} />
      </div>
    </div>
  );
}
