// THE Cockpit card, DRAWN (architecture review, 2026-10-15): every list — an open issue, a ticket, a closed one, a
// scheduled task, a spend line, work done — is one card (RecordCard), and these checks render it and read what it
// SHOWS. The checks they replace matched the code's text and were rewritten nine times in two days for moves that
// changed nothing on screen; a check here fails only when what the owner sees changes.
import { React, h, draw, inside, btn, text } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
import { elements, parseTsx, propText } from "../consistency/jsx.mjs";
const { default: RecordCard } = await import("@/components/fm/RecordCard");
const { AttentionCard } = await import("@/components/cockpit/IssueCard");
const { cockpitCard } = await import("@/config/cockpitCard");
const { groupAttention } = await import("@/config/attention");
const { STAGE_WORDS } = await import("@/fm/fmEngine");
const { pillClass } = await import("@/fm/tone");

console.log("  a ticket's card:");
// its pill: the stage's one word and tone (fmEngine.STAGE_WORDS through fm/tone pillClass), not the Schedule's due-soon
const ticket = draw(h(RecordCard, { title: "#33 · Test lock unavailable",
  status: { text: STAGE_WORDS.ticket.word, tone: pillClass(STAGE_WORDS.ticket.tone) },
  when: "Opened 2026-10-15 00:08", pills: h("span", { className: "fm-clause" }, "Test lock"),
  notes: ["What to do: power", "Reminder sent to Facility Manager (00:24)"], amount: "IDR 1,000",
  erase: { title: "Erase", detail: "x", run: async () => {} }, onOpen: () => {},
  actions: h(React.Fragment, null, btn("Mark resolved"), btn("Close")) }));
const body = inside(ticket, "fm-record-main"), strip = (html) => inside(html, "fm-record-strip");
const name = (html) => inside(inside(html, "fm-record-strip"), "fm-record-name");
// ⚠️ NAME ON TOP, STATE FIRST (owner, 2026-11-05): the strip names it, the card's first line says where it stands, the
// quiet line, the words, who moved it, the bar
ck("its name in its strip, its state the card's first line, both in its tone's colour (.strip-warn, 07-facility.css)",
   text(name(ticket)) === "|#33 · Test lock unavailable|" && !text(body).includes("Test lock unavailable") && !strip(ticket).includes("In progress")
   && body.startsWith('<div class="fm-record-main"><div class="fm-record-state strip-warn"><span class="fm-record-status">In progress</span></div>')
   && /class="fm-record-strip strip-warn"/.test(ticket) && !/due-soon/.test(ticket), ticket);
ck("  ...its buttons INSIDE the card, its bar along its bottom edge: its last part (owner, 2026-11-05)",
   /fm-record-main[\s\S]*<\/div><div class="fm-record-actions"><button[^>]*>Mark resolved<\/button><button[^>]*>Close<\/button><\/div><\/div><\/div>$/.test(ticket), ticket);
ck("  ...its time in its strip, its tags on its quiet line, then its notes, its cost at the right under them",
   /fm-record-when">Opened 2026-10-15 00:08/.test(strip(ticket)) && /fm-record-meta[\s\S]*Test lock/.test(body) && /What to do: power[\s\S]*Reminder sent[\s\S]*fm-record-foot"><span class="fm-amount">IDR 1,000/.test(body), body);
{
  const { stripTone } = await import("@/components/fm/RecordCard");
  const { ACCENT_PILL, QUIET_PILL } = await import("@/fm/tone");
  ck("  ...its strip's colour: the worst state's, then the card's tone, else grey (red, amber, green, grey)",
     stripTone([{ text: "a", tone: pillClass("warn") }, { text: "b", tone: pillClass("danger") }]) === "danger"
     && stripTone([{ text: "a", tone: QUIET_PILL }, { text: "b", tone: ACCENT_PILL }]) === "ok"
     && stripTone([{ text: "a", tone: QUIET_PILL }]) === "neutral" && stripTone([], "fault-watched tone-warn") === "warn"
     && stripTone([], "cockpit-focus") === "neutral" && stripTone([{ text: "a", tone: pillClass("ok") }], "tone-danger") === "ok");
}
ck("  ...it opens when tapped, as a button for the keyboard", /role="button"[^>]*tabindex="0"|tabindex="0"[^>]*role="button"/.test(ticket));

console.log("\n  an open issue on the Overview — the same card:");
const ent = (state) => ({ entity_id: "lock.example", state, attributes: {} });
const [group] = groupAttention([
  { id: "unavailable:lock.example", kind: "unavailable", title: "Test lock", detail: "Unavailable", entityId: "lock.example",
    source: "live", device: { key: "lock.example", label: "Test lock", room: "Hall" } },
  { id: "fault:f1", kind: "fault", title: "#33 · Test lock unavailable", detail: "Fault", entityId: "lock.example", ticketId: "f1",
    stage: "fault", source: "alert", device: { key: "lock.example", label: "Test lock", room: "Hall" } }]);
const CADENCE = { checkMinutes: 5, nightlyAt: "02:00" };
const issue = draw(h(AttentionCard, { card: cockpitCard(group, CADENCE), onOpenEntity: () => {},
  buttons: () => h(React.Fragment, null, btn("Open Ticket"), btn("Close")) }));
// owner, 2026-10-22: "show the area right after the device name, as the Spend tab's pills … to save one line"; "remove
// the chevron, it's redundant"
const meta = (html) => inside(html, "fm-record-meta");
ck("it IS the Cockpit card: its source icons in its strip, then its name, a link; its room quiet on a line under — no chevron",
   /class="fm-record-card"/.test(issue) && /fm-record-lead[\s\S]*<svg[\s\S]*<\/span><span class="fm-record-name">/.test(strip(issue))
   && /^<span class="fm-record-name"><button[^>]*fm-title-link[^>]*>Test lock<\/button><\/span>$/.test(name(issue)) && /^<div class="fm-record-meta"><span>Hall<\/span>/.test(meta(issue))
   && !/lucide-chevron-right/.test(issue) && !/fm-record-subtitle/.test(issue), issue.slice(0, 400));
