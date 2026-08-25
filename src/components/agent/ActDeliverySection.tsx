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
import ToggleField from "@/components/common/ToggleField";
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
      {/* ⚠️ OWNERSHIP FIRST, TIMING SECOND, BY THE OWNER'S OWN ORDERING. This
          tab reads top-down as one question narrowing: WHO decides what is
          worth saying, then WHAT it may touch, then WHEN it may reach you. The
          quiet window used to lead, which put a preference about sleep above
          the switch that decides whether the assistant speaks for the villa at
          all. */}
      <h3 className="settings-section-title">Who decides what is worth saying</h3>
      <ToggleField
        checked={c.agentOwnsAnalysis === true}
        disabled={ctx.saving}
        onChange={(agentOwnsAnalysis) => edit({ agentOwnsAnalysis })}
        label="Let the assistant decide, not your automations"
        note="Turn this on once the assistant is the one you rely on."
        more={<>
          Off, a built-in check steps aside whenever one of your automations
          covers the same ground — installed is taken as doing the job. That is
          right while you still run them, and wrong once you have retired them:
          a switched-off rule is still installed, so it keeps its replacement
          switched off too, permanently.{" "}
          <strong>This does not double anything up.</strong> If one of your
          automations does report something, the assistant's version of that
          same device is still dropped in favour of yours, every time.
        </>}
      />
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
