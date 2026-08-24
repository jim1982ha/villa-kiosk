// src/components/reports/ReportsModal.tsx
// The Briefings workspace — one modal, six tabs, opened by the owner and by the
// facility manager.
//
// ⚠️ LABELLED "BRIEFINGS", NOT "REPORTS", AND ON PURPOSE. Facility already has
// a tab called "Report" — a DOCUMENT the facility manager generates on demand,
// in Markdown, downloaded, a point-in-time record of readiness and spend. This
// is the AUTOMATED PERIODIC brief: scheduled, delivered by notification, built
// from the villa's own alert layer. They shipped with the same label AND the
// same `FileText` icon, which is a coin-flip for whoever opens one.
//
// The word is the product's own — the renderer titles every one of these
// "Weekly property brief" / "Weekly facility brief", so opening Briefings and
// finding a brief needs no explanation. The CODE stays `reports` throughout:
// the backend package, the four `/reports-*` endpoints, these file names. That
// is what the subsystem is; only the label a person reads is disambiguated.
//
// Tab order is the order somebody actually approaches this: read one, see what
// it can and cannot measure, decide when it arrives, then look at the record.
//
//   Preview      compose one now and read it, sending nothing        owner
//   Coverage     what this property can be asked about, and what it cannot
//                                                                    owner
//   Checks       is anything listening, what this villa's automations have
//                reported, the built-in analyses on/off, and why each did or
//                did not run                                         owner
//   Schedule     when it arrives, for whom, where, and who writes the prose
//                                                                    owner
//   Tasks        the maintenance jobs a brief raised, and ticking them off
//   History      what was produced and whether it was delivered
//
// ⚠️ "Checks" ABSORBED "Diagnostics" (2026-08-22) — see ModulesTab's header for
// why the two were one question. Nothing was dropped; the collector health that
// tab owned is now the FIRST section of Checks, because everything under it is
// meaningless while nothing is listening.
//
// ⚠️ THE SHELL IS COPIED FROM `FacilityModal`, NOT INVENTED. A dialog assembled
// from `.modal-backdrop` + `.modal.settings-modal` renders as a centred card on
// a tablet; one assembled any other way renders as a full-bleed top-anchored
// sheet, which is the trap both dialogs added in August 2026 had to be verified
// against on real hardware. The fixed height that keeps these wildly different
// tabs from resizing the card comes from `.settings-modal` itself — it was an
// opt-in class until v2.653.0, which is how Advanced Settings went without it.
//
// ⚠️ TWO CAPABILITIES OPEN THIS, AND THE TABS ARE GATED SEPARATELY FROM THE
// DIALOG (2026-08-22, owner: "the Facility Manager shall have access to it").
// The modal opens on `manageFacility`, which the owner and `ops` both hold;
// `canConfigure` (`editConfig`, owner only) decides which tabs render. That
// split is not a preference — it MIRRORS the proxy, which is the real gate:
//
//   GET  /reports-config        any authorized session
//   GET  /reports-history       any authorized session
//   GET  /reports-tasks         any authorized session
//   POST /reports-tasks-complete  owner + ops   (TASK_ACK_ROLES)
//   PUT  /reports-config        owner
//   GET  /reports-diagnostics   owner
//   POST /reports-run-now       owner
//   POST /reports-next-run      owner
//   GET/PUT /reports-secret     owner
//
// So a facility manager gets Tasks and History — the two things their job
// actually needs, reading what was delivered and ticking off what it raised —
// and the four owner tabs are not rendered rather than rendered-and-403. ⚠️ A
// TAB THAT 403s IS WORSE THAN AN ABSENT ONE: it invites the reader to conclude
// the add-on is broken. Hiding is a rendering convenience; the proxy refuses
// whatever the browser sends. Never the only gate.
//
// ⚠️ AND `reload()` MUST NOT ASK FOR WHAT IT CANNOT HAVE. It fetches four
// documents in parallel and two of them are owner-only, so an `ops` session
// would fire two guaranteed 403s on every open — noise in the add-on log that
// looks exactly like an attack, and `unreachable` is derived from the config
// read, which would still be fine and so would hide nothing. Skipped by
// capability instead.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, BookMarked, Brain, CalendarClock, CheckCircle2,
  FileText, GitCompare, HandHelping, History, KeyRound, ListChecks, Loader2,
  Receipt, Search, ShieldQuestion, SlidersHorizontal,
} from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import ModalTabs from "@/components/common/ModalTabs";
import ModalFooter from "@/components/common/ModalFooter";
import {
  fetchNarrationSecrets, fetchReportsConfig, fetchReportsDiagnostics,
  fetchReportsHistory, runReportNow, saveNarrationSecret, saveReportsConfig,
  type ReportPreview, type ReportsDiagnostics,
} from "@/reports/reportsApi";
import type {
  ReportHistoryEntry, ReportSchedule, ReportsConfig,
} from "@/reports/reportsTypes";
import PreviewTab from "./PreviewTab";
import CoverageTab from "./CoverageTab";
import ScheduleTab from "./ScheduleTab";
import CockpitConcerns from "@/components/cockpit/CockpitConcerns";
import CockpitMemories from "@/components/cockpit/CockpitMemories";
import CockpitProposals from "@/components/cockpit/CockpitProposals";
import CockpitQueue from "@/components/cockpit/CockpitQueue";
import CockpitReview from "@/components/cockpit/CockpitReview";
import SourceLegend from "@/components/common/SourceLegend";
import AgentTuningPanel from "@/components/settings/AgentTuningPanel";
import ApiKeyPanel from "@/components/settings/ApiKeyPanel";
import PeoplePanel from "@/components/settings/PeoplePanel";
import ShadowDiffPanel from "@/components/settings/ShadowDiffPanel";
import UsagePanel from "@/components/settings/UsagePanel";
import { AgentConfigProvider } from "@/agent/AgentConfigDraft";
import HistoryTab from "./HistoryTab";
import ModulesTab from "./ModulesTab";

