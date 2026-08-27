// src/components/settings/AgentActSettings.tsx
//
// What the villa is PERMITTED to do: when it may interrupt you, where jobs go,
// and whether it may touch anything.
//
// ⚠️ MOVED OUT OF THE "Act & Tell" TAB (2026-08-27, owner's judgement: its
// content "seems more relevant for Settings rather than a visible reporting
// Tab"). Right — the other four tier tabs REPORT and that one held three
// editable controls, so it was a settings pane wearing a step badge.
//
// ⚠️ THE ARGUMENT IT WAS PLACED THERE FOR STILL HOLDS, AND IS NOW MET
// DIFFERENTLY. §4.1 calls the reason/act line "the authority boundary, and the
// most important one", and the old header reasoned that an owner should see
// the whole of what the villa may do "without opening a settings dialog". That
// is now a read-only SUMMARY on the tab — a sentence anybody can read — while
// changing it happens here beside every other setting. Seeing and editing were
// being served by one surface, which is why it could not be either cleanly.
//
// ⚠️ AND THEY ARE THE SAME CONTROLS, NOT COPIES. One `AgentConfigDraft` wraps
// the whole dialog; two panels editing one document through two drafts is a
// lost update.

import { useAgentConfigDraft } from "@/agent/AgentConfigDraft";
import InfoHint from "@/components/common/InfoHint";
import ActuableDevicesPanel from "./ActuableDevicesPanel";
import ToggleField from "@/components/common/ToggleField";

