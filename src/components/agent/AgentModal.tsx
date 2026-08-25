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
  Activity, Brain, Search, Send, SlidersHorizontal, Sparkles, Zap, Eye, EyeOff,
} from "lucide-react";

import { useModalA11y } from "@/hooks/useModalA11y";
import ModalTabs from "@/components/common/ModalTabs";
import ModalFooter from "@/components/common/ModalFooter";
import RecentChecks from "@/components/agent/RecentChecks";
import { loadTriagePasses, type TriagePass } from "@/agent/agentApi";
import { AgentConfigProvider,
         useAgentConfigDraft } from "@/agent/AgentConfigDraft";
import AgentConcerns from "@/components/agent/AgentConcerns";
import AgentMemories from "@/components/agent/AgentMemories";
import AgentProposals from "@/components/agent/AgentProposals";
import AgentQueue from "@/components/agent/AgentQueue";
import AgentReview from "@/components/agent/AgentReview";
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

/** The tiers that genuinely stop when supervision is switched off.
 *
 *  ⚠️ THREE OF SIX, NOT ALL OF THEM, AND THE DIFFERENCE IS CHECKED IN THE CODE
 *  RATHER THAN ASSUMED. `scheduler`, `runtime` and `outbox` each refuse on
 *  `enabled`, so Triage, Reason and Act really do go inert. REFLEX does not:
 *  those are Home Assistant blueprints that fire with no add-on and no model,
 *  which is the entire reason Tier 0 exists. OBSERVE does not either —
 *  `observe/cycle.py` contains no `enabled` check at all, so the journal keeps
 *  recording, and it costs nothing because no model is involved.
 *
 *  ⚠️ GREYING THE OTHER TWO WOULD BE A LIE OF EXACTLY THE KIND THIS SUBSYSTEM
 *  KEEPS PAYING FOR: a working tier presented as stopped, so an owner reading
 *  a dimmed Observe tab concludes their villa recorded nothing during the
 *  period it was off. It recorded everything. */
const INERT_WHEN_OFF: ReadonlySet<Tab> = new Set(["triage", "reason", "act"]);

/** ⚠️ THE PROVIDER WRAPS THE WHOLE DIALOG, AND WRAPPING IT PER TAB IS WHY SAVE
 *  DID NOTHING. `AgentConfigDraft`'s own docstring says it: "the provider wraps
 *  the whole dialog rather than the one tab that edits — a draft must survive a
 *  tab switch, and the button that commits it lives outside every tab." I put
 *  it inside two tabs instead, which broke the feature twice over: the footer
 *  sat OUTSIDE every provider so it had no draft to commit, and the two tabs
 *  each created their OWN draft, so an edit on one was invisible to the other
 *  and to anything that might have read it. Reported as changing a setting and
 *  never seeing Save light up. */
export default function AgentModal(props: {
  onClose: () => void; canConfigure: boolean;
}) {
  return (
    <AgentConfigProvider enabled={props.canConfigure}>
      <AgentDialog {...props} />
    </AgentConfigProvider>
  );
}

