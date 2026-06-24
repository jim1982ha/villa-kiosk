// src/components/panels/PowerToggle.tsx
// The big on/off button shared by the light, fan, switch and media panels.
// One component so the markup, the "on" styling and the Power icon live in a
// single place instead of being copy-pasted into every panel.

import { Power } from "lucide-react";

interface Props {
  on: boolean;
  onClick: () => void;
}

export default function PowerToggle({ on, onClick }: Props) {
  return (
    <button className={`big-toggle ${on ? "on" : ""}`} onClick={onClick}>
      <Power size={24} /> {on ? "On" : "Off"}
    </button>
  );
}
