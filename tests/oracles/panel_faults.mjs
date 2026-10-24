// A device window's warning (owner, 2026-10-24: "when a device is flagged with an issue (or similarly with a linked
// entity for this device): put a /!\ icon on the top left of the additional details modal to open the cockpit
// highlighting this specific faults … contextual to the fault and refresh automatically (even disappear)"). Driven by
// value and drawn: when it shows (panelHeader.faults, the badge's own predicate), what a tap does (screen
// "openFaults"), the card it marks (attention.cardFocused, AttentionCard), and the button itself (FaultsButton).
import { h, draw, inside } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
import { parseTsx, elements, guardsOf } from "../consistency/jsx.mjs";
const { panelHeader } = await import("@/components/panels/panelHeader");
const { screenReducer, START } = await import("@/pages/screen");
const { attentionFor, cardFocused, groupAttention, issueSeverity } = await import("@/config/attention");
const { cockpitCard } = await import("@/config/cockpitCard");
const { AttentionCard } = await import("@/components/cockpit/CockpitOverview");
const { FaultsButton } = await import("@/components/panels/BasePanel");

console.log("  when it shows: any issue the Cockpit's Overview lists for the device or its linked entity:");
// owner, 2026-10-24: Timmerflotte_5969's "Unavailable" card was in the Cockpit and its window showed no warning —
// 2.496.523 read the badge's fault records only
const ent = (id, state) => ({ entity_id: id, state, attributes: {}, last_changed: "", last_updated: "" });
const entities = { "sensor.pump_power": ent("sensor.pump_power", "36"), "switch.pump_relay": ent("switch.pump_relay", "off") };
const map = { "sensor.pump_power": { entityId: "sensor.pump_power", type: "sensor", label: "Pump", linkedEntityId: "switch.pump_relay" } };
const pump = { entityId: "sensor.pump_power", mapping: map["sensor.pump_power"] };
const ids = panelHeader({ panel: pump, entities, canControl: true, linkedSwitch: null,
  config: { entityMap: map, deviceGroups: [], isHidden: () => false, hasFault: () => false } }).issueIds;
ck("the window asks about the device and its linked entity, the device first", ids.join() === "sensor.pump_power,switch.pump_relay", ids);
const item = (kind, entityId, extra = {}) => ({ id: `${kind}:${entityId}`, kind, title: entityId, detail: kind, entityId,
  device: { key: entityId, label: entityId, room: "Terrace" }, ...extra });
const sev = (items) => issueSeverity(groupAttention(items), ids, (id) => id);
ck("an offline device's card (no fault record): the warning, in the Overview's grey", sev([item("unavailable", "sensor.pump_power")]) === "lost");
ck("  ...a fault: amber; on the linked entity too", sev([item("fault", "sensor.pump_power", { ticketId: "f1", stage: "fault", source: "alert" })]) === "warn"
   && sev([item("fault", "switch.pump_relay", { ticketId: "f2", stage: "fault", source: "alert" })]) === "warn");
ck("  ...the most serious of them: an alarm (red) over a fault and an offline one",
   sev([item("unavailable", "switch.pump_relay"), item("alarm", "sensor.pump_power")]) === "danger");
ck("  ...another device's issue, or none: no warning — it goes by itself", sev([item("unavailable", "lock.door")]) === null && sev([]) === null);
{
  const villa = { devices: { deviceOf: (id) => id, ids: ["sensor.pump_power"], unavailable: ["sensor.pump_power"] },
    attentionItems: [item("unavailable", "sensor.pump_power")] };
  const seen = attentionFor(villa, (id) => id !== "sensor.pump_power");
  ck("  ...as THIS profile's Overview lists it: a card it does not see warns of nothing",
     issueSeverity(seen.attentionGroups, ids, (id) => id) === null);
}

console.log("\n  a tap: the Cockpit's Overview, this device's card marked, the device back on close:");
const OWNER = { facility: true }, GUEST = { facility: false };
const open = { ...START, nav: { ...START.nav, panel: pump } };
const go = screenReducer(open, { type: "openFaults", ids: ["sensor.pump_power", "switch.pump_relay"] }, OWNER);
ck("the Cockpit open on its Overview, the device window closed, its faults to mark",
   go.windows.cockpit === true && go.cockpitTab === "overview" && go.nav.panel === null
   && go.faultsFocus?.join() === "sensor.pump_power,switch.pump_relay", go);
