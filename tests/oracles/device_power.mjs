// A device's power — which way its switch sits and the service that throws it
// (src/utils/devicePower.ts, round 11, 2.496.164). Eight sites decided it: a
// linked LOCK read "Off" when unlocked and was sent `homeassistant.toggle`
// (a lock has none); a paused TV's power button and its badge disagreed with
// nobody saying they answer different questions.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { devicePower, deviceSwitch, switchAsk, POWER_DOMAINS } = await import("@/utils/devicePower");

const e = (id, state) => ({ entity_id: id, state, attributes: {} });
const p = (id, state) => devicePower(e(id, state));
const flip = (x) => (x.flip ? `${x.flip.domain}.${x.flip.service}` : null);

ck("a light: on/off, its own toggle", p("light.a", "on").position === "on" && flip(p("light.a", "off")) === "light.toggle");
ck("a LOCK: unlocked is ON (the state acted on), flipped with lock/unlock — never homeassistant.toggle",
   p("lock.a", "unlocked").position === "on" && flip(p("lock.a", "unlocked")) === "lock.lock" && flip(p("lock.a", "locked")) === "lock.unlock");
ck("  ...a jammed lock is not secured (on → lock it); one in motion is unknown, no switch",
   flip(p("lock.a", "jammed")) === "lock.lock" && p("lock.a", "locking").position === "unknown" && p("lock.a", "locking").flip === null);
ck("a cover: open (or partly) is on, closed off, moving unknown; open/close_cover",
   flip(p("cover.a", "open")) === "cover.close_cover" && flip(p("cover.a", "closed")) === "cover.open_cover" && p("cover.a", "opening").position === "unknown");
ck("a TV's POWER: paused and idle are ON (its badge's activity is another question)",
   p("media_player.tv", "paused").position === "on" && p("media_player.tv", "idle").position === "on" && p("media_player.tv", "standby").position === "off"
   && flip(p("media_player.tv", "paused")) === "media_player.toggle");
ck("unavailable, or never reported: unknown, and nothing is sent", p("switch.a", "unavailable").flip === null && devicePower(undefined, "switch.a").position === "unknown");
ck("a domain with no toggle of its own: homeassistant.toggle", flip(p("climate.a", "heat")) === "homeassistant.toggle");
const table = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/ha-commands.json", import.meta.url), "utf8"));
const outside = POWER_DOMAINS.filter((d) => d === "homeassistant" ? !table.homeassistantServices.includes("toggle") : !table.serviceDomains.includes(d));
ck("every domain a flip can reach is in the one table of what the kiosk may send", outside.length === 0, outside);

const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const sites = ["components/panels/FanPanel.tsx", "components/panels/LightPanel.tsx", "components/panels/SwitchPanel.tsx", "components/panels/MediaPanel.tsx"];
const own = sites.filter((f) => /const on = entity\?\.state ===/.test(src(f)) || /HAServices\.toggle/.test(src(f)));
ck("the power panels read and throw through devicePower, none by `state === \"on\"`", own.length === 0, own);
const d = src("pages/Dashboard.tsx");
ck("the quick tap and the linked switch throw through it; the linked switch knows 'unknown'",
   /HAServices\.power\(ws, entity, entityId\)/.test(d) && /HAServices\.power\(ws, entities\[linkedEntityId\], linkedEntityId\)/.test(d) && /known: linkedPower\?\.position !== "unknown"/.test(d));
