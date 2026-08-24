// src/components/agent/AgentModal.tsx
//
// Everything the agent produces, and nothing else. The whole reasoning layer in
// one dialog.
//
// ⚠️ IT EXISTS BECAUSE THE SUBSYSTEM WAS SPLIT ACROSS THREE. Its conclusions
// were in the Facility Cockpit, its tuning, people and API key in Advanced
// Settings, its running cost in a fourth tab and its comparison against the old
// rules in a fifth. The owner asked twice where "Concerns" were shown, which is
// the correct question to ask of a product that had put one subsystem behind
// three doors.
//
// ⚠️ AND THE LIGHT HALF MOVED, NOT THE HEAVY ONE. `ReportsModal` carries a real
// data layer — config, revision, diagnostics, history, preview, save, compose,
// send — that ONLY its five report tabs read. Every block here fetches its own
// data and owns its own capability check, so extracting these was a relocation
// with no shared state to untangle. Cutting the other way would have meant
// moving ~400 lines of fetch/save cycle and getting the revision handling wrong
// on the way; a scan of both halves found zero cross-references between them,
// which is what made the direction obvious rather than a guess.
//
// ⚠️ NO CAPABILITY IS READ HERE AND THAT IS DELIBERATE. Every block owns its
// own — the same rule `test_cockpit_is_gated_nowhere` protects — because "what
// is the villa concluding about my property" is not a privileged question, and
// a dialog-level gate would make it one.

import { useState } from "react";
import {
  BookMarked, GitCompare, HandHelping, KeyRound, Receipt, Search,
  SlidersHorizontal, Sparkles,
} from "lucide-react";

import { useModalA11y } from "@/hooks/useModalA11y";
import ModalTabs from "@/components/common/ModalTabs";
import ModalFooter from "@/components/common/ModalFooter";
import SourceLegend from "@/components/common/SourceLegend";
import { AgentConfigProvider } from "@/agent/AgentConfigDraft";
import CockpitConcerns from "@/components/cockpit/CockpitConcerns";
import CockpitMemories from "@/components/cockpit/CockpitMemories";
import CockpitProposals from "@/components/cockpit/CockpitProposals";
import CockpitQueue from "@/components/cockpit/CockpitQueue";
import CockpitReview from "@/components/cockpit/CockpitReview";
import AgentTuningPanel from "@/components/settings/AgentTuningPanel";
import ApiKeyPanel from "@/components/settings/ApiKeyPanel";
import PeoplePanel from "@/components/settings/PeoplePanel";
import ShadowDiffPanel from "@/components/settings/ShadowDiffPanel";
import UsagePanel from "@/components/settings/UsagePanel";

type Tab =
  | "concerns" | "look" | "act" | "memory"
  | "tuning" | "access" | "usage" | "shadow";

/** ⚠️ THE FIRST THREE ARE NAMED BY THE DECISION THEY NEED, NOT BY THEIR STAGE,
 *  AND THE OWNER'S QUESTION IS WHY. They asked what the difference was between
 *  "Concerns" and "Waiting on you" — a fair question, because BOTH earlier
 *  names described the pipeline rather than the reader's job, and two of the
 *  three tabs wanted a decision without saying so.
 *
 *  Concerns is the only one where nothing is blocked: it is a conclusion, and
 *  reading it is the whole interaction. The other two each block something
 *  different, so each says what it is asking for:
 *
 *    Approve a look   — spend a run investigating something triage flagged
 *    Approve an action— let the villa DO something, or adopt a procedure
 *
 *  ⚠️ AND THE ORDER IS STILL THE PIPELINE. A look precedes a concern precedes
 *  an action, so a reader scanning left to right meets the stages in the order
 *  they happen even though the names no longer announce them. */
const TABS: { id: Tab; label: string; icon: typeof Sparkles; owner?: true }[] = [
  { id: "look", label: "Approve a look", icon: Search, owner: true },
  { id: "concerns", label: "Concerns", icon: Sparkles },
  { id: "act", label: "Approve an action", icon: HandHelping, owner: true },
  { id: "memory", label: "Memory", icon: BookMarked, owner: true },
  { id: "tuning", label: "Tuning", icon: SlidersHorizontal, owner: true },
  { id: "access", label: "Access", icon: KeyRound, owner: true },
  { id: "usage", label: "Cost", icon: Receipt, owner: true },
  { id: "shadow", label: "Shadow diff", icon: GitCompare, owner: true },
];

export default function AgentModal(
  { onClose, canConfigure }:
  { onClose: () => void; canConfigure: boolean },
) {
  const dialogRef = useModalA11y(onClose);
  const tabs = TABS.filter((t) => canConfigure || !t.owner);
  // ⚠️ THE FIRST VISIBLE TAB, NEVER A LITERAL. Hard-coding one that a facility
  // manager cannot see opens them on an empty body with nothing selected —
  // the defect `ReportsModal` records having shipped.
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "concerns");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="VESTA Agent"
      >
        <div className="settings-header">
          <h2>VESTA Agent</h2>
        </div>

        <ModalTabs
          tabs={tabs}
          active={tab}
          onSelect={setTab}
          label="VESTA Agent sections"
        />

        <div className="settings-body">
          {tab === "look" && (
            <div className="reports-pane">
              <CockpitQueue />
              <SourceLegend only={["triage"]} />
            </div>
          )}
          {tab === "concerns" && (
            <div className="reports-pane">
              <CockpitConcerns />
              <SourceLegend only={["agent"]} />
            </div>
          )}
          {/* ⚠️ TWO BLOCKS, ONE TAB, BECAUSE THEY ARE ONE DECISION: something is
              stopped until a person answers. A proposal is an action on the
              villa with a countdown; a review is a procedure it wrote. Separate
              tabs would show an empty dialog as two broken ones. */}
          {tab === "act" && (
            <div className="reports-pane">
              <CockpitProposals />
              <CockpitReview />
              <SourceLegend only={["agent"]} />
            </div>
          )}
          {tab === "memory" && (
            <div className="reports-pane"><CockpitMemories /></div>
          )}
          {/* ⚠️ THE CONFIG TABS SHARE ONE DRAFT PROVIDER. Two panels each
              loading, versioning and PUTting the same document is a lost
              update — the store refuses a write whose `rev` is stale, so saving
              one silently discarded the other's edit. */}
          {(tab === "tuning" || tab === "access") && (
            <AgentConfigProvider enabled>
              <div className="reports-pane">
                {tab === "tuning" && <AgentTuningPanel />}
                {tab === "access" && <><PeoplePanel /><ApiKeyPanel /></>}
              </div>
            </AgentConfigProvider>
          )}
          {tab === "usage" && <div className="reports-pane"><UsagePanel /></div>}
          {tab === "shadow" && <div className="reports-pane"><ShadowDiffPanel /></div>}
        </div>

        <ModalFooter onClose={onClose} />
      </div>
    </div>
  );
}