ck("  ...closing the Cockpit gives the device back and forgets the mark",
   go.panelReturn?.to === "cockpit" && go.panelReturn.nav.panel === pump
   && screenReducer(go, { type: "closeWindow", window: "cockpit" }, OWNER).faultsFocus === null
   && screenReducer(go, { type: "closeWindow", window: "cockpit" }, OWNER).nav.panel === pump);
ck("  ...the Cockpit opened anew (its top-bar button) marks nothing",
   screenReducer({ ...go, windows: { ...go.windows, cockpit: false } }, { type: "openWindow", window: "cockpit" }, OWNER).faultsFocus === null);
ck("  ...a profile that does not manage faults is not sent there, nor with nothing to mark",
   screenReducer(open, { type: "openFaults", ids: ["sensor.pump_power"] }, GUEST) === open
   && screenReducer(open, { type: "openFaults", ids: [] }, OWNER) === open);

console.log("\n  the card it marks: the device's, its entities folded onto it as the cards are:");
const fold = new Map([["sensor.pump_energy", "sensor.pump_power"]]);
const deviceOf = (id) => fold.get(id) ?? id;
ck("the device's card, whichever of its entities the window or the fault names",
   cardFocused("sensor.pump_power", ["sensor.pump_power"], deviceOf) && cardFocused("sensor.pump_power", ["sensor.pump_energy"], deviceOf)
   && cardFocused("switch.pump_relay", ["sensor.pump_power", "switch.pump_relay"], deviceOf));
ck("  ...never another device's, and none without a request",
   !cardFocused("lock.door", ["sensor.pump_power"], deviceOf) && !cardFocused("sensor.pump_power", undefined, deviceOf)
   && !cardFocused(undefined, ["sensor.pump_power"], deviceOf));
const [group] = groupAttention([{ id: "fault:f1", kind: "fault", title: "Pump has not run", detail: "Fault", entityId: "sensor.pump_power",
  ticketId: "f1", stage: "fault", source: "alert", device: { key: "sensor.pump_power", label: "House Pump", room: "Terrace" } }]);
const card = cockpitCard(group, { checkMinutes: 5, nightlyAt: "02:00" });
const marked = draw(h(AttentionCard, { card, onOpenEntity: () => {}, focused: true }));
const plain = draw(h(AttentionCard, { card, onOpenEntity: () => {} }));
ck("  ...drawn marked (cockpit-focus: amber frame, lit a moment), the others as before",
   /class="fm-record-card[^"]*\bcockpit-focus\b/.test(marked) && !/cockpit-focus/.test(plain), marked.slice(0, 200));

console.log("\n  the button:");
const btnHtml = draw(h(FaultsButton, { onOpen: () => {}, severity: "lost" }));
ck("a real button, named for a screen reader, the Cockpit's warning sign in its issue's colour, the icon buttons' size",
   /^<button type="button" class="btn ghost icon-only panel-faults-btn cockpit-attention-lost"/.test(btnHtml)
   && /aria-label="Open this device&#x27;s issues in the Cockpit"/.test(btnHtml) && /<svg[^>]*lucide-triangle-alert/.test(btnHtml), btnHtml);
const tree = parseTsx("components/panels/BasePanel.tsx");
const [placed] = elements(tree, "FaultsButton");
ck("  ...drawn by the device window only while its Overview lists an issue, first of the header's actions (top right)",
   !!placed && guardsOf(placed).join() === "warning" && inside(btnHtml, "btn") !== ""
   && /const issue = useDeviceIssue\(faults\?\.ids \?\? \[\]\);/.test(tree.text)
   && /<div className="modal-header-actions">\s*\{\/\*[\s\S]*?\*\/\}\s*\{warning && <FaultsButton/.test(tree.text)
   && /\{\(headerActions \|\| back \|\| warning\) &&/.test(tree.text), guardsOf(placed ?? tree));

done("✅ a device window's warning opens its issues in the Cockpit");
