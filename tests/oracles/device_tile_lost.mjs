// A device tile in a device list wears "contact lost" WHOLE (owner, 2026-10-19: in a room's window only the icon square
// of "… Temperature — Unavailable" was dashed amber). The tile is DRAWN here from the device's own look (deviceLook,
// the map badge's rule) for four devices: one that lost contact, one with no value to give, one answering, and a
// critical one that lost contact — and the classes the stylesheet paints are read off the markup.
import { h, draw } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
const { default: SummaryEntityRow } = await import("@/components/panels/SummaryEntityRow");

const ent = (id, state) => ({ entity_id: id, state, attributes: {}, last_changed: "", last_updated: "" });
const entities = {
  "sensor.lost": ent("sensor.lost", "unavailable"),
  "sensor.novalue": ent("sensor.novalue", "unknown"),
  "sensor.ok": ent("sensor.ok", "21.5"),
  "sensor.critical": ent("sensor.critical", "unavailable"),
  "sensor.critical_ok": ent("sensor.critical_ok", "3"),
};
const critical = new Set(["sensor.critical", "sensor.critical_ok"]);
const looks = storeLookSource(entities, { entityMap: {}, isCritical: (id) => critical.has(id) });

const tile = (id) => draw(h(SummaryEntityRow, {
  label: id, stateText: "x", look: deviceLook(id, looks), badgeSrc: "data:,", notInHa: false, offMap: false,
  hidden: false, onOpen: () => {},
}));
const classOf = (html) => /^<div class="([^"]*)"/.exec(html)?.[1].split(/\s+/) ?? [];

const lost = classOf(tile("sensor.lost"));
ck("a device that lost contact: the whole tile is marked lost", lost.includes("summary-entity-row") && lost.includes("is-lost"), lost);
ck("  ...amber, not the critical red", !lost.includes("is-critical"), lost);
const none = classOf(tile("sensor.novalue"));
ck("a device with no value to give (\"unknown\") is a plain tile — it is answering", !none.includes("is-lost") && !none.includes("is-critical"), none);
const ok = classOf(tile("sensor.ok"));
ck("a device answering is a plain tile", ok.join(" ") === "summary-entity-row", ok);
const crit = classOf(tile("sensor.critical"));
ck("a CRITICAL device that lost contact: lost AND critical (its badge's red ring)", crit.includes("is-lost") && crit.includes("is-critical"), crit);
const critOk = classOf(tile("sensor.critical_ok"));
ck("  ...a critical device that answers is a plain tile", critOk.join(" ") === "summary-entity-row", critOk);

// What those classes paint: the badge's unavailable language on the tile — the dashed amber edge, its tint, the
// reading in amber — and a critical one's solid red ring. Read from the stylesheet, rule by rule.
const css = readFileSync(new URL("../../src/styles/02-hud.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel) => { const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css); return m?.[1] ?? ""; };
const lostRule = rule(".summary-entity-row.is-lost");
ck("the lost tile: a dashed amber edge on an amber tint", /border:\s*2px dashed var\(--status-warning\)/.test(lostRule)
   && /background:\s*color-mix\(in srgb, var\(--status-warning\)/.test(lostRule), lostRule);
ck("  ...its reading in amber", /color:\s*var\(--status-warning\)/.test(rule(".summary-entity-row.is-lost .summary-entity-state")));
const critRule = rule(".summary-entity-row.is-lost.is-critical");
ck("the critical lost tile: a red ring, never the amber dash", /border:\s*2px solid var\(--status-danger\)/.test(critRule), critRule);
ck("  ...its reading in red", /color:\s*var\(--status-danger\)/.test(rule(".summary-entity-row.is-lost.is-critical .summary-entity-state")));

// The caller: every device list is SummaryGroupPanel (a room's window, the Cockpit's lists, Lights, Facility…), and it
// draws each row as this tile with the row's deviceLook — the store look that folds the villa's critical list in.
const panel = readFileSync(new URL("../../src/components/panels/SummaryGroupPanel.tsx", import.meta.url), "utf8");
ck("the device lists draw this tile, with the row's own look", /const look = deviceLook\(id, looks\);/.test(panel)
   && /const badge = look;/.test(panel) && /<SummaryEntityRow[\s\S]*?look=\{badge\}/.test(panel)
   && /storeLookSource\(entities, \{ \.\.\.config, isCritical: villaDevices\.isCritical \}\)/.test(panel));

done("✅ a device that lost contact wears the whole tile, a critical one its red ring");
