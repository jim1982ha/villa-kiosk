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
import { Loader2, Plus, Trash2 } from "lucide-react";

import { loadAgentConfig, loadBotChats, saveAgentConfig,
         type AgentConfig, type BotChat } from "@/agent/agentApi";

/** The roles the backend accepts. ⚠️ An unknown role resolves to NOBODY there,
 *  so offering a free-text field would produce entries that silently do
 *  nothing — the select is what keeps the two ends agreeing. */
const ROLES = ["owner", "facility", "ops"] as const;

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
  const [sw, setSw] = useState<Switches>({ enabled: false, chat: false });
  /** ⚠️ THE STORED DOCUMENT AS IT ARRIVED. The store REPLACES on write, so
   *  every save must send the whole thing — and this copy is what carries keys
   *  this version does not know about (a newer add-on's settings) through a
   *  save unharmed. Sending only what changed deleted the sender list once. */
  const [carryOver, setCarryOver] = useState<Record<string, unknown>>({});
  /** ⚠️ THE BOT'S OWN CHATS, SO NOBODY COPIES A NUMBER OUT OF A RAW PAYLOAD.
   *  Empty is a normal state — a villa whose core is restarting, or whose bot
   *  has no private chats — and the row falls back to typing the id, which is
   *  what existed before. It is never a reason to block the edit. */
  const [chats, setChats] = useState<BotChat[]>([]);
  /** Triggers as stored, so flipping `chat` cannot silently clear a sibling. */
  const [triggers, setTriggers] = useState<Record<string, boolean>>({});

  /** ⚠️ `quiet` EXISTS BECAUSE A REFRESH IS NOT A LOAD. Every save used to call
   *  this plainly, so `loading` went true and the whole panel was replaced by
   *  "Loading…" for a moment — reported as the modal refreshing on every click.
   *  The spinner belongs to the FIRST read, when there is genuinely nothing to
   *  show; after that the panel already has content and swapping it out is a
   *  flicker that reads as a fault. */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const got = await loadAgentConfig();
    // ⚠️ BLANK ROWS SURVIVE A REFRESH. They are local by definition — an
    // unnamed sender is never stored — so replacing the list wholesale would
    // delete whatever the operator is halfway through typing.
    setRows((current) => [...toRows(got?.config.allowedSenders as
                                    Record<string, string>),
                          ...current.filter((r) => !r.id.trim())]);
    setSw({
      enabled: got?.config.enabled === true,
      chat: got?.config.triggers?.chat === true,
    });
    setCarryOver(got?.raw ?? {});
    setTriggers((got?.config.triggers ?? {}) as Record<string, boolean>);
    setChats(await loadBotChats());
    setRev(got?.rev ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** ⚠️ IT DOES NOT TOUCH `rows`, AND THAT IS THE POINT. The caller owns what
   *  is on screen; this only writes it. An earlier version called `setRows` with
   *  the SAVED subset and then reloaded, which deleted a blank row the operator
   *  was still typing into — add two, fill the first, blur, and the second
   *  vanished under the cursor.
   *
   *  ⚠️ AND IT RELOADS ONLY ON FAILURE. On success the local state already IS
   *  the truth, so re-reading buys nothing and costs a round trip plus a
   *  repaint. A refused write is almost always a revision conflict — another
   *  tab saved first — so re-sending the same body would discard their edit;
   *  reloading rebases on theirs. Same rule DeviceConfigSync states. */
  const persist = useCallback(async (next: Row[]) => {
    setSaving(true);
    setError(null);
    const map: AgentConfig["allowedSenders"] = {};
    for (const r of next) map[`${CHANNEL}:${r.id.trim()}`] = r.role;
    const ok = await saveAgentConfig({ allowedSenders: map }, carryOver, rev);
    setSaving(false);
    if (!ok) {
      setError("That change was not saved — reloading the current list.");
      void load(true);
      return;
    }
    void load(true);
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
      setError("That change was not saved — reloading.");
      void load(true);
      return;
    }
    setSw(next);
    void load(true);
  }, [sw, triggers, carryOver, rev, load]);

  /** ⚠️ APPENDS A BLANK ROW EDITED IN PLACE — the same idiom as Briefings'
   *  "Add a schedule", which is what this panel was rebuilt onto. The first
   *  version had a separate draft field plus a ⊕, which is a second way to do
   *  the same thing on the same screen and left "press Enter or press ⊕?"
   *  ambiguous. */
  const add = useCallback(() => setRows([...rows, { id: "", role: "owner" }]),
                          [rows]);

  /** ⚠️ SAVED ONLY ONCE A ROW HAS AN ID, and there is no footer Save button
   *  here to defer to — this section lives in a CollapsibleSection, not a
   *  modal with actions. A blank row is local until it names somebody; an
   *  empty key would be a sender nobody can be, stored. */
  const commit = useCallback((next: Row[]) => {
    setRows(next);
    const named = next.filter((r) => r.id.trim());
    if (named.length !== new Set(named.map((r) => r.id.trim())).size) return;
    void persist(named);
  }, [persist]);

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
          None yet. The villa answers nobody until you add someone.
        </p>
      )}

      {rows.map((row, i) => (
        <div className="editable-row" key={i} style={{ marginTop: 8 }}>
          <div className="editable-row-fields">
            {/* ⚠️ A NAME WHEN WE KNOW ONE, THE NUMBER WHEN WE DO NOT. In a
                PRIVATE chat the chat id and the sender id are the same number,
                so the bot's own chat list is exactly the right menu — groups
                are excluded by the backend because there the two differ and an
                entry could never match anybody. An id already stored but no
                longer among the chats keeps its own option, or editing an
                existing row would silently retarget it. */}
            {chats.length > 0 ? (
              <select
                value={row.id}
                disabled={saving}
                aria-label="Who"
                onChange={(e) => commit(rows.map((r, n) =>
                  (n === i ? { ...r, id: e.target.value } : r)))}
              >
                <option value="">Choose a chat…</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {row.id && !chats.some((c) => c.id === row.id) && (
                  <option value={row.id}>{row.id} (not a current chat)</option>
                )}
              </select>
            ) : (
              <input
                value={row.id}
                disabled={saving}
                aria-label="Telegram user id"
                placeholder="Telegram user id"
                inputMode="numeric"
                onChange={(e) => setRows(rows.map((r, n) =>
                  (n === i ? { ...r, id: e.target.value } : r)))}
                onBlur={() => commit(rows)}
              />
            )}
            <select
              value={row.role}
              disabled={saving}
              aria-label="Role"
              onChange={(e) => commit(rows.map((r, n) =>
                (n === i ? { ...r, role: e.target.value as Role } : r)))}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {/* ⚠️ `btn danger icon-only`, THE SAME CLASSES BRIEFINGS USES, and
              the shared block already said so: `.editable-row > .btn.danger`
              sits in styles.css next to the row rules. This used `icon-btn` —
              the app's neutral glass chrome — so the one destructive control in
              the row was the only delete in the app that did not read as one.
              Reported from the screen. Removing somebody's access is exactly
              the action that should look different from everything beside it. */}
          <button
            type="button"
            className="btn danger icon-only"
            disabled={saving}
            aria-label={row.id ? `Remove ${row.id}` : "Remove this row"}
            onClick={() => commit(rows.filter((_, n) => n !== i))}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      ))}

      <button className="btn" disabled={saving} onClick={add}
              style={{ marginTop: 10, alignSelf: "flex-start" }}>
        <Plus size={16} aria-hidden /><span>Add someone</span>
      </button>

      {error && <p className="body-text" role="alert">{error}</p>}

      <p className="muted body-text" style={{ marginTop: 10,
        fontSize: "var(--text-xs)" }}>
        {chats.length > 0
          ? "The bot's own private chats. Group chats are not listed: a group "
            + "names a room rather than a person, so it could never match who "
            + "sent a message."
          : "No chats found, so type the numeric Telegram user id — it is in "
            + "the user_id field of any message the bot receives."}
      </p>
    </>
  );
}