type Tab =
  // Agent-produced, and this dialog now holds nothing else by design.
  | "concerns" | "queue" | "waiting" | "memory"
  | "tuning" | "access" | "usage" | "shadow"
  // ⚠️ THE REPORT PIPELINE, PENDING RELOCATION — see the TABS comment.
  | "preview" | "coverage" | "checks" | "schedule" | "history";

/** ⚠️ `configure: true` MEANS "THE PROXY WOULD REFUSE THIS TAB TO ANYONE BUT
 *  THE OWNER" — see the endpoint table in this file's header. It is not a
 *  judgement about who ought to see what; changing one of these without
 *  changing the matching handler puts a tab on screen that cannot work. */
const TABS: { id: Tab; label: string; icon: typeof FileText; configure?: true }[] = [
  // ── What the agent CONCLUDED ────────────────────────────────────────────
  // ⚠️ FIRST, BECAUSE IT IS THE PRODUCT. Everything else in this dialog exists
  // to produce, explain, fund or configure a concern.
  { id: "concerns", label: "Concerns", icon: Brain },
  // Stage BEFORE a concern: triage flagged it, nothing has examined it, and it
  // carries no severity (ADR-021). Second so the two stages read in order.
  { id: "queue", label: "Worth a look", icon: Search, configure: true },
  // Blocked on a person: an action the villa stopped, and a procedure it wrote.
  { id: "waiting", label: "Waiting on you", icon: HandHelping, configure: true },
  // What it has come to believe and will assert into every later check.
  { id: "memory", label: "Memory", icon: BookMarked, configure: true },
  // ── How it is set up, and what it costs ─────────────────────────────────
  { id: "tuning", label: "Tuning", icon: SlidersHorizontal, configure: true },
  { id: "access", label: "Access", icon: KeyRound, configure: true },
  { id: "usage", label: "Cost", icon: Receipt, configure: true },
  { id: "shadow", label: "Shadow diff", icon: GitCompare, configure: true },
  // ── The report the concerns are delivered in ────────────────────────────
  // ⚠️ THESE FOUR ARE NOT AGENT-PRODUCED AND ARE MARKED FOR RELOCATION. A
  // brief is composed by the DETERMINISTIC pipeline — built-in checks, blueprint
  // findings and concerns, deduplicated by subject — and an LLM only ever
  // rewords it. By the rule this dialog now follows they belong with the report
  // pipeline, not here; they stay only until that destination exists, and the
  // group heading says so rather than letting them look native.
  { id: "preview", label: "Preview", icon: FileText, configure: true },
  { id: "coverage", label: "Coverage", icon: ShieldQuestion, configure: true },
  { id: "checks", label: "Checks", icon: ListChecks, configure: true },
  { id: "schedule", label: "Delivery", icon: CalendarClock, configure: true },
  { id: "history", label: "History", icon: History },
];