export default function AgentActSettings() {
  const ctx = useAgentConfigDraft();
  const c = ctx.config;
  const edit = ctx.edit;
  // ⚠️ EMPTY MEANS NEVER QUIET, NOT ALWAYS. A property that has not set a
  // window wants its warnings; defaulting the other way silences a villa
  // nobody configured.
  const start = String(c.quietHoursStart ?? "");
  const end = String(c.quietHoursEnd ?? "");

  return (
    <>
      {/* ⚠️ "WHO DECIDES WHAT IS WORTH SAYING" WAS DELETED IN 2.755.0, AND
          THE ANSWER IS NOW THE HEADER SWITCH. It held one toggle,
          `agent_owns_analysis`, whose only job was to override a stand-down
          that no longer exists — a second master switch beside the real one,
          which is how an owner ends up with supervision ON and detection OFF
          and no screen able to say so. Supervision on means the assistant
          supersedes the automations; off means they do the job. One control,
          in the header, visible from every tab. */}
      <h3 className="settings-section-title">When it may interrupt you</h3>
      <p className="muted body-text">
        Inside this window the villa holds anything that can wait until morning.
        <InfoHint label="When it may interrupt you">
          Leave both empty and it never holds anything back. Something urgent
          ignores the window entirely — that is what makes it urgent.
        </InfoHint>
      </p>
      {/* ⚠️ `.row` + `.settings-row-half`, THE PAIR SETTINGS ALREADY USES.
          A first draft invented `.settings-row`, which is not a class this
          stylesheet defines — the two fields would have had no layout at all
          and `test_every_class_in_the_markup_exists_in_the_stylesheet` caught
          it before the commit. The half's flex-basis is what keeps them on one
          line on a phone as well as on a roomy screen. */}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="fm-field settings-row-half">
          <span>Quiet from</span>
          <input type="time" value={start}
                 onChange={(e) => edit({ quietHoursStart: e.target.value })} />
        </label>
        <label className="fm-field settings-row-half">
          <span>Quiet until</span>
          <input type="time" value={end}
                 onChange={(e) => edit({ quietHoursEnd: e.target.value })} />
        </label>
      </div>

      {/* ⚠️ THE FACILITY MANAGER LIST BELONGS ON THIS TAB, not under Settings. It is
          not a tuning dial — it decides whether a finding becomes a TO-DO ITEM
          somebody is asked to do, which is the same authority question as
          "who is told" and "what may it touch" directly above and below it. */}
      <h3 className="settings-section-title">Turning findings into to-do items</h3>
      <p className="muted body-text">
        Leave empty and nothing is added to a list.
        <InfoHint label="Turning findings into to-do items">
          <p>
            Name a to-do list and every finding the villa sends you is also
            added to it as a to-do item.
          </p>
          <p>
            The item carries the finding&rsquo;s reference in brackets. That is
            what lets one tick count everywhere: the Facility Manager screen on
            the tablet, the to-do list itself, and the acknowledgement count in
            your next briefing all read the same one.
          </p>
          {/* ⚠️ THIS PARAGRAPH DESCRIBED MACHINERY THAT WAS RETIRED ON
              2026-08-28 and would have gone on describing it. It read: "If you
              also install the VESTA task automation in Home Assistant, the job
              arrives on Telegram with a Done button and chases whoever is
              responsible." Nothing fires that automation any more — an item is
              the RECORD of work, and the alert is what announces the finding.
              A screen still promising a Telegram button is the shape of defect
              this project keeps paying for. */}
          <p>
            Nothing is messaged when an item is added — the alert already told
            somebody. Once a day, whoever holds the Facility manager role gets
            one message listing everything still open.
          </p>
          <p>
            {/* ⚠️ NO EXAMPLE ENTITY ID, NOT EVEN AS A PLACEHOLDER. This shipped
                one and `test_hard_rules` caught it twice over: an id-shaped
                string in rendered TSX reaches every install, and a placeholder
                is rendered. The shape is described instead. */}
            You will find the reference in Home Assistant under Settings,
            Devices &amp; services, Helpers. It begins with the word todo and a
            dot.
          </p>
        </InfoHint>
      </p>
      <label className="fm-field">
        <input
          type="text"
          value={String(c.taskList ?? "")}
          onChange={(e) => edit({ taskList: e.target.value.trim() })}
          disabled={ctx.saving}
        />
        <span>Facility manager to-do list</span>
      </label>

      <div className="settings-section-title">
        Allow to control devices
      </div>
      {/* ⚠️ THE GATE ON TOUCHING THE VILLA, AND IT SHIPS CLOSED (ADR-023).
          Home Assistant's own MCP add-on is where the villa's readings come
          from, and its tool surface includes calling services, deleting
          entities and restarting Home Assistant. `act_enabled` is the switch
          that decides whether any of that is reachable — it has existed and
          defaulted to false since the agent was written, and nothing in
          Settings could see it, so an owner had no way to know the promise was
          being kept. A guarantee nobody can check is not a guarantee. */}
      <ToggleField
        checked={c.actEnabled === true}
        onChange={(actEnabled: boolean) => edit({ actEnabled })}
        label="Let it operate devices, not just watch them"
        note="Check this option to allow VESTA Agent to control selected devices."
        disabled={ctx.saving}
        more={<>
          <p>
            Every other setting decides how much it looks and who it tells.
            This one decides whether it may touch anything at all.
          </p>
          <p>Leave it off unless you have a reason.</p>
          <p>
            It only ever touches what you add to the list below. The switch and
            the list must both allow it.
          </p>
          {/* ⚠️ MOVED HERE FROM THE LIST BELOW, because it qualifies the whole
              permission rather than the search box it used to sit under — and
              the list no longer has a heading or a hint of its own. */}
          <p>
            Anything that could let somebody in, or silence an alarm, is never
            done automatically — whatever is on that list. You are asked to
            confirm it instead.
          </p>
        </>}
      />
      {/* ⚠️ THE ALLOW-LIST LIVES WITH THE TIER THAT ENFORCES IT. It is only
          consulted here, at the authority boundary, and it is AND-ed with the
          master switch on the Settings tab — so an owner who turns actuation on
          and adds nothing has still authorised nothing, which the panel says
          out loud rather than leaving as an empty form. */}
      <ActuableDevicesPanel
        locked={c.actEnabled !== true}
        value={Array.isArray(c.actuableEntities)
          ? c.actuableEntities.map(String) : []}
        onChange={(actuableEntities) => edit({ actuableEntities })}
        disabled={ctx.saving}
      />

    </>
  );
}
