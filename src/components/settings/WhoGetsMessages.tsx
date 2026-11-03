// src/components/settings/WhoGetsMessages.tsx
// Settings › Messages › "Who gets the messages" (owner, 2026-11-03): the villa's two lists, the owner's and
// the facility manager's, each picked among the villa's notify entities (its Telegram chats and phone apps), never
// typed. Saved on the villa itself (messages/recipients), where every VESTA alert and the VESTA Agent read them: a
// change reaches the next alert at once, the Agent's within 5 minutes.

import { useRef, useState } from "react";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { ROLE_LABELS } from "@/auth/roles";
import { ROLE_LISTS, planChange, targetsOf, type SentLists } from "@/messages/recipients";
import RemovablePill from "@/components/common/RemovablePill";
import EntityPicker from "./EntityPicker";
import { withItem } from "@/utils/listToggle";

export default function WhoGetsMessages() {
  const { entities, ws, getEntitiesSnapshot } = useHA();
  const name = useEntityLabel();
  const [problem, setProblem] = useState<string | null>(null);
  // What this tablet sent to each list that the villa may not show yet: two adds in a row build on each other
  // (each used to build from the list on screen, and the second wrote over the first).
  const sentRef = useRef<Partial<Record<string, SentLists | null>>>({});
  return (
    <>
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
          <div key={list.role} className="settings-field-row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span className="body-text" style={{ minWidth: 130 }}>{who}</span>
            {!helper ? (
              <span className="muted body-text">The villa has no list for this yet: it comes with VESTA's message settings.</span>
            ) : (
              <>
                {ids.map((id) => (
                  <RemovablePill key={id} label={name(id)} tip={id} removeLabel={`Take ${name(id)} off the ${who}'s list`}
                    onRemove={() => void save((now) => withItem(now, id, false))} />
                ))}
                <div style={{ flex: "1 1 180px", minWidth: 140 }}>
                  <EntityPicker domains={["notify"]} onChange={(id) => void save((now) => withItem(now, id, true))}
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
