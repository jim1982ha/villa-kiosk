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

/** ⚠️ TWO SWITCHES, AND THEY NEST RATHER THAN DUPLICATE. `enabled` is the whole
 *  agent — briefings, triage, chat, everything — and `triggers.chat` is this
 *  feature alone. Both ship OFF: an add-on that begins reasoning about a villa
 *  the moment it is installed, before anybody has set a budget or a recipient,
 *  is one that spends money nobody agreed to. Showing only the chat switch
 *  would leave an owner ticking it and getting silence, with the real reason a
 *  level up and invisible. */
type Switches = { enabled: boolean; chat: boolean };

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
  const [sw, setSw] = useState<Switches>({ enabled: false, chat: false });
  /** ⚠️ THE STORED DOCUMENT AS IT ARRIVED. The store REPLACES on write, so
   *  every save must send the whole thing — and this copy is what carries keys
   *  this version does not know about (a newer add-on's settings) through a
   *  save unharmed. Sending only what changed deleted the sender list once. */
  const [carryOver, setCarryOver] = useState<Record<string, unknown>>({});
  /** Triggers as stored, so flipping `chat` cannot silently clear a sibling. */
  const [triggers, setTriggers] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const got = await loadAgentConfig();
    setRows(toRows(got?.config.allowedSenders as Record<string, string>));
    setSw({
      enabled: got?.config.enabled === true,
      chat: got?.config.triggers?.chat === true,
    });
    setCarryOver(got?.raw ?? {});
    setTriggers((got?.config.triggers ?? {}) as Record<string, boolean>);
    setRev(got?.rev ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async (next: Row[]) => {
    setSaving(true);
    setError(null);
    const map: AgentConfig["allowedSenders"] = {};
    for (const r of next) map[`${CHANNEL}:${r.id}`] = r.role;
    const ok = await saveAgentConfig({ allowedSenders: map }, carryOver, rev);
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
  }, [carryOver, rev, load]);

  /** ⚠️ `triggers` IS SPREAD FROM WHAT WAS STORED, never rebuilt from
   *  literals. The first version wrote `{scheduled: true, event: false, chat}`
   *  — three assertions where one was intended, so flipping chat would have
   *  silently turned `scheduled` ON at a property that had deliberately turned
   *  it off. */
  const flip = useCallback(async (patch: Partial<Switches>) => {
    const next = { ...sw, ...patch };
    setSaving(true);
    setError(null);
    const ok = await saveAgentConfig(
      patch.enabled === undefined
        ? { triggers: { ...triggers, chat: next.chat } as AgentConfig["triggers"] }
        : { enabled: next.enabled },
      carryOver, rev);
    setSaving(false);
    if (!ok) {
      setError("That change was not saved. Reloading.");
      void load();
      return;
    }
    setSw(next);
    void load();
  }, [sw, triggers, carryOver, rev, load]);

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
      <label className="toggle">
        <input type="checkbox" checked={sw.enabled} disabled={saving}
               onChange={(e) => void flip({ enabled: e.target.checked })} />
        <span>VESTA agent</span>
      </label>
      <p className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
        The master switch. Off means the agent does nothing at all — no
        briefings, no answers, no cost.
      </p>

      {/* ⚠️ INDENTED BECAUSE IT DEPENDS ON THE SWITCH ABOVE, and the nesting is
          the half of that signal which survives everything. Greying alone
          carries it through colour only — which fails on a sunlit wall tablet,
          fails for a colour-blind reader, and failed outright until the
          disabled state had any styling at all. Structure says "this belongs
          to that" with no CSS support required. */}
      <div style={{ marginLeft: 18, borderLeft: "1px solid var(--hairline)",
                    paddingLeft: 14 }}>
        <label className="toggle">
          {/* ⚠️ DISABLED, NOT HIDDEN, while the master is off. Hiding it would
              make the reason for the silence invisible; disabled with the
              sentence below says which switch to reach for. */}
          <input type="checkbox" checked={sw.chat && sw.enabled}
                 disabled={saving || !sw.enabled}
                 onChange={(e) => void flip({ chat: e.target.checked })} />
          <span>Answer messages</span>
        </label>
        <p className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
          {sw.enabled
            ? "Lets the people below start a conversation with the villa."
            : "Turn on ‘VESTA agent’ above to use this."}
        </p>
      </div>

      <p className="muted body-text" style={{ marginTop: 14 }}>
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
