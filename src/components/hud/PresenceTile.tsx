// src/components/hud/PresenceTile.tsx
// Is the villa seen as empty or occupied — always in sight: a tile under the floors (the left rail is on every
// screen, the villa's name in the top bar is not), and a tap tells why (owner, 2026-10-18). WHAT it says is
// config/presence's (by value, tested); this draws it. No sensor picked in Settings › Villa: no tile.

import { CircleQuestionMark, House, Users } from "lucide-react";
import { presenceHeading, presenceStateWords, stageColor, stageWords, type Presence, type PresenceWhy } from "@/config/presence";
import { sinceWords as since, usePresence, usePresenceWhy } from "@/config/usePresence";
import { STATUS_COLOR } from "@/utils/stateColors";
import { useModalA11y } from "@/hooks/useModalA11y";
import ModalFooter from "@/components/common/ModalFooter";
import { useProfile } from "@/auth/ProfileContext";
import { profileView } from "@/auth/permissions";
import LastDayTimeline from "@/components/panels/LastDayTimeline";
import DialogLayer from "@/components/common/DialogLayer";
import InfoTip from "@/components/common/InfoTip";

const ICON = { occupied: Users, empty: House, unknown: CircleQuestionMark };
/** The tile's own short word (a 50 px rail): the panel's heading says it in full. */
const SHORT = { occupied: "In", empty: "Empty", unknown: "?" };

export default function PresenceTile({ onOpen }: { onOpen: () => void }) {
  const p = usePresence();
  if (!p) return null;
  return <div className="hud-stack"><PresenceButton presence={p.presence} when={p.since} onClick={onOpen} /></div>;
}

/** The villa's presence window, as the Dashboard opens it (pages/surfaces "presence"). A person's whereabouts are
 *  the owner's to see: the proxy never relays a person to a guest or staff session (ha-commands.json readDomains),
 *  so for them the window has no People at all. `canOpen`: whether a row's device has a panel to open. */
export function PresenceWindow({ onClose, onOpenEntity, canOpen }: {
  onClose: () => void; onOpenEntity: (entityId: string) => void; canOpen: (entityId: string) => boolean;
}) {
  const { role } = useProfile();
  const sees = profileView(role);
  const p = usePresence();
  const why = usePresenceWhy();
  if (!p) return null;
  const band = presenceBand(p.sensorId, why);
  const history = <LastDayTimeline entityId={band.entityId} words={band.words} colorFor={band.colorFor} />;
  return <PresencePanel presence={p.presence} when={p.since} why={why} showPeople={sees.people} showMovement={sees.motion}
    canOpen={canOpen} onOpenEntity={onOpenEntity} onClose={onClose} presenceHistory={history} />;
}

/** What the window's band charts — pure (a check reads it by value).
 *  ⚠️ EACH STEP IN THE BAND (owner, 2026-10-24: "show each stage … so user can see clearly when each step was
 *  triggered"): a sensor that names its stages is charted by them, in its own words and order; otherwise the presence
 *  sensor picked in Settings, Occupied / Empty, as before. */
export function presenceBand(sensorId: string, why: PresenceWhy): {
  entityId: string; words: (s: string) => string; colorFor: (s: string) => string;
} {
  const st = why.stages;
  return st
    ? { entityId: st.sensorId, words: (s) => stageWords(st, s), colorFor: (s) => stageColor(st, s) }
    : { entityId: sensorId, words: (s) => presenceStateWords(s).label, colorFor: (s) => STATUS_COLOR[presenceStateWords(s).tone] };
}

/** The tile, drawn — pure (a check draws it). `when`: since when, in words (usePresence). */
export function PresenceButton({ presence: p, when, onClick }: { presence: Presence; when: string; onClick: () => void }) {
  const Icon = ICON[p.state];
  const said = p.state === "empty" && when ? `Empty since ${when}` : p.label;
  return (
    <button type="button" className="icon-btn hud-presence-btn" data-presence={p.state}
      style={{ "--tone": STATUS_COLOR[p.tone] } as React.CSSProperties}
      title={`${said}, tap to see why`} aria-label={`${said}. Tap to see why.`} onClick={onClick}>
      <Icon size={18} aria-hidden />
      <span className="hud-presence-word">{SHORT[p.state]}</span>
    </button>
  );
}

/** One row of the window: what it names, its state. A button only when it opens something (owner, 2026-10-18: a row
 *  that lit up under the mouse and did nothing) — otherwise plain text, no hover, no pointer. */
