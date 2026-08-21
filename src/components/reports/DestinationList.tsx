// src/components/reports/DestinationList.tsx
// Who receives one schedule's briefing: an inline button showing the current
// choice, and a tick list behind it.
//
// ⚠️ TICKING, NOT ADD-THEN-DELETE, AND THAT WAS THE OWNER'S CALL. The first
// version was a picker that appended, plus a trash button per chosen row —
// three controls to express one set, stacked under a schedule that is itself
// three controls, and on a tablet it read as clutter: "the choice of the
// recipient shall be done via an inline button (same line as the schedule
// definition) and no need to add a dedicated delete icon for this".
//
// A tick list is the honest shape anyway. The value IS a set of destinations,
// so a checkbox per destination maps one-to-one onto it; adding and removing
// stop being separate operations with separate affordances, and the list of
// what is available doubles as the list of what is chosen.
//
// ⚠️ A DESTINATION IS NOT ONLY A `notify.*` SERVICE, and the reference villa
// needed both escapes from that assumption.
//
//   ANY DOMAIN, if the service takes a required `message` and a `title` —
//   `discovery._speaks_message` decides from the published schema. That is how
//   `telegram_bot.send_message` appears: the modern Telegram integration
//   registers NO `notify.telegram_*` service at all, so a picker built from the
//   notify domain showed six phones and a television.
//
//   AN ENTITY, written `entity:notify.x`. The modern notify platform registers
//   ONE `notify.send_message` service and an ENTITY per destination, so a bot
//   with two allowed chats is two entities and zero services. This is the only
//   way to address ONE of them — which is what "send it to the Telegram group,
//   not to every chat the bot can reach" requires.

import { ChevronDown, Send } from "lucide-react";

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

/** The `entity:` prefix keeps an entity target from being confused with a
 *  service of the same shape (`discovery.ENTITY_TARGET_PREFIX`). It is a
 *  storage detail and reads as noise beside a friendly name, so it is dropped
 *  for display only — never from the value. */
const plain = (target: string) =>
  target.startsWith("entity:") ? target.slice("entity:".length) : target;

/** What the inline button says: the answer to "who gets this one", at a glance
 *  and without opening anything. Exported because the button lives in the
 *  schedule row and the list lives under it — one function so the two cannot
 *  describe the same set differently. */
export function summarise(targets: string[], available: DiscoveredTarget[]): string {
  const nameOf = (service: string) =>
    available.find((t) => t.service === service)?.name || plain(service);
  if (targets.length === 0) return "Nobody";
  if (targets.length === 1) return nameOf(targets[0]);
  return `${nameOf(targets[0])} +${targets.length - 1}`;
}

export function RecipientButton({
  targets, available, open, onToggle,
}: {
  targets: string[];
  available: DiscoveredTarget[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="btn"
      aria-expanded={open}
      aria-label={`Recipients: ${summarise(targets, available)}`}
      onClick={onToggle}
    >
      <Send size={16} aria-hidden="true" />
      <span className={targets.length === 0 ? "sev-warning" : undefined}>
        {summarise(targets, available)}
      </span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
  );
}

export default function DestinationList({
  targets, available, onChange,
}: {
  targets: string[];
  available: DiscoveredTarget[];
  onChange: (next: string[]) => void;
}) {
  const offered = available.filter((t) => !t.needsTarget);

  /** ⚠️ THE UNION OF OFFERED AND CHOSEN, NOT JUST WHAT IS OFFERED. A target
   *  since removed from Home Assistant must stay visible and un-tickable, not
   *  silently vanish from a set the operator is auditing — with the trash
   *  buttons gone, a row that is not rendered is a destination that cannot be
   *  removed at all. */
  const rows: DiscoveredTarget[] = [
    ...offered,
    ...targets
      .filter((t) => !offered.some((o) => o.service === t))
      .map((t) => ({
        service: t, name: `${plain(t)} (no longer in Home Assistant)`,
        broadcast: false, needsTarget: false,
      })),
  ];

  const toggle = (service: string) =>
    onChange(targets.includes(service)
      ? targets.filter((t) => t !== service)
      : [...targets, service]);

  return (
    <div className="reports-recipients">
      {rows.length === 0 && (
        <p className="muted body-text">
          Home Assistant offers nothing that can deliver a brief. Set up a
          notification integration there first.
        </p>
      )}
      {rows.map((t) => (
        <label key={t.service} className="toggle">
          <input
            type="checkbox"
            checked={targets.includes(t.service)}
            onChange={() => toggle(t.service)}
          />
          <span>
            {t.name}
            {/* ⚠️ `notify.notify` FANS OUT TO EVERY DEVICE IN THE HOUSE. A
                perfectly good service and a terrible default: a villa that
                switches briefings on and gets the weekly summary on the TV,
                three phones and a tablet switches them off again. */}
            {t.broadcast && (
              <span className="sev-warning"> — every device in the house</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}
