// src/components/settings/WhoGetsMessages.tsx
// Settings › Messages › "Who gets the messages" (owner, 2026-11-03): the villa's two lists, the owner's and
// the facility manager's, each picked among the villa's notify entities (its Telegram chats and phone apps), never
// typed. Saved on the villa itself (messages/recipients), where every VESTA alert and the VESTA Agent read them: a
// change reaches the next alert at once, the Agent's within 5 minutes.
//
// ⚠️ EACH CHAT'S LANGUAGE IS SET HERE, BESIDE IT (owner, 2026-11-03: "isn't it also redundant to show … the language
// selection [on the VESTA Agent's page]? Since it's already selected in the Vesta kiosk UI"): one of the villa's
// settings (AppConfig chatLanguages), told to the Agent in its heartbeat answer. The Agent's page only shows it.
//
// ⚠️ ONE WAY OF SAVING FOR THE WHOLE SECTION (architecture review round 18, card 1): a chat was saved on the villa at
// once while its language waited in Settings' draft, so ✕ said "nothing was kept" over a chat that was, and a chat
// taken off left its language behind. Now the section owns both and saves both at once, outside the draft (its keys
// are not Settings' draft keys: configSlice.recordEdit records only those); a chat on no list any more loses its
// language with it.

import { useRef, useState } from "react";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { ROLE_LABELS } from "@/auth/roles";
import { CHAT_LANGUAGES, ROLE_LISTS, droppedChats, planChange, targetsOf, withChatLanguage, type SentLists } from "@/messages/recipients";
import { useConfig } from "@/config/ConfigContext";
import RemovablePill from "@/components/common/RemovablePill";
import Dropdown from "@/components/common/Dropdown";
import EntityPicker from "./EntityPicker";
import { withItem } from "@/utils/listToggle";

export default function WhoGetsMessages({ onSaved }: {
  /** A change saved on the villa (a chat added or taken off, a language set): the dialog's Cancel says it was kept. */
  onSaved?: () => void;
}) {
  const { entities, ws, getEntitiesSnapshot } = useHA();
  const name = useEntityLabel();
  // the villa's settings, written at once (never the dialog's draft): each chat's language
  const { config, update } = useConfig();
  const languages = config.chatLanguages;
  const setLanguage = (id: string, code: string) => {
    update((c) => ({ chatLanguages: withChatLanguage(c.chatLanguages, id, code) }));
    onSaved?.();
  };
  const [problem, setProblem] = useState<string | null>(null);
  // What this tablet sent to each list that the villa may not show yet: two adds in a row build on each other
  // (each used to build from the list on screen, and the second wrote over the first).
  const sentRef = useRef<Partial<Record<string, SentLists | null>>>({});
  return (
    <>
      {/* one card, a block per role (owner, 2026-11-03: the pills sat spread across the line, the pickers not lined up) */}
      <div className="settings-list">
      {/* the language column named once, as the announcements' "Seconds" (owner, 2026-11-03: "the language
          description part is still very badly explained … clearer and also shorter") */}
      <div className="settings-list-head">
        <span>Chat</span>
        <span>Language VESTA writes in</span>
      </div>
      {ROLE_LISTS.map((list) => {
        const who = ROLE_LABELS[list.profile];
        const helper = entities[list.entityId];
        const ids = targetsOf(helper?.state);
        const save = async (change: (ids: string[]) => string[]) => {
          // the villa's text as this tablet holds it NOW (not as rendered), and what this tablet sent since
          const plan = planChange(getEntitiesSnapshot()[list.entityId]?.state, sentRef.current[list.role] ?? null, change);
          if (plan.text === null) {
            setProblem(`The ${who}'s list is full: take someone off it first.`);
            return;
          }
          sentRef.current[list.role] = plan.sent;
          const sent = await HAServices.setText(ws, list.entityId, plan.text);
          if (!sent.ok) sentRef.current[list.role] = null;
          // a chat now on no list loses its language (it is no one's to read any more): withChatLanguage's English
          if (sent.ok) for (const gone of droppedChats(ROLE_LISTS.map((l) => l.role === list.role ? targetsOf(plan.text)
            : targetsOf(getEntitiesSnapshot()[l.entityId]?.state)), ids)) setLanguage(gone, "en");
          if (sent.ok) onSaved?.();
          setProblem(sent.ok ? null : `The ${who}'s list could not be saved: try again.`);
        };
        return (
          <div key={list.role} className="settings-list-row recipients-role">
            <span className="body-text recipients-role-name">{who}</span>
            {!helper ? (
              <span className="muted body-text">This list is not on the villa yet.</span>
            ) : (
              <>
                {ids.map((id) => (
                  <div key={id} className="recipients-chat">
                    <RemovablePill label={name(id)} tip={id} removeLabel={`Take ${name(id)} off the ${who}'s list`}
                      onRemove={() => void save((now) => withItem(now, id, false))} />
                    <Dropdown className="recipients-language" ariaLabel={`The language ${name(id)} reads VESTA's messages in`}
                      value={languages[id] ?? "en"} onChange={(code) => setLanguage(id, code)}
                      options={Object.entries(CHAT_LANGUAGES).map(([code, words]) => ({ value: code, label: words }))} />
                  </div>
                ))}
                <EntityPicker domains={["notify"]} onChange={(id) => void save((now) => withItem(now, id, true))}
                  placeholder="Add a chat or phone…" hideCurrentLabel compact />
              </>
            )}
          </div>
        );
      })}
      </div>
      {problem && <span className="body-text sev-warning" role="alert">{problem}</span>}
    </>
  );
}
