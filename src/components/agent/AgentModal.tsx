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

import { useEffect, useState } from "react";
import {
  Activity, Brain, Search, Send, SlidersHorizontal, Sparkles, Zap,
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
import { ReflexTab, ObserveTab } from "./ReflexObserve";
import { TierIntro, TIERS } from "./tiers";
import ActDeliverySection from "./ActDeliverySection";
import AgentAdvancedModal from "./AgentAdvancedModal";
import { loadAgentConfig } from "@/agent/agentApi";
import { fetchReportsDiagnostics,
         type ReportsDiagnostics } from "@/reports/reportsApi";
import AgentTuningPanel from "@/components/settings/AgentTuningPanel";

type Tab = "reflex" | "observe" | "triage" | "reason" | "act" | "settings";

/** ⚠️ THE SIX TABS ARE THE HLD'S FIVE TIERS, IN ITS ORDER, PLUS SETTINGS.
 *  §4 orders them by how fast each must answer and how much judgement it is
 *  trusted with — "speed decreases and judgement increases as you go up;
 *  determinism returns at the top, because deciding who to wake at 3am is not a
 *  judgement a model should make". Left to right is therefore the villa's own
 *  signal path: something happens, it is recorded, something cheap asks whether
 *  it matters, something expensive works out why, something deterministic
 *  decides who is told.
 *
 *  ⚠️ AND THE ORDER IS THE ARGUMENT, NOT DECORATION. The previous arrangement
 *  grouped by UI kind — lists, then settings — which put the cheapest tier
 *  beside the most expensive and gave a reader no way to see that one feeds the
 *  next. The owner's question about Concerns versus approvals was that missing
 *  sequence showing through.
 *
 *  ⚠️ THE FIRST TWO ARE NOT OWNER-GATED. Reflex and Observe describe what the
 *  property does with no AI in the path at all, and a facility manager has more
 *  reason to read them than the owner does. */
const TABS: { id: Tab; label: string; icon: typeof Sparkles; owner?: true }[] = [
  { id: "reflex", label: "Reflex", icon: Zap },
  { id: "observe", label: "Observe", icon: Activity },
  { id: "triage", label: "Triage", icon: Search, owner: true },
  { id: "reason", label: "Reason", icon: Brain },
  { id: "act", label: "Act & Tell", icon: Send, owner: true },
  { id: "settings", label: "Settings", icon: SlidersHorizontal, owner: true },
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
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "reflex");
  const [advanced, setAdvanced] = useState(false);
  // ⚠️ ONE FETCH FOR THE WHOLE DIALOG, ON OPEN. Reflex and Observe both read
  // the same diagnostics document, and two components each fetching it would
  // probe Home Assistant twice for one screen — that endpoint runs a live probe
  // per request, which is exactly why the Cockpit stopped calling it.
  const [diagnostics, setDiagnostics] = useState<ReportsDiagnostics | null>(null);
  const [cadence, setCadence] = useState<string>("");
  useEffect(() => {
    void loadAgentConfig().then((cfg) => {
      const mins = Number(cfg?.config?.triageMinutes ?? 0);
      if (Number.isFinite(mins) && mins > 0) {
        setCadence(mins % 60 === 0 && mins >= 60
          ? `every ${mins / 60} hour${mins === 60 ? "" : "s"}`
          : `every ${mins} minutes`);
      }
    });
  }, []);
  useEffect(() => { void fetchReportsDiagnostics().then(setDiagnostics); }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
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
          {/* ── Step 0 · what acts by itself ───────────────────────────── */}
          {tab === "reflex" && <ReflexTab diagnostics={diagnostics} />}

          {/* ── Step 1 · what is being recorded ────────────────────────── */}
          {tab === "observe" && <ObserveTab diagnostics={diagnostics} />}

          {/* ── Step 2 · the cheap pass that only points ───────────────── */}
          {tab === "triage" && (
            <div className="reports-pane">
              {/* ⚠️ THE VILLA'S OWN CADENCE, NOT THE HLD'S EXAMPLE. It read
                  "every 15 minutes" while this property runs 360 — a screen the
                  settings contradict. */}
              <TierIntro tier={TIERS.triage} speed={cadence} />
              {/* ⚠️ THE QUEUE IS THIS TIER'S ONLY OUTPUT, and the HLD is
                  emphatic about why it looks weak: triage "cannot act, cannot
                  notify, cannot write. It only escalates" — and it assigns NO
                  severity, because severity is what the investigation decides.
                  A row here is a pointer, not a finding. */}
              <CockpitQueue />
            </div>
          )}

          {/* ── Step 3 · the only tier that judges ─────────────────────── */}
          {tab === "reason" && (
            <div className="reports-pane">
              <TierIntro tier={TIERS.reason} />
              {/* Concerns first: the HLD calls a Concern "the single currency
                  of everything downstream", and this tier is the only thing
                  that mints one. */}
              <CockpitConcerns />
              {/* ⚠️ MEMORY AND DRAFTS BELONG TO THIS TIER, NOT TO SETTINGS.
                  Both are things the agent WORKED OUT — a learned claim about
                  the property, and a procedure it wrote — so they are outputs
                  of reasoning, filed with it. Memory is written only on the
                  reasoning path, never from a tool result, which is the rule
                  that stops a device name becoming a permanent claim. */}
              <CockpitMemories />
              <CockpitReview />
            </div>
          )}

          {/* ── Step 4 · who is told, and what may be done ─────────────── */}
          {tab === "act" && (
            <div className="reports-pane">
              <TierIntro tier={TIERS.act} />
              {/* ⚠️ THIS IS THE AUTHORITY BOUNDARY — §4.1 calls it "the most
                  important one". The model decides what matters; it never
                  decides who is told, whether a brief already went, or whether
                  an action is permitted. Anything that could let somebody in or
                  silence an alarm is offered here and never executed. */}
              {/* ⚠️ NO `SourceLegend` ON THESE TABS. The step header already
                  carries the one chip they would explain, so the key repeated
                  the same word directly beneath itself — reported as a
                  redundant badge. The legend earns its place where SEVERAL
                  sources appear together, not where one does. */}
              <CockpitProposals />
              <AgentConfigProvider enabled>
                <ActDeliverySection />
              </AgentConfigProvider>
            </div>
          )}

          {/* ── Settings ───────────────────────────────────────────────── */}
          {tab === "settings" && (
            <AgentConfigProvider enabled>
              <div className="reports-pane">
                <AgentTuningPanel />
                {/* ⚠️ THE REST BEHIND ONE DOOR, THE SAME SHAPE SETTINGS USES
                    FOR ADVANCED SETTINGS. Cost, people, the API key and the
                    shadow comparison are all things an owner opens
                    occasionally and none belong in the daily path — putting
                    them inline would bury the four dials that are actually
                    tuned. */}
                {/* ⚠️ THE KEY LIVES HERE NOW, AND NOWHERE ELSE. It was under
                    three tier tabs, each of which shows exactly ONE source —
                    so the key repeated the chip already in that tab's header,
                    directly beneath it, which is what the owner reported as a
                    redundant badge. A legend earns its place where a reader
                    learns the whole vocabulary at once, not where it restates
                    a single label. This is that place, and it is the only one:
                    the six labels are used across BOTH dialogs, so learning
                    them belongs with the settings rather than with any one
                    step. */}
                <SourceLegend />
                <button className="btn" onClick={() => setAdvanced(true)}>
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  <span>Cost, people and advanced</span>
                </button>
              </div>
            </AgentConfigProvider>
          )}
        </div>

        <ModalFooter onClose={onClose} />
      </div>
      {/* ⚠️ RENDERED AS A SIBLING, NOT NESTED, so its own backdrop covers this
          dialog rather than being clipped inside it — the same arrangement
          Settings uses for Advanced Settings. */}
      {advanced && <AgentAdvancedModal onBack={() => setAdvanced(false)} />}
    </div>
  );
}
