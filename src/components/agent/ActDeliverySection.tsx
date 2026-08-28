// src/components/agent/ActDeliverySection.tsx
//
// What the villa is permitted to do, stated rather than edited.
//
// ⚠️ IT USED TO BE THE CONTROLS THEMSELVES, AND THAT MADE THIS TAB A SETTINGS
// PANE (2026-08-27, owner: its content "seems more relevant for Settings rather
// than a visible reporting Tab"). They were right. Reflex, Observe, Triage and
// Reason all REPORT — what fired, what was recorded, what was checked, what was
// concluded — and Act & Tell held three editable fields, so the one tab about
// the authority boundary was the one tab that showed no evidence.
//
// ⚠️ THE REASON THEY WERE PUT HERE SURVIVES, WHICH IS WHY THIS EXISTS AT ALL.
// §4.1 calls the reason/act line "the authority boundary, and the most
// important one", and the old header argued an owner should be able to see the
// whole of what the villa may do "without opening a settings dialog". Deleting
// the block outright would have lost that; a guarantee nobody can check is not
// a guarantee. So the permissions are still on this tab — as a SENTENCE, read
// from the same draft the settings write to, so the two cannot disagree.
//
// ⚠️ IT READS THE DRAFT, NOT THE SAVED DOCUMENT, and that is deliberate: an
// owner who has just changed a permission in Settings and come back to look
// should see what they chose, not what was stored before it.

import { useAgentConfigDraft } from "@/agent/AgentConfigDraft";

/** `""` → a sentence that says so. ⚠️ AN UNSET WINDOW MEANS NEVER QUIET, NOT
 *  ALWAYS — the same rule `outbox.quiet_now` states, and the opposite reading
 *  would have this tab claim a silent villa. */
function quietText(start: string, end: string): string {
  if (!start || !end || start === end) {
    return "It may interrupt you at any hour — no quiet window is set.";
  }
  return `Anything that can wait is held between ${start} and ${end}. `
    + "Something urgent ignores the window.";
}

export default function ActDeliverySection() {
  const { config } = useAgentConfigDraft();
  const start = String(config.quietHoursStart ?? "").trim();
  const end = String(config.quietHoursEnd ?? "").trim();
  const list = String(config.taskList ?? "").trim();
  const mayAct = config.actEnabled === true;
  const devices = Array.isArray(config.actuableEntities)
    ? config.actuableEntities.length : 0;

  return (
    <>
      <div className="settings-section-title">What it is allowed to do</div>
      <dl className="tier-facts">
        <div>
          <dt>Quiet hours</dt>
          <dd>{start && end && start !== end ? `${start} – ${end}` : "none"}</dd>
        </div>
        <div>
          <dt>To-Do List</dt>
          <dd>{list ? "on a list" : "off"}</dd>
        </div>
        <div>
          <dt>May operate devices</dt>
          {/* ⚠️ THE SWITCH AND THE LIST ARE BOTH REQUIRED, so reporting only
              the switch would overstate the permission — an owner who turned it
              on and added nothing has authorised exactly nothing, and the
              number is what says so. */}
          <dd>{mayAct ? (devices > 0 ? `${devices} allowed` : "none chosen") : "no"}</dd>
        </div>
      </dl>
      {/* ⚠️ ONE PARAGRAPH, NOT TWO (2026-08-28, owner: "merge the 2 text
          section together … and make it shorter, while keeping the same
          relevancy"). The line above the facts said only where the settings are
          edited, which is a sentence about navigation sitting where the reader
          wants a sentence about behaviour — and it pushed the thing they came
          to read below three chips. Where to change them is now a clause on the
          end, which is also where somebody who has finished reading needs it.
          ⚠️ THE TO-DO CLAUSE LOST ITS POINTER because the list is now directly
          underneath (the separate tab was merged in on the same day), and
          "appears under To-Do List" sent a reader looking for a tab that is
          no longer there. */}
      <p className="muted body-text">
        {quietText(start, end)}
        {" "}
        {list
          ? "Anything it tells you about becomes a to-do item, listed below."
          : "Nothing it finds is added to a to-do list, because none is named."}
        {" "}
        {mayAct
          ? (devices > 0
            ? "It may operate the devices you chose and nothing else; anything "
              + "that could let somebody in or silence an alarm is offered to "
              + "you rather than done."
            : "It is allowed to operate devices but none have been chosen, so "
              + "it can still touch nothing.")
          : "It can watch and tell, and touch nothing at all."}
        {" "}
        Change any of this under Settings &amp; others.
      </p>
    </>
  );
}
