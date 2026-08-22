// src/components/settings/ChatSendersPanel.tsx
//
// Who may talk to the villa. REQ-016, TASK-037.
//
// ⚠️ THIS LIST SHIPS EMPTY AND EMPTY MEANS THE BOT ANSWERS NOBODY. That is not
// an unconfigured state to be helped past — an `allowed_senders` with an entry
// in it is an open bot, and anyone who finds the bot's username can then talk
// to the villa. So this panel offers no example row, no placeholder id and no
// "add me" shortcut: the owner types an id they have looked up, deliberately,
// once.
//
// ⚠️ AND IT IS A RENDERING CONVENIENCE ONLY. The rule that matters lives in
// `agent/policy.py:sender_role`, which resolves the role BEFORE the message
// text is read. Nothing here is a security control; a browser can send whatever
// it likes and the proxy refuses a non-owner write to /agent-config.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";

import { loadAgentConfig, saveAgentConfig, type AgentConfig } from "@/agent/agentApi";

/** The roles the backend accepts. ⚠️ An unknown role resolves to NOBODY there,
 *  so offering a free-text field would produce entries that silently do
 *  nothing — the select is what keeps the two ends agreeing. */
const ROLES = ["owner", "facility", "ops"] as const;

/**
 * ⚠️ `width: auto` IS LOAD-BEARING AND MUST NOT BE TIDIED AWAY. `styles.css`
 * carries `.modal input, .modal select { width: 100% }` — a DESCENDANT
 * selector, so it reaches into every component that happens to sit inside a
 * modal, which is the pattern CLAUDE.md warns about and this panel is a new
 * victim of. A flex item defaults to `0 1 auto`, so its flex-basis resolves to
 * that `width: 100%`: each select would demand the whole row while the id
 * field (`flex: 1`, basis `0%`) collapsed to nothing. Roomy on a laptop,
 * unreadable on a 360px phone — the shape of every regression the parity
 * checklist exists for. Fixed HERE rather than by narrowing the shared rule to
 * `>`, because other panels rely on it for their full-width fields.
 */
const SELECT_STYLE = { width: "auto", flex: "0 0 auto" } as const;
type Role = (typeof ROLES)[number];

/** ⚠️ Keyed `channel:id`, because a Telegram user id and a future WhatsApp id
 *  are integers from different namespaces and would eventually collide. */
const CHANNEL = "telegram";

type Row = { id: string; role: Role };

function toRows(map: Record<string, string> | undefined): Row[] {
  return Object.entries(map ?? {})
    .filter(([key]) => key.startsWith(`${CHANNEL}:`))
    .map(([key, role]) => ({
      id: key.slice(CHANNEL.length + 1),
      role: (ROLES as readonly string[]).includes(role) ? (role as Role) : "ops",
    }));
}

export default function ChatSendersPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [rev, setRev] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState("");
  const [draftRole, setDraftRole] = useState<Role>("owner");

  const load = useCallback(async () => {
    setLoading(true);
    const got = await loadAgentConfig();
    setRows(toRows(got?.config.allowedSenders as Record<string, string>));
    setRev(got?.rev ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async (next: Row[]) => {
    setSaving(true);
    setError(null);
    const map: AgentConfig["allowedSenders"] = {};
    for (const r of next) map[`${CHANNEL}:${r.id}`] = r.role;
    const ok = await saveAgentConfig({ allowedSenders: map }, rev);
    setSaving(false);
    if (!ok) {
      // ⚠️ RELOAD RATHER THAN RETRY. A refused write is almost always a
      // revision conflict — another tab saved first — and re-sending the same
      // body would discard their edit. The same rule DeviceConfigSync states.
      setError("That change was not saved. Reloading the current list.");
      void load();
      return;
    }
    setRows(next);
    void load();
  }, [rev, load]);

  const add = useCallback(() => {
    const id = draftId.trim();
    if (!id) return;
    setDraftId("");
    void persist([...rows.filter((r) => r.id !== id), { id, role: draftRole }]);
  }, [draftId, draftRole, rows, persist]);

  if (loading) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Loading…
      </p>
    );
  }

  return (
    <>
      <p className="muted body-text">
        People who may message the villa and get an answer. Anyone not listed is
        ignored in silence — no reply, so a stranger who finds the bot learns
        nothing from it.
      </p>

      {rows.length === 0 && (
        <p className="muted body-text">
          Nobody is listed, so the villa answers nobody. This is the shipped
          state; add yourself to start a conversation.
        </p>
      )}

      {rows.map((row) => (
        <div className="row" key={row.id} style={{ gap: 8, marginTop: 8 }}>
          <span className="body-text" style={{ flex: 1, minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis" }}>{row.id}</span>
          <select
            style={SELECT_STYLE}
            value={row.role}
            disabled={saving}
            onChange={(e) => void persist(rows.map((r) =>
              (r.id === row.id ? { ...r, role: e.target.value as Role } : r)))}
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            type="button"
            className="icon-btn"
            disabled={saving}
            aria-label={`Remove ${row.id}`}
            onClick={() => void persist(rows.filter((r) => r.id !== row.id))}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      ))}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <input
          value={draftId}
          disabled={saving}
          onChange={(e) => setDraftId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          aria-label="Telegram user id"
          placeholder="Telegram user id"
          style={{ flex: 1, minWidth: 0 }}
        />
        <select style={SELECT_STYLE} value={draftRole} disabled={saving}
                aria-label="Role"
                onChange={(e) => setDraftRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="icon-btn" disabled={saving || !draftId.trim()}
                aria-label="Add sender" onClick={add}>
          <UserPlus size={16} aria-hidden />
        </button>
      </div>

      {error && <p className="body-text" role="alert">{error}</p>}

      <p className="muted body-text" style={{ marginTop: 10,
        fontSize: "var(--text-xs)" }}>
        A numeric Telegram user id, not a username — it is in the
        <code> user_id </code> field of any message the bot receives.
      </p>
    </>
  );
}
