// src/components/settings/WhoGetsMessages.tsx
// Settings › Messages › "Who gets the messages" (owner, 2026-11-03): the villa's two lists, the owner's and
// the facility manager's, each picked among the villa's notify entities (its Telegram chats and phone apps), never
// typed. Saved on the villa itself (messages/recipients), where every VESTA alert and the VESTA Agent read them: a
// change reaches the next alert at once, the Agent's within 5 minutes.
//
// ⚠️ EACH CHAT'S LANGUAGE IS SET HERE, BESIDE IT (owner, 2026-11-03: "isn't it also redundant to show … the language
// selection [on the VESTA Agent's page]? Since it's already selected in the Vesta kiosk UI"): one of the villa's
// settings (AppConfig chatLanguages), kept with Settings' Save like the rest of its draft, and told to the Agent in its
// heartbeat answer. The Agent's page only shows it.

import { useRef, useState } from "react";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { ROLE_LABELS } from "@/auth/roles";
import { CHAT_LANGUAGES, ROLE_LISTS, planChange, targetsOf, withChatLanguage, type SentLists } from "@/messages/recipients";
import RemovablePill from "@/components/common/RemovablePill";
import Dropdown from "@/components/common/Dropdown";
import EntityPicker from "./EntityPicker";
import { withItem } from "@/utils/listToggle";

interface Props {
  /** Each chat's language as the dialog shows it (its draft's view): notify entity → code; none named reads English. */
  languages: Readonly<Record<string, string>>;
  /** Write each chat's languages, as the dialog writes (its draft). */
  onLanguages: (next: Record<string, string>) => void;
}

export default function WhoGetsMessages({ languages, onLanguages }: Props) {
  const { entities, ws, getEntitiesSnapshot } = useHA();
  const name = useEntityLabel();
  const [problem, setProblem] = useState<string | null>(null);
  // What this tablet sent to each list that the villa may not show yet: two adds in a row build on each other
  // (each used to build from the list on screen, and the second wrote over the first).
  const sentRef = useRef<Partial<Record<string, SentLists | null>>>({});
  return (
    <>
      {/* one card, a block per role (owner, 2026-11-03: the pills sat spread across the line, the pickers not lined up) */}
      <div className="settings-list">
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
          setProblem(sent.ok ? null : `The ${who}'s list could not be saved: try again.`);
        };
        return (
          <div key={list.role} className="settings-list-row recipients-role">
            <span className="body-text recipients-role-name">{who}</span>
            {!helper ? (
              <span className="muted body-text">The villa has no list for this yet: it comes with VESTA's message settings.</span>
            ) : (
              <>
                {ids.map((id) => (
                  <div key={id} className="recipients-chat">
                    <RemovablePill label={name(id)} tip={id} removeLabel={`Take ${name(id)} off the ${who}'s list`}
                      onRemove={() => void save((now) => withItem(now, id, false))} />
                    <Dropdown className="recipients-language" ariaLabel={`The language ${name(id)} reads VESTA's messages in`}
                      value={languages[id] ?? "en"} onChange={(code) => onLanguages(withChatLanguage(languages, id, code))}
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