export default function ReportsModal(
  { onClose, canConfigure }:
  // ⚠️ `canAck` IS GONE WITH THE TASKS TAB, ITS ONLY CONSUMER. Completing a
  // caretaker task is Facility Manager work against an automation-written
  // to-do list — nothing the agent produces — so the tab moved out of this
  // dialog rather than being duplicated. Facility still has it, gated on
  // `manageFacility`, which is the capability the proxy actually requires.
  { onClose: () => void; canConfigure: boolean },
) {
  const dialogRef = useModalA11y(onClose);
  const tabs = TABS.filter((t) => canConfigure || !t.configure);
  // ⚠️ THE DEFAULT TAB IS THE FIRST VISIBLE ONE, NOT A LITERAL. Hard-coding
  // "preview" opened a facility manager on a tab that is not in their list, so
  // the body rendered nothing while every tab button looked unselected.
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "tasks");

  const [config, setConfig] = useState<ReportsConfig | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const [carryOver, setCarryOver] = useState<Record<string, unknown>>({});
  const [diagnostics, setDiagnostics] = useState<ReportsDiagnostics | null>(null);
  const [history, setHistory] = useState<ReportHistoryEntry[] | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  // ⚠️ WHETHER A CREDENTIAL EXISTS, NEVER THE CREDENTIAL. `/reports-secret` has
  // no read path for the value at all — see `secrets.configured()`.
  const [secretsConfigured, setSecretsConfigured] = useState<Record<string, boolean>>({});
  /** The Schedule tab's unsaved edit, or null. ⚠️ IT LIVES HERE BECAUSE THE
   *  SAVE BUTTON DOES. Every dialog in this family puts its actions in the
   *  pinned footer; this one had Save at the foot of the tab CONTENT, below the
   *  fold on a laptop and under a section that unfolds when ticked — so the one
   *  button that commits the work was the one you could not see, while Close
   *  sat visible the whole time. Reported as exactly that. */
  const [pending, setPending] = useState<ReportsConfig | null>(null);

  // ⚠️ THREE STATES, NOT TWO. "Not loaded yet", "loaded and empty" and
  // "could not be reached" are different things, and collapsing the last two
  // shows an empty schedule list to someone whose add-on is simply down —
  // which reads as "briefings are off" and invites configuring them twice.
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);

  // ⚠️ A NOTICE BELONGS TO THE ACTION THAT RAISED IT, NOT TO THE DIALOG. It
  // rendered above the tab body, so "The add-on refused the change (400)" from
  // a save in Schedule was still on screen in Coverage, History and
  // Diagnostics — reported by the owner. Those tabs have no save, so the banner
  // there is an error about nothing, and worse, it reads as an error about
  // WHATEVER TAB IS SHOWING. Clearing it on switch is the whole fix; keeping
  // one notice per tab would be a second state machine for a message whose
  // entire lifetime is "until the user does the next thing".
  //
  // ⚠️ AND IT CARRIES ITS TONE. Every notice rendered as `fm-banner warn`,
  // including "Saved." — a success in the colour of a failure.
  //
  // ⚠️ AND IT LIVES IN THE HEADER, AS ONE ICON. Reported by the owner: a
  // full-width bar reading "Sending…" then "Sent to 1 recipient(s)." pushed the
  // whole tab body down for a sentence whose entire content is "that worked".
  // It is now a chip beside the title, with the words in `title`/`aria-label`.
  //
  // ⚠️ `pending` IS A THIRD TONE AND NOT A DERIVED ONE. `bad: false` alone
  // would draw a green tick on "Sending…", i.e. report success while the
  // request is still open. Deriving it from `busy` instead was tried on paper
  // and is wrong for a different reason: `save()` sets "Saved." and THEN awaits
  // a diagnostics refetch, so the tick would spin for a beat after the write
  // landed. The notice describes itself; nothing else has to be consulted.
  const [notice, setNotice] = useState<
    { text: string; bad: boolean; pending?: boolean } | null>(null);
  useEffect(() => { setNotice(null); }, [tab]);

  // ⚠️ AN ERROR OPENS ITSELF; A SUCCESS DOES NOT. A `title` tooltip is
  // mouse-only, and the device this is operated from is a wall-mounted tablet —
  // so "Sent to 1, failed for 2: <why>" behind a hover would be unreadable
  // exactly where it matters. Failures still render the full sentence in the
  // body; successes are the icon alone, which is what was asked for. Tapping
  // the chip toggles either way, so nothing is unreachable by touch.
  const [noticeOpen, setNoticeOpen] = useState(false);
  useEffect(() => { setNoticeOpen(notice?.bad ?? false); }, [notice]);

  const reload = useCallback(async () => {
    // ⚠️ THE TWO OWNER-ONLY READS ARE SKIPPED, NOT FIRED-AND-CAUGHT. See the
    // endpoint table in the header: `/reports-diagnostics` and
    // `/reports-secret` are owner-only, and the tabs that consume them are not
    // rendered for a facility manager anyway — so asking would buy nothing and
    // cost two 403s in the add-on log on every open.
    const [c, h, d, k] = await Promise.all([
      fetchReportsConfig(),
      fetchReportsHistory(),
      canConfigure ? fetchReportsDiagnostics() : Promise.resolve(null),
      canConfigure ? fetchNarrationSecrets() : Promise.resolve({}),
    ]);
    if (c) {
      setConfig(c.config);
      setRev(c.rev);
      setCarryOver(c.raw);
    }
    setDiagnostics(d);
    setHistory(h);
    setSecretsConfigured(k);
    // ⚠️ DERIVED FROM THE CONFIG READ, WHICH EVERY ROLE MAY MAKE. Deriving it
    // from the diagnostics read instead would show "the add-on could not be
    // reached" to every facility manager, on an add-on that answered fine.
    setUnreachable(c === null);
  }, [canConfigure]);

  useEffect(() => { void reload(); }, [reload]);

  /** Re-probe on demand. ⚠️ `/reports-diagnostics` RUNS DISCOVERY LIVE ON
   *  EVERY REQUEST — it opens a websocket and walks the recorder — so this is
   *  the real thing rather than a cache bust, and it is also why nothing here
   *  polls: doing this every few seconds while a dialog sits open would put a
   *  continuous load on a Pi for a panel that is read once. */
  const refresh = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    await reload();
    setBusy(false);
  }, [reload]);

  const save = useCallback(async (next: ReportsConfig) => {
    setBusy(true);
    setNotice(null);
    const result = await saveReportsConfig(next, rev, carryOver);
    if (result.ok) {
      setConfig(next);
      setRev(result.rev);
      setNotice({ text: "Saved.", bad: false });
      // ⚠️ EVERYTHING DERIVED FROM THE CONFIG IS NOW STALE, AND ONE OF THOSE
      // THINGS IS A SENTENCE THE OPERATOR READS AS FACT. `next_runs` is
      // computed by the backend from the STORED schedules, so until this
      // refetch it kept answering about the config from before the save: an
      // owner changed a schedule from "weekly on Monday 12:38" to "daily
      // 12:40", pressed Save, and the line under the row still read "Next:
      // Monday 24 Aug, 12:38".
      //
      // ⚠️ THE WHOLE DIAGNOSTICS DOCUMENT, NOT A NEW next-runs ENDPOINT.
      // Destinations and capabilities are derived from the same read and go
      // stale on the same event; a second route would be a second thing to
      // keep in step, for a request an operator makes deliberately and rarely.
      setDiagnostics(await fetchReportsDiagnostics());
    } else {
      // ⚠️ A CONFLICT RE-READS RATHER THAN RETRYING. Another device wrote in
      // the gap; overwriting it is exactly what the revision exists to stop.
      setNotice({
        text: result.conflict
          ? "Someone else changed these settings. Reloaded — please re-apply."
          : result.error,
        bad: true,
      });
      if (result.conflict) await reload();
    }
    setBusy(false);
    // ⚠️ THE FOOTER CLOSES ON SUCCESS AND MUST NOT ON FAILURE, so this reports
    // which happened rather than resolving void. A conflict has just reloaded
    // somebody else's copy into the dialog; closing it would throw away the
    // operator's chance to re-apply.
    return result.ok;
  }, [rev, carryOver, reload]);

  /** ⚠️ A SEPARATE WRITE FROM THE CONFIG SAVE, because a credential is not
   *  configuration: it lives in its own 0600 file that no store handler serves.
   *  Riding the config PUT would put an API key into the document any
   *  authorized session — a guest's phone included — can GET. */
  const saveSecret = useCallback(async (provider: string, value: string) => {
    setBusy(true);
    setNotice(null);
    const result = await saveNarrationSecret(provider, value);
    if (result.ok) {
      setSecretsConfigured(await fetchNarrationSecrets());
      setNotice({ text: value ? "Key stored." : "Key removed.", bad: false });
    } else {
      setNotice({ text: result.error, bad: true });
    }
    setBusy(false);
  }, []);

  /** Send ONE schedule's briefing for real, now.
   *
   *  ⚠️ THIS DELIVERS. Every other control in this dialog reads or previews;
   *  this one messages the household, so it reports what happened per target
   *  rather than a bare "Sent." — a briefing that reached nobody must not look
   *  the same as one that reached three phones.
   *
   *  ⚠️ IT SENDS THE SCHEDULE'S PROFILE AND LETS THE ADD-ON RESOLVE IT, so
   *  "send this one now" means the same brief to the same people the scheduler
   *  would have chosen. The resolution order — the profile's people, then the
   *  schedule's own stored list, then the legacy shared one — lives in
   *  `pipeline.targets_for`, and re-deriving it here would be a second
   *  implementation that disagrees on exactly the legacy configs it exists to
   *  keep working. Delivering nowhere is reported from the answer rather than
   *  guessed at beforehand.
   *
   *  ⚠️ THE LEGACY KEYS ARE FORWARDED TOO. A schedule with no profile is the
   *  shape this replaced, and dropping its stored `targets`/`audience` here
   *  would make "send it now" deliver somewhere the schedule itself would
   *  not. */
  const sendNow = useCallback(async (s: ReportSchedule) => {
    setBusy(true);
    setNotice({ text: "Sending…", bad: false, pending: true });
    const result = await runReportNow({
      preview: false, cadence: s.cadence, role: s.role,
      audience: s.audience, targets: s.targets,
    });
    const sent = (result?.deliveries ?? []).filter((d) => d.status === "sent");
    const failed = (result?.deliveries ?? []).filter(
      (d) => d.status === "failed");
    setNotice(!result
      ? { text: "Could not send. See the add-on log.", bad: true }
      : failed.length
        ? { text: `Sent to ${sent.length}, failed for ${failed.length}: `
                  + failed.map((d) => d.detail || d.target).join("; "), bad: true }
        // ⚠️ "Sent to 0 recipient(s)" WAS THE ANSWER FOR A SCHEDULE WITH
        // NOWHERE TO GO, and it reads as success. The pre-flight refusal that
        // used to catch it could only see the schedule's own list; now that
        // destinations come from the profile, the add-on is the only thing that
        // knows, so the empty answer is named where it arrives.
        : sent.length === 0
          ? { text: "Nobody is set up to receive this profile's briefings, so "
                    + "nothing was sent.", bad: true }
          : { text: `Sent to ${sent.length} recipient(s).`, bad: false });
    setHistory(await fetchReportsHistory());
    setBusy(false);
  }, []);

  const compose = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const result = await runReportNow({ preview: true, cadence: "weekly" });
    if (result) setPreview(result);
    else setNotice({ text: "Could not compose a brief. See the add-on log.", bad: true });
    setBusy(false);
  }, []);

  /** ⚠️ ONE COMMIT OBJECT FOR THE STRIP AND THE FOOTER. Two would be two
   *  answers to "is there anything unsaved" — and the strip's question is asked
   *  precisely when the footer's Save is the thing being walked away from. */
  const commit = {
    dirty: pending !== null,
    saving: busy,
    save: () => (pending ? save(pending) : true),
    // ⚠️ THE TAB OWNS THE DRAFT AND REPUBLISHES IT FROM `config` ON EVERY
    // CHANGE, so clearing it here is what a discard IS: the tab re-seeds from
    // the server's copy.
    discard: () => setPending(null),
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal config-editor-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Briefings"
      >
        <div className="settings-header">
          <h2>Briefings</h2>
          {notice && (
            <button
              type="button"
              className={`reports-notice-chip${notice.bad ? " warn" : ""}`}
              title={notice.text}
              aria-expanded={noticeOpen}
              onClick={() => setNoticeOpen((v) => !v)}
            >
              {notice.pending
                ? <Loader2 size={18} className="spin" aria-hidden="true" />
                : notice.bad
                  ? <AlertTriangle size={18} aria-hidden="true" />
                  : <CheckCircle2 size={18} aria-hidden="true" />}
              {/* ⚠️ THE WORDS ARE STILL IN THE DOM, AND `title` IS NOT ENOUGH.
                  A live region announces its CONTENT when that content changes;
                  an icon has none, and `title` is only a last-resort accessible
                  NAME, which is a different thing — so the result of a send
                  would be announced as nothing. This span is the content. */}
              <span className="sr-only" role="status">{notice.text}</span>
            </button>
          )}
        </div>

        <ModalTabs
          tabs={tabs}
          active={tab}
          onSelect={setTab}
          commit={commit}
          label="Briefing sections"
        />

        <div className="settings-body">
          {notice && noticeOpen && (
            <div className={`fm-banner${notice.bad ? " warn" : ""}`}>
              {notice.text}
            </div>
          )}
          {/* ⚠️ NOT A NOTICE, AND DELIBERATELY NOT MOVED. A notice is the result
              of something the operator just did and lasts until they do the
              next thing; this is a STATE of the dialog — every control below it
              is showing nothing — and collapsing it to an icon would leave an
              empty panel with no explanation on screen. */}
          {unreachable && (
            <div className="fm-banner warn">
              The add-on could not be reached, so these settings are not shown.
              Nothing here has been changed.
            </div>
          )}

          {tab === "preview" && (
            <PreviewTab
              preview={preview}
              busy={busy}
              narrationMode={config?.narration?.mode ?? "deterministic"}
              onCompose={() => void compose()}
            />
          )}
          {tab === "coverage" && (
            <CoverageTab
              diagnostics={diagnostics}
              busy={busy}
              onRefresh={() => void refresh()}
              // ⚠️ `[0]`, BECAUSE `fetchReportsHistory` RETURNS NEWEST FIRST.
              // The STORE is a ring written oldest-first and the fetcher
              // reverses it — one line apart in `reportsApi`, and the Cockpit
              // block this replaces read `[length - 1]` and so printed the
              // FIRST briefing ever sent under the words "Last briefing". It
              // was on screen in the owner's own screenshot, dated four days
              // before the briefing they had just received.
              lastBriefing={history && history.length > 0 ? history[0].at : ""}
            />
          )}
          {tab === "checks" && (
            <ModulesTab
              diagnostics={diagnostics}
              config={config}
              preview={preview}
              busy={busy}
              onSave={(next) => void save(next)}
              onRefresh={() => void refresh()}
            />
          )}
          {tab === "schedule" && (
            <ScheduleTab
              config={config}
              diagnostics={diagnostics}
              busy={busy}
              onDraft={setPending}
              onSendNow={(s) => void sendNow(s)}
              secretsConfigured={secretsConfigured}
              onSaveSecret={(provider, value) => void saveSecret(provider, value)}
            />
          )}
          {/* ── Agent-produced ────────────────────────────────────────────
              ⚠️ THESE EIGHT MOVED HERE IN 2.725.0 FROM TWO OTHER DIALOGS, and
              the rule is absolute: everything the agent produces lives in this
              dialog and nothing the agent produces lives anywhere else. The
              queue, concerns, proposals, review and memories came from the
              Facility Cockpit; the tuning, access, cost and shadow panels came
              from Advanced Settings, where an owner looking for "what is the AI
              doing" had no reason to look. Splitting one subsystem across three
              dialogs is what made it unfindable — the owner asked twice where
              Concerns were shown. */}
          {tab === "concerns" && (
            <div className="reports-pane">
              <CockpitConcerns />
              <SourceLegend only={["agent"]} />
            </div>
          )}
          {tab === "queue" && (
            <div className="reports-pane">
              <CockpitQueue />
              <SourceLegend only={["triage"]} />
            </div>
          )}
          {/* ⚠️ TWO BLOCKS, ONE TAB, BECAUSE THEY ARE ONE QUESTION: something
              is stopped until a person answers. A proposal is an action on the
              villa with a countdown; a review is a procedure it wrote. Separate
              tabs would have made an empty dialog look like two broken ones. */}
          {tab === "waiting" && (
            <div className="reports-pane">
              <CockpitProposals />
              <CockpitReview />
              <SourceLegend only={["agent"]} />
            </div>
          )}
          {tab === "memory" && (
            <div className="reports-pane"><CockpitMemories /></div>
          )}
          {/* ⚠️ THE THREE CONFIG TABS SHARE ONE DRAFT PROVIDER. `AgentConfigDraft`
              exists because two panels each loading, versioning and PUTting the
              same document is a lost update — the store refuses a write whose
              `rev` is stale, so saving one panel silently discarded the other's
              edit. Three panels now, same document, still one draft. */}
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
          {tab === "history" && <HistoryTab entries={history} />}
        </div>

        {/* ⚠️ ONE FOOTER COMPONENT, ONE SAVING POLICY — `common/ModalFooter`.
            This dialog is where the policy was worked out: the Save used to sit
            at the foot of the Schedule tab's own content, below the fold, while
            Close stayed pinned in the footer. It was then re-stated by hand
            here, which is how five other dialogs went on ending in five
            slightly different rows. The exit button says Cancel exactly while
            there is a draft to discard, and Save appears with it. */}
        <ModalFooter
          note="Briefings are composed by the add-on and delivered by Home Assistant"
          busy={busy}
          commit={commit}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
