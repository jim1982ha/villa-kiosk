// src/components/agent/AgentModal.tsx
// The VESTA Agent area (docs/agent-integration/PLAN.md A8): its presence, and
// its messages, reports and recommendations, newest first, with their buttons
// where this profile may answer. Opened from the top bar (HUD); shown only to
// a profile with viewAgent and only while the agent is configured.

import { useState } from "react";
import { Bot, CircleAlert, Info, TriangleAlert, ChevronRight, X } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { labelOf } from "@/config/EntityMap";
import { ROLE_LABELS, isRole } from "@/auth/roles";
import MarkdownPreview from "@/components/fm/MarkdownPreview";
import InlineConfirm from "@/components/common/InlineConfirm";
import { useAgent, useAgentLiveView } from "@/agent/AgentContext";
import { answerLine, buttonsShown, clearNeedsConfirm, settledIds } from "@/agent/agentView";
import type { AgentMessage, AgentSeverity, AgentStatus } from "@/agent/agentApi";
import { dayTime } from "@/utils/dateText";
import ModalFooter from "@/components/common/ModalFooter";

export interface AgentModalProps {
  onClose: () => void;
  onOpenEntity: (entityId: string) => void;
}

const KIND_LABEL: Record<AgentMessage["kind"], string> = {
  message: "Message",
  report: "Report",
  recommendation: "Recommendation",
};

const SEVERITY_ICON: Record<AgentSeverity, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  critical: CircleAlert,
};

const profileLabel = (p: string) => (isRole(p) ? ROLE_LABELS[p] : p);

function when(iso: string | null): string {
  if (!iso) return "";
  return dayTime(iso);
}

function presenceLine(status: AgentStatus | null): string {
  if (!status) return "Checking…";
  if (status.state === "online") return status.statusText ? `Online — ${status.statusText}` : "Online";
  return status.lastSeen
    ? `Offline — last seen ${when(status.lastSeen)}`
    : "Offline — it has not reported in yet";
}

export default function AgentModal({ onClose, onOpenEntity }: AgentModalProps) {
  const dialogRef = useModalA11y(onClose);
  const { status, messages, answer, clear } = useAgent();
  useAgentLiveView();
  // "Clear answered": every answered or expired message at once — the old
  // ones nobody needs to read again. Never an open question.
  const settled = settledIds(messages);
  const [clearingSettled, setClearingSettled] = useState(false);
  const [footerError, setFooterError] = useState<string | null>(null);
  const clearSettled = async () => {
    setClearingSettled(true);
    setFooterError(null);
    setFooterError(await clear(settled));
    setClearingSettled(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal agent-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="VESTA Agent"
      >
        <div className="modal-header">
          <h2>VESTA Agent</h2>
        </div>

        <div className="modal-body">
          <div className={`agent-presence agent-presence-${status?.state ?? "unknown"}`} role="status">
            <span className={`agent-presence-dot ${status?.state === "online" ? "online" : "offline"}`} aria-hidden="true" />
            <span>{presenceLine(status)}</span>
          </div>

          <div className="settings-section-title">Messages</div>
          {messages.length === 0
            ? <p className="muted body-text">No messages from the VESTA Agent yet.</p>
            : (
              <div className="agent-message-list">
                {messages.map((m) => (
                  <AgentMessageCard key={m.id} message={m} status={status}
                    answer={answer} clear={clear} onOpenEntity={onOpenEntity} />
                ))}
              </div>
            )}
          {footerError && <p className="body-text sev-warning" role="alert">{footerError}</p>}
        </div>

        {/* "Clear answered" on the left when there is anything settled. */}
        <ModalFooter onClose={onClose} leading={settled.length > 0 ? (
          <button className="btn ghost" disabled={clearingSettled} onClick={() => void clearSettled()}>
            <X size={16} /> Clear answered ({settled.length})
          </button>
        ) : undefined} />
      </div>
    </div>
  );
}

function AgentMessageCard({ message: m, status, answer, clear, onOpenEntity }: {
  message: AgentMessage;
  status: AgentStatus | null;
  answer: ReturnType<typeof useAgent>["answer"];
  clear: ReturnType<typeof useAgent>["clear"];
  onOpenEntity: (entityId: string) => void;
}) {
  const { entities } = useHA();
  const { config } = useConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const Icon = SEVERITY_ICON[m.severity];
  const shown = buttonsShown(m);
  const answered = answerLine(m, profileLabel);

  const press = async (buttonId: string) => {
    setBusy(true);
    setError(null);
    const result = await answer(m.id, buttonId);
    setBusy(false);
    if (!result.ok) {
      setError(result.alreadyAnswered
        ? `Already answered by ${profileLabel(result.alreadyAnswered.profile)}.`
        : result.message);
    }
  };

  const doClear = async () => {
    setBusy(true);
    setError(null);
    const problem = await clear([m.id]);
    // On success the card is gone; only a failure needs this state again.
    if (problem) { setBusy(false); setConfirming(false); setError(problem); }
  };
  // ⚠️ AN OPEN QUESTION ASKS FIRST: cleared, its buttons are gone for everyone
  // and the agent never gets an answer (agentView.clearNeedsConfirm).
  const askClear = () => (clearNeedsConfirm(m) ? setConfirming(true) : void doClear());

  return (
    <div className={`agent-message agent-sev-${m.severity} agent-state-${m.state}`}>
      <div className="agent-message-head">
        <Icon size={18} className={`agent-sev-icon agent-sev-icon-${m.severity}`} />
        <span className="agent-message-title">{m.title}</span>
        <span className="fm-clause agent">{KIND_LABEL[m.kind]}</span>
        {!confirming && (
          <button className="btn ghost agent-message-clear" disabled={busy} onClick={askClear}
            aria-label={`Clear “${m.title}”`}>
            <X size={14} /> Clear
          </button>
        )}
      </div>
      {confirming && (
        <InlineConfirm
          question="Clear it? It still waits for an answer — the agent will never get one."
          confirmLabel="Clear"
          onConfirm={doClear}
          onCancel={() => setConfirming(false)}
        />
      )}
      <div className="muted body-text agent-message-meta">
        <Bot size={12} /> {when(m.createdAt)}
        {m.state === "expired" && " · expired"}
      </div>
      {m.body && <div className="agent-message-body"><MarkdownPreview markdown={m.body} /></div>}
      {m.entities.length > 0 && (
        <div className="agent-message-entities">
          {m.entities.map((id) => (
            <button key={id} className="agent-entity-chip" onClick={() => onOpenEntity(id)}>
              {labelOf(id, config.entityMap, entities)}
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
      )}
      {shown && (
        <div className="agent-message-buttons">
          {m.buttons.map((b) => (
            <button key={b.id} className="btn" disabled={busy} onClick={() => void press(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {!shown && m.canAnswer && status?.state !== "online" && (
        <p className="muted body-text agent-message-note">
          The buttons come back when the agent is online.
        </p>
      )}
      {answered && <p className="muted body-text agent-message-note">{answered}</p>}
      {error && <p className="body-text sev-warning" role="alert">{error}</p>}
    </div>
  );
}
