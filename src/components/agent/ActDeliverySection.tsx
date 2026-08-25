// src/components/agent/ActDeliverySection.tsx
//
// The two controls that belong to Tier 4: when the villa may interrupt you, and
// which devices it may operate.
//
// ⚠️ THEY SIT WITH THE TIER THEY GOVERN, NOT WITH THE OTHER SETTINGS. §4.1
// calls the reason/act line "the authority boundary, and the most important
// one" — the model decides what matters and never decides who is told or
// whether an action is permitted. Both of those are decided HERE, by a fixed
// table and an allow-list, so an owner reading this tab can see the whole of
// what the villa is permitted to do without opening a settings dialog.
//
// ⚠️ AND THEY ARE THE SAME CONTROLS AS BEFORE, NOT COPIES. `AgentTuningPanel`
// no longer renders them; this does. Two panels editing one document through
// two drafts is a lost update, so both read the one `AgentConfigDraft` the tab
// already wraps them in.

import { useAgentConfigDraft } from "@/agent/AgentConfigDraft";
import InfoHint from "@/components/common/InfoHint";
import ActuableDevicesPanel from "@/components/settings/ActuableDevicesPanel";

export default function ActDeliverySection() {
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

      {/* ⚠️ THE ALLOW-LIST LIVES WITH THE TIER THAT ENFORCES IT. It is only
          consulted here, at the authority boundary, and it is AND-ed with the
          master switch on the Settings tab — so an owner who turns actuation on
          and adds nothing has still authorised nothing, which the panel says
          out loud rather than leaving as an empty form. */}
      <ActuableDevicesPanel
        value={Array.isArray(c.actuableEntities)
          ? c.actuableEntities.map(String) : []}
        onChange={(actuableEntities) => edit({ actuableEntities })}
        disabled={ctx.saving}
      />

    </>
  );
}