function Row({ entityId, name, said, onOpen, tip }: {
  entityId: string; name: string; said: string; onOpen?: (id: string) => void;
  /** What it does, behind an (i) inline after its name (owner, 2026-10-24). A button never holds the (i)'s own
   *  button: with one, the name alone opens the device. */
  tip?: string;
}) {
  if (tip) {
    return (
      <li><div className="presence-row">
        <span className="with-tip">
          {onOpen ? <button type="button" className="presence-name opens" onClick={() => onOpen(entityId)}>{name}</button> : <span>{name}</span>}
          <InfoTip label={`About ${name}`}>{tip}</InfoTip>
        </span>
        <span className="muted">{said}</span>
      </div></li>
    );
  }
  const inner = <><span>{name}</span><span className="muted">{said}</span></>;
  return (
    <li>{onOpen
      ? <button type="button" className="presence-row opens" onClick={() => onOpen(entityId)}>{inner}</button>
      : <div className="presence-row">{inner}</div>}</li>
  );
}

/** Why the villa counts as empty or occupied: who it watches (the owner only), the latest movement among the sensors
 *  it watches with its history, the settings that decide it — all from the sensor's own lists (config/presence).
 *  Pure (a check draws it): the history is drawn by `historyOf`, the window's ReadingHistory. */
export function PresencePanel({ presence: p, when, why, showPeople, showMovement = true, canOpen, onOpenEntity, onClose, presenceHistory }: {
  presence: Presence; when: string; why: PresenceWhy; showPeople: boolean;
  /** Its latest movement — never for a profile that sees no motion (profileView: a guest). */
  showMovement?: boolean; canOpen: (entityId: string) => boolean;
  onOpenEntity: (entityId: string) => void; onClose: () => void;
  /** The villa's presence itself over time — Occupied / Empty (owner, 2026-10-20: the only band was the latest
   *  movement's, "Clear", read as the villa's) — right under its "now". */
  presenceHistory?: React.ReactNode;
}) {
  const dialogRef = useModalA11y(onClose);
  const act = why.lastActivity;
  const head = presenceHeading(p, when, why.stages, since);
  const opener = (id: string) => (canOpen(id) ? onOpenEntity : undefined);
  return (
    <DialogLayer className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal settings-modal presence-modal" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Villa presence">
        <div className="modal-header"><h2>Villa presence</h2></div>
        <div className="modal-body">
          <div className="presence-now" style={{ "--tone": head.color } as React.CSSProperties}>
            <strong>{head.label}</strong>{head.when ? <span className="muted"> · since {head.when}</span> : null}
          </div>
          {presenceHistory}
          {showPeople && (
            <>
              <div className="settings-section-title">People</div>
              {why.people === null ? <p className="muted body-text">This sensor does not list the people it watches.</p>
                : why.people.length === 0 ? <p className="muted body-text">None of the people this sensor watches is known.</p> : (
                  <ul className="presence-list">
                    {why.people.map((x) => <Row key={x.entityId} entityId={x.entityId} name={x.name} onOpen={opener(x.entityId)}
                      said={`${x.place}${since(x.since) ? ` · since ${since(x.since)}` : ""}`} />)}
                  </ul>
                )}
            </>
          )}
          {showMovement && (
            <>
              <div className="settings-section-title">Latest movement</div>
              {act ? (
                <>
                  {/* ⚠️ NOT A BUTTON, AND NO CHART OF ITS OWN (owner, 2026-10-20: its "Clear" band was read as the
                      villa's; the villa's Occupied / Empty band replaces it, under "now") */}
                  <ul className="presence-list">
                    <Row entityId={act.entityId} name={act.name} tip={act.full || undefined}
                      said={act.moving ? "moving now" : `quiet since ${since(act.at)}`} />
                  </ul>
                </>
              ) : <p className="muted body-text">{why.listsSensors ? "None of the sensors this one watches reports." : "This sensor does not list the sensors it watches."}</p>}
            </>
          )}
          {why.settings.length > 0 && (
            <>
              <div className="settings-section-title">What decides it</div>
              <ul className="presence-list">
                {why.settings.map((x) => <Row key={x.entityId} entityId={x.entityId} name={x.name} onOpen={opener(x.entityId)}
                  said={x.said} tip={x.explain || undefined} />)}
              </ul>
            </>
          )}
        </div>
        <ModalFooter onClose={onClose} />
      </div>
    </DialogLayer>
  );
}
