// src/components/agent/AgentModal.tsx
// The VESTA Agent area (docs/agent-integration/PLAN.md A8): its presence, and
// its messages, reports and recommendations, newest first, with their buttons
// where this profile may answer. Opened from the top bar (HUD); shown only to
// a profile with viewAgent and only while the agent is configured.

import { useState } from "react";
import { Bot, CircleAlert, Info, TriangleAlert, ChevronRight } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { displayLabelFor } from "@/config/EntityMap";
import { ROLE_LABELS, isRole } from "@/auth/roles";
import ReportPreview from "@/components/fm/ReportPreview";
import { useAgent, useAgentLiveView } from "@/agent/AgentContext";
import { answerLine, buttonsShown } from "@/agent/agentView";
import type { AgentMessage, AgentSeverity, AgentStatus } from "@/agent/agentApi";

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
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
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
  const { status, messages, answer } = useAgent();
  useAgentLiveView();

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
                    answer={answer} onOpenEntity={onOpenEntity} />
                ))}
              </div>
            )}
        </div>

        <div className="modal-footer">
          {/* Two slots, space-between (see .modal-footer): an empty left one. */}
          <span />
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function AgentMessageCard({ message: m, status, answer, onOpenEntity }: {
  message: AgentMessage;
  status: AgentStatus | null;
  answer: ReturnType<typeof useAgent>["answer"];
  onOpenEntity: (entityId: string) => void;
}) {
  const { entities } = useHA();
  const { config } = useConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = SEVERITY_ICON[m.severity];
  const shown = buttonsShown(m, status);
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

  return (
    <div className={`agent-message agent-sev-${m.severity} agent-state-${m.state}`}>
      <div className="agent-message-head">
        <Icon size={18} className={`agent-sev-icon agent-sev-icon-${m.severity}`} />
        <span className="agent-message-title">{m.title}</span>
        <span className="fm-clause agent">{KIND_LABEL[m.kind]}</span>
      </div>
      <div className="muted body-text agent-message-meta">
        <Bot size={12} /> {when(m.createdAt)}
        {m.state === "expired" && " · expired"}
      </div>
      {m.body && <div className="agent-message-body"><ReportPreview markdown={m.body} /></div>}
      {m.entities.length > 0 && (
        <div className="agent-message-entities">
          {m.entities.map((id) => (
            <button key={id} className="agent-entity-chip" onClick={() => onOpenEntity(id)}>
              {displayLabelFor(id, config.entityMap[id]?.label,
                entities[id]?.attributes.friendly_name as string | undefined)}
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
