// src/components/panels/useOpenPanelActions.ts
// The open panel's header actions — Back, its other readings, edit, report a
// fault, the badge and its colour, the linked switch (asked first when it must
// be) and the motion line — built in one place, next to the context BasePanel
// reads them from.
//
// ⚠️ OUT OF THE DASHBOARD PAGE (architecture review 11, 2026-10-09). They were
// assembled across ~90 lines of pages/Dashboard.tsx, the app's most-changed
// file (32 commits in a month): every new header button rewired the page.
// A new action now touches this file and BasePanel, nothing else.

import { useCallback } from "react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { roleCan } from "@/auth/permissions";
import { labelOf } from "@/config/EntityMap";
import { CATEGORY_LABELS } from "@/config/EntityCategories";
import { patchMapping } from "@/config/mappingEdits";
import { readingRows } from "@/config/readingRows";
import { deviceSwitch } from "@/utils/devicePower";
import { HAServices } from "@/ha/HAServiceCalls";
import { useOptimisticToggle } from "@/hooks/useOptimisticToggle";
import { useAskFirst, type AskFirst } from "@/hooks/useAskFirst";
import { backLabel, type Screen, type ScreenAction } from "@/pages/screen";
import type { ActivePanel } from "@/types/panel.types";
import type { ReadingRow } from "@/config/readingRows";
import type { PanelActions } from "./PanelActionsContext";
import { panelHeader } from "./panelHeader";

export interface OpenPanelInput {
  screen: Screen;
  go: (a: ScreenAction) => void;
  /** The panel an entity opens to, or null when this profile may not see it. */
  panelFor: (entityId: string) => ActivePanel | null;
  /** What else is on the open entity's device (config/VillaModel's identity). */
  readingsOf: (entityId: string) => readonly string[];
}

/** The open panel's actions (null when no panel is open), and the linked
 *  switch's "ask first" question, which the page draws as a dialog. */
export function useOpenPanelActions({ screen, go, panelFor, readingsOf }: OpenPanelInput): {
  actions: PanelActions | null;
  linkedAsk: AskFirst;
} {
  const { config, update } = useConfig();
  const { entities, ws } = useHA();
  const { role } = useProfile();
  const canControl = roleCan(role, "controlEntities");
  const canEditConfig = roleCan(role, "editConfig");
  const canReportFault = roleCan(role, "reportFault");
  const activePanel = screen.nav.panel;

  /** A device's reading, opened from the device's panel: Back returns to it. */
  const openReading = useCallback(
    (entityId: string) => go({ type: "openReading", panel: panelFor(entityId) }), [panelFor, go]);
  const goBack = useCallback(() => go({ type: "back" }), [go]);
  const backText = backLabel(screen, (id) => labelOf(id, config.entityMap, entities), (c) => CATEGORY_LABELS[c]);
  const readings: ReadingRow[] = activePanel
    ? readingRows(readingsOf(activePanel.entityId), entities, config.entityMap, config.alertThresholds)
    : [];

  // The open panel's LINKED entity (EntityMapping.linkedEntityId). Its switch
  // is optimistic: the switch otherwise can't move until the device itself
  // confirms, which for some integrations (an AP LED, say) takes seconds —
  // see useOptimisticToggle. Its power is devicePower's: a linked LOCK is "on"
  // when unlocked and is flipped with lock/unlock (it has no toggle); unknown
  // when HA lost it. deviceSwitch adds whether to ask first: a linked lock's
  // unlock, or a linked device the owner set to "ask before switching".
  const linkedEntityId = activePanel
    ? (config.entityMap[activePanel.entityId] ?? activePanel.mapping).linkedEntityId
    : undefined;
  const linkedLabel = linkedEntityId ? labelOf(linkedEntityId, config.entityMap, entities) : "";
  const linkedPower = linkedEntityId
    ? deviceSwitch(entities[linkedEntityId], linkedEntityId,
        { label: linkedLabel, requireConfirm: config.entityMap[linkedEntityId]?.requireConfirm })
    : null;
  const linkedSend = useCallback(
    () => (linkedEntityId ? HAServices.power(ws, entities[linkedEntityId], linkedEntityId) : undefined),
    [ws, linkedEntityId, entities]);
  const linkedToggle = useOptimisticToggle(linkedEntityId, linkedPower?.position === "on", linkedSend);
  // The panel row and the camera's rail both draw this switch; the question
  // is asked by the page, as a dialog, so neither can skip it and the
  // camera's narrow rail needs no room for an inline prompt.
  const linkedAsk = useAskFirst(linkedPower?.ask ?? null, linkedToggle.toggle);

  if (!activePanel) return { actions: null, linkedAsk };
  // The device's exact map badge, its linked switch and its motion line —
  // components/panels/panelHeader, from the open panel and live data; the
  // switch's state is the optimistic hook's.
  const header = panelHeader({ panel: activePanel, entities, config, canControl,
    linkedSwitch: linkedPower ? { isOn: linkedToggle.isOn, known: linkedPower.position !== "unknown" } : null });
  return {
    linkedAsk,
    actions: {
      entityId: activePanel.entityId,
      readings,
      onOpenReading: openReading,
      back: backText ? { label: backText, go: goBack } : undefined,
      // Owner-only: jump straight to this device's row in Advanced Settings.
      onEdit: canEditConfig ? () => go({ type: "editDevice" }) : undefined,
      // Every profile can report; only some can MANAGE. A guest gets a
      // one-screen report form, an owner/facility manager lands in the Faults
      // tab with the device filled in — same button, same intent.
      onReportFault: canReportFault ? () => go({ type: "reportFault" }) : undefined,
      badge: header.badge,
      onSetBadgeColor: canEditConfig
        ? (hex) => update(patchMapping(activePanel.entityId, { badgeColor: hex ?? undefined }, activePanel.mapping))
        : undefined,
      linked: header.linked ? { ...header.linked, toggle: linkedAsk.request } : undefined,
      motion: header.motion ?? undefined,
    },
  };
}
