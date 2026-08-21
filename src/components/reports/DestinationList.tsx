// src/components/reports/DestinationList.tsx
// A list of delivery destinations, with a picker. Used twice.
//
// ⚠️ ONE COMPONENT BECAUSE THERE ARE TWO PLACES, NOT DESPITE IT. The shared
// list and each schedule's own override are the same widget over the same data,
// and the moment they are written twice they drift — the broadcast warning gets
// added to one, the "removed from Home Assistant" fallback to the other. That
// is Part 1 of /dry-audit: converge on one reader rather than adding a second.
//
// ⚠️ A DESTINATION IS ANY SERVICE THAT SPEAKS `title` + `message`, NOT JUST A
// `notify.*` ONE. `discovery._speaks_message` decides by reading each service's
// published schema, which is how `telegram_bot.send_message` appears here: the
// modern Telegram integration registers no `notify.telegram_*` service at all,
// so a picker built from the notify domain showed six phones and a television
// and the owner asked where Telegram had gone.

import { Trash2 } from "lucide-react";

/** The `entity:` prefix exists to keep an entity target from being confused
 *  with a service of the same shape (see `discovery.ENTITY_TARGET_PREFIX`). It
 *  is a storage detail and reads as noise beside a friendly name, so it is
 *  dropped for display only — never from the value. */
const plain = (target: string) =>
  target.startsWith("entity:") ? target.slice("entity:".length) : target;

export interface DiscoveredTarget {
  service: string;
  name: string;
  broadcast: boolean;
  /** ⚠️ A SERVICE THAT CANNOT BE CALLED WITHOUT AN `entity_id`, and therefore
   *  one that must NOT be offered. `notify.send_message` is the modern
   *  platform's single entry point: picking it bare is a valid-looking choice
   *  that fails at delivery time, hours later, on nobody's screen. The
   *  destinations it stands for are listed individually as entity targets — so
   *  hiding it removes a trap without removing a capability. */
  needsTarget: boolean;
}

export default function DestinationList({
  targets, available, onChange, emptyText,
}: {
  targets: string[];
  available: DiscoveredTarget[];
  onChange: (next: string[]) => void;
  emptyText: string;
}) {
  const unused = available.filter(
    (t) => !targets.includes(t.service) && !t.needsTarget);

  /** A configured target keeps its friendly name if discovery still knows it,
   *  and prints as its raw service id if it does not — a target since removed
   *  from Home Assistant must stay VISIBLE and removable, not silently vanish
   *  from a list the operator is auditing. */
  const label = (service: string) => {
    const known = available.find((t) => t.service === service);
    return known && known.name !== service
      ? `${known.name} — ${plain(service)}` : plain(service);
  };

  return (
    <>
      <ul className="reports-list">
        {targets.map((t) => (
          <li key={t} className="reports-item">
            <span>{label(t)}</span>
            <button
              className="btn danger icon-only"
              aria-label={`Stop sending to ${t}`}
              onClick={() => onChange(targets.filter((x) => x !== t))}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
        {targets.length === 0 && <li className="reports-item muted">{emptyText}</li>}
        {/* ⚠️ `notify.notify` FANS OUT TO EVERY DEVICE IN THE HOUSE. A perfectly
            good service and a terrible default: a villa that switches briefings
            on and gets the weekly summary on the TV, three phones and a tablet
            switches them off again. Discovery flags it; this warns. */}
        {targets.some((t) => available.find((a) => a.service === t)?.broadcast) && (
          <li className="reports-item sev-warning">
            One of these sends to every device in the house at once.
          </li>
        )}
      </ul>

      {/* ⚠️ A PICKER, NOT A TEXT FIELD. The services are already known, and a
          typed service name that does not exist fails silently at delivery
          time — hours later, on nobody's screen. */}
      {available.length === 0 ? (
        <p className="muted body-text">
          Home Assistant offers no service that can deliver a brief. Set up a
          notification integration there first.
        </p>
      ) : unused.length > 0 && (
        <div className="reports-schedule">
          <select
            aria-label="Add a destination"
            value=""
            onChange={(e) => { if (e.target.value) onChange([...targets, e.target.value]); }}
          >
            <option value="">Add a destination…</option>
            {unused.map((t) => (
              <option key={t.service} value={t.service}>
                {t.name === t.service
                  ? plain(t.service) : `${t.name} — ${plain(t.service)}`}
                {t.broadcast ? " (every device)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
