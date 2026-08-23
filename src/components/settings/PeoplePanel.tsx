// src/components/settings/PeoplePanel.tsx
//
// Who the villa knows: one row per person — name, Telegram chat, the devices
// they are reached on, and their profile. REQ-016, TASK-037, and the owner's
// own request after the panel this replaces was reported as "a very limited
// choice of senders".
//
// ⚠️ IT REPLACES `ChatSendersPanel`, WHICH ASKED HALF THE QUESTION. That panel
// listed Telegram chats and a role, because it existed only to answer "may this
// person talk to the villa". Meanwhile a briefing's recipients were chosen in a
// completely different modal, from a completely different list, against no
// person at all — so one human being was configured twice, in two vocabularies,
// and the two could disagree with nothing anywhere saying so. `reports/people.py`
// merged the two facts; this is the screen that edits the merged table.
//
// ⚠️ ONLY THE `telegram` FIELD GRANTS ANYTHING INBOUND, AND THIS PANEL MUST NOT
// BLUR THAT. A notify target can only RECEIVE — naming one is an address, never
// an identity — so a person with three devices and no chat may be sent
// everything and may say nothing. `people.role_for_sender` reads the telegram
// field alone and is mutation-pinned; a panel that presented the two as one
// "contact method" would be the one way merging these tables could widen the
// allow-list. That is why they are separate controls with separate labels and
// why the copy below says which one is which.
//
// ⚠️ THE TABLE SHIPS EMPTY AND EMPTY MEANS THE BOT ANSWERS NOBODY. That is not
// an unconfigured state to be helped past: a row with a Telegram id in it is an
// open bot, and anyone who finds the username can then talk to the villa. No
// example row, no placeholder id, no "add me" shortcut.
//
// ⚠️ AND IT IS A RENDERING CONVENIENCE ONLY. `agent/policy.py:sender_role`
// resolves identity before a message is read and the proxy refuses a non-owner
// write to /agent-config. Nothing here is a control.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { loadBotChats, peopleOf,
         type AgentConfig, type BotChat, type Person } from "@/agent/agentApi";
import { useAgentConfigDraft } from "@/agent/AgentConfigDraft";
import { fetchReportsDiagnostics } from "@/reports/reportsApi";
import DestinationList, { RecipientButton,
                          type DiscoveredTarget } from "@/components/reports/DestinationList";
import { ROLE_LABELS, ROLE_ORDER, type Role } from "@/auth/roles";

/** ⚠️ Keyed `channel:id` in the legacy map, because a Telegram user id and a
 *  future WhatsApp id are integers from different namespaces and would
 *  eventually collide. The new table keeps the channel in the FIELD NAME
 *  instead, which is why `people.py` has an `INBOUND_CHANNEL` constant. */
const CHANNEL = "telegram";

/** Rows synthesised from `allowed_senders`, for a villa that configured senders
 *  before this table existed.
 *
 *  ⚠️ THE SAME MIGRATION `people.people()` DOES ON THE BACKEND, AND FOR THE
 *  SAME REASON — except that one is READ-ONLY and this one is what makes it
 *  permanent. Without it the panel would show an empty list on a villa whose
 *  bot is answering people, which reads as "nobody is configured" and is false.
 *  A legacy sender has no delivery target, so the row is inbound-only until the
 *  owner gives it one. */
function fromLegacy(map: Record<string, string> | undefined,
                    chats: BotChat[]): Person[] {
  return Object.entries(map ?? {})
    .filter(([key]) => key.startsWith(`${CHANNEL}:`))
    .map(([key, role]) => ({
      // ⚠️ THE CHAT'S OWN NAME WHEN THE BOT KNOWS IT. `allowed_senders` stored
      // only a number, so a straight migration produced a person CALLED
      // "765979167" sitting beside a chat picker showing "Jm" — read from the
      // screen as the same field twice. The bot already knows that chat's
      // name; using it is the difference between a migrated row and a migrated
      // row somebody can recognise. The number remains if the chat is gone.
      name: chats.find((c) => c.id === key.slice(CHANNEL.length + 1))?.name
        || key.slice(CHANNEL.length + 1),
      telegram: key.slice(CHANNEL.length + 1),
      targets: [],
      role: (ROLE_ORDER as readonly string[]).includes(role)
        ? (role as Role) : "ops",
    }));
}

