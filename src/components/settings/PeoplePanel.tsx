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
// allow-list.
//
// ⚠️ AND THE MERGE WAS ASKED FOR, TWICE, ON A CORRECT OBSERVATION: the same
// person's Telegram chat appears in BOTH pickers, so the row reads as one
// address asked for twice. The observation is right and the conclusion does not
// follow, for three reasons worth keeping written down because the question
// will be asked again:
//
//   1. THE SETS DIVERGE. `chat.known_chats` is PRIVATE chats only — it excludes
//      groups because a group's id names the ROOM and the sender id names
//      whoever typed, so storing one matches nobody and fails silently. The
//      devices list is Companion apps, televisions, notify services and
//      Telegram entities INCLUDING groups; the reference villa's own facility
//      target is a supergroup. One list is people, the other is addresses.
//   2. DERIVING ONE FROM THE OTHER WOULD MAKE ADDING A DEVICE GRANT THE RIGHT
//      TO COMMAND THE VILLA. Today a guest can be sent a check-out reminder on
//      Telegram without gaining a voice; under a merge, that delivery target
//      would silently authenticate them.
//   3. IT WOULD PUT THE AUTH PATH ON A LIVE REGISTRY LOOKUP. Identity is a
//      stored id compared as a string — no network, fails closed. Resolving a
//      notify entity to a chat id at message time makes the answer depend on an
//      HA call that can be slow or fail, and "fails closed" then means the bot
//      goes deaf.
//
// So the FIELDS stay and the PRESENTATION changed: devices first (the ordinary
// case), the chat second and only while the villa answers messages at all, and
// labelled by what it DOES ("Can message the villa") rather than by what it
// contains ("Telegram chat"), which is what made it read as a second address.
//
// ⚠️ THE TABLE SHIPS EMPTY AND EMPTY MEANS THE BOT ANSWERS NOBODY. That is not
// an unconfigured state to be helped past: a row with a Telegram id in it is an
// open bot, and anyone who finds the username can then talk to the villa. No
// example row, no placeholder id, no "add me" shortcut.
//
// ⚠️ AND IT IS A RENDERING CONVENIENCE ONLY. `agent/policy.py:sender_role`
// resolves identity before a message is read and the proxy refuses a non-owner
// write to /agent-config. Nothing here is a control.

import ToggleField from "@/components/common/ToggleField";
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
 *  owner gives it one — which is exactly the `(no devices yet)` state Briefings
 *  now names. */
