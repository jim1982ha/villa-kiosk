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
import RecordCard from "@/components/fm/RecordCard";
import { MessageCircle, X } from "lucide-react";
import Dropdown from "@/components/common/Dropdown";
import AddOnLine from "@/components/common/AddOnLine";
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
      {/* a block per role, its name and its add on one line, its chats under it (owner, 2026-11-03: the pills sat
          spread across the line, the pickers not lined up) */}
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
          <div key={list.role} className="recipients-role">
            {/* its add on the line of its name, opening there (owner, 2026-11-04; common/AddOnLine) */}
            {!helper ? <span className="body-text recipients-role-name">{who}</span> : (
              <AddOnLine title={<span className="body-text recipients-role-name">{who}</span>} words="Add"
                label={`Add a chat or phone to ${who}`}>
                {(done) => <EntityPicker domains={["notify"]} startOpen compact hideCurrentLabel placeholder="Add a chat or phone…"
                  onChange={(id) => { done(); void save((now) => withItem(now, id, true)); }} />}
              </AddOnLine>
            )}
            {!helper ? (
              <span className="muted body-text">This list is not on the villa yet.</span>
            ) : ids.length > 0 && (
              // ⚠️ EACH CHAT THE COCKPIT'S CARD (owner, 2026-11-06): its name in the strip (its list is the line above
              // it), the language VESTA writes to it its one field (owner, 2026-11-03: named once, short; 2026-11-06 "Language":
              // the card names the chat and the section says VESTA writes to it, so the name fits the cards' one name
              // column), Remove its bar
              <div className="fm-list">
                {ids.map((id) => (
                  <RecordCard key={id} title={name(id)} lead={<MessageCircle size={16} aria-hidden />}
                    body={
                      <div className="card-field">
                        <span className="card-field-label">Language</span>
                        <Dropdown className="recipients-language" ariaLabel={`The language ${name(id)} reads VESTA's messages in`}
                          value={languages[id] ?? "en"} onChange={(code) => setLanguage(id, code)}
                          options={Object.entries(CHAT_LANGUAGES).map(([code, words]) => ({ value: code, label: words }))} />
                      </div>
                    }
                    actions={
                      <button type="button" className="btn ghost" aria-label={`Take ${name(id)} off the ${who}'s list`}
                        onClick={() => void save((now) => withItem(now, id, false))}>
                        <X size={16} aria-hidden />Remove
                      </button>
                    } />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {problem && <span className="body-text sev-warning" role="alert">{problem}</span>}
    </>
  );
}