// The linked ring is deviceActivity.readingOf's, which asks devicePower — driven
// by value: a device LINKED to an unlocked lock / an open cover rings, linked to a
// locked one / a closed one does not (a raw `state === "on"` said neither).
{
  const { readingOf, storeLookSource } = await import("@/utils/deviceActivity");
  const cfg = { entityMap: { "sensor.p": { entityId: "sensor.p", type: "sensor", linkedEntityId: "lock.l" },
                             "sensor.q": { entityId: "sensor.q", type: "sensor", linkedEntityId: "cover.c" } }, alertThresholds: {} };
  const linked = (lock, cover) => {
    const src = storeLookSource({ "sensor.p": e("sensor.p", "5"), "sensor.q": e("sensor.q", "5"), "lock.l": e("lock.l", lock), "cover.c": e("cover.c", cover) }, cfg);
    return [readingOf("sensor.p", src).linkedOn, readingOf("sensor.q", src).linkedOn];
  };
  ck("the linked ring asks it: an UNLOCKED lock and an OPEN cover ring their devices, locked / closed do not",
     linked("unlocked", "open").join() === "true,true" && linked("locked", "closed").join() === "false,false", [linked("unlocked", "open"), linked("locked", "closed")]);
}
ck("the device-list rows throw through it", /const sw = deviceSwitch\(e, id,/.test(src("components/panels/SummaryGroupPanel.tsx")) && /const f = sw\.flip;/.test(src("components/panels/SummaryGroupPanel.tsx")));

console.log("\n  asking first (2.496.259 — one tap in a room list unlocked a door):");
const sw = (id, state, policy) => deviceSwitch(e(id, state), id, policy);
ck("throwing a LOCKED lock is an unlock: it asks, by name, whoever owns the switch",
   sw("lock.f", "locked", { label: "Front door" }).ask?.question === "Unlock Front door?"
   && sw("lock.f", "locked", { label: "Front door" }).ask?.confirmLabel === "Confirm unlock");
ck("  ...locking an unlocked one does not (securing a door is never the risk)",
   sw("lock.f", "unlocked", { label: "Front door" }).ask === null);
ck("  ...and a lock nobody can read offers nothing to ask about", sw("lock.f", "unavailable").ask === null);
ck("a plain light asks nothing; the owner's 'ask before switching' makes it ask, worded by where it goes",
   sw("light.a", "on").ask === null
   && sw("switch.gate", "off", { label: "Gate", requireConfirm: true }).ask?.question === "Turn on Gate?"
   && sw("switch.gate", "on", { label: "Gate", requireConfirm: true }).ask?.question === "Turn off Gate?"
   && sw("cover.g", "closed", { label: "Garage", requireConfirm: true }).ask?.question === "Open Garage?");
ck("an unnamed device is still asked about", switchAsk({ domain: "lock", service: "unlock" }).question === "Unlock this device?");
const { isQuickToggle } = await import("@/utils/quickAction");
ck("the map's quick tap reads the SAME answer: a flagged switch opens its panel, an unflagged one toggles",
   isQuickToggle({ entityId: "switch.gate", type: "switch", requireConfirm: true }, e("switch.gate", "off")) === false
   && isQuickToggle({ entityId: "switch.lamp", type: "switch" }, e("switch.lamp", "off")) === true);
// Every place that throws a switch renders that answer through the one hook.
const row = src("components/panels/EntityRowToggle.tsx"), pt = src("components/panels/PowerToggle.tsx"),
      lp = src("components/panels/LockPanel.tsx"), cf = src("components/panels/ControlFrame.tsx"), sg = src("components/panels/SummaryGroupPanel.tsx");
ck("the list row passes deviceSwitch's ask, and its switch only requests (never toggles straight away)",
   /ask=\{sw\.ask\}/.test(sg) && /useAskFirst\(ask,/.test(row) && /onClick=\{request\}/.test(row) && !/onClick=\{\(\) => \{ tapFeedback\(\); toggle\(\); \}\}/.test(row));
ck("the power button: its ask comes from deviceSwitch, through the one hook",
   /deviceSwitch\(entity, mapping\.entityId, mapping\)/.test(cf) && /ask=\{sw\.ask\}/.test(cf) && /useAskFirst\(ask,/.test(pt) && /onClick=\{request\}/.test(pt));
ck("the lock panel: lock and unlock both through switchAsk and the hook; nothing unlocks outside it",
   /useAskFirst\(switchAsk\(\{ domain: "lock", service: "unlock" \}, mapping\)/.test(lp)
   && (lp.match(/unlockDoor/g) ?? []).length === 1 && /onClick=\{unlock\.request\}/.test(lp));
ck("the linked switch: deviceSwitch with the linked device's own flag, asked by a dialog the panels cannot skip",
   /deviceSwitch\(entities\[linkedEntityId\], linkedEntityId,/.test(d) && /useAskFirst\(linkedPower\?\.ask \?\? null, linkedToggle\.toggle\)/.test(d)
   && /toggle: linkedAsk\.request,/.test(d));
ck("no switch site reads requireConfirm for itself any more",
   [row, pt, lp, cf, sg].every((t) => !/requireConfirm \?/.test(t)) && !/mapping\.requireConfirm\) return false/.test(src("utils/quickAction.ts")));
ck("HAServices keeps no per-domain toggle of its own", !/toggle(Light|Fan|Switch|Entity|Media)\b/.test(src("ha/HAServiceCalls.ts")));

done("✅ a device's power, decided once");
