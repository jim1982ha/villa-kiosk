// src/components/hud/PresenceTile.tsx
// Is the villa seen as empty or occupied — always in sight: a tile under the floors (the left rail is on every
// screen, the villa's name in the top bar is not), and a tap tells why (owner, 2026-10-18). WHAT it says is
// config/presence's (by value, tested); this draws it. No sensor picked in Settings › Villa: no tile.

import { CircleQuestionMark, House, Users } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { presenceOf, presenceWhy, sinceText, type Presence, type PresenceWhy } from "@/config/presence";
import { STATUS_COLOR } from "@/utils/stateColors";
import { clockTime, dayTime } from "@/utils/dateText";
import { useModalA11y } from "@/hooks/useModalA11y";
import ModalFooter from "@/components/common/ModalFooter";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";

const ICON = { occupied: Users, empty: House, unknown: CircleQuestionMark };
const since = (at: string | null) => sinceText(at, clockTime, dayTime);
/** The tile's own short word (a 50 px rail): the panel's heading says it in full. */
const SHORT = { occupied: "In", empty: "Empty", unknown: "?" };

export default function PresenceTile({ onOpen }: { onOpen: () => void }) {
  const { entities } = useHA();
  const { config } = useConfig();
  const p = presenceOf(config.presenceSensor, entities);
  if (!p) return null;
  return <div className="hud-stack"><PresenceButton presence={p} onClick={onOpen} /></div>;
}

/** The villa's presence window, as the Dashboard opens it (pages/surfaces "presence"). A person's whereabouts are
 *  the owner's to see: the proxy never relays a person to a guest or staff session (ha-commands.json readDomains),
 *  so for them the window says nothing about people rather than "no person is set up". */
export function PresenceWindow({ onClose, onOpenEntity }: { onClose: () => void; onOpenEntity: (entityId: string) => void }) {
  const { entities } = useHA();
  const { config } = useConfig();
  const { role } = useProfile();
  const seesPeople = roleCan(role, "seePeople");
  const p = presenceOf(config.presenceSensor, entities);
  if (!p) return null;
  const why = presenceWhy(config.presenceSensor, entities);
  return <PresencePanel presence={p} why={seesPeople ? why : { ...why, people: null }} onOpenEntity={onOpenEntity} onClose={onClose} />;
}

/** The tile, drawn — pure (a check draws it). */
export function PresenceButton({ presence: p, onClick }: { presence: Presence; onClick: () => void }) {
  const Icon = ICON[p.state];
  const when = since(p.since);
  const said = p.state === "empty" && when ? `Empty since ${when}` : p.label;
  return (
    <button type="button" className="icon-btn hud-presence-btn" data-presence={p.state}
      style={{ "--tone": STATUS_COLOR[p.tone] } as React.CSSProperties}
      title={`${said} — tap to see why`} aria-label={`${said}. Tap to see why.`} onClick={onClick}>
      <Icon size={18} aria-hidden />
      <span className="hud-presence-word">{SHORT[p.state]}</span>
    </button>
  );
}

/** Why the villa counts as empty or occupied: who is home, the latest movement, the settings that decide it. */
/** One row of the window: what it names, its state; a tap opens it. */
function Row({ entityId, name, said, onOpen }: { entityId: string; name: string; said: string; onOpen: (id: string) => void }) {
  return (
    <li><button type="button" className="presence-row" onClick={() => onOpen(entityId)}>
      <span>{name}</span><span className="muted">{said}</span>
    </button></li>
  );
}

/** Why the villa counts as empty or occupied: who is home (the owner only: `people` null), the latest movement, the
 *  settings that decide it. Pure (a check draws it). */
export function PresencePanel({ presence: p, why, onOpenEntity, onClose }: {
  presence: Presence; why: Omit<PresenceWhy, "people"> & { people: PresenceWhy["people"] | null };
  onOpenEntity: (entityId: string) => void; onClose: () => void;
}) {
  const dialogRef = useModalA11y(onClose);
  const when = since(p.since);
  const act = why.lastActivity;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal settings-modal presence-modal" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Villa presence">
        <div className="modal-header"><h2>Villa presence</h2></div>
        <div className="modal-body">
          <div className="presence-now" style={{ "--tone": STATUS_COLOR[p.tone] } as React.CSSProperties}>
            <strong>{p.label}</strong>{when ? <span className="muted"> · since {when}</span> : null}
          </div>
          {why.people && (
            <>
              <div className="settings-section-title">People</div>
              {why.people.length === 0 ? <p className="muted body-text">No person is set up in the villa's system.</p> : (
                <ul className="presence-list">
                  {why.people.map((x) => <Row key={x.entityId} entityId={x.entityId} name={x.name} onOpen={onOpenEntity}
                    said={`${x.place}${since(x.since) ? ` · since ${since(x.since)}` : ""}`} />)}
                </ul>
              )}
            </>
          )}
          <div className="settings-section-title">Latest movement</div>
          {act ? (
            <ul className="presence-list">
              <Row entityId={act.entityId} name={act.name} onOpen={onOpenEntity}
                said={act.moving ? "moving now" : `quiet since ${since(act.at)}`} />
            </ul>
          ) : <p className="muted body-text">No motion sensor reports.</p>}
          {why.settings.length > 0 && (
            <>
              <div className="settings-section-title">What decides it</div>
              <ul className="presence-list">
                {why.settings.map((x) => <Row key={x.entityId} entityId={x.entityId} name={x.name} onOpen={onOpenEntity}
                  said={`${x.value}${x.unit ? ` ${x.unit}` : ""}`} />)}
              </ul>
            </>
          )}
        </div>
        <ModalFooter onClose={onClose} />
      </div>
    </div>
  );
}
