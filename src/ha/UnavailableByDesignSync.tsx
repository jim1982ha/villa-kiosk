// src/ha/UnavailableByDesignSync.tsx
// Headless: hands the villa's list of devices asleep by design (AppConfig.unavailableByDesign, a shared setting) to
// the entity store, the ONE place that applies it (ha/unavailableByDesign). Inside the sign-in gate, like
// DeviceConfigSync: the store reads a joining device's last report from history, which needs the session.

import { useEffect } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "./HAStateStore";

export default function UnavailableByDesignSync() {
  const { config } = useConfig();
  const { setUnavailableByDesign } = useHA();
  const ids = config.unavailableByDesign;
  useEffect(() => { setUnavailableByDesign(new Set(ids)); }, [ids, setUnavailableByDesign]);
  return null;
}
