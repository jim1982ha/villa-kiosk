// A FAULT BEING CONFIRMED (owner, 2026-10-23): "keep the Fault card visible in the Cockpit when a fault is still being
// monitored … until VESTA finally closes it" — in the same Open issues list, LAST, never counted as a problem; its look
// is the owner's to choose (one marker, `fault-watched`). A person closed it (Done on Telegram, Close in the Cockpit);
// the VESTA Agent wrote `confirmsBy` on the resolved fault (agent-contract.json ticket.fields) and takes it away once it
// has read it again. Driven through the real modules: which faults are being confirmed and their line
// (fm/faultConfirm), the open-issue counts and the map's fault marks that must NOT take them (config/attention), their
// cards drawn (cockpitCard → IssueCard) and where Messages puts them.
import { h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { confirmingFaults, confirmParts, shownUntil } = await import("@/fm/faultConfirm");
const confirmLine = (c) => { const { did, tip } = confirmParts(c); return `${did} · ${tip}`; };
const { attentionOf, attentionFor, deviceIssues } = await import("@/config/attention");
const { confirmingCards, cockpitCard } = await import("@/config/cockpitCard");
const { AttentionCard } = await import("@/components/cockpit/IssueCard");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
const { fmAttention } = await import("@/fm/fmEngine");
const { clockTime, momentText } = await import("@/utils/dateText");
// what, WHEN, then who — the close's moment as the Agent's Telegram lines write it (owner, 2026-10-25: "complete it to
// mention the clear time"); `at(-2)` is a Done's close, `at(-1)` a Cockpit Close's and the Agent's own clearing's
const on = (min) => ` on ${momentText(NOW + min * 60_000)}`;
const { devicesOf } = await import("../consistency/devices.mjs");
const { parseTsx, elements, propText, guardsOf } = await import("../consistency/jsx.mjs");

const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
ck("the agreement declares confirmsBy among the fault's fields (the proxy lists it in /agent/v1/info ticket_fields)",
   typeof contract.ticket.fields.confirmsBy === "string" && !contract.ticket.fieldsBeforeList.includes("confirmsBy"));

const NOW = new Date(2026, 9, 23, 14, 58).getTime();
const at = (min) => new Date(NOW + min * 60_000).toISOString();
const CADENCE = { checkMinutes: 5, nightlyAt: "02:00" };
const opened = { at: at(-60), status: "open", photoIds: [], by: "VESTA Agent" };
// a Done on Telegram: the agent's completion step names the person (`who`), the Kiosk stamps it the agent's
const doneOn = (id, entityId, confirmsBy, extra = {}) => ({ id, title: "Door unlocked", status: "resolved", openedAt: at(-60),
  resolvedAt: at(-2), entityId, photoIds: [], alertNumber: 65, origin: "alert", check: "minutes", source: "vesta_agent",
  ...(confirmsBy ? { confirmsBy } : {}),
  updates: [opened, { at: at(-2), status: "resolved", photoIds: [], who: "JM", note: "Done on Telegram (JM).", by: "VESTA Agent" }],
  ...extra });
// the Cockpit's Close: nothing done (kind cleared), by the profile
const closedIn = (id, entityId, confirmsBy) => ({ id, title: "Pump offline", status: "resolved", openedAt: at(-60),
  resolvedAt: at(-1), entityId, photoIds: [], confirmsBy,
  updates: [opened, { at: at(-1), status: "resolved", kind: "cleared", note: "Closed without action", photoIds: [], by: "Owner" }] });
const active = { id: "a1", title: "Leak under sink", status: "open", openedAt: at(-30), entityId: "binary_sensor.leak", photoIds: [],
  updates: [opened] };

const watched = doneOn("w1", "lock.door", at(8));               // VESTA confirms by 15:06
const kiosk = closedIn("w2", "switch.pump", at(9));              // closed in the Cockpit, confirmed by 15:07
const due = doneOn("w3", "lock.back", at(-3));                    // its moment past, the verdict at the next look
const stale = doneOn("w4", "lock.gate", at(-11));                 // past by more than two looks: let go
const plain = doneOn("w5", "lock.side", undefined);              // no field yet: about to be watched (afterClose)
const data = { ...EMPTY_FM_DATA, tickets: [active, watched, kiosk, due, stale, plain] };

console.log("  which faults are being confirmed:");
const conf = confirmingFaults(data, CADENCE, NOW);
ck("a resolved fault with confirmsBy is being confirmed, the soonest verdict first, the Agent's just closed with no field yet last (about to be); an open one and one past its grace are not",
   JSON.stringify(conf.map((c) => c.ticket.id)) === JSON.stringify(["w3", "w1", "w2", "w5"])
   && conf.map((c) => c.awaiting).join() === "false,false,false,true", conf.map((c) => c.ticket.id));
const line = (id, list = conf) => confirmLine(list.find((c) => c.ticket.id === id));
// ⚠️ OPEN › CLEARED (ON THE WATCH LIST) › CLOSED (owner, 2026-10-31): it said "VESTA confirms by 15:06", read as a next
// check, and a Cockpit Close said "Closed on …" on a card that was not closed
const closesAt = (min) => `VESTA closes this at ${clockTime(NOW + min * 60_000)} if all is still well; if the problem is back before then, it reopens as the same problem.`;
ck("  ...its line: \"Done on 23/10/2026 14:56 (JM) · VESTA closes this at 15:06 if all is still well; …\" (the villa's clock)",
   line("w1") === `Done${on(-2)} (JM) · ${closesAt(8)}` && clockTime(NOW + 8 * 60_000).includes("06"),
   line("w1"));
ck("  ...a Close in the Cockpit says what was pressed, No action needed (never Closed: it is not closed yet), and the profile",
   line("w2") === `No action needed${on(-1)} (Owner) · ${closesAt(9)}`,
   line("w2"));
{
  // ⚠️ EVERY CLOSE ALIKE (owner, 2026-10-25): an alert the VESTA Agent cleared itself is watched too, said "Cleared"
  const { AGENT_STAMP } = await import("@/agent/agentApi");
  const cleared = { ...closedIn("w6", "lock.porch", at(60)), updates: [opened,
    { at: at(-1), status: "resolved", kind: "cleared", note: "Cleared: back to normal.", photoIds: [], by: AGENT_STAMP }] };
  const c = confirmingFaults({ ...EMPTY_FM_DATA, tickets: [cleared] }, CADENCE, NOW);
  ck("  ...an alert the VESTA Agent cleared itself says Cleared, no name", c.length === 1
     && confirmLine(c[0]) === `Cleared${on(-1)} · ${closesAt(60)}`, c.map(confirmLine));
}
ck("  ...its moment past: at the Agent's next look, never a time gone by",
   line("w3") === `Done${on(-2)} (JM) · VESTA closes this at its next look if all is still well.`,
   line("w3"));
{
  // its pill says what happens then (owner, 2026-10-31): "Closes 15:06", then "Closes within 5min" once past
  const parts = (id) => confirmParts(confirmingFaults(data, CADENCE, NOW).find((c) => c.ticket.id === id));
  ck("  ...its pill: \"Closes\" and the time, then the Agent's next look once past ('Closes within 5min')",
     parts("w1").when === `Closes ${clockTime(NOW + 8 * 60_000)}` && parts("w3").when === `Closes within ${CADENCE.checkMinutes}min`,
     [parts("w1").when, parts("w3").when]);
}
ck("  ...shown at most two of the Agent's looks past its moment; with the Agent offline (no cadence), not past it",
   shownUntil(0, CADENCE) === 10 * 60_000 && shownUntil(0, null) === 0
   && JSON.stringify(confirmingFaults(data, null, NOW).map((c) => c.ticket.id)) === JSON.stringify(["w1", "w2"]));

console.log("\n  never an open problem:");
const ids = ["lock.door", "switch.pump", "lock.back", "lock.gate", "lock.side", "binary_sensor.leak"];
const entities = Object.fromEntries(ids.map((id) => [id, { entity_id: id, state: id === "binary_sensor.leak" ? "off" : "locked",
  attributes: { friendly_name: id.split(".")[1] }, last_changed: at(-5) }]));
const devices = devicesOf({ ids });
const villa = { devices, attentionItems: attentionOf({ devices, entities, entityMap: {}, resolvedRooms: {}, fmData: data }).attentionItems };
const att = attentionFor(villa, () => true);
ck("the open issues, their count and the health line hold only the active fault",
   att.attentionGroups.length === 1 && att.attentionGroups[0].items.every((i) => i.ticketId === "a1")
   && fmAttention(data).unresolved.map((t) => t.id).join() === "a1" && att.health.summary === "1 thing needs attention.",
   att.attentionGroups.map((g) => g.key));
ck("  ...and the map's fault marks (the amber \"!\") only its device",
   [...deviceIssues(att.attentionGroups).amber].join() === "binary_sensor.leak");

console.log("\n  in the Open issues list, last, uncounted, marked:");
const cards = confirmingCards(conf, { devices, entities, entityMap: {}, resolvedRooms: { "lock.door": "Hall" }, may: () => true });
ck("one card per fault, titled by its device, its fault's title its line, the confirm line under it, no buttons; one about to be watched, no pill",
   cards.length === 4 && cards.every((c) => c.look === "watched" && c.lines.every((l) => l.actions.length === 0))
   && cards.slice(0, 3).every((c) => c.nextCheck?.when) && cards[3].nextCheck === null && cards[3].lines[0].closing === `Done${on(-2)} (JM)`
   && cards[1].title === "door" && cards[1].room === "Hall" && cards[1].lines[0].text === "#65 · Door unlocked"
   && cards[1].lines[0].closing === `Done${on(-2)} (JM)` && cards[1].nextCheck.tip === line("w1").split(" · ")[1], cards[1]);
{
  // owner, 2026-11-02: two LED Strip cards on Watch, "the same issue being reported in 2 distinct cards"
  const twice = confirmingFaults({ ...EMPTY_FM_DATA, tickets: [watched, doneOn("w6", "lock.door", at(20))] }, CADENCE, NOW);
  const one = confirmingCards(twice, { devices, entities, entityMap: {}, resolvedRooms: { "lock.door": "Hall" }, may: () => true });
  ck("one card per device on Watch, as in Open issues: its watched faults are its lines, its pill the last to close",
     one.length === 1 && one[0].lines.length === 2 && one[0].nextCheck.when === `Closes ${clockTime(NOW + 20 * 60_000)}`, one.map((c) => [c.key, c.lines.length]));
}
ck("  ...only the faults whose device the profile may open (as the open issues)",
   confirmingCards(conf, { devices, entities, entityMap: {}, resolvedRooms: {}, may: (id) => id !== "lock.door" })
     .map((c) => c.key).join() === "watched:device:lock.back,watched:device:switch.pump,watched:device:lock.side");
const drawn = draw(h(AttentionCard, { card: cards[1], onOpenEntity: () => {} }));
// ⚠️ THE SAME CARD AS AN OPEN ISSUE'S (owner, 2026-10-23: "the same piece of code … same style and same card layout"):
// RecordCard's frame (marked), its title and room pill, the open issues' next-check pill, the check as its lead
ck("  ...drawn by the open issues' own card: marked frame, a check, its device and room, its fault, who closed it its who line",
   /^<div class="fm-record-card fault-watched">/.test(drawn) && /class="[^"]*fault-watched-icon/.test(drawn)
   && /<strong><button[^>]*>door<\/button><\/strong><\/div>/.test(drawn) && /<div class="fm-record-meta"><span>Hall<\/span><\/div>/.test(drawn)
   && /#65 · Door unlocked/.test(drawn) && /class="fm-record-who"><svg[\s\S]*?<\/svg><span>Done[^<]* \(JM\)<\/span>/.test(drawn)
   && drawn.includes(`<span>Done${on(-2)} (JM)</span>`), drawn.slice(0, 900));
