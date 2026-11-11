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
// ⚠️ SAVED BY THE DIALOG'S SAVE, LIKE EVERY OTHER SETTING (owner, 2026-11-06: a chat taken off was written to the villa
// at once while Save stayed grey, so no one could tell it was saved). A list's change is HELD in the dialog's one
// pending store (config/pendingEdits `hold`): the card shows it at once, Save lights, Save sends the list (over the
// villa's list as it is then: another tablet's change meanwhile is kept), Cancel drops it. A chat's language is a key
// of Settings' draft (configSlice SETTINGS_KEYS), as every other: Cancel puts it back. A chat on no list any more
// loses its language with it, in the same draft. (Architecture review round 18 had made both "at once" instead.)

import { useRef, useState } from "react";
import { useHA } from "@/ha/HAStateStore";
import { HAServices } from "@/ha/HAServiceCalls";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { usePendingStore } from "@/hooks/usePendingField";
import { ROLE_LABELS } from "@/auth/roles";
import {
  CHAT_LANGUAGES, ROLE_LISTS, droppedChats, heldChanges, targetsOf, textOf, withChanges, withChatLanguage, type ListChange,
} from "@/messages/recipients";
import RecordCard from "@/components/fm/RecordCard";
import { NamedId } from "@/components/common/IdText";
import CardField from "./CardField";
import { MessageCircle } from "lucide-react";
import Dropdown from "@/components/common/Dropdown";
import AddOnLine from "@/components/common/AddOnLine";
import EntityPicker from "./EntityPicker";
import ProblemLine from "@/components/common/ProblemLine";

interface Props {
  /** Each chat's language, as Settings' draft shows it (its view). */
  languages: Readonly<Record<string, string>>;
  /** Write them, as the dialog writes (its draft: Save keeps, Cancel puts back). */
  onLanguages: (next: Record<string, string>) => void;
}

/** The pending store's key of a role's held changes. */
const heldKey = (role: string) => `recipients:${role}`;

/** The section's lists and what changes them, every change the dialog's (tests/oracles/settings_save.mjs drives it). */
export function useRecipientLists({ languages, onLanguages }: Props) {
  const { entities, ws, getEntitiesSnapshot } = useHA();
  const pending = usePendingStore();
  const [problem, setProblem] = useState<string | null>(null);
  // the connection as it is when Save sends, never as it was when the change was held
  const latest = useRef({ ws, getEntitiesSnapshot });
  latest.current = { ws, getEntitiesSnapshot };
  const villaIds = (entityId: string, now = entities) => targetsOf(now[entityId]?.state);
  const heldOf = (role: string) => (pending.shown(heldKey(role)) as ListChange[] | undefined) ?? [];
  const lists = ROLE_LISTS.map((list) => {
    const who = ROLE_LABELS[list.profile];
    const helper = entities[list.entityId];
    const ids = withChanges(villaIds(list.entityId), heldOf(list.role));
    /** What Save sends for this list: the held changes over the villa's list as it is then. */
    const send = (changes: readonly ListChange[]) => async () => {
      const { ws: now, getEntitiesSnapshot: snapshot } = latest.current;
      const text = textOf(withChanges(villaIds(list.entityId, snapshot()), changes));
      if (text === null) return `The ${who}'s list is full: take someone off it first.`;
      const sent = await HAServices.setText(now, list.entityId, text);
      return sent.ok ? null : `The ${who}'s list could not be saved: try again.`;
    };
    const change = (id: string, on: boolean) => {
      const villa = villaIds(list.entityId);
      const changes = heldChanges(villa, heldOf(list.role), { id, on });
      const next = withChanges(villa, changes);
      if (textOf(next) === null) {
        setProblem(`The ${who}'s list is full: take someone off it first.`);
        return;
      }
      setProblem(null);
      if (changes.length === 0) pending.forget(heldKey(list.role));
      else pending.hold(heldKey(list.role), changes, send(changes));
      // a chat now on no list loses its language (it is no one's to read any more): withChatLanguage's English
      const shown = ROLE_LISTS.map((l) => (l.role === list.role ? next : withChanges(villaIds(l.entityId), heldOf(l.role))));
      const gone = droppedChats(shown, ids);
      if (gone.length > 0) onLanguages(gone.reduce((m, g) => withChatLanguage(m, g, "en"), { ...languages }));
    };
    return { ...list, who, onVilla: !!helper, ids, add: (id: string) => change(id, true), remove: (id: string) => change(id, false) };
  });
  const setLanguage = (id: string, code: string) => onLanguages(withChatLanguage(languages, id, code));
  return { lists, problem, setLanguage };
}

export default function WhoGetsMessages(props: Props) {
  const name = useEntityLabel();
  const { lists, problem, setLanguage } = useRecipientLists(props);
  const { languages } = props;
  return (
    <>
      {/* a block per role, its name and its add on one line, its chats under it (owner, 2026-11-03: the pills sat
          spread across the line, the pickers not lined up) */}
      {lists.map(({ role, who, onVilla, ids, add, remove }) => {
        return (
          <div key={role} className="recipients-role">
            {/* its add on the line of its name, opening there (owner, 2026-11-04; common/AddOnLine) */}
            {!onVilla ? <span className="body-text recipients-role-name">{who}</span> : (
              <AddOnLine title={<span className="body-text recipients-role-name">{who}</span>} words="Add"
                label={`Add a chat or phone to ${who}`}>
                {(done) => <EntityPicker domains={["notify"]} startOpen compact placeholder="Add a chat or phone…"
                  onChange={(id) => { done(); add(id); }} />}
              </AddOnLine>
            )}
            {!onVilla ? (
              <span className="muted body-text">This list is not on the villa yet.</span>
            ) : ids.length > 0 && (
              // ⚠️ EACH CHAT THE COCKPIT'S CARD (owner, 2026-11-06): its name in the strip with its id after it, quiet
              // (common/IdText NamedId: the card has no id line; its list is the line above it), the language VESTA writes to it its one field (owner, 2026-11-03: named once, short; 2026-11-06 "Language":
              // the card names the chat and the section says VESTA writes to it, so the name fits the cards' one name
              // column), its bin at its strip's right takes it off the list
              <div className="fm-list">
                {ids.map((id) => (
                  <RecordCard key={id} title={<NamedId name={name(id)} id={id} />} lead={<MessageCircle size={16} aria-hidden />}
                    body={
                      <CardField label="Language">
                        <Dropdown className="recipients-language" ariaLabel={`The language ${name(id)} reads VESTA's messages in`}
                          value={languages[id] ?? "en"} onChange={(code) => setLanguage(id, code)}
                          options={Object.entries(CHAT_LANGUAGES).map(([code, words]) => ({ value: code, label: words }))} />
                      </CardField>
                    }
                    remove={{ label: `Take ${name(id)} off the ${who}'s list`, run: () => remove(id) }} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <ProblemLine>{problem}</ProblemLine>
    </>
  );
}