ck("  ...its problem, then that problem's own buttons, the card's bar, its last part",
   /fm-record-main[\s\S]*#33 · Test lock unavailable[\s\S]*<\/div><div class="fm-record-actions"><button[^>]*>Open Ticket<\/button><button[^>]*>Close<\/button><\/div><\/div><\/div>$/.test(issue), issue);
// owner, 2026-11-01: "the card themselves shall not be clickable". Its buttons under its words on every width, as the
// Tickets tab's card (owner, 2026-11-04): the bar is the card's bottom edge, on every card, at every width
{
  const sheets = ["07-facility.css", "08-shared.css"].map((f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8")).join("\n");
  ck("  ...the card is not pressed; its bar one row of equal segments, a finger tall, at every width",
     !/role="button"|fm-openable/.test(issue) && /\.fm-record-actions \{ display: flex; flex-wrap: wrap; gap: 1px;/.test(sheets)
     && /\.fm-record-actions :is\(\.btn, \.icon-btn, \.fm-document-link\) \{\s*flex: 1 1 0; min-width: 0; min-height: var\(--touch-min\)/.test(sheets)
     && (sheets.match(/^\s*\.fm-record-actions \{/gm) ?? []).length === 1, sheets.match(/[^\n]*\.fm-record-actions[^\n]*/g));
}
ck("  ...its name opens the device, no line says it again", /fm-title-link/.test(issue) && !text(meta(issue)).includes("Test lock"), issue);
// owner, 2026-10-22: a refresh icon, not "Next check:"; 2026-11-06: a pill (the app's), on the card's first line, at its
// right under the strip's time, never on the quiet line
const stateLine = (html) => inside(html, "fm-record-state");
const PILL = /<span class="fm-entity-chip fm-chip-static fm-record-check" aria-label="Next check: within 5min \([^"]+\)"><svg[^>]*lucide-refresh-cw[\s\S]*?<\/svg>next check within 5min<\/span><\/div>$/;
ck("  ...its next check a pill, the last thing of its first line (after its state), never on its quiet line",
   PILL.test(stateLine(issue)) && stateLine(issue).indexOf("fm-record-status") < stateLine(issue).indexOf("fm-record-check")
   && !/fm-record-check|next check/.test(meta(issue)), [stateLine(issue), meta(issue)]);
{
  const facility = readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8");
  const rule = facility.match(/\n:is\(\.fm-record-state, \.fm-record-part-head\) \.fm-record-check \{([^}]*)\}/)?.[1] ?? "";
  ck("  ...at that line's right (pushed by its margin), whole, the line wrapping it under its state when both do not fit",
     /margin-left: auto/.test(rule) && /flex: none/.test(rule) && /white-space: nowrap/.test(rule)
     && /\n\.fm-record-state \{ display: flex; flex-wrap: wrap;/.test(facility) && !/\.fm-record-meta[^{]*fm-record-check/.test(facility), rule);
  // every caller: the pill is RecordCard's alone (its `check`), drawn on its first line even on a card with no state
  const { readdirSync } = await import("node:fs");
  const root = new URL("../../src/", import.meta.url);
  const using = readdirSync(root, { recursive: true }).filter((f) => /\.tsx?$/.test(f) && f !== "components/fm/RecordCard.tsx")
    .filter((f) => /<CheckPill\b|fm-record-check/.test(readFileSync(new URL(f, root), "utf8")));
  const bare = draw(h(RecordCard, { title: "T", room: "Hall", check: { pill: "next check 02:00", tip: "Next check: 02:00" } }));
  ck("  ...every next check drawn by the card itself (no other file draws the pill); a card with no state still has its first line for it",
     using.length === 0 && /^<div class="fm-record-state strip-neutral"><span class="fm-entity-chip fm-chip-static fm-record-check"/.test(stateLine(bare))
     && !/fm-record-check/.test(meta(bare)), [using, bare]);
}
// the card's pill (cardCheck): its faults' timed check, else "checked live" for a card all live
const { cardCheck } = await import("@/fm/faultTiming");
const nextCheck = (...a) => cardCheck(...a)?.text ?? null;
// at a fixed noon: the soonest of the 02:00 night and the 5-minute look is the night's from 01:55 to 02:00, and this
// check failed those five minutes every night (2026-10-22, 01:58)
const NOON = new Date(2026, 9, 21, 12, 0, 0);
const said = (problems, cadence = CADENCE) => nextCheck(problems, cadence, NOON);
ck("  ...each card says when its problems are read again, the Agent's numbers its own",
   said([{ source: "live" }])?.startsWith("Checked live")
   && said([{ source: "night", check: "nightly" }]) === "Next check: 02:00"
   && said([{ source: "night", check: "nightly" }], { checkMinutes: 15, nightlyAt: "04:30" }) === "Next check: 04:30"
   && said([{ source: "live", fault: { source: "night", check: "minutes" } }]) === "Next check: within 5min"   // offline: rechecked
   && said([{ source: "night", check: "nightly" }, { source: "alert", check: "minutes" }]) === "Next check: within 5min"
   && said([{ source: "alert" }]) === "Next check: within 5min" && said([{ source: "night" }]) === "Next check: within 5min" // older: read at every look now
   && said([{ source: "owner" }]) === null && said([{ source: "chat" }]) === null
   && said([{ source: "live" }, { source: "guest" }]) === null   // a person's fault beside it: its part says live

   && said([{ source: "schedule" }]) === null
   && said([{ source: "night", check: "nightly" }], null) === null);
// owner, 2026-10-19: hovering "Next check" says when, as a date and time — the nightly check's next run, or the
// Agent's next look; nothing for a card with no time (live, by hand, an Agent that did not say)
const { nextCheckAt } = await import("@/fm/faultTiming");
const { momentText } = await import("@/utils/dateText");
const NOW = new Date(2026, 9, 19, 2, 10);
const at = (problems, cadence = CADENCE) => { const d = nextCheckAt(problems, cadence, NOW); return d ? momentText(d) : null; };
ck("  ...and hovering it says when: the nightly check's next run, the Agent's next look",
   at([{ source: "night", check: "nightly" }]) === "20/10/2026 02:00"
   && at([{ source: "night", check: "nightly" }], { checkMinutes: 5, nightlyAt: "04:30" }) === "19/10/2026 04:30"
   && at([{ source: "alert", check: "minutes" }]) === "19/10/2026 02:15"
   && at([{ source: "live" }]) === null && at([{ source: "owner" }]) === null && at([{ source: "night" }], null) === null,
   [at([{ source: "night", check: "nightly" }]), at([{ source: "alert", check: "minutes" }])]);
// owner, 2026-10-20: the Agent reads every open night finding again at every look ("minutes"); a fault an older Agent
// wrote "day" — a check the agreement no longer declares — and one written with no check read at their source's clock:
// for a maintenance check, every look. A card says the soonest real moment of its faults.
{
  const t1310 = new Date(2026, 9, 19, 13, 10);
  const when = (problems, cadence, now) => { const d = nextCheckAt(problems, cadence, now); return d ? momentText(d) : null; };
  ck("  ...every night fault: within the Agent's look — what it writes now, an older Agent's \"day\", or none",
     [{ source: "night", check: "minutes" }, { source: "night", check: "day" }, { source: "night" }]
       .every((p) => nextCheck([p], CADENCE, t1310) === "Next check: within 5min" && when([p], CADENCE, t1310) === "19/10/2026 13:15"));
  ck("  ...a fault written \"nightly\" keeps its nightly time; beside an every-look fault, the sooner wins",
     nextCheck([{ source: "night", check: "nightly" }], CADENCE, t1310) === "Next check: 02:00"
     && nextCheck([{ source: "night", check: "nightly" }, { source: "alert", check: "minutes" }], CADENCE, t1310) === "Next check: within 5min"
     && nextCheck([{ source: "live", fault: { source: "night", check: "day" } }], CADENCE, new Date(2026, 9, 19, 1, 58)) === "Next check: within 5min");
  ck("  ...a live item beside them keeps its rule: the faults decide; live alone stays live; a person's alone: by hand",
     nextCheck([{ source: "live" }, { source: "night", check: "minutes" }], CADENCE, t1310) === "Next check: within 5min"
     && nextCheck([{ source: "live" }], CADENCE, t1310) === "Checked live"
     && nextCheck([{ source: "night", check: "day" }], null, t1310) === null);
}
// owner, 2026-11-06: an Inbox card whose problem is only live ("Unavailable", no VESTA fault) had no pill: the tablet
// re-reads live states all the time, so it says "checked live", its tip the Live row's own words (faultTiming's table)
{
  const { timingRow, LIVE_CHECK } = await import("@/fm/faultTiming");
  const goes = timingRow("live", null).goes;
  ck("  ...a problem watched live: \"checked live\", its tip when the card goes in the table's Live row's words",
     LIVE_CHECK.pill === "checked live" && LIVE_CHECK.tip === `This tablet watches it all the time: the card goes ${goes[0].toLowerCase()}${goes.slice(1)}`
     && goes === "As soon as the device is back to normal", LIVE_CHECK);
  const dev = { key: "camera.example_storage", label: "Storage Room Person Detection", room: "Storage" };
  const liveItem = { id: "unavailable:camera.example_storage", kind: "unavailable", title: dev.label, detail: "Unavailable",
    entityId: dev.key, source: "live", device: dev };
  const drawn = (items) => draw(h(AttentionCard, { card: cockpitCard(groupAttention(items)[0], CADENCE), onOpenEntity: () => {} }));
  const alone = drawn([liveItem]);
  ck("  ...drawn: a live-only card has the pill at the right of its first line, saying \"checked live\"",
     /<span class="fm-entity-chip fm-chip-static fm-record-check" aria-label="This tablet watches it all the time[^"]*"><svg[^>]*lucide-refresh-cw[\s\S]*?<\/svg>checked live<\/span><\/div>$/.test(stateLine(alone)), stateLine(alone));
  // a live state and a fault of another problem on one card: the card's pill is the fault's (the later check, the one
  // to wait for); the live part its own "checked live" on its header, before its time
  const fault = { id: "fault:f9", kind: "fault", title: "Storage camera storage full", detail: "Fault", entityId: "sensor.example_storage_card", ticketId: "f9",
    stage: "fault", source: "night", check: "nightly", device: dev };
  const both = cockpitCard(groupAttention([liveItem, fault])[0], CADENCE, NOON);
  const mixed = draw(h(AttentionCard, { card: both, onOpenEntity: () => {} }));
  const heads = [...mixed.matchAll(/<div class="fm-record-part-head[\s\S]*?<\/div>/g)].map((m) => m[0]);
  ck("  ...a card of several: the card's pill its fault's next check, the live part's header its own \"checked live\" before its time",
     both.lines.length === 2 && /next check 02:00<\/span><\/div>$/.test(stateLine(mixed))
     && heads.filter((x) => /checked live<\/span><span class="fm-record-when">/.test(x)).length === 1
     && heads.filter((x) => /fm-record-check/.test(x)).length === 1, [stateLine(mixed), heads]);
  const twoLive = cockpitCard(groupAttention([liveItem, { ...liveItem, id: "alarm:camera.example_storage", kind: "alarm", detail: "Unlocked" }])[0], CADENCE);
  ck("  ...a card all live: one pill, the card's, none repeated on its parts",
     twoLive.nextCheck === LIVE_CHECK && twoLive.lines.every((l) => !l.check), twoLive);
}
// owner, 2026-10-21: "the tooltip is updating every minute, whereas I expect it to reflect the 5 min check period" —
// it said now + 5 min. The Agent says when its look last started (cadence lastLookAt): the next one is a fixed moment.
{
  const LOOKED = { ...CADENCE, lastLookAt: new Date(2026, 9, 19, 2, 8, 30).toISOString() };
  const when = (now) => { const d = nextCheckAt([{ source: "alert", check: "minutes" }], LOOKED, now); return d ? d.getTime() : null; };
  const fixed = new Date(2026, 9, 19, 2, 13, 30).getTime();
  ck("  ...the Agent's next look is its last look + 5 min, the same moment a minute later; a missed look rolls on",
     when(NOW) === fixed && when(new Date(2026, 9, 19, 2, 11)) === fixed && when(new Date(2026, 9, 19, 2, 13)) === fixed
     && when(new Date(2026, 9, 19, 2, 14)) === new Date(2026, 9, 19, 2, 18, 30).getTime()
     && nextCheck([{ source: "alert", check: "minutes" }], LOOKED, NOW) === "Next check: within 5min",
     [when(NOW), fixed]);
}
// owner, 2026-10-21: a door locked at 14:38:50 still a fault at 14:45 — the Agent closes it once it has stayed right for
// its clear wait, and the card now says so (FmTicket.closesAt → attention `closing` → the line under its problem)
{
  const { clockTime } = await import("@/utils/dateText");
  const t1445 = new Date(2026, 9, 21, 14, 45), closes = new Date(2026, 9, 21, 14, 49), locked = new Date(2026, 9, 21, 14, 38, 50);
  const fault = (closing) => groupAttention([{ id: "fault:c1", kind: "fault", title: "#65 · Door unlocked", detail: "Fault",
    entityId: "lock.example", ticketId: "c1", stage: "fault", source: "alert", device: { key: "lock.example", label: "Door", room: "Hall" },
    ...(closing ? { closing } : {}) }])[0];
  const line = (closing, now = t1445) => cockpitCard(fault(closing), CADENCE, now).lines[0].closing;
  const waiting = { at: closes.toISOString(), word: "Locked", since: { at: locked.getTime(), before: false } };
  ck("  ...a fault waiting to close says what it reads, since when, and when it closes if it stays so",
     line(waiting) === `Locked since ${clockTime(locked)} · closes at about ${clockTime(closes)} if it stays locked`
     && line(waiting, new Date(2026, 9, 21, 14, 50)) === `Locked since ${clockTime(locked)} · closes at the next check if it stays locked`
     && line({ at: closes.toISOString() }) === `Back to normal · closes at about ${clockTime(closes)} if it stays so`
     // the history not read yet: "…", never a time; not said: no time at all
     && line({ ...waiting, since: "loading" }) === `Locked since … · closes at about ${clockTime(closes)} if it stays locked`
     && line({ ...waiting, since: null }) === `Locked · closes at about ${clockTime(closes)} if it stays locked`
     && line(undefined) === null, [line(waiting)]);
  const drawn = draw(h(AttentionCard, { card: cockpitCard(fault(waiting), CADENCE, t1445), onOpenEntity: () => {} }));
  ck("  ...drawn under its problem's line", drawn.includes(`if it stays locked</span>`), drawn.slice(0, 500));
  // ticket 19 of "One inbox" (owner, 2026-10-28): the short story Telegram's Status tells, every line, under its problem
  const story = [{ note: "Alert sent (to: Facility Manager)", at: "2026-10-21T06:40:00Z" },
    { note: "🆘 Need help on Telegram (Wayan)", at: "2026-10-21T06:52:00Z" }];
  const told = draw(h(AttentionCard, { card: cockpitCard({ ...fault(waiting), items: [{ ...fault(waiting).items[0], story }] },
    CADENCE, t1445), onOpenEntity: () => {} }));
  const list = inside(told, "cockpit-attention-story");
  ck("  ...and its short story, every line in order with its time, under its problem's line",
     list.indexOf(`Alert sent (to: Facility Manager) · ${momentText(story[0].at)}`) >= 0
     && list.indexOf(`🆘 Need help on Telegram (Wayan) · ${momentText(story[1].at)}`) > list.indexOf("Alert sent"), list || told.slice(0, 800));
  ck("  ...none told, no story drawn", !drawn.includes("cockpit-attention-story"));
  const { attentionOf } = await import("@/config/attention");
  const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
  const { devicesOf } = await import("../consistency/devices.mjs");
  const ticket = { id: "c1", title: "Door unlocked", status: "open", openedAt: "2026-10-21T06:00:00Z", entityId: "lock.example",
    photoIds: [], closesAt: closes.toISOString() };
  // villa, 2026-10-26: last_changed is the restart of the villa's system — the time is the history's (sinceOf), never it
  const restart = new Date(2026, 9, 21, 14, 44);
  const entities = { "lock.example": { entity_id: "lock.example", state: "locked", attributes: {}, last_changed: restart.toISOString() } };
  const { sinceEntities } = await import("@/config/attention");
  const fmData = { ...EMPTY_FM_DATA, tickets: [ticket] };
  const asked = [];
  const items = attentionOf({ devices: devicesOf({ ids: ["lock.example"] }), entities, entityMap: {}, resolvedRooms: {},
    fmData, sinceOf: (id) => (asked.push(id), { at: locked.getTime(), before: false }) }).attentionItems;
  const c = items.find((i) => i.ticketId === "c1")?.closing;
  ck("  ...from the fault's closesAt and its device as it reads now, since when from its history (never the restart)",
     c?.at === closes.toISOString() && c?.word === "Locked" && c?.since?.at === locked.getTime()
     && asked.join() === "lock.example" && sinceEntities({ fmData, devices: devicesOf({ ids: ["lock.example"] }), entities, entityMap: {} }).join() === "lock.example", c);
  const unread = attentionOf({ devices: devicesOf({ ids: ["lock.example"] }), entities, entityMap: {}, resolvedRooms: {},
    fmData }).attentionItems.find((i) => i.ticketId === "c1")?.closing;
  ck("  ...no history to ask: no time said, never last_changed", unread?.since === null, unread);
  // owner's end-to-end test, 2026-10-30: a lock that was UNAVAILABLE read "Unlocked since before 19 Oct"
  const olderState = (since) => attentionOf({ devices: devicesOf({ ids: ["lock.example"] }), entities, entityMap: {},
    resolvedRooms: {}, fmData, sinceOf: () => since }).attentionItems.find((i) => i.ticketId === "c1")?.closing;
  const before = olderState({ at: Date.parse("2026-10-20T00:00:00Z"), before: false });
  const outOfReach = olderState({ at: Date.parse("2026-10-19T00:00:00Z"), before: true });
  ck("  ...a state older than the problem is not what changed: \"Back to normal\", never its state since then",
     before?.at === closes.toISOString() && before?.word === undefined && outOfReach?.word === undefined, [before, outOfReach]);
  // owner, 2026-10-29: a new alert's row in Messages had no time (nothing told of it yet)
  const { rowTime } = await import("@/config/cockpitCard");
  const opened = items.find((i) => i.ticketId === "c1");
  const fresh = cockpitCard({ ...fault(waiting), items: [opened] }, CADENCE, t1445);
  const toldCard = cockpitCard({ ...fault(waiting), items: [{ ...opened, story }] }, CADENCE, t1445);
  // owner, 2026-11-01: the Inbox said its escalation's 01:07, the ticket its opening's 00:19, for one alert
  ck("  ...it says when it was opened, as its ticket does, whatever was told of it since",
     rowTime(fresh) === "2026-10-21T06:00:00Z" && rowTime(toldCard) === "2026-10-21T06:00:00Z", [rowTime(fresh), rowTime(toldCard)]);
}
ck("  ...said whole, with its moment, by the pill's tooltip (the Kiosk's own: common/Tip)",
   /aria-label="Next check: within 5min \(\d\d\/\d\d\/\d{4} \d\d:\d\d\)"/.test(issue)
   && /<Tip text=\{tip\}>/.test(readFileSync(new URL("../../src/components/fm/RecordCard.tsx", import.meta.url), "utf8"))
   && /<CheckPill \{\.\.\.check\} \/>/.test(readFileSync(new URL("../../src/components/fm/RecordCard.tsx", import.meta.url), "utf8")));
// owner, 2026-10-15: "there should always be the room line, to respect a consistent layout"
const [roomless] = groupAttention([{ id: "fault:f9", kind: "fault", title: "Relay dropped", detail: "Fault", entityId: "sensor.relay_t",
  ticketId: "f9", stage: "fault", source: "night", device: { key: "sensor.relay_t", label: "Relay" } }]);
ck("  ...a device no room holds still has its room: Other, as By Room files it",
   /<div class="fm-record-meta"><span>Other<\/span>/.test(draw(h(AttentionCard, { card: cockpitCard(roomless, CADENCE), onOpenEntity: () => {} }))));
const lone = draw(h(AttentionCard, { card: cockpitCard({ ...group, entityId: undefined }, CADENCE), onOpenEntity: () => {} }));
ck("  ...a problem with no device: no chevron, nothing to tap, no buttons", !/chevron-right/.test(lone) && !/role="button"/.test(lone) && !/fm-record-actions/.test(lone));

// owner, 2026-10-18: "#55" sat further right than "#41" above it; 2026-11-05 ("Status on top"): a card of several
// problems says how many in its strip, with every source, and each problem has its own header line: its icon, its state,
// its time, then its words, all starting at the same place
{
  const dev = { key: "lock.door", label: "Door lock", room: "Hall" };
  const [two] = groupAttention([
    { id: "alarm:lock.door", kind: "alarm", title: "Door lock", detail: "Unlocked", entityId: "lock.door", source: "live", device: dev },
    { id: "fault:f1", kind: "fault", title: "#41 · Door unlocked", detail: "Fault", entityId: "lock.door", ticketId: "f1", stage: "fault", source: "alert", device: dev },
    { id: "fault:f2", kind: "fault", title: "#55 · Door unlocked", detail: "Fault", entityId: "lock.door", ticketId: "f2", stage: "fault", source: "alert", device: dev }]);
  const drawn = draw(h(AttentionCard, { card: cockpitCard(two, CADENCE), onOpenEntity: () => {} }));
  const parts = drawn.split('<section class="fm-record-part">').slice(1);
  const head = (p) => inside(p, "fm-record-part-head");
  ck("  ...a card of several problems: \"2 problems\" in its strip, red as its worst; each problem its header: its icon, its state, its time",
     /class="fm-record-strip strip-danger"[\s\S]*fm-record-status">2 problems</.test(drawn) && /siren/.test(strip(drawn)) && /lucide-radio/.test(strip(drawn))
     // its "Unlocked" is no state of its header: the alert folded onto it says it (a state never repeats the words);
     // each fault nobody moved says so (owner, 2026-11-06: every card that can have a state has one)
     && parts.length === 2 && /lucide-radio/.test(head(parts[0])) && !/Unlocked/.test(head(parts[0])) && /#41 · Door unlocked/.test(parts[0])
     && /siren/.test(head(parts[1])) && parts.every((p) => /<span class="fm-record-status">New fault<\/span>/.test(head(p)))
     && parts.every((p) => /fm-record-when">[^<]+</.test(head(p)) && /^<div class="fm-record-part-head strip-(danger|warn)">/.test(p))
     && parts.every((p) => !/<svg/.test(inside(p, "fm-record-part-text"))), { parts });
}

// owner, 2026-10-15: "don't skip a line between the room and the next section"; 2026-11-05: a card as tall as its
// content, its bar its last part. What the stylesheet says:
{
  const { readFileSync } = await import("node:fs");
  const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8");
  const rule = (text, sel) => (text.match(new RegExp(`^${sel.replace(/[.]/g, "\\.").replace(/[()]/g, "\\$&")} \\{([^}]*)\\}`, "m")) ?? [])[1] ?? "";
  ck("  ...its words right under the room: 4 px apart, no height of their own; the frame holds its parts edge to edge",
     /gap: 4px/.test(rule(css("07-facility.css"), ".fm-record-main")) && !/min-height|height:/.test(rule(css("08-shared.css"), ".cockpit-attention-sub-text"))
     && /padding: 0;/.test(rule(css("07-facility.css"), ".fm-record-card")) && /flex-direction: column/.test(rule(css("07-facility.css"), ".fm-record-card"))
     && !/stretch|height:/.test(rule(css("07-facility.css"), ".fm-record-card")), [rule(css("07-facility.css"), ".fm-record-main"), rule(css("07-facility.css"), ".fm-record-card")]);
}

// architecture review, 2026-10-15: "offline for 129 h" was written at 02:00 and a day old by evening — a duration in a
// fault's title is worded when it is shown, from its since, in the Kiosk's own words
{
  const { faultTitle } = await import("@/fm/fmEngine");
  const since = "2026-10-09T09:00:00Z", at = (iso) => Date.parse(iso);
  const t = { title: "Sensor offline for 129 h.", titlePattern: "Sensor offline for {since}.", since };
  ck("  ...a duration in its title is today's: worded from its since each time it is shown",
     faultTitle(t, at("2026-10-15T11:00:00Z")) === "Sensor offline for 6d 2h."
     && faultTitle(t, at("2026-10-09T10:15:00Z")) === "Sensor offline for 1h 15min."
     && faultTitle({ ...t, alertNumber: 5 }, at("2026-10-15T11:00:00Z")) === "#5 · Sensor offline for 6d 2h."
     && faultTitle({ title: "Sensor offline for 129 h." }) === "Sensor offline for 129 h."               // an older fault
     && faultTitle({ ...t, since: undefined }) === "Sensor offline for 129 h.");                          // nothing to count from
}

console.log("\n  a scheduled task — the same card:");
const task = draw(h(RecordCard, { title: "Pool filter clean", tone: "state-due-soon", status: { text: "Due soon", tone: "due-soon" },
  when: "due in 3 days · every 30 days", actions: h(React.Fragment, null, btn("Log"), h("button", { className: "icon-btn", "aria-label": "Remove" })) }));
ck("its name in its strip, its state its first line, Log and the bin its bar, its tint on the card",
   text(name(task)) === "|Pool filter clean|" && /fm-record-main"><div class="fm-record-state strip-neutral"><span class="fm-record-status">Due soon</.test(task) && /fm-record-actions[\s\S]*Log[\s\S]*aria-label="Remove"/.test(task)
   && /class="fm-record-card state-due-soon"/.test(task), task.slice(0, 300));
ck("  ...nothing to erase by holding it (its bin removes it): no hold-to-erase on it", !/fm-erasable/.test(task));
// owner, 2026-11-04: "what is the top right pill (light grey) for … it never disappears": the hold-to-erase hint dot,
// drawn on every erasable row's corner over its time pill. A row that can be erased draws its content and nothing else
{
  const { default: ErasableRow } = await import("@/components/fm/ErasableRow");
  const row = draw(h(ErasableRow, { intent: { title: "Erase", detail: "x" }, erase: async () => {} }, h("b", null, "the card")));
  ck("  ...an erasable row draws no hint of it: only its own content", /^<div [^>]*class="fm-row fm-erasable"[^>]*><b>the card<\/b><\/div>$/.test(row), row);
}

// owner, 2026-10-18: a problem's words ran on, and no button showed the mouse was on it. Drawn: the words cut on one line
// (whole on hover); in the stylesheets: every button lights under the mouse, the card does not light over a button.
// owner, 2026-10-31: an opened card still cut its lines ("…against a normal 0.07 kWh/da…"). ONE rule: the Inbox's list
// row is the one place a message is cut; a card, only ever drawn opened, shows every line whole.
// (Each line's own Close went on 2026-10-30: one Done closes everything on the card.)
{
  const { readFileSync } = await import("node:fs");
  const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8");
  const dev = { key: "lock.door4", label: "Door", room: "Hall" };
  const words = "A long problem whose words are all shown, over as many lines as they need";
  const [two] = groupAttention([
    { id: "fault:x", kind: "fault", title: words, detail: "Fault", entityId: "lock.door4", ticketId: "x", stage: "fault", source: "alert", device: dev },
    { id: "fault:y", kind: "fault", title: "Another", detail: "Fault", entityId: "lock.door4", ticketId: "y", stage: "fault", source: "alert", device: dev }]);
  const card = draw(h(AttentionCard, { card: cockpitCard(two, CADENCE), onOpenEntity: () => {} }));
  ck("  ...a problem's words are drawn whole in the card, no hover repeating them; no line carries a button of its own",
     card.includes(`<span class="cockpit-attention-sub-title">${words}</span>`)
     && elements(parseTsx("components/cockpit/IssueCard.tsx"), "Tip").length === 0
     && !card.includes("cockpit-line-act"), card.slice(0, 600));
  const shared = css("08-shared.css"), fac = css("07-facility.css"), base = css("01-base.css");
  // every rule of every stylesheet that cuts a text with "…" (comments dropped; a rule body holds no brace)
  const { readdirSync } = await import("node:fs");
  const cuts = readdirSync(new URL("../../src/styles/", import.meta.url)).filter((f) => f.endsWith(".css")).flatMap((f) =>
    [...css(f).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /text-overflow:\s*ellipsis|line-clamp/.test(m[2])).map((m) => m[1].trim().replace(/\s+/g, " ")));
  const CARD = /fm-record|fm-row|cockpit-attention|messages-card|messages-detail|announcement/;
  // owner, 2026-11-01: the line under a title was cut at the time's column; it spans the row, on one line, cut with "…"
  ck("a folded card's first words are one line cut with \"…\", over the card's width", cuts.includes(".fm-card-folded"), cuts);
  // owner, 2026-11-05: the strip's name two lines at most, then "…"; a part's header line its state's words give way
  ck("  ...an opened card: no text of it is ever cut but its strip's name and a part's state (no other rule cuts a card's text)",
     cuts.includes(".fm-record-name") && cuts.includes(".fm-record-part-head .fm-record-status")
     && cuts.filter((sel) => ![".fm-card-folded", ".fm-record-name", ".fm-record-part-head .fm-record-status"].includes(sel)).every((sel) => !CARD.test(sel))
     && /\.cockpit-attention-sub-text \{[^}]*overflow-wrap: anywhere;/.test(shared), cuts.filter((sel) => CARD.test(sel)));
  // owner, 2026-11-01: one column, a tap opening a card in its place: no pane is left, and every section draws InboxCard
  const tab = parseTsx("components/cockpit/MessagesTab.tsx");
  const pane = /\.messages-(list|detail|scroll|back|row)\b|\.reading\b/;
  ck("  ...and the Inbox is one column of one card: no pane, no row, no Back, InboxCard alone draws them",
     !pane.test(shared.replace(/\/\*[\s\S]*?\*\//g, "")) && elements(tab, "InboxCard").length === 1
     && elements(tab, "CockpitAttentionRow").every((e) => { for (let n = e.parent; n; n = n.parent) if (n.name?.getText?.() === "InboxCard") return true; return false; }));
    // owner, 2026-11-01: two or three stacked icons made the name's line that tall, an empty line above the room
  // owner, 2026-11-01: stacked icons made the name's line that tall; 2026-11-05: they are the strip's, side by side
  ck("a card's icons take no line of their own: in its strip, side by side, never stacked, no column of their own",
     /:is\(\.fm-record-lead, [^)]*\) \{\s*flex: none; white-space: nowrap; min-height: var\(--strip-line\); display: inline-flex;/.test(fac)
     && /\.cockpit-source-icons \{ flex-direction: row;/.test(fac)
     && !/fm-record-gutter|padding-left: 30px/.test(fac));
  ck("every button lights under the mouse, and the card does not light while the mouse is on any of its buttons",
     /@media \(hover: hover\) \{\s*\.btn:hover:not\(:disabled\) \{/.test(base)
     && /\.fm-record-card:has\(> \.fm-openable\):hover:not\(:has\(\.fm-record-actions:hover\)\):not\(:has\(button:hover\)\)/.test(fac));
}

// owner, 2026-10-22: "check the tooltips in the whole Cockpit are consistently styled with other tooltips in the
// Kiosk": no element of the Cockpit, nor the windows' shared footer, asks the browser for its own grey `title` box —
// every hover text is common/Tip, the charts' card (.spark-tip)
{
  const { readdirSync } = await import("node:fs");
  const dir = (d) => readdirSync(new URL(`../../src/components/${d}/`, import.meta.url)).filter((f) => f.endsWith(".tsx")).map((f) => `${d}/${f}`);
  const files = [...dir("cockpit"), ...dir("fm"), "common/ModalFooter.tsx"];
  const native = files.filter((f) => /<[a-z][a-z0-9]*\b[^<>]*\stitle=/.test(readFileSync(new URL(`../../src/components/${f}`, import.meta.url), "utf8")));
  const tip = readFileSync(new URL("../../src/components/common/Tip.tsx", import.meta.url), "utf8");
  ck("no Cockpit element shows the browser's own tooltip: every hover text is the Kiosk's card (common/Tip)",
     native.length === 0 && /className="spark-tip ui-tip"/.test(tip) && /placeTip\(/.test(tip), native);
}
// owner, 2026-10-22: "wherever there is a card to show, the same style, centrally applied — scan the whole Kiosk UI".
// The frame is said once (01-base.css --card-*); every Cockpit list draws RecordCard; a pill is the Kiosk's pill.
{
  const { readdirSync } = await import("node:fs");
  const css = readdirSync(new URL("../../src/styles/", import.meta.url)).filter((f) => f.endsWith(".css"))
    .map((f) => [f, readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8")]);
  const rules = css.flatMap(([f, t]) => [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ f, sel: m[1].trim().split("\n").pop(), body: m[2] })));
  const ownFrame = rules.filter((r) => /background: var\(--bg-card\)/.test(r.body) && /border: 1px solid var\(--hairline\)/.test(r.body));
  ck("a card's frame is said once: no rule repeats --bg-card with its own 1 px hairline border",
     ownFrame.length === 0 && /--card-radius: 12px;/.test(css.find(([f]) => f === "01-base.css")[1]), ownFrame.map((r) => `${r.f} ${r.sel}`));
  const tsx = (d) => readdirSync(new URL(`../../src/components/${d}/`, import.meta.url)).filter((f) => f.endsWith(".tsx"))
    .map((f) => [`${d}/${f}`, readFileSync(new URL(`../../src/components/${d}/${f}`, import.meta.url), "utf8")]);
  const handRows = tsx("fm").filter(([f, t]) => !/RecordCard|ErasableRow/.test(f) && /className=\{?[`"]fm-row[ `"$]/.test(t)).map(([f]) => f);
  ck("  ...every Cockpit list draws THE card (RecordCard), none a card of its own", handRows.length === 0, handRows);
  const inlinePills = [...tsx("settings"), ...tsx("fm"), ...tsx("cockpit"), ...tsx("common")]
    .filter(([, t]) => /borderRadius: 999/.test(t)).map(([f]) => f);
  ck("  ...and a pill is the Kiosk's pill (.fm-entity-chip, common/RemovablePill), never one drawn in inline styles",
     inlinePills.length === 0, inlinePills);
}
// architecture review round 13 (2026-11-01): the Inbox drew the room as a framed pill, Tickets, Schedule and Today as plain
// grey text among the tags. ONE room, the card's own `room` input, on every list that shows a room; 2026-11-05: quiet
// text, the first words of the card's quiet line.
{
  const card = draw(h(RecordCard, { title: "Pump", room: "Kitchen", device: h("span", { className: "fm-entity-chip" }, "DEVICE"),
    pills: h("span", { className: "fm-clause" }, "Cl. 3") }));
  const room = '<div class="fm-record-meta"><span>Kitchen</span>';
  ck("a card's name in its strip; its quiet line: its device, its room, then its tags (architecture review, 2026-11-05)",
     text(name(card)) === "|Pump|" && text(meta(card)) === "|DEVICE|Kitchen|Cl. 3|"
     && (card.match(/Kitchen/g) ?? []).length === 1, card);
  const issue = draw(h(AttentionCard, { card: { key: "k", title: "Pump", room: "Kitchen", lead: null, nextCheck: null, actions: [],
    lines: [{ key: "l", text: "Stopped", story: [], closing: null, openedAt: null }] }, onOpenEntity() {} }));
  ck("  ...the Inbox's opened card draws the same line", issue.includes(room), issue);
  // a task's card is TaskCard, the Schedule and Today tabs' alike (architecture review, 2026-11-05): they give it its room
  const roomed = { "fm/TicketsTab.tsx": "roomOf(t)", "fm/ScheduleEditor.tsx": "roomOf(s)", "fm/TaskCard.tsx": "room",
    "fm/TodayTab.tsx": "roomOf(s.schedule)", "fm/SpendTab.tsx": "roomOf(c)", "cockpit/IssueCard.tsx": "card.room" };
  const cardOf = { "fm/ScheduleEditor.tsx": "TaskCard", "fm/TodayTab.tsx": "TaskCard" };
  const given = Object.fromEntries(Object.keys(roomed).map((f) => [f, elements(parseTsx(`components/${f}`), cardOf[f] ?? "RecordCard")
    .map((e) => propText(e, "room")).filter((x) => x !== undefined && x !== null)]));
  ck("  ...Tickets, Schedule, Today, Spend and the Inbox's card each give their card its room, none as a tag of its own",
     Object.entries(roomed).every(([f, r]) => JSON.stringify(given[f]) === JSON.stringify([r]))
     && Object.keys(roomed).every((f) => !/className="fm-clause">\{[^}]*room/.test(readFileSync(new URL(`../../src/components/${f}`, import.meta.url), "utf8"))),
     given);
}
console.log("\n  a card's state is one pill, everywhere (owner, 2026-11-01, option A):");
{
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
  const root = new URL("../../src", import.meta.url).pathname;
  const badges = walk(root).filter((p) => /fm-record-status|fm-badge/.test(readFileSync(p, "utf8")));
  ck("a card's state is drawn in one place (RecordCard's first line, a part's header)", badges.length === 1 && badges[0].endsWith("components/fm/RecordCard.tsx"), badges);
  const { cockpitCard } = await import("@/config/cockpitCard");
  const said = (item) => { const c = cockpitCard({ key: "device:d", title: "D", items: [item] }, null); return { text: c.lines.map((l) => l.text).join("|"), pills: c.status.map((s) => s.text) }; };
  const f = { id: "fault:x", kind: "fault", title: "Door stuck", detail: "", ticketId: "x" };
  const cases = [["Missing", { id: "u", kind: "unavailable", title: "", detail: "Missing", fault: f }],
    ["Unavailable", { id: "u", kind: "unavailable", title: "", detail: "Unavailable" }],
    ["Overdue", { id: "s", kind: "schedule", title: "Filter", detail: "Overdue" }]];
  for (const [word, item] of cases) {
    const got = said(item);
    ck(`  ..."${word}": in its state, not in the line's words`, got.pills.includes(word) && !got.text.toLowerCase().includes(word.toLowerCase()), got);
  }
  ck("  ...but a ticket's stage is no state of the device: its line's move says it (owner, 2026-11-02/05)", said({ ...f, stage: "ticket" }).pills.length === 0);
  const { taskState } = await import("@/components/fm/TaskCard");
  const late = { schedule: { enabled: true }, state: "overdue" };
  ck("  ...a paused task too: its state says it, overdue or not", taskState({ ...late, schedule: { enabled: false } }).word === "Paused"
     && taskState(late).word === "Overdue");
  const row = readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8");
  ck("  ...and the Inbox draws no state of its own: its cards are RecordCard's", !/CardPillLine|fm-badge|fm-record-status|StatusPill/.test(row));
}

// owner, 2026-11-05 ("Status on top", then "state first"): a card's state is said ONCE, its first line, on every card of
// every tab, whatever its width; its bar holds its buttons and nothing else; who moved it is its who line, never its
// stage or its time again
{
  const bar = (html) => inside(html, "fm-record-actions");
  const { moveWho, moveState } = await import("@/fm/faultNotes");
  const { momentText } = await import("@/utils/dateText");
  const reopened = { kind: "reopened", word: "Reopened", who: "VESTA Agent", at: "2026-10-31T05:11:00Z", tone: "tone-warn" };
  const unavailable = { key: "device:a", title: "Lock", room: "Hall", status: [{ text: "Unavailable", tone: "tone-quiet" }],
    lines: [{ key: "a", text: "", actions: [], story: [], openedAt: "2026-10-31T05:11:00Z", move: reopened }] };
  const withButtons = draw(h(AttentionCard, { card: unavailable, onOpenEntity: () => {}, buttons: () => btn("Done") }));
  const without = draw(h(AttentionCard, { card: unavailable, onOpenEntity: () => {} }));
  const first = (html) => inside(html, "fm-record-state");
  ck("a card's states its first line, joined: the device's and how it was last moved; its bar only its buttons",
     text(first(withButtons)) === "|Unavailable · Reopened|" && /fm-record-state strip-warn/.test(withButtons) && /strip-warn/.test(strip(withButtons))
     && text(bar(withButtons)) === "|Done|" && !/Unavailable|Reopened/.test(strip(withButtons) + inside(withButtons, "fm-record-meta")
       + inside(withButtons, "cockpit-attention-sub-text")), withButtons);
  ck("  ...who moved it its who line, its time and its word dropped when the strip says them",
     /fm-record-who"><svg[\s\S]*?<\/svg><span>By VESTA Agent<\/span>/.test(withButtons)
     && moveWho(reopened, ["Reopened"], momentText(reopened.at), momentText) === "By VESTA Agent"
     && moveWho(reopened, [], undefined, momentText) === `Reopened by VESTA Agent, on ${momentText(reopened.at)}`
     && moveWho({ ...reopened, kind: "opened", word: "Ticket opened", who: "Fab & Jm", stage: "ticket" }, ["Ticket in progress"], momentText(reopened.at), momentText) === "Opened by Fab & Jm"
     && moveWho({ ...reopened, kind: "help", word: "Need help asked", who: "Owner" }, [], "x", momentText) === `Need help asked by Owner, on ${momentText(reopened.at)}`
     && moveState({ ...reopened, kind: "help", word: "Need help asked" }) === null && moveWho(null, [], "x", momentText) === null);
  ck("  ...a card with no buttons says them in the same place, no bar", strip(without) === strip(withButtons) && first(without) === first(withButtons)
     && !/fm-record-actions/.test(without), without);
  const task = draw(h(RecordCard, { title: "Pool filter clean", status: { text: "Due soon", tone: "tone-warn" }, actions: btn("Done") }));
  const tk = draw(h(RecordCard, { title: "Pump", status: { text: "Ticket in progress", tone: "tone-accent" }, who: "Opened by Owner", actions: btn("Close") }));
  const closed = draw(h(RecordCard, { title: "Pump", status: { text: "Resolved", tone: "tone-quiet" }, who: "Done by Wayan" }));
  const times = (html, words) => html.split(words).length - 1;
  const kinds = { "an Inbox card's state": times(withButtons, "Unavailable"), "an Inbox problem's move": times(withButtons, "Reopened"),
    "an Inbox card with no buttons": times(without, "Unavailable"), "a task's due state": times(task, "Due soon"),
    "a ticket's stage": times(tk, "Ticket in progress"), "a closed ticket's": times(closed, "Resolved") };
  ck("  ...every kind of card says its state exactly once, its first line, in its colour as its strip (green handled, grey closed)",
     Object.values(kinds).every((n) => n === 1) && [withButtons, without, task, tk, closed].every((c) => text(first(c)).length > 1 && !/fm-record-status/.test(strip(c)))
     && /strip-ok/.test(strip(tk)) && /strip-neutral/.test(strip(closed)) && /strip-warn/.test(strip(task))
     && /fm-record-state strip-ok/.test(tk) && /fm-record-state strip-neutral/.test(closed) && /fm-record-state strip-warn/.test(task) && text(inside(tk, "fm-record-who")) === "|[icon]|Opened by Owner|", kinds);
  const css = readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8");
  // a ticket's title can be a sentence: "Device_2623 has been offline for over 8d 3h." (owner, 2026-11-05)
  const long = draw(h(RecordCard, { title: "A device with a long name has been offline for over 8d 3h.", number: "#91-P1", when: "05/11/2026 08:56",
    status: { text: "Ticket in progress", tone: "tone-accent" } }));
  ck("  ...a long name stays in its strip, between its chip and its time; its first line its state alone",
     /fm-record-number">#91-P1<\/span><span class="fm-record-name">A device with a long name has been offline for over 8d 3h\.<\/span><span class="fm-record-when">05\/11\/2026 08:56<\/span><\/div>/.test(long)
     && text(first(long)) === "|Ticket in progress|", long);
  ck("  ...its name wraps two lines at most, then \"…\"; its chip and time never shrink and stay on the first line",
     /\.fm-record-name \{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/.test(css) && !/white-space: nowrap|text-overflow/.test(/\.fm-record-name \{([^}]*)\}/.exec(css)?.[1] ?? "nowrap") && /\.fm-record-strip, \.fm-record-part-head \{[^}]*align-items: flex-start;/.test(css)
     && /:is\(\.fm-record-lead, \.fm-record-number, \.fm-record-when,[^)]*\) \{\s*flex: none; white-space: nowrap;/.test(css));
  ck("  ...short words on a narrow card, the full ones on a wide one: the card is measured, never the bar",
     /\.fm-record \{ container: work-row \/ inline-size; \}/.test(css) && /@container work-row \(max-width: 519px\) \{\s*\.work-long \{ display: none; \}\s*\.work-short \{ display: inline; \}/.test(css));
}

done("✅ every Cockpit list is one card, checked as it is drawn");
