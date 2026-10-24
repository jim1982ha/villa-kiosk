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
const { cardFocused, groupAttention } = await import("@/config/attention");
const { cockpitCard } = await import("@/config/cockpitCard");
const { AttentionCard } = await import("@/components/cockpit/CockpitOverview");
const { FaultsButton } = await import("@/components/panels/BasePanel");

console.log("  when it shows: the device's open fault, or its linked entity's — the badge's own rule:");
const ent = (id, state) => ({ entity_id: id, state, attributes: {}, last_changed: "", last_updated: "" });
const entities = { "sensor.pump_power": ent("sensor.pump_power", "36"), "switch.pump_relay": ent("switch.pump_relay", "off") };
const map = { "sensor.pump_power": { entityId: "sensor.pump_power", type: "sensor", label: "Pump", linkedEntityId: "switch.pump_relay" } };
const pump = { entityId: "sensor.pump_power", mapping: map["sensor.pump_power"] };
const faultsWith = (faulty) => panelHeader({ panel: pump, entities, canControl: true, linkedSwitch: null,
  config: { entityMap: map, deviceGroups: [], isHidden: () => false, hasFault: (id) => faulty.includes(id) } }).faults;
ck("a fault on the device: the device", faultsWith(["sensor.pump_power"]).join() === "sensor.pump_power");
ck("  ...on its linked entity: the linked entity", faultsWith(["switch.pump_relay"]).join() === "switch.pump_relay");
ck("  ...on both: both, the device first", faultsWith(["switch.pump_relay", "sensor.pump_power"]).join() === "sensor.pump_power,switch.pump_relay");
ck("  ...none (closed, or never): nothing, so no button — it goes by itself", faultsWith([]).length === 0);
ck("  ...and the badge's amber \"!\" reads the same predicate",
   panelHeader({ panel: pump, entities, canControl: true, linkedSwitch: null,
     config: { entityMap: map, deviceGroups: [], isHidden: () => false, hasFault: (id) => id === "sensor.pump_power" } }).badge.mark === "fault");

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
const btnHtml = draw(h(FaultsButton, { onOpen: () => {} }));
ck("a real button, named for a screen reader, the Cockpit's warning sign in a fault's amber, the icon buttons' size",
   /^<button type="button" class="btn ghost icon-only panel-faults-btn cockpit-attention-warn"/.test(btnHtml)
   && /aria-label="Open this device&#x27;s faults in the Cockpit"/.test(btnHtml) && /<svg[^>]*lucide-triangle-alert/.test(btnHtml), btnHtml);
const tree = parseTsx("components/panels/BasePanel.tsx");
const [placed] = elements(tree, "FaultsButton");
ck("  ...drawn by the device window only while it has faults to open, first on the title line (top left)",
   !!placed && guardsOf(placed).join() === "faults" && inside(btnHtml, "btn") !== ""
   && /<div className="title">\s*\{\/\*[\s\S]*?\*\/\}\s*\{faults && <FaultsButton/.test(tree.text), guardsOf(placed ?? tree));

done("✅ a device window's warning opens its faults in the Cockpit");
