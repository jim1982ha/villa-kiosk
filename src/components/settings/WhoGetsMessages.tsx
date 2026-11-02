// src/components/settings/WhoGetsMessages.tsx
// Advanced Settings › Messages › "Who gets the messages" (owner, 2026-11-03): the villa's two lists, the owner's and
// the facility manager's, each picked among the villa's notify entities (its Telegram chats and phone apps), never
// typed. Saved on the villa itself (messages/recipients), where every VESTA alert and the VESTA Agent read them: a
// change reaches the next alert at once, the Agent's within 5 minutes.

import { useState } from "react";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { ROLE_LABELS } from "@/auth/roles";
import { ROLE_LISTS, textOf, targetsOf } from "@/messages/recipients";
import RemovablePill from "@/components/common/RemovablePill";
import EntityPicker from "./EntityPicker";
import { withItem } from "@/utils/listToggle";

export default function WhoGetsMessages() {
  const { entities, ws } = useHA();
  const name = useEntityLabel();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      {ROLE_LISTS.map((list) => {
        const who = ROLE_LABELS[list.profile];
        const helper = entities[list.entityId];
        const ids = targetsOf(helper?.state);
        const save = async (next: string[]) => {
          const text = textOf(next);
          if (text === null) {
            setProblem(`The ${who}'s list is full: take someone off it first.`);
            return;
          }
          const sent = await HAServices.setText(ws, list.entityId, text);
          setProblem(sent.ok ? null : `The ${who}'s list could not be saved: try again.`);
        };
        return (
          <div key={list.role} className="settings-field-row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span className="body-text" style={{ minWidth: 130 }}>{who}</span>
            {!helper ? (
              <span className="muted body-text">The villa has no list for this yet: it comes with VESTA's message settings.</span>
            ) : (
              <>
                {ids.map((id) => (
                  <RemovablePill key={id} label={name(id)} tip={id} removeLabel={`Take ${name(id)} off the ${who}'s list`}
                    onRemove={() => void save(withItem(ids, id, false))} />
                ))}
                <div style={{ flex: "1 1 180px", minWidth: 140 }}>
                  <EntityPicker domains={["notify"]} onChange={(id) => void save(withItem(ids, id, true))}
                    placeholder="Add a chat or phone…" hideCurrentLabel compact />
                </div>
              </>
            )}
          </div>
        );
      })}
      {problem && <span className="body-text sev-warning" role="alert">{problem}</span>}
    </>
  );
}