function fromLegacy(map: Record<string, string> | undefined): Person[] {
  return Object.entries(map ?? {})
    .filter(([key]) => key.startsWith(`${CHANNEL}:`))
    .map(([key, role]) => ({
      // ⚠️ THE CHAT'S OWN NAME WHEN THE BOT KNOWS IT. `allowed_senders` stored
      // only a number, so a straight migration produced a person CALLED
      // "765979167" sitting beside a chat picker showing "Jm" — read from the
      // screen as the same field twice. The bot already knows that chat's
      // name; using it is the difference between a migrated row and a migrated
      // row somebody can recognise. The number remains if the chat is gone.
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
  /** ⚠️ THE CHAT FIELD IS HIDDEN WHILE THE VILLA ANSWERS NOBODY — there is
   *  nothing for it to grant, and an inert control is the clutter that made
   *  this row confusing. ⚠️ BUT NEVER HIDDEN WHEN A ROW ALREADY HAS ONE: that
   *  is authority already granted, and authority you cannot see is worse than a
   *  field you do not need. Switching chat off must not conceal who could
   *  speak the moment it goes back on. */
  /** Which row has its destination list open. ⚠️ ONE AT A TIME and by INDEX,
   *  the same rule ScheduleTab follows: two open lists on a phone push
   *  everything else off the screen. */
  const [open, setOpen] = useState<number | null>(null);

  const stored = peopleOf(draft.config);
  /** Rows synthesised from the legacy sender map, when the table is empty.
   *  ⚠️ DERIVED AFTER `chats` IS DECLARED, because the migration reads it to
   *  name the person — see `fromLegacy`. */
  const migrated = stored.length === 0
    ? fromLegacy(draft.config.allowedSenders as Record<string, string>)
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
      {/* ⚠️ THE STYLE OVERRIDE IS DROPPED WITH THE MARKUP. It set
          `--text-xs` inline on this one note, so this switch's explanation was
          a size smaller than every other explanation in the app — a distinction
          that means nothing to a reader and reads as a rendering fault. The
          shared component uses the app's own body size. */}
      <ToggleField
        checked={chat && agentOn}
        onChange={(on) => void flipChat(on)}
        disabled={saving || !agentOn}
        label="Answer messages"
        note={agentOn
          ? "Lets the people below start a conversation with the villa."
          : "Turn “Supervision is switched on” on, under Cadence and cost below."}
        more={agentOn ? (
          <>
            Each row gains a “Can message the villa” field, asked separately
            from their devices because the two point opposite ways: a device is
            an address the villa sends TO, and only a private Telegram chat
            identifies who is SPEAKING. Group chats are not offered — a group's
            id names the room, not the person.
          </>
        ) : undefined}
      />

      {legacy && (
        <div className="fm-banner" style={{ marginTop: 12 }}>
          These people were set up when the villa only recorded who may send it
          messages, so nobody has any devices yet. Add the devices each person
          should be reached on — briefings for their profile go there.
        </div>
      )}

      <p className="muted body-text" style={{ marginTop: 14 }}>
        One row per person: where the villa reaches them, and what they are to
        it. The profile decides both what a briefing for them contains and which
        schedules land there.
      </p>

      {rows.length === 0 && (
        <p className="muted body-text">
          Nobody yet. The villa answers nobody and has nowhere to send a
          briefing until you add someone.
        </p>
      )}

      {/* ⚠️ A LADDER WITH NOBODY ON THE FIRST RUNG (2026-08-27, owner's
          request after seeing it happen). An urgent problem is meant to reach
          the Facility manager first and the owner only if it goes
          unanswered — but when no row holds that profile the villa correctly
          jumps straight to the owner, immediately, and NOTHING said so. It
          reads as the chasing rule being broken; it is the rule working
          against a table with a hole in it.

          ⚠️ IT IS SHOWN ONLY WHEN SOMEBODY EXISTS. On an empty table the
          sentence above already says the villa can reach nobody at all, and a
          second warning under it would be scolding a person for not having
          finished a form they have not started. */}
      {rows.length > 0 && !rows.some((r) => r.role === "ops") && (
        <p className="body-text sev-warning">
          No Facility manager yet, so anything urgent comes straight to the
          Owner with no delay. Give somebody that profile and the villa tries
          them first, bringing the Owner in only if nobody answers.
        </p>
      )}

      {rows.map((row, i) => (
        <div key={i} className="editable-row-card">
          <div className="editable-row" style={{ marginTop: 8 }}>
            <div className="editable-row-fields editable-row-tight">
              {/* ⚠️ EVERY FIELD CARRIES A VISIBLE LABEL, and it took a report to
                  get them: three unlabelled controls in a row read as three
                  guesses. ⚠️ AND THERE WERE FOUR UNTIL 2.655.0 — a `Name` box
                  that nothing on either side ever read, which the legacy
                  migration filled with the person's Telegram id, so the row
                  opened with a NUMBER beside a chat picker and was reported as
                  the same field twice. Deleting it is what makes the row fit on
                  one line, which is the other half of that report.
                  `--field-label-size`/`--field-label-gap` are the app's own
                  rhythm for this shape. */}
              {/* ⚠️ DEVICES COME FIRST, BECAUSE THEY ARE WHAT EVERY ROW
                  NEEDS. A person who receives briefings and never messages the
                  villa is the ordinary case; the chat below is the exception,
                  and leading with the exception is what made the row read as
                  two addresses for one person. */}
              <label className="people-field">
                <span>Devices — briefings are sent here</span>
                <RecipientButton
                  targets={row.targets ?? []}
                  available={targets}
                  open={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
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
              {(chat || row.telegram) && (
              <label className="people-field">
                <span>Can message the villa</span>
                {chats.length > 0 ? (
                  <select
                    value={row.telegram}
                    disabled={saving}
                    onChange={(e) => at(i, { telegram: e.target.value })}
                  >
                    <option value="">No — receives only</option>
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
                    placeholder="Their Telegram user id, or leave empty"
                    inputMode="numeric"
                    onChange={(e) => at(i, { telegram: e.target.value })}
                  />
                )}
              </label>
              )}
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
              aria-label="Remove this person"
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
              onClose={() => setOpen(null)}
            />
          )}
        </div>
      ))}

      <button className="btn" disabled={saving}
              onClick={() => commit([...rows, { telegram: "", targets: [],
                                                role: "owner" }])}
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
