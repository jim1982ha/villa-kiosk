// src/components/cockpit/CockpitModal.tsx
// Cockpit as its own dialog — the shell only; the content is `CockpitTab`.
//
// ⚠️ THIS EXISTS FOR THE PROFILES THAT HAVE NO FACILITY WORKSPACE (2.569.0).
// The owner reported "two distinct icons / modals feels redundant", and for
// them it was: they could open Cockpit and Facility side by side. Cockpit is
// now Facility's first tab, and the HUD's alert icon opens it there — for
// anyone holding `manageFacility`.
//
// A GUEST HOLDS NEITHER, and Cockpit was never gated. Deleting this file would
// have removed the villa's only status view from the profile most likely to be
// standing in front of the tablet, in the name of tidying the owner's own
// screen. So the redundancy is resolved per PROFILE rather than per FILE: one
// implementation (`CockpitTab`), two shells, and nobody sees both.
//
// ⚠️ THE DRILL-DOWN PANEL IS A SIBLING OF THIS DIALOG, NOT A CHILD. It renders
// its own `.modal-backdrop` (via BasePanel), and nesting one backdrop inside
// another lets a click meant to dismiss just the panel bubble up and close this
// dialog with it — the panel's backdrop has no reason to stopPropagation,
// because normally it IS the outermost one. FacilityModal keeps the same shape
// for the same reason.

import { useState } from "react";
import { useModalA11y } from "@/hooks/useModalA11y";
import ModalFooter from "@/components/common/ModalFooter";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability } from "@/auth/permissions";
import SummaryGroupPanel, { type SummaryGroup } from "@/components/panels/SummaryGroupPanel";
import CockpitTab from "./CockpitTab";

export interface CockpitModalProps {
  onClose: () => void;
  mappedEntityIds: Set<string>;
  onOpenEntity: (entityId: string) => void;
  /** Open a Facility RECORD — see `CockpitTab`'s own prop docstring. In this
   *  shell it is normally absent: a profile that can reach Facility is sent to
   *  Facility's Cockpit tab instead of here. */
  onOpenRecord?: (kind: "fault" | "schedule", recordId: string) => void;
}

export default function CockpitModal({
  onClose, mappedEntityIds, onOpenEntity, onOpenRecord,
}: CockpitModalProps) {
  const dialogRef = useModalA11y(onClose);
  const { role } = useProfile();
  const canControl = role != null && hasCapability(role, "controlEntities");
  const [drill, setDrill] = useState<SummaryGroup | null>(null);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          ref={dialogRef}
          // `.settings-modal` already carries the 780px width, so this keeps
          // the classes it always had minus a dead `cockpit-modal` that
          // styled nothing (removed from test_css_classes' KNOWN_HOOKS with it).
          className="modal settings-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Villa Cockpit"
        >
          <div className="settings-header">
            <h2>Cockpit</h2>
          </div>

          <div className="settings-body">
            <CockpitTab
              mappedEntityIds={mappedEntityIds}
              onOpenEntity={onOpenEntity}
              onOpenRecord={onOpenRecord}
              onOpenGroup={setDrill}
            />
          </div>

          <ModalFooter onClose={onClose} />
        </div>
      </div>

      {drill && (
        <SummaryGroupPanel
          group={drill}
          canControl={canControl}
          mappedEntityIds={mappedEntityIds}
          onClose={() => setDrill(null)}
          onOpenEntity={(id) => { setDrill(null); onOpenEntity(id); }}
        />
      )}
    </>
  );
}
