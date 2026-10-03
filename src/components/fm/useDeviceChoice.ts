// src/components/fm/useDeviceChoice.ts
// "Which device is this about?" in a Facility form — the search box's text
// and the device it matched, kept together (2.496.263). The Faults and Spend
// tabs each held the pair and wrote select / clear / edit by hand; one place
// now guarantees that typing un-matches the device, so a stale match can
// never ride along under text the person has since changed.

import { useState } from "react";

export function useDeviceChoice() {
  const [deviceText, setDeviceText] = useState("");
  const [entityId, setEntityId] = useState("");
  /** Choose a device (from the search or a shortlist). */
  const selectDevice = (id: string, name: string) => { setEntityId(id); setDeviceText(name); };
  const clearDevice = () => { setEntityId(""); setDeviceText(""); };
  return {
    deviceText, entityId, selectDevice, clearDevice,
    /** What DeviceSearchPicker needs, bar its options. */
    pickerProps: {
      value: deviceText,
      matchedEntityId: entityId || undefined,
      onChangeText: (text: string) => { setDeviceText(text); setEntityId(""); },
      onSelect: (opt: { entityId: string; label: string }) => selectDevice(opt.entityId, opt.label),
      onClear: clearDevice,
    },
  };
}