export default function PeoplePanel() {
  /** ⚠️ ONE DRAFT FOR THE WHOLE DOCUMENT, SHARED WITH THE DIALS PANEL BESIDE
   *  THIS ONE. Both edit `/agent-config`; two panels each holding their own
   *  copy and their own revision is a lost update, which is what put "I changed
   *  it and it did not save" on the screen. See `AgentConfigDraft`. */
  const draft = useAgentConfigDraft();
  const saving = draft.saving;
  const [error, setError] = useState<string | null>(null);
  /** The bot's own private chats, so nobody copies a number out of a raw
   *  payload. Empty is a normal state — a villa whose core is restarting, or
   *  whose bot has no private chats — and the row falls back to typing the id.
   *  It is never a reason to block the edit. */
  const [chats, setChats] = useState<BotChat[]>([]);
  /** Every destination Home Assistant can deliver to, from the SAME discovery
   *  the Briefings dialog uses. ⚠️ NOT A SECOND PICKER: `DestinationList` owns
   *  the tick-list idiom, including the two escapes from "a destination is a
   *  notify service" that this villa needed. */
  const [targets, setTargets] = useState<DiscoveredTarget[]>([]);
  /** Which row has its destination list open. ⚠️ ONE AT A TIME and by INDEX,
   *  the same rule ScheduleTab follows: two open lists on a phone push
   *  everything else off the screen. */
  const [open, setOpen] = useState<number | null>(null);

  const stored = peopleOf(draft.config);
  /** Rows synthesised from the legacy sender map, when the table is empty.
   *  ⚠️ DERIVED AFTER `chats` IS DECLARED, because the migration reads it to
   *  name the person — see `fromLegacy`. */
  const migrated = stored.length === 0
    ? fromLegacy(draft.config.allowedSenders as Record<string, string>, chats)
    : [];
  const legacy = stored.length === 0 && migrated.length > 0;
  const rows = stored.length ? stored : migrated;

  useEffect(() => {
    let cancelled = false;
    void loadBotChats().then((got) => { if (!cancelled) setChats(got); });
    void fetchReportsDiagnostics().then((diag) => {
      if (!cancelled) setTargets(diag?.notifyTargets ?? []);
    });
    return () => { cancelled = true; };
  }, []);

  /** Put the whole table into the draft.
   *
   *  ⚠️ IT CLEARS `allowed_senders` AT THE SAME TIME. The two are not merged on
   *  the backend — `people()` reads the legacy map ONLY while the table is
   *  empty — so leaving it behind means deleting the last person here silently
   *  resurrects every sender the old panel had, which is precisely the
   *  config-resurrection bug CLAUDE.md's hard rule describes. The backend's
   *  migration is read-only; this is the edit that makes it permanent.
   *
   *  ⚠️ AND A BLANK ROW IS KEPT IN THE DRAFT RATHER THAN DROPPED. An operator
   *  fills a row in left to right, and a table that deleted the row the moment
   *  it had no name would delete it under the cursor. `people._row` drops a
   *  nameless row on read, so nothing downstream can be confused by one.
   *
   *  ⚠️ A DUPLICATE TELEGRAM ID IS REFUSED, because `role_for_sender` returns
   *  the FIRST match — two rows claiming one chat would make which profile that
   *  person speaks as depend on list order. */
  const commit = useCallback((next: Person[]) => {
    const ids = next.map((r) => r.telegram.trim()).filter(Boolean);
    setError(ids.length !== new Set(ids).size
      ? "Two people cannot share one Telegram chat — that one is not stored."
      : null);
    draft.edit({ people: next, allowedSenders: {} });
  }, [draft]);

  /** ⚠️ `triggers` IS SPREAD FROM WHAT WAS STORED, never rebuilt from literals:
   *  writing `{scheduled: true, event: false, chat}` is three assertions where
   *  one was intended, and would silently turn `scheduled` back on at a
   *  property that had deliberately turned it off. */
  const flipChat = (on: boolean) => {
    const triggers = { ...(draft.config.triggers ?? {}), chat: on };
    draft.edit({ triggers: triggers as AgentConfig["triggers"] });
  };

  const agentOn = draft.config.enabled === true;
  const chat = draft.config.triggers?.chat === true;
  const loading = draft.loading;

  const at = (i: number, patch: Partial<Person>) =>
    commit(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  if (loading) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Loading…
      </p>
    );
  }

  return (
    <>
      {/* ⚠️ DISABLED, NOT HIDDEN, while supervision is off. Hiding it would make
          the reason for the silence invisible; disabled with the sentence below
          says which switch to reach for — and it is in this same tab, under
          "Cadence and cost". */}
      <label className="toggle">
        <input type="checkbox" checked={chat && agentOn}
               disabled={saving || !agentOn}
               onChange={(e) => void flipChat(e.target.checked)} />
        <span>Answer messages</span>
      </label>
      <p className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
        {agentOn
          ? "Lets the people below start a conversation with the villa. Only a "
            + "row with a Telegram chat can; a device is a place to send to, "
            + "never a way in."
          : "Turn “Supervision is switched on” on, under Cadence and cost "
            + "below, to use this."}
      </p>

      {legacy && (
        <div className="fm-banner" style={{ marginTop: 12 }}>
          These people were set up when the villa only recorded who may send it
          messages, so nobody has any devices yet. Add the devices each person
          should be reached on — briefings for their profile go there.
        </div>
      )}

      <p className="muted body-text" style={{ marginTop: 14 }}>
        One row per person. The chat is how they reach the villa; the devices
        are how it reaches them; the profile decides both what a briefing for
        them contains and which schedules land there. Anyone not listed is
        ignored in silence — a stranger who finds the bot learns nothing from
        it.
      </p>

      {rows.length === 0 && (
        <p className="muted body-text">
          Nobody yet. The villa answers nobody and has nowhere to send a
          briefing until you add someone.
        </p>
      )}

      {rows.map((row, i) => (
        <div key={i} className="editable-row-card">
          <div className="editable-row" style={{ marginTop: 8 }}>
            <div className="editable-row-fields">
              {/* ⚠️ EVERY FIELD CARRIES A VISIBLE LABEL, and it took a report to
                  get them. Four unlabelled controls in a row read as four
                  guesses — and the first one is worse than a guess after the
                  legacy migration, which names a person after their Telegram
                  id, so the row opened with a NUMBER beside a chat picker and
                  was read as the same field twice: "I don't understand this
                  menu: as I see both the Chat ID fields". `--field-label-size`
                  and `--field-label-gap` are the app's own rhythm for exactly
                  this shape. */}
              <label className="people-field">
                <span>Name</span>
                <input
                  value={row.name}
                  disabled={saving}
                  placeholder="Who this is"
                  onChange={(e) => at(i, { name: e.target.value })}
                />
              </label>
              {/* ⚠️ A NAME WHEN WE KNOW ONE, THE NUMBER WHEN WE DO NOT. In a
                  PRIVATE chat the chat id and the sender id are the same
                  number, so the bot's own chat list is exactly the right menu —
                  groups are excluded by the backend because there the two
                  differ and an entry could never match anybody. An id already
                  stored but no longer among the chats keeps its own option, or
                  editing an existing row would silently retarget it.

                  ⚠️ AND "No chat" IS A REAL CHOICE, NOT AN EMPTY ONE. A person
                  with devices and no chat is a normal, delivery-only row, and
                  the option has to say so — a blank first entry reads as "not
                  filled in yet".

                  ⚠️ IT IS NOT THE SAME QUESTION AS THE DEVICES BESIDE IT, and
                  the labels are what say so. Asked directly — "I was expecting
                  to see only the dropdown from picture #3, since it covers all
                  the possibilities of sending to". It does cover all of those:
                  it is the OUTBOUND half. A chat is the only thing that lets
                  somebody message the VILLA, and a notify target can only
                  receive, so listing one may never be read as identity. That
                  asymmetry is the one thing merging these two tables could have
                  got wrong (`people.role_for_sender`), which is why the field
                  stays and the labels changed instead. */}
              <label className="people-field">
                <span>Telegram chat — lets them message the villa</span>
                {chats.length > 0 ? (
                  <select
                    value={row.telegram}
                    disabled={saving}
                    onChange={(e) => at(i, { telegram: e.target.value })}
                  >
                    <option value="">No chat — cannot message the villa</option>
                    {chats.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {row.telegram && !chats.some((c) => c.id === row.telegram) && (
                      <option value={row.telegram}>
                        {row.telegram} (not a current chat)
                      </option>
                    )}
                  </select>
                ) : (
                  <input
                    value={row.telegram}
                    disabled={saving}
                    placeholder="Telegram user id (optional)"
                    inputMode="numeric"
                    onChange={(e) => at(i, { telegram: e.target.value })}
                  />
                )}
              </label>
              <label className="people-field">
                <span>Devices — where briefings are sent</span>
                <RecipientButton
                  targets={row.targets ?? []}
                  available={targets}
                  open={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
                />
              </label>
              <label className="people-field">
                <span>Profile</span>
                <select
                  value={row.role}
                  disabled={saving}
                  onChange={(e) => at(i, { role: e.target.value as Role })}
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </label>
            </div>
            {/* ⚠️ `btn danger icon-only`, the app's destructive treatment.
                Removing somebody's access to the villa is exactly the action
                that should look different from everything beside it —
                `test_editable_rows` pins it, after the panel this replaces
                shipped with the neutral glass chrome instead. */}
            <button
              type="button"
              className="btn danger icon-only"
              disabled={saving}
              aria-label={row.name ? `Remove ${row.name}` : "Remove this row"}
              onClick={() => {
                setOpen(null);
                commit(rows.filter((_, n) => n !== i));
              }}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
          {open === i && (
            <DestinationList
              targets={row.targets ?? []}
              available={targets}
              onChange={(next) => at(i, { targets: next })}
            />
          )}
        </div>
      ))}

      <button className="btn" disabled={saving}
              onClick={() => commit([...rows, { name: "", telegram: "",
                                                targets: [], role: "owner" }])}
              style={{ marginTop: 10, alignSelf: "flex-start" }}>
        <Plus size={16} aria-hidden /><span>Add someone</span>
      </button>

      {error && <p className="body-text" role="alert">{error}</p>}

      <p className="muted body-text" style={{ marginTop: 10,
        fontSize: "var(--text-xs)" }}>
        {chats.length > 0
          ? "The chat list is the bot's own private chats. Group chats are not "
            + "listed: a group names a room rather than a person, so it could "
            + "never match who sent a message."
          : "No chats found, so type the numeric Telegram user id — it is in "
            + "the user_id field of any message the bot receives."}
      </p>
    </>
  );
}
