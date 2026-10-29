// src/components/settings/MaintenanceMode.tsx
// The villa's maintenance mode (owner, 2026-10-29): its switch (Advanced Settings › System, owner only) and THE ONE
// explanation of it, shown by the switch's (i) and by the top bar's "Maintenance" mark while it is on (owner: "describe
// properly and clearly what the maintenance switch does in a (i) … and in the TOP BAR"). The VESTA Agent reads the
// switch from the stored villa settings (agent-contract.json `heartbeat.answer.maintenance`).

import { Wrench } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import SegmentedGroup from "@/components/common/SegmentedGroup";

/** What maintenance mode does, in the owner's words: the (i) of the switch and of the top bar's mark. */
export function MaintenanceModeExplained() {
  return (
    <>
      Turn it on while work is done in the villa, so VESTA does not chase anyone about the alarms the work sets off.
      While it is on:
      <ul>
        <li>urgent (P1) alerts still reach the owner and the facility manager through VESTA, numbered and chased as
          usual;</li>
        <li>any other new alert is not taken up by VESTA: no number, no reminder, no ticket. The villa's own message
          still appears in its chat and on the tablet;</li>
        <li>alerts already open carry on as before.</li>
      </ul>
      It takes effect within a few minutes. Every tablet shows "Maintenance" in its top bar while it is on. Turn it off
      in Advanced Settings › System once the work is done: the alerts that came meanwhile are not sent afterwards.
    </>
  );
}

/** The switch: one for every tablet (AppConfig.maintenanceMode). */
export default function MaintenanceMode() {
  const { config, update } = useConfig();
  const on = config.maintenanceMode;
  return (
    <div className="settings-field-row">
      <span className="muted body-text">Only urgent (P1) alerts are sent while it's on.</span>
      <SegmentedGroup ariaLabel="Maintenance mode" active={on ? "on" : null}
        onChange={() => update({ maintenanceMode: !on })}
        options={[{ key: "on", title: "Maintenance mode, on every tablet",
          label: <><Wrench size={16} /><span>{on ? "On" : "Off"}</span></> }]} />
    </div>
  );
}
