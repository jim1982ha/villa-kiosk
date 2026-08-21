// src/components/reports/ReportsModal.tsx
// The Briefings workspace — one modal, five tabs, owner only.
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
//   Preview      compose one now and read it, sending nothing
//   Coverage     what this property can be asked about, and what it cannot
//   Checks       the built-in analyses, on/off, and why each did or did not run
//   Schedule     when it arrives, for whom, where, and who writes the prose
//   History      what was produced and whether it was delivered
//   Diagnostics  the detection layer's own health
//
// ⚠️ THE SHELL IS COPIED FROM `FacilityModal`, NOT INVENTED. A dialog assembled
// from `.modal-backdrop` + `.modal.settings-modal` renders as a centred card on
// a tablet; one assembled any other way renders as a full-bleed top-anchored
// sheet, which is the trap both dialogs added in August 2026 had to be verified
// against on real hardware. `modal-fixed-height` is here for the same reason
// Facility has it: these tabs have wildly different content lengths and letting
// the dialog resize around every switch is jarring.
//
// ⚠️ OWNER-GATED HERE AND, INDEPENDENTLY, ON THE SERVER. Hiding this from the
// HUD is a rendering convenience; `supervisor-proxy.py` refuses a non-owner PUT
// to /reports-config and a non-owner GET of /reports-diagnostics whatever the
// browser sends. Never the only gate.

import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2, FileText, History,
  Loader2, Save as SaveIcon, ShieldQuestion, SlidersHorizontal,
} from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
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
import HistoryTab from "./HistoryTab";
import DiagnosticsTab from "./DiagnosticsTab";
import ModulesTab from "./ModulesTab";

type Tab = "preview" | "coverage" | "checks" | "schedule" | "history" | "diagnostics";

const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "preview", label: "Preview", icon: FileText },
  { id: "coverage", label: "Coverage", icon: ShieldQuestion },
  { id: "checks", label: "Checks", icon: SlidersHorizontal },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "history", label: "History", icon: History },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
];

export default function ReportsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalA11y(onClose);
  const [tab, setTab] = useState<Tab>("preview");

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
    const [c, d, h, k] = await Promise.all([
      fetchReportsConfig(), fetchReportsDiagnostics(), fetchReportsHistory(),
      fetchNarrationSecrets(),
    ]);
    if (c) {
      setConfig(c.config);
      setRev(c.rev);
      setCarryOver(c.raw);
    }
    setDiagnostics(d);
    setHistory(h);
    setSecretsConfigured(k);
    setUnreachable(c === null);
  }, []);

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
   *  ⚠️ IT USES THE SCHEDULE'S OWN AUDIENCE AND RECIPIENTS, not the global
   *  defaults, so "send this one now" means the same brief the schedule would
   *  have sent. A schedule with no recipients is refused before the request,
   *  because composing and delivering nowhere reads as success. */
  const sendNow = useCallback(async (s: ReportSchedule) => {
    const targets = s.targets ?? [];
    if (targets.length === 0) {
      setNotice({ text: "This schedule has no recipients, so there is nobody "
                        + "to send it to.", bad: true });
      return;
    }
    setBusy(true);
    setNotice({ text: "Sending…", bad: false, pending: true });
    const result = await runReportNow({
      preview: false, audience: s.audience, cadence: s.cadence, targets,
    });
    const sent = (result?.deliveries ?? []).filter((d) => d.status === "sent");
    const failed = (result?.deliveries ?? []).filter(
      (d) => d.status === "failed");
    setNotice(!result
      ? { text: "Could not send. See the add-on log.", bad: true }
      : failed.length
        ? { text: `Sent to ${sent.length}, failed for ${failed.length}: `
                  + failed.map((d) => d.detail || d.target).join("; "), bad: true }
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal config-editor-modal modal-fixed-height"
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

        <div className="fm-tabs" role="tablist" aria-label="Briefing sections">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`fm-tab${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <Icon size={16} /><span>{t.label}</span>
              </button>
            );
          })}
        </div>

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
            />
          )}
          {tab === "checks" && (
            <ModulesTab
              diagnostics={diagnostics}
              config={config}
              preview={preview}
              busy={busy}
              onSave={(next) => void save(next)}
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
          {tab === "history" && <HistoryTab entries={history} />}
          {tab === "diagnostics" && <DiagnosticsTab diagnostics={diagnostics} />}
        </div>

        {/* ⚠️ THE SHELL WAS COPIED FROM `FacilityModal` AND THE FOOTER WAS NOT.
            Every dialog in this family — Facility, Settings, Advanced Settings —
            ends in a `.settings-footer` with a Close button, and this one shipped
            with no way out except the backdrop or Escape. Neither is discoverable
            on a wall-mounted tablet, which is the device this is operated from.
            That is the cost of copying a shell by hand: it carries what the
            copier noticed. `tests/py/test_modal_shell.py` now derives the parts
            of the shell from the dialogs that HAVE them and fails on a
            `.settings-modal` missing one, because there is no component to
            violate and so nothing else could have caught it. */}
        <div className="settings-footer" style={{ justifyContent: "space-between" }}>
          <span className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
            Briefings are composed by the add-on and delivered by Home Assistant
          </span>
          <div className="reports-footer-actions">
            {/* ⚠️ ALWAYS PRESENT ON THE TAB THAT HAS A FORM, DISABLED WHEN
                THERE IS NOTHING TO SAVE — not conditionally rendered. A button
                that appears and vanishes is a button whose position you cannot
                learn, which is the complaint this fixes in a new costume. The
                other tabs have no draft: Checks writes on each toggle, and the
                rest are read-only. */}
            {tab === "schedule" && (
              <button
                className="btn primary"
                disabled={busy || pending === null}
                onClick={() => { if (pending) void save(pending); }}
              >
                <SaveIcon size={16} />
                <span>{busy ? "Saving…" : "Save"}</span>
              </button>
            )}
            {/* ⚠️ GHOST WHEN SAVE IS BESIDE IT. Two primary buttons in one
                footer say "these are equally what you came to do", and one of
                them discards an edit. */}
            <button
              className={`btn ${tab === "schedule" ? "ghost" : "primary"}`}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