function AgentDialog(
  { onClose, canConfigure }:
  { onClose: () => void; canConfigure: boolean },
) {
  const draft = useAgentConfigDraft();
  const dialogRef = useModalA11y(onClose);
  const tabs = TABS.filter((t) => canConfigure || !t.owner);
  // ⚠️ THE FIRST VISIBLE TAB, NEVER A LITERAL. Hard-coding one that a facility
  // manager cannot see opens them on an empty body with nothing selected —
  // the defect `ReportsModal` records having shipped.
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "reflex");
  // ⚠️ THE DRAFT, NOT THE SAVED CONFIG, so the panes dim the moment the header
  // switch is flipped rather than only after Save — which is what makes the
  // switch feel like it did something.
  const offAndInert = draft.config.enabled !== true && INERT_WHEN_OFF.has(tab);

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
  /** ⚠️ FETCHED HERE AND NOT INSIDE `RecentChecks`, so the component stays a
   *  renderer with no I/O of its own — the Handover panel already loads these
   *  alongside its diff and would otherwise be fetching them twice, once
   *  itself and once through its child. */
  const [passes, setPasses] = useState<TriagePass[]>([]);
  useEffect(() => { void loadTriagePasses().then(setPasses); }, []);

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
        {/* ⚠️ THE MASTER SWITCH IS IN THE HEADER BECAUSE IT IS THE ONE CONTROL
            THAT ANSWERS "AM I SPENDING ANYTHING". It was the first row of the
            Settings tab, which put the whole dialog's on/off behind five tabs
            of scrolling — and it is the answer a reader wants from any of them.
            Same slot and same classes as SettingsModal's theme control.
            ⚠️ IT IS THE SAME STORED SETTING, MOVED, NOT A SECOND ONE. Two
            controls over one key in one dialog is the lost update
            `ActDeliverySection`'s header warns about; it no longer appears on
            the Settings tab at all.
            ⚠️ AND `enabled` REALLY IS TOTAL, WHICH IS WHY IT CAN BE LABELLED
            THAT WAY. `agent_config.trigger_enabled` reads "`enabled` gates all
            of them" and returns False for every entry point before anything is
            asked; the scheduler, runtime and outbox each check it again.
            Nothing reaches a provider with this off. */}
        <div className="settings-header">
          <h2>VESTA Agent</h2>
          {/* ⚠️ THE SAME `segmented segmented-icons` GROUP SETTINGS USES FOR
              THEME, not a checkbox. A bare checkbox with a word beside it read
              as a form field dropped into a title bar; this is the app's
              existing header-control idiom and needs no new CSS. Icon-only, so
              the meaning rides `title`/`aria-label` — which is what the theme
              buttons do too. */}
          <div className="settings-header-control">
            <div className="segmented segmented-icons" role="group"
                 aria-label="Supervision">
              {([
                { on: true, icon: Eye,
                  label: "Supervision on — the villa watches, reasons and may spend" },
                { on: false, icon: EyeOff,
                  label: "Supervision off — nothing is asked of a model and nothing is spent" },
              ] as const).map(({ on, icon: Icon, label }) => (
                <button
                  key={String(on)}
                  className={draft.config.enabled === on ? "active" : ""}
                  disabled={draft.saving}
                  onClick={() => draft.edit({ enabled: on })}
                  aria-pressed={draft.config.enabled === on}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ⚠️ THE STRIP GETS THE DRAFT TOO, NOT JUST THE FOOTER — an existing
            pin caught this half. Switching tabs with unsaved edits must warn,
            and a strip that cannot see the draft silently drops them. */}
        <ModalTabs
          tabs={tabs}
          active={tab}
          onSelect={setTab}
          commit={draft}
          label="VESTA Agent sections"
        />

        {/* ⚠️ INERT, NOT HIDDEN. A reader with supervision off still needs to
            see what these tiers WOULD do — that is how they decide whether to
            switch it on — so the panes stay legible and only their controls
            stop responding. `inert` also takes them out of the tab order, so a
            keyboard user is not walked through a pane that cannot answer. */}
        <div className={"settings-body"
                        + (offAndInert ? " pane-inert" : "")}
             {...(offAndInert ? { inert: "" as unknown as boolean } : {})}>
          {offAndInert && (
            <div className="fm-banner warn">
              Supervision is off, so this step is not running. Reflex and
              Observe are unaffected — the villa still acts on the urgent
              things and still records what changes.
            </div>
          )}
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
              {/* ⚠️ THE QUEUE IS THIS TIER'S ONLY *PENDING* OUTPUT, and the HLD
                  is emphatic about why it looks weak: triage "cannot act, cannot
                  notify, cannot write. It only escalates" — and it assigns NO
                  severity, because severity is what the investigation decides.
                  A row here is a pointer, not a finding. */}
              <AgentQueue />
              {/* ⚠️ AND THIS TAB WAS BLANK WITHOUT THE TRACE. `AgentQueue`
                  correctly renders NOTHING in `auto` mode — an empty approval
                  queue on a villa that investigates by itself is the permanent
                  and correct state — so a villa running Live saw a step header
                  over an empty pane, which reads as a broken tier rather than a
                  working one. The passes were being recorded the whole time and
                  were only visible on the Handover page under Advanced. */}
              <div className="settings-section-title">Recent checks</div>
              <RecentChecks
                passes={passes}
                empty={<>No check has run yet. One runs on the schedule above,
                       or immediately from &ldquo;Check the villa now&rdquo; on
                       the Handover tab.</>}
              />
            </div>
          )}

          {/* ── Step 3 · the only tier that judges ─────────────────────── */}
          {tab === "reason" && (
            <div className="reports-pane">
              <TierIntro tier={TIERS.reason} />
              {/* Concerns first: the HLD calls a Concern "the single currency
                  of everything downstream", and this tier is the only thing
                  that mints one. */}
              <AgentConcerns />
              {/* ⚠️ MEMORY AND DRAFTS BELONG TO THIS TIER, NOT TO SETTINGS.
                  Both are things the agent WORKED OUT — a learned claim about
                  the property, and a procedure it wrote — so they are outputs
                  of reasoning, filed with it. Memory is written only on the
                  reasoning path, never from a tool result, which is the rule
                  that stops a device name becoming a permanent claim. */}
              <AgentMemories />
              <AgentReview />
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
              <AgentProposals />
              <ActDeliverySection />
            </div>
          )}

          {/* ── Settings ───────────────────────────────────────────────── */}
          {tab === "settings" && (
            <div className="reports-pane">
                <AgentTuningPanel />
                {/* ⚠️ THE REST BEHIND ONE DOOR, THE SAME SHAPE SETTINGS USES
                    FOR ADVANCED SETTINGS. Cost, people, the API key and the
                    shadow comparison are all things an owner opens
                    occasionally and none belong in the daily path — putting
                    them inline would bury the four dials that are actually
                    tuned. */}
                {/* ⚠️ `SourceLegend` MOVED TO ADVANCED IN 2.753.0, by the
                    owner's instruction. Its journey is the argument for where
                    it ended up: it started under three tier tabs, where it
                    restated the one chip already in each header (reported as a
                    redundant badge), then sat here — correct, because the six
                    labels are learnt once and used across both dialogs, but
                    still on the daily path below the four dials people
                    actually tune. It is reference material: read once,
                    consulted rarely. That is what Advanced is for. */}
            </div>
          )}
        </div>

        {/* ⚠️ `commit={draft}` IS WHAT MAKES SAVE EXIST. Without it the button
            is rendered permanently inert — `ModalFooter` greys Save when it has
            no draft, which looks identical to "nothing has changed". */}
        {/* ⚠️ THE ADVANCED OPENER IS IN THE FOOTER, SO IT IS REACHABLE FROM
            EVERY TAB. It used to sit at the bottom of the Settings pane, which
            put cost, people and the provider key behind two navigations from
            anywhere else in this dialog — and made them invisible from the five
            tabs a reader actually spends time on. `leading` is the slot
            SettingsModal already uses for its own Advanced opener, and that
            prop's docstring says why it stays left rather than joining the
            action group. */}
        <ModalFooter
          commit={draft}
          leading={
            <button className="btn ghost" onClick={() => setAdvanced(true)}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>Cost, people and advanced</span>
            </button>
          } onClose={onClose} />
      </div>
      {/* ⚠️ RENDERED AS A SIBLING, NOT NESTED, so its own backdrop covers this
          dialog rather than being clipped inside it — the same arrangement
          Settings uses for Advanced Settings. */}
      {advanced && <AgentAdvancedModal onBack={() => setAdvanced(false)} />}
    </div>
  );
}