// owner, 2026-11-05 ("Status on top"): a Watch card's strip says when it closes, in green, with its (i)
const stripOf = (html) => /class="fm-record-strip strip-(\w+)">[\s\S]*?<span class="fm-record-status">([^<]*)<\/span><span class="info-tip"><button type="button" class="info-btn" aria-label="([^"]*)"/.exec(html);
const checkOf = (html) => /<span class="fm-record-check" aria-label="([^"]*)">/.exec(html);
{
  const strip = stripOf(drawn);
  ck("  ...its strip says \"Closes\" and its time, in green, what VESTA does then in its (i)",
     !!strip && strip[2] === `Closes ${clockTime(NOW + 8 * 60_000)}` && strip[3] === closesAt(8) && strip[1] === "ok", strip?.slice(1));
  ck("  ...said once: no next check on its quiet line", checkOf(drawn) === null, checkOf(drawn));
}
ck("  ...no Close and no Open Ticket: it is closed", !/fm-record-actions/.test(drawn));
const activeCard = draw(h(AttentionCard, { card: cockpitCard(att.attentionGroups[0], CADENCE, new Date(NOW)), onOpenEntity: () => {} }));
ck("an active fault keeps its look: no marker", /^<div class="fm-record-card">/.test(activeCard) && !/fault-watched/.test(activeCard));
ck("  ...and a fault only a person closes has no next check: nothing checks it", checkOf(activeCard) === null && stripOf(activeCard) === null,
   checkOf(activeCard)?.slice(1));
{
  // Messages' own markup (the component needs the app's contexts to render): which cards are open issues and which
  // watched is the Messages model's, by value (messages_model.mjs); the tab draws them in that order
  const tree = parseTsx("components/cockpit/MessagesTab.tsx");
  const tab = tree.statements.find((s) => s.name?.getText() === "MessagesTab");
  const sections = elements(tab, "ListSection");
  const named = (t) => sections.find((e) => propText(e, "title") === `"${t}"`);
  const issuesSec = named("Open issues"), notesSec = named("Notifications");
  const folded = (t) => elements(tab, "FoldedList").find((e) => propText(e, "title") === `"${t}"`);
  const watch = folded("Watch"), closedSec = folded("Closed");
  const within = (n, outer) => !!n && !!outer && n.getStart() >= outer.getStart() && n.getEnd() <= outer.getEnd();
  // ⚠️ FOLDED BY DEFAULT (owner, 2026-10-25: "collapse all the cards in the watchlist … by default"); a section of its
  // own named Watch, below Notifications, at the same level, then Closed (owner, 2026-10-28)
  ck("  ...Messages draws them in the Watch section, after Open issues AND Notifications, then Closed; never among the open issues",
     !!watch && !!closedSec && !!issuesSec && !!notesSec && propText(watch, "rows") === "view.watched"
     && /view\.issues\.map\(card\)/.test(issuesSec?.getText() ?? "") && watch.getStart() > notesSec.getEnd() && notesSec.getStart() > issuesSec.getEnd()
     && closedSec.getStart() > watch.getEnd(),
     [!!issuesSec, !!notesSec, !!watch, !!closedSec]);
  ck("  ...the count stays the open issues' (cockpitIssues' open cards), never the watched",
     propText(issuesSec, "count") === "open.length", propText(issuesSec, "count"));
  const { ListSection, default: FoldedList } = await import("@/components/common/FoldedList");
  const drawn = (open) => draw(h(ListSection, { title: "Watch", count: 2, open, onToggle: () => {} }, h("p", null, "card 1")));
  ck("  ...a section folded shows its name and count, no card; open, its cards",
     /Watch \(2\)/.test(drawn(false)) && !/card 1/.test(drawn(false)) && /aria-expanded="false"/.test(drawn(false))
     && /card 1/.test(drawn(true)), drawn(false));
  const tabSrc = readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8");
  ck("  ...Watch and Closed are drawn with the issues, always, empty or not (owner, 2026-10-28)",
     /\{showsIssues && \(\s*<>\s*<FoldedList title="Watch"/.test(tabSrc)
     && ((html) => /Closed/.test(html) && /Nothing closed yet\./.test(html))(draw(h(FoldedList, { title: "Closed", rows: [], open: true,
       onToggle: () => {}, empty: "Nothing closed yet.", children: () => null }))));
  // ⚠️ ONE FOLDED LIST (architecture review 19 #2, 2026-11-03): Tickets' Closed and Schedule's Recent work vanished when
  // empty, under a grey line and Closed with no (i), while the Inbox's said "Nothing closed yet." under its section name
  const closedTickets = elements(parseTsx("components/fm/TicketsTab.tsx"), "FoldedList")
    .concat(elements(parseTsx("components/fm/RecentWorkList.tsx"), "FoldedList"));
  ck("  ...Tickets' Closed and Schedule's Recent work are the same folded list, each with its empty line, Closed with its (i)",
     closedTickets.length === 2 && closedTickets.every((e) => propText(e, "empty") !== null)
     && propText(closedTickets[0], "tip") !== null, closedTickets.length);
  ck("  ...Watch and Closed start folded; Open issues, Notifications and Reports open",
     /useState\(\{ issues: true, notes: true, reports: true, watch: false, closed: false \}\)/.test(readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8")));
  // owner, 2026-11-03: "remove all the redundant sub-text mentioning how many items are included in each section" ("1
  // watched item" under Watch (1)): a section whose title shows its count says it nowhere else
  const { Pager } = await import("@/components/common/Paged");
  const { pageOf } = await import("@/components/common/paging");
  const pager = (n, unit) => draw(h(Pager, { paged: { ...pageOf(Array.from({ length: n }, (_, i) => i), 10, 0), go: () => {} }, unit }));
  ck("  ...one page under a counted title: no line at all; a list whose title has none keeps \"3 reports\"; past a page, where the reader stands",
     pager(1) === "" && /3 reports/.test(pager(3, "report")) && /1–10 of 23/.test(pager(23)) && !/watched/.test(pager(1)),
     [pager(1), pager(3, "report")]);
  // and Notifications and Reports titled with theirs too (architecture review 19 #4: they kept "12 notifications")
  const counted = [...elements(tab, "Pager"), ...elements(parseTsx("components/common/FoldedList.tsx"), "Pager")];
  ck("  ...Notifications, Reports, Watch, Closed, Tickets' Closed and Recent work, each titled with its count, pass the pager no count's word",
     counted.length === 3 && counted.every((e) => propText(e, "unit") == null)
     && ["Notifications", "Reports"].every((t) => /^view\.\w+\.length$/.test(propText(named(t), "count") ?? "")),
     counted.map((e) => propText(e, "unit")));
}

console.log("\n  a hidden device: no card in any section (config/cockpitIssues, the cards Open issues draws):");
{
  // ⚠️ OWNER, 2026-10-25: "hidden means hidden everywhere". The open issues left a hidden device out; its CLOSED fault
  // was still a Watched card, built beside them through the profile's visibility alone. Driven through the villa's
  // items → the profile's view → cockpitIssues, the very path Messages takes (useCockpitIssues).
  const { cockpitIssues } = await import("@/config/cockpitIssues");
  const jammed = { id: "h1", title: "Door jammed", status: "open", openedAt: at(-20), entityId: "lock.door", photoIds: [],
    updates: [opened] };
  const hdata = { ...data, tickets: [...data.tickets, jammed] };   // lock.door: w1 watched, h1 open
  const issuesWith = (hidden) => {
    const devs = devicesOf({ ids: ids.filter((id) => !hidden.has(id)), hidden });
    const view = attentionFor({ devices: devs, attentionItems: attentionOf({ devices: devs, entities, entityMap: {},
      resolvedRooms: {}, fmData: hdata }).attentionItems }, () => true);
    return cockpitIssues(view, { fmData: hdata, cadence: CADENCE, now: new Date(NOW), entities, entityMap: {}, resolvedRooms: {} });
  };
  const about = (cards) => cards.filter((c) => c.entityId === "lock.door").map((c) => c.key);
  const seen = issuesWith(new Set()), quiet = issuesWith(new Set(["lock.door"]));
  ck("not hidden: the door has its open card and its watched card",
     about(seen.open).join() === "device:lock.door" && about(seen.watched).join() === "watched:device:lock.door",
     { open: about(seen.open), watched: about(seen.watched) });
  const numbered = (() => {
    const devs = devicesOf({ ids, hidden: new Set() });
    const d2 = { ...hdata, tickets: hdata.tickets.map((t) => (t.id === "w1" ? { ...t, alertNumber: 90 } : t)) };
    const view = attentionFor({ devices: devs, attentionItems: attentionOf({ devices: devs, entities, entityMap: {},
      resolvedRooms: {}, fmData: d2 }).attentionItems }, () => true);
    return cockpitIssues(view, { fmData: d2, cadence: CADENCE, now: new Date(NOW), entities, entityMap: {}, resolvedRooms: {} });
  })();
  ck("a watched card carries its alert's number, so VESTA's card of it is found there (and leaves Notifications)",
     numbered.watched.find((c) => c.key === "watched:device:lock.door")?.lines[0].alertNumber === 90, numbered.watched.map((c) => c.lines));
  ck("  ...hidden in the villa's system: no card about it, open or watched; every other card kept",
     about(quiet.open).length === 0 && about(quiet.watched).length === 0
     && quiet.watched.map((c) => c.key).join() === "watched:device:lock.back,watched:device:switch.pump,watched:device:lock.side" && quiet.open.length === seen.open.length - 1,
     { open: quiet.open.map((c) => c.key), watched: quiet.watched.map((c) => c.key) });
  ck("  ...and Messages draws exactly these, its open issues and its Watched rows from useCockpitIssues (the profile's view)",
     /const \{ open, watched, closed \} = useCockpitIssues\(\);/.test(readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8"))
     && /const view = useVillaAttention\(\);[\s\S]*cockpitIssues\(view, /.test(readFileSync(new URL("../../src/components/cockpit/useVillaAttention.ts", import.meta.url), "utf8")));
}

{
  // owner, 2026-11-02: Done pressed on an offline device: its card goes to Watch, its live state does not stay as an issue
  const offline = devicesOf({ ids: ["switch.pump", "lock.door"], unavailable: ["switch.pump", "lock.door"] });
  const ents = { "switch.pump": { entity_id: "switch.pump", state: "unavailable", attributes: {} }, "lock.door": { entity_id: "lock.door", state: "unavailable", attributes: {} } };
  const at = (t) => new Date(Date.now() + t).toISOString();
  const closing = { ...closedIn("n1", "switch.pump", at(600_000)), openedAt: at(-3_600_000) };
  const left = attentionOf({ devices: offline, entities: ents, entityMap: {}, resolvedRooms: {}, fmData: { ...EMPTY_FM_DATA, tickets: [closing] } }).attentionItems.map((i) => i.entityId);
  const past = attentionOf({ devices: offline, entities: ents, entityMap: {}, resolvedRooms: {}, fmData: { ...EMPTY_FM_DATA, tickets: [{ ...closing, confirmsBy: at(-600_000) }] } }).attentionItems.map((i) => i.entityId);
  ck("a device on Watch is no open issue while it stays offline; another offline device is", left.join() === "lock.door", left);
  ck("  ...once the watch is over and it is still offline, it is an issue again", past.includes("switch.pump"), past);
}

{
  // owner, 2026-11-02: every Done, a fault a person raised too
  const mine = { id: "p1", title: "Tap drips", status: "resolved", openedAt: at(-60), resolvedAt: new Date(NOW - 60_000).toISOString(), photoIds: [], updates: [] };
  const agents = { ...mine, id: "p2", source: "vesta_agent" };
  const shown = (c) => confirmingFaults({ ...EMPTY_FM_DATA, tickets: [mine, agents] }, c, NOW).map((x) => x.ticket.id).join();
  ck("a person's fault Done stays on Watch until the nightly check after it, the Agent's own time; the Agent's is on Watch until it says (about to be); no Agent, no watch",
     shown(CADENCE) === "p1,p2" && shown(null) === "", [shown(CADENCE), shown(null)]);
  // the eight seconds at 02:49: its Done closed, its confirmsBy not written yet
  const { watchedRecords } = await import("@/fm/faultConfirm");
  const answering = (t) => watchedRecords({ ...EMPTY_FM_DATA, tickets: [t] }, CADENCE, NOW).length;
  ck("  ...the Agent's own, until it answers: its device's live state does not come back as a card with a Done; after two looks, it may",
     answering(agents) === 1 && answering({ ...agents, resolvedAt: at(-11) }) === 0);
}

console.log("\n  one place at every moment (architecture review round 16: faultConfirm.afterClose):");
{
  // ⚠️ owner, 2026-11-02: closed at 02:49:25, the Agent's confirmsBy written at 02:49:33. In between the fault sat under
  // Closed, then jumped to Watch. One record walked through the Done, the eight seconds, the Agent's moment written, that
  // moment past, two looks past it: at each step it is on exactly one list, and its offline device's live state is an
  // open issue exactly when the fault is closed.
  const { afterClose, closedFaults, watchedRecords } = await import("@/fm/faultConfirm");
  const T0 = NOW, LOOK = CADENCE.checkMinutes * 60_000, iso = (ms) => new Date(ms).toISOString();
  const devs = devicesOf({ ids: ["switch.example_pump"], unavailable: ["switch.example_pump"] });
  const ents = { "switch.example_pump": { entity_id: "switch.example_pump", state: "unavailable", attributes: {} } };
  const done0 = { ...doneOn("k1", "switch.example_pump", undefined), resolvedAt: iso(T0), openedAt: iso(T0 - 3_600_000),
    updates: [opened, { at: iso(T0), status: "resolved", photoIds: [], who: "JM", note: "Done on Telegram (JM).", by: "VESTA Agent" }] };
  const written = { ...done0, confirmsBy: iso(T0 + 60 * 60_000) };
  const where = (t, now) => {
    const d = { ...EMPTY_FM_DATA, tickets: [t] };
    const onWatch = confirmingFaults(d, CADENCE, now).map((c) => c.ticket.id);
    const inClosed = closedFaults(d, CADENCE, now).map((c) => c.ticket.id);
    const hidden = watchedRecords(d, CADENCE, now).map((x) => x.id);
    const live = attentionOf({ devices: devs, entities: ents, entityMap: {}, resolvedRooms: {}, fmData: d, cadence: CADENCE, now }).attentionItems
      .some((i) => i.kind === "unavailable" && i.entityId === "switch.example_pump");
    return { place: afterClose(t, CADENCE, now)?.place, onWatch: onWatch.join(), inClosed: inClosed.join(), hidden: hidden.join(), live };
  };
  const steps = [
    ["Done pressed (t0), no confirmsBy yet", done0, T0, "awaiting"],
    ["  ...8s later, still none", done0, T0 + 8_000, "awaiting"],
    ["  ...the Agent writes confirmsBy (t0 + 1h)", written, T0 + 9_000, "watch"],
    ["  ...its moment past, the verdict due", written, T0 + 61 * 60_000, "watch"],
    ["  ...two looks past its moment, no verdict: let go", written, T0 + 60 * 60_000 + 2 * LOOK + 1_000, "closed"],
    ["  ...no confirmsBy ever (an older Agent): two looks after the close", done0, T0 + 2 * LOOK + 1_000, "closed"],
  ];
  for (const [what, t, now, want] of steps) {
    const w = where(t, now);
    const one = want === "closed" ? w.onWatch === "" && w.inClosed === "k1" : w.onWatch === "k1" && w.inClosed === "";
    ck(`${what}: ${want === "closed" ? "under Closed" : "on Watch"}, on that list only; its device's live state ${want === "closed" ? "an open issue again" : "hidden"}`,
       w.place === want && one && (w.hidden === (want === "closed" ? "" : "k1")) && w.live === (want === "closed"), w);
  }
  // "Not a problem while it lasts" is closed: under Closed only, never on Watch, whatever the Agent wrote
  const lasting = { ...written, updates: [opened, { at: iso(T0), status: "resolved", kind: "cleared", lasting: true, photoIds: [], by: "Owner" }] };
  const l = where(lasting, T0 + 8_000);
  ck("\"Not a problem while it lasts\": under Closed, on no other list", l.place === "closed" && l.onWatch === "" && l.inClosed === "k1" && l.hidden === "", l);
  // owner, 2026-11-04: "there are no button in the closed card to potentially re-open this issue"
  const { closedCards } = await import("@/config/cockpitCard");
  const { CockpitAttentionRow } = await import("@/components/cockpit/IssueCard");
  const shut = closedCards({ ...EMPTY_FM_DATA, tickets: [lasting] }, CADENCE, new Date(T0 + 8_000),
    { devices: devs, entities: ents, entityMap: {}, resolvedRooms: {}, may: () => true });
  const reopen = shut[0]?.lines[0].actions ?? [];
  ck("  ...its Closed card has Reopen, on that record: an open fault again",
     reopen.length === 1 && reopen[0].label === "Reopen" && reopen[0].ids.join() === "k1" && reopen[0].step.to === "open", reopen);
  // owner, 2026-11-04: "i don't want you to do this for all closed items": a plain close (Done, the watch over) has none
  const plain = closedCards({ ...EMPTY_FM_DATA, tickets: [written] }, CADENCE, new Date(T0 + 60 * 60_000 + 2 * LOOK + 1_000),
    { devices: devs, entities: ents, entityMap: {}, resolvedRooms: {}, may: () => true });
  ck("  ...only it: a fault closed any other way has no Reopen under Closed",
     plain.length === 1 && plain[0].lines[0].actions.length === 0, plain[0]?.lines[0].actions);
  const row = (canManage) => draw(h(CockpitAttentionRow, { card: shut[0], onOpenEntity: () => {}, canManage, onEditTicket: () => {}, onRaiseTicket: () => {} }));
  // drawn by the open issues' row, whose buttons need the store's context: here its gate, for a profile that does not
  // manage Facility work (IssueCard: canManage && line.actions)
  ck("  ...none for a profile that does not manage Facility work",
     !/fm-record-actions/.test(row(false)) && /\(canManage && line\.actions\.length > 0/.test(readFileSync(new URL("../../src/components/cockpit/IssueCard.tsx", import.meta.url), "utf8")));
}

console.log("\n  a closed record told once, on both Closed sections (architecture review 23):");
{
  const { closedCards } = await import("@/config/cockpitCard");
  const { closedTold } = await import("@/fm/faultConfirm");
  const { faultLatest, moveText } = await import("@/fm/faultNotes");
  const { closedActions, workRecord } = await import("@/fm/deviceWork");
  const T0 = NOW, iso = (ms) => new Date(ms).toISOString();
  const devs = devicesOf({ ids: ["switch.example_pump"] });
  const ents = { "switch.example_pump": { entity_id: "switch.example_pump", state: "on", attributes: {} } };
  const taken = { at: iso(T0 - 1_800_000), status: "in_progress", photoIds: [], by: "Owner" };
  // a ticket a person opened, closed in Tickets with No action needed; one of VESTA's, done; one VESTA cleared itself
  const mine = { ...doneOn("p1", "switch.example_pump", undefined), source: "owner", status: "resolved", resolvedAt: iso(T0),
    openedAt: iso(T0 - 3_600_000), updates: [opened, taken, { at: iso(T0), status: "resolved", kind: "cleared", photoIds: [], by: "Owner" }] };
  const vestas = { ...mine, id: "v1", source: "vesta_agent", updates: [opened, taken, { at: iso(T0), status: "resolved", who: "JM", photoIds: [], by: "Owner" }] };
  const cleared = { ...mine, id: "c1", source: "vesta_agent", updates: [opened, { at: iso(T0), status: "resolved", kind: "cleared", note: "Cleared by VESTA", photoIds: [], by: "VESTA Agent" }] };
  const later = new Date(T0 + 3 * 86_400_000);
  const told = (t) => {
    const inbox = closedCards({ ...EMPTY_FM_DATA, tickets: [t] }, null, later, { devices: devs, entities: ents, entityMap: {}, resolvedRooms: {}, may: () => true })[0]?.lines[0];
    return { inbox: (inbox?.move ? moveText(inbox.move, momentText) : null) ?? inbox?.closing, inboxReopen: (inbox?.actions ?? []).map((a) => a.label).join(),
      tickets: faultLatest(t, momentText)?.text, ticketsReopen: closedActions(workRecord(t), closedTold(t).reopen).map((a) => a.label).join() };
  };
  const [m, v, c] = [told(mine), told(vestas), told(cleared)];
  ck("the same words on Inbox › Closed and Tickets › Closed, by the action pressed and who",
     m.inbox === m.tickets && m.inbox === `No action needed by Owner, on ${momentText(T0)} · Resolved`
     && v.inbox === v.tickets && v.inbox === `Done by JM, on ${momentText(T0)} · Resolved`
     && c.inbox === c.tickets && c.inbox === `Cleared on ${momentText(T0)}`, [m, v, c]);
  ck("  ...and the same Reopen on both: a person's own ticket (nothing checks it again), never one VESTA checks",
     m.inboxReopen === "Reopen" && m.ticketsReopen === "Reopen" && v.inboxReopen === "" && v.ticketsReopen === ""
     && c.inboxReopen === "" && c.ticketsReopen === "", [m, v, c]);
}

console.log("\n  gone or back as the Agent says:");
const without = (t) => { const { confirmsBy: _c, ...rest } = t; return rest; };
const right = { ...data, tickets: data.tickets.map((t) => (t.id === "w1" ? without(t) : t)) };
// the Agent takes the field away at its look after the moment (at(8)): by then two of its looks from the close are past
ck("the watch ended right (the Agent took confirmsBy away): it goes, still resolved, still no open problem",
   !confirmingFaults(right, CADENCE, NOW + 9 * 60_000).some((c) => c.ticket.id === "w1") && fmAttention(right).unresolved.map((t) => t.id).join() === "a1");
const reopened = { ...data, tickets: data.tickets.map((t) => (t.id !== "w1" ? t : without({ ...t, status: "open", resolvedAt: undefined,
  updates: [...t.updates, { at: at(9), status: "open", kind: "reopened", note: "Still there after the close.", photoIds: [], by: "VESTA Agent" }] }))) };
ck("  ...still bad (reopened): an open fault again, counted, off the watched cards",
   !confirmingFaults(reopened, CADENCE, NOW).some((c) => c.ticket.id === "w1")
   && fmAttention(reopened).unresolved.map((t) => t.id).sort().join() === "a1,w1");
ck("  ...the field left on a reopened fault (before the Agent's repair) never makes it a confirming one",
   !confirmingFaults({ ...data, tickets: [{ ...watched, status: "open" }] }, CADENCE, NOW).length);

console.log("\n  a reopen in the Kiosk takes the watch away (architecture review i_k1, 2026-10-23: fmEngine withoutClose):");
{
  // ⚠️ The Kiosk's Reopen kept confirmsBy (every field but resolvedAt rode along): a Cockpit Close a minute later showed
  // "Closed (Owner) · VESTA confirms it at its next look" with the EARLIER close's watch time, while the Agent watched
  // nothing. Driven through the one way in for every change (fmCommands applyFmCommand), as the store runs it.
  const { applyFmCommand } = await import("@/fm/fmCommands");
  const { CLOSE_ONLY_FIELDS } = await import("@/fm/fmEngine");
  let n = 0;
  const k = (min) => ({ now: at(min), id: (p) => p + (++n), by: "Owner" });
  const doneW1 = doneOn("w1", "lock.front_door", at(2));
  const start = { ...EMPTY_FM_DATA, tickets: [doneW1] };
  ck("before: the Done on Telegram is being confirmed", confirmingFaults(start, CADENCE, NOW).length === 1);
  const reopenedHere = applyFmCommand(start, { type: "advanceTickets", ids: ["w1"], to: "open", step: { photoIds: [], note: "still dripping" } }, k(1));
  const r = reopenedHere.tickets[0];
  ck("Reopen: open, with neither the close's time nor its watch",
     r.status === "open" && !("confirmsBy" in r) && !("resolvedAt" in r) && r.updates.at(-1).kind === "reopened",
     { status: r.status, confirmsBy: r.confirmsBy, resolvedAt: r.resolvedAt });
  ck("  ...every other field kept (its alert number, its device, its steps)",
     r.alertNumber === 65 && r.entityId === "lock.front_door" && r.updates.length === 3 && r.check === "minutes");
  const closedAgain = applyFmCommand(reopenedHere, { type: "closeTickets", ids: ["w1"] }, k(2));
  // ...on Watch, about to be (faultConfirm.afterClose), saying no moment until the Agent writes this close's
  const unsaid = (d, now) => confirmingFaults(d, CADENCE, now).every((c) => c.awaiting && Number.isNaN(c.at) && confirmParts(c).when === "");
  ck("  ...a Cockpit Close a minute later: resolved, and NO watch time until the Agent writes one",
     closedAgain.tickets[0].status === "resolved" && unsaid(closedAgain, NOW + 2 * 60_000),
     confirmingFaults(closedAgain, CADENCE, NOW + 2 * 60_000).map(confirmLine));
  const agentWatches = { ...closedAgain, tickets: closedAgain.tickets.map((t) => ({ ...t, confirmsBy: at(9) })) };
  ck("  ...the Agent writes its watch on THIS close: the row is back, with its time",
     confirmingFaults(agentWatches, CADENCE, NOW + 2 * 60_000).map((c) => c.at).join() === String(Date.parse(at(9))));
  const started = applyFmCommand(start, { type: "advanceTickets", ids: ["w1"], to: "in_progress", step: { photoIds: [] } }, k(1));
  ck("Mark in progress on the closed fault: the watch goes too",
     started.tickets[0].status === "in_progress" && !("confirmsBy" in started.tickets[0]) && !("resolvedAt" in started.tickets[0]));
  const patched = applyFmCommand(start, { type: "updateTicket", id: "w1", patch: { status: "open" } }, k(1));
  ck("a status patch that reopens it: the watch goes too",
     patched.tickets[0].status === "open" && !("confirmsBy" in patched.tickets[0]) && !("resolvedAt" in patched.tickets[0]));
  const retitled = applyFmCommand(start, { type: "updateTicket", id: "w1", patch: { title: "Front door unlocked" } }, k(1));
  ck("  ...a rename of the closed fault leaves the close and its watch as they are",
     retitled.tickets[0].confirmsBy === at(2) && retitled.tickets[0].resolvedAt === at(-2));
  const legacy = { ...EMPTY_FM_DATA, tickets: [{ ...doneW1, status: "open", resolvedAt: undefined,
    updates: [...doneW1.updates, { at: at(-1), status: "open", kind: "reopened", photoIds: [], by: "Owner" }] }] };
  const legacyClosed = applyFmCommand(legacy, { type: "closeTickets", ids: ["w1"] }, k(1));
  ck("a fault reopened by an older build (its watch left on it), closed now: no watch time",
     !("confirmsBy" in legacyClosed.tickets[0]) && unsaid(legacyClosed, NOW + 60_000));
  const resolvedNow = applyFmCommand(legacy, { type: "advanceTickets", ids: ["w1"], to: "resolved", step: { photoIds: [] } }, k(1));
  ck("  ...or marked resolved: none either, and its resolution time is this one",
     !("confirmsBy" in resolvedNow.tickets[0]) && resolvedNow.tickets[0].resolvedAt === at(1));
  ck("the fields a reopen takes away are the Agent's reopen's (kiosk.py reopen_ticket drops resolvedAt and confirmsBy)",
     [...CLOSE_ONLY_FIELDS].sort().join() === "confirmsBy,resolvedAt", CLOSE_ONLY_FIELDS);
  ck("the agreement says it: a reopen by either side removes the watch",
     /A reopen by either side removes it\./.test(contract.ticket.fields.confirmsBy));
}

done("✅ a fault being confirmed is listed last among the open issues, marked, never counted, and goes as the Agent says");
