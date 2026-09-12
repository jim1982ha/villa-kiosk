// src/components/settings/PeoplePanel.tsx
//
// Who the villa knows: one row per person — the devices they are reached on,
// and their profile. REQ-016, TASK-037.
//
// ⚠️ THIS PANEL NO LONGER DECIDES WHO MAY TALK TO THE VILLA (owner's ruling,
// 2026-09-13), AND THE CONTROL IT LOST IS THE ONE THAT BROKE IT. A third column
// used to ask "Can message the villa", offering the bot's private chats so
// nobody had to copy a user id out of a raw payload. Its option list was built
// from any telegram-platform registry entry whose unique_id contained an
// underscore — so when Home Assistant grew an update-EVENT entity, the list
// offered "Vesta_… Update event" as a PERSON. It was reasonably selected, and
// from then on every Telegram button answered "You cannot act on this alert"
// for everybody, the owner included, because a stored "event" can never equal a
// sender id. Two allow-lists, and the one this panel wrote disagreed with Home
// Assistant's own.
//
// So the second list is gone rather than guarded. Home Assistant's
// `allowed_chat_ids` decides which chats the bot answers in; reaching one of
// those chats IS the permission. The owner's words: "As soon as the message is
// being received in the telegram chat (whether this is a group chat or an
// individual chat), the button shall be clickable whoever is clicking it. The
// fact that the person had access to the telegram chat is the first [gate]
// already." Do not reintroduce a per-person picker here — it was asked for
// twice, and `test_people` pins its absence.
//
// ⚠️ SO A ROW ANSWERS TWO THINGS, BOTH OUTBOUND. Where briefings go
// (`targets`), and which voice they are written in (`role`) — a facility
// manager gets the file that WANTS entity ids, an owner gets the one that
// forbids them. `people.role_for_chat` reads the same table backwards to pick
// that voice for a reply, which is a rendering question, never an admission
// one.
//
// ⚠️ ALL THREE PROFILES, from `auth/roles.ts` ROLE_ORDER: guest, owner and
// facility manager — the same three the onboarding menu offers. A fourth
// spelling of "who a person is" is how `facility` and `ops` once appeared in
// one picker.
//
// ⚠️ THE TABLE SHIPS EMPTY, still by security requirement: an empty table means
// nowhere to deliver, and a seeded one would write this property's briefings to
// whatever address a default named.
//
// ⚠️ AND IT IS A RENDERING CONVENIENCE ONLY. The proxy refuses a non-owner
// write to /agent-config. Nothing here is a control.

import ToggleField from "@/components/common/ToggleField";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { peopleOf,
         type AgentConfig, type Person } from "@/vesta/supervise/agentApi";
import { useAgentConfigDraft } from "@/vesta/supervise/AgentConfigDraft";
import { fetchReportsDiagnostics } from "@/vesta/brief/reportsApi";
import DestinationList, { RecipientButton,
                          type DiscoveredTarget } from "@/vesta/brief/components/DestinationList";
import { ROLE_LABELS, ROLE_ORDER, type Role } from "@/auth/roles";
import Loading from "@/components/common/Loading";

export default function PeoplePanel() {
  /** ⚠️ ONE DRAFT FOR THE WHOLE DOCUMENT, SHARED WITH THE DIALS PANEL BESIDE
   *  THIS ONE. Both edit `/agent-config`; two panels each holding their own
   *  copy and their own revision is a lost update, which is what put "I changed
   *  it and it did not save" on the screen. See `AgentConfigDraft`. */
  const draft = useAgentConfigDraft();
  const saving = draft.saving;
  /** Every destination Home Assistant can deliver to, from the SAME discovery
   *  the Briefings dialog uses. ⚠️ NOT A SECOND PICKER: `DestinationList` owns
   *  the tick-list idiom, including the two escapes from "a destination is a
   *  notify service" that this villa needed. */
  const [targets, setTargets] = useState<DiscoveredTarget[]>([]);
  /** Which row has its destination list open. ⚠️ ONE AT A TIME and by INDEX,
   *  the same rule ScheduleTab follows: two open lists on a phone push
   *  everything else off the screen. */
  const [open, setOpen] = useState<number | null>(null);

  const rows = peopleOf(draft.config);

  useEffect(() => {
    let cancelled = false;
    void fetchReportsDiagnostics().then((diag) => {
      if (!cancelled) setTargets(diag?.notifyTargets ?? []);
    });
    return () => { cancelled = true; };
  }, []);

  /** Put the whole table into the draft.
   *
   *  ⚠️ A BLANK ROW IS KEPT IN THE DRAFT RATHER THAN DROPPED. An operator fills
   *  a row in left to right, and a table that deleted the row the moment it had
   *  no destinations would delete it under the cursor. `people._row` drops a
   *  roleless row on read, so nothing downstream can be confused by one.
   *
   *  ⚠️ NO DUPLICATE CHECK ANY MORE: there is no per-person id to collide.
   *  Two rows may name the same chat, and `people.CHAT_ROLE_PRECEDENCE` decides
   *  which voice that chat is answered in rather than list order. */
  const commit = useCallback((next: Person[]) => {
    draft.edit({ people: next });
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
      <Loading />
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
            Anyone who can see a message in one of the bot's Telegram chats can
            reply to it and press its buttons. Reaching the chat is the
            permission — Home Assistant already decides which chats the bot
            answers in, and the villa does not keep a second list beside it. The
            profile below decides whose voice a reply is written in, not who is
            allowed to ask.
          </>
        ) : undefined}
      />

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
              onClick={() => commit([...rows, { targets: [], role: "owner" }])}
              style={{ marginTop: 10, alignSelf: "flex-start" }}>
        <Plus size={16} aria-hidden /><span>Add someone</span>
      </button>

    </>
  );
}
