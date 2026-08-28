// src/components/agent/AgentAdvancedModal.tsx
//
// The agent's occasional settings, one door back from the daily ones.
//
// ⚠️ THE SAME SHAPE SETTINGS USES FOR ADVANCED SETTINGS, and deliberately so.
// Cost, who may talk to the villa, the provider key and the comparison against
// the old rules are each opened rarely and none belong in the path somebody
// walks to change a cadence. Inlining them buried the four dials that are
// actually tuned, which is the reading problem the whole reorganisation is
// about.

import { KeyRound, Receipt, SlidersHorizontal, Users } from "lucide-react";

import { useModalA11y } from "@/hooks/useModalA11y";
import ModalTabs from "@/components/common/ModalTabs";
import ModalFooter from "@/components/common/ModalFooter";
import { AgentConfigProvider,
         useAgentConfigDraft } from "@/agent/AgentConfigDraft";
import ApiKeyPanel from "@/components/settings/ApiKeyPanel";
import PeoplePanel from "@/components/settings/PeoplePanel";
import AgentTuningPanel from "@/components/settings/AgentTuningPanel";
import FlagTypesPanel from "@/components/settings/FlagTypesPanel";
import UsagePanel from "@/components/settings/UsagePanel";
import { useState } from "react";

type Tab = "settings" | "cost" | "people" | "key";

const TABS: { id: Tab; label: string; icon: typeof Receipt }[] = [
  // ⚠️ SETTINGS FIRST, AND IT MOVED HERE IN 2.759.0 BY REQUEST. The tier dialog
  // is five TABS THAT ARE STEPS, read top to bottom; a settings pane among them
  // was the only one that was not a step and sat where a reader following the
  // sequence expected a sixth. It leads here because it is the one an owner
  // opens to CHANGE something — cost, people and the key are read far more
  // often than they are edited.
  //
  // ⚠️ COST WAS FIRST UNTIL THEN, on the grounds that it is the tab an owner
  // opens unprompted. Still true, and it is second rather than displaced: the
  // dials that decide the cost now sit directly beside the page that reports
  // it, which is the pairing the old arrangement split across two dialogs.
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
  { id: "cost", label: "Cost", icon: Receipt },
  { id: "people", label: "Who may talk to it", icon: Users },
  { id: "key", label: "Provider key", icon: KeyRound },
  // ⚠️ THE "HANDOVER" TAB WAS DELETED IN 2.756.0, AND ITS QUESTION IS WHY. It
  // compared what the assistant concluded against what the villa's automations
  // concluded over the same period, so an owner could decide whether retiring
  // them was safe. That decision is taken and the automations are retired — one
  // side of the comparison is permanently silent, so the page could only ever
  // print "N things your automations caught and the villa did not" about a
  // period in which nothing was listening on that side. Its live half, the
  // triage trace, moved to the Triage tab where it belongs.
];

/** ⚠️ SAME SHAPE AS `AgentModal`, AND IT HAD THE SAME DEFECT. The provider must
 *  wrap the DIALOG, or the footer has no draft to commit and each tab edits a
 *  private one. */
export default function AgentAdvancedModal({ onBack }: { onBack: () => void }) {
  return (
    <AgentConfigProvider enabled>
      <AdvancedDialog onBack={onBack} />
    </AgentConfigProvider>
  );
}

function AdvancedDialog({ onBack }: { onBack: () => void }) {
  const draft = useAgentConfigDraft();
  const dialogRef = useModalA11y(onBack);
  // ⚠️ THE FIRST TAB, DERIVED — NOT A SECOND COPY OF WHICH ONE THAT IS
  // (2026-08-27). 2.759.0 moved Settings to the front of `TABS` and left this
  // literal reading "cost", so the dialog opened on the SECOND tab: the strip
  // said Settings led and the pane showed Cost, which is the screen
  // contradicting itself. Reading `TABS[0]` makes the order the single source
  // of truth, so reordering the strip cannot leave the opening pane behind.
  const [tab, setTab] = useState<Tab>(TABS[0].id);
  return (
    <div className="modal-backdrop" onClick={onBack}>
      <div
        ref={dialogRef}
        // ⚠️ `modal settings-modal config-editor-modal`, THE FULL TRIPLE, AND
        // OMITTING `.modal` COST ALL THREE SYMPTOMS THE OWNER REPORTED. `.modal`
        // carries the background, the width cap, the border, the elevation and
        // the flex column; `.settings-modal` alone styles the INSIDE of a card
        // that was never given a card. So the dialog rendered with no ground of
        // its own, sat wherever the backdrop's centring left it, and — because
        // `.config-editor-modal` was missing too — resized vertically as its
        // body changed. That last one is the defect that rule's own comment
        // describes: `.modal` only CAPS height, so a dialog whose tab switches
        // from a two-row list to a dozen rows visibly grows around the reader.
        // Every other dialog in the app already used all three.
        className="modal settings-modal config-editor-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Assistant settings and others"
      >
        <div className="settings-header"><h2>Settings &amp; others</h2></div>
        <ModalTabs tabs={TABS} active={tab} onSelect={setTab}
                   commit={draft}
          label="Advanced assistant sections" />
        <div className="settings-body">
          {/* ⚠️ THE TAUGHT KINDS SIT ON *SETTINGS*, BENEATH THE DIALS, NOT ON A
              TAB OF THEIR OWN. It is a tuning surface — the same question as
              the cadence and the depth, asked about kinds of finding rather
              than about the clock — and a fifth tab holding one list is a tab
              nobody opens twice, which is the reasoning already recorded above
              for the source legend landing on Cost. */}
          {tab === "settings" && (
            <div className="reports-pane">
              <AgentTuningPanel />
              <FlagTypesPanel />
            </div>
          )}
          {tab === "cost" && (
            <div className="reports-pane">
              <UsagePanel />
              {/* ⚠️ THE LEGEND LANDS ON *COST*, NOT ON A TAB OF ITS OWN. Every
                  one of its six labels answers "where did this come from", and
                  the page where that question is actually asked is the one
                  itemising what each source charged. A seventh tab holding one
                  static key would be a tab nobody opens twice. */}
            </div>
          )}
          {/* ⚠️ ONE DRAFT PROVIDER AROUND THE TWO THAT WRITE CONFIG. Two panels
              each loading, versioning and PUTting one document is a lost
              update — the store refuses a write whose revision is stale, so
              saving one silently discarded the other's edit. */}
          {(tab === "people" || tab === "key") && (
            <div className="reports-pane">
              {tab === "people" && <PeoplePanel />}
              {tab === "key" && <ApiKeyPanel />}
            </div>
          )}
        </div>
        <ModalFooter commit={draft} onClose={onBack} />
      </div>
    </div>
  );
}
