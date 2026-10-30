// THE Cockpit card, DRAWN (architecture review, 2026-10-15): every list — an open issue, a ticket, a closed one, a
// scheduled task, a spend line, work done — is one card (RecordCard), and these checks render it and read what it
// SHOWS. The checks they replace matched the code's text and were rewritten nine times in two days for moves that
// changed nothing on screen; a check here fails only when what the owner sees changes.
import { React, h, draw, inside, btn } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";
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
const head = inside(ticket, "fm-record-head"), body = inside(ticket, "fm-record-body");
ck("its pill on the title line, in its tone's class (a filled pill: .fm-badge.tone-warn, 07-facility.css)",
   /#33 · Test lock unavailable[\s\S]*In progress/.test(head) && /fm-badge tone-warn/.test(head) && !/due-soon/.test(head), head);
ck("  ...its buttons INSIDE the card, on the right of its text (owner, 2026-10-14)",
   /fm-record-actions[\s\S]*Mark resolved[\s\S]*Close/.test(body) && /fm-row-main[\s\S]*fm-record-actions/.test(body)
   && inside(ticket, "fm-record-card").includes("Mark resolved"), body);
ck("  ...the pills and when on one line, then its notes, its cost on the right",
   /fm-meta[\s\S]*Test lock[\s\S]*Opened 2026-10-15 00:08/.test(body) && /What to do: power[\s\S]*Reminder sent/.test(body)
   && /fm-amount">IDR 1,000/.test(body));
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
  actions: h(React.Fragment, null, btn("Open Ticket"), btn("Close")) }));
// owner, 2026-10-22: "show the area right after the device name, as the Spend tab's pills … to save one line"; "remove
// the chevron, it's redundant"
ck("it IS the Cockpit card: its source icons, then its name and its room as a pill on ONE line — no chevron",
   /class="fm-record-card"/.test(issue) && /fm-record-lead[\s\S]*<svg/.test(inside(issue, "fm-record-head"))
   && /<strong>Test lock<\/strong><span class="fm-entity-chip fm-chip-static">Hall<\/span>/.test(issue)
   && !/lucide-chevron-right/.test(issue) && !/fm-record-subtitle/.test(issue), issue.slice(0, 400));
ck("  ...its problem's line on the left, Open Ticket and Close inside on the right of it",
   /fm-row-main[\s\S]*#33 · Test lock unavailable[\s\S]*fm-record-actions[\s\S]*Open Ticket[\s\S]*Close/.test(inside(issue, "fm-record-body")));
ck("  ...it opens the device when tapped (a button), and its buttons stop their own presses",
   /role="button"/.test(issue) && /class="fm-record-actions"/.test(issue));
// owner, 2026-10-22: "instead of `Next check:` show a refresh icon, as a pill, on this same first line, on the right"
ck("  ...its next check a pill at the right of that line: a refresh icon, then when",
   /<\/div><span class="fm-entity-chip fm-chip-static fm-record-check" aria-label="Next check: within 5min \([^"]+\)"><svg[^>]*lucide-refresh-cw[\s\S]*?<\/svg>within 5min<\/span><\/div>$/.test(inside(issue, "fm-record-head")),
   inside(issue, "fm-record-head"));
const { nextCheck } = await import("@/fm/faultTiming");
// at a fixed noon: the soonest of the 02:00 night and the 5-minute look is the night's from 01:55 to 02:00, and this
// check failed those five minutes every night (2026-10-22, 01:58)
const NOON = new Date(2026, 9, 21, 12, 0, 0);
const said = (problems, cadence = CADENCE) => nextCheck(problems, cadence, NOON);
ck("  ...each card says when its problems are read again, the Agent's numbers its own",
   said([{ source: "live" }]) === "Next check: live"
   && said([{ source: "night", check: "nightly" }]) === "Next check: 02:00"
   && said([{ source: "night", check: "nightly" }], { checkMinutes: 15, nightlyAt: "04:30" }) === "Next check: 04:30"
   && said([{ source: "live", fault: { source: "night", check: "minutes" } }]) === "Next check: within 5min"   // offline: rechecked
   && said([{ source: "night", check: "nightly" }, { source: "alert", check: "minutes" }]) === "Next check: within 5min"
   && said([{ source: "alert" }]) === "Next check: within 5min" && said([{ source: "night" }]) === "Next check: within 5min" // older: read at every look now
   && said([{ source: "owner" }]) === "Next check: by hand" && said([{ source: "chat" }]) === "Next check: by hand"
   && said([{ source: "live" }, { source: "guest" }]) === "Next check: by hand"
   && said([{ source: "schedule" }]) === "Next check: by hand"
   && said([{ source: "night", check: "nightly" }], null) === "Next check: by the VESTA Agent");
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
     && nextCheck([{ source: "live" }], CADENCE, t1310) === "Next check: live"
     && nextCheck([{ source: "night", check: "day" }], null, t1310) === "Next check: by the VESTA Agent");
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
  const { buildAttentionItems } = await import("@/config/attention");
  const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");
  const { devicesOf } = await import("../consistency/devices.mjs");
  const ticket = { id: "c1", title: "Door unlocked", status: "open", openedAt: "2026-10-21T06:00:00Z", entityId: "lock.example",
    photoIds: [], closesAt: closes.toISOString() };
  // villa, 2026-10-26: last_changed is the restart of the villa's system — the time is the history's (sinceOf), never it
  const restart = new Date(2026, 9, 21, 14, 44);
  const entities = { "lock.example": { entity_id: "lock.example", state: "locked", attributes: {}, last_changed: restart.toISOString() } };
  const { closingEntities } = await import("@/config/attention");
  const fmData = { ...EMPTY_FM_DATA, tickets: [ticket] };
  const asked = [];
  const items = buildAttentionItems({ devices: devicesOf({ ids: ["lock.example"] }), entities, entityMap: {}, resolvedRooms: {},
    fmData, sinceOf: (id) => (asked.push(id), { at: locked.getTime(), before: false }) });
  const c = items.find((i) => i.ticketId === "c1")?.closing;
  ck("  ...from the fault's closesAt and its device as it reads now, since when from its history (never the restart)",
     c?.at === closes.toISOString() && c?.word === "Locked" && c?.since?.at === locked.getTime()
     && asked.join() === "lock.example" && closingEntities(fmData, entities).join() === "lock.example", c);
  const unread = buildAttentionItems({ devices: devicesOf({ ids: ["lock.example"] }), entities, entityMap: {}, resolvedRooms: {},
    fmData }).find((i) => i.ticketId === "c1")?.closing;
  ck("  ...no history to ask: no time said, never last_changed", unread?.since === null, unread);
  // owner's end-to-end test, 2026-10-30: a lock that was UNAVAILABLE read "Unlocked since before 19 Oct"
  const olderState = (since) => buildAttentionItems({ devices: devicesOf({ ids: ["lock.example"] }), entities, entityMap: {},
    resolvedRooms: {}, fmData, sinceOf: () => since }).find((i) => i.ticketId === "c1")?.closing;
  const before = olderState({ at: Date.parse("2026-10-20T00:00:00Z"), before: false });
  const outOfReach = olderState({ at: Date.parse("2026-10-19T00:00:00Z"), before: true });
  ck("  ...a state older than the problem is not what changed: \"Back to normal\", never its state since then",
     before?.at === closes.toISOString() && before?.word === undefined && outOfReach?.word === undefined, [before, outOfReach]);
  // owner, 2026-10-29: a new alert's row in Messages had no time (nothing told of it yet)
  const { rowTime } = await import("@/config/cockpitCard");
  const opened = items.find((i) => i.ticketId === "c1");
  const fresh = cockpitCard({ ...fault(waiting), items: [opened] }, CADENCE, t1445);
  const toldCard = cockpitCard({ ...fault(waiting), items: [{ ...opened, story }] }, CADENCE, t1445);
  ck("  ...its row says when: the last step told of it, else when it was opened, never nothing",
     rowTime(fresh) === "2026-10-21T06:00:00Z" && rowTime(toldCard) === story[1].at, [rowTime(fresh), rowTime(toldCard)]);
}
ck("  ...said whole, with its moment, by the pill's tooltip (the Kiosk's own: common/Tip)",
   /aria-label="Next check: within 5min \(\d\d\/\d\d\/\d{4} \d\d:\d\d\)"/.test(issue)
   && /<Tip text=\{tip\}>/.test(readFileSync(new URL("../../src/components/fm/RecordCard.tsx", import.meta.url), "utf8"))
   && /<CheckPill when=\{check\.when\} tip=\{check\.tip\} \/>/.test(readFileSync(new URL("../../src/components/fm/RecordCard.tsx", import.meta.url), "utf8")));
// owner, 2026-10-15: "there should always be the room line, to respect a consistent layout"
const [roomless] = groupAttention([{ id: "fault:f9", kind: "fault", title: "Relay dropped", detail: "Fault", entityId: "sensor.relay_t",
  ticketId: "f9", stage: "fault", source: "night", device: { key: "sensor.relay_t", label: "Relay" } }]);
ck("  ...a device no room holds still has its room pill: Other, as By Room files it",
   /<span class="fm-entity-chip fm-chip-static">Other</.test(draw(h(AttentionCard, { card: cockpitCard(roomless, CADENCE), onOpenEntity: () => {} }))));
const lone = draw(h(AttentionCard, { card: cockpitCard({ ...group, entityId: undefined }, CADENCE), onOpenEntity: () => {} }));
ck("  ...a problem with no device: no chevron, nothing to tap, no buttons", !/chevron-right/.test(lone) && !/role="button"/.test(lone) && !/fm-record-actions/.test(lone));

// owner, 2026-10-18: "#55" (its own siren before it) sat further right than "#41" above it (its icons are the card's):
// a line's icon hangs in the card's icon column, so every line's text starts at the same place.
{
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../src/styles/07-facility.css", import.meta.url), "utf8");
  const dev = { key: "lock.door", label: "Door lock", room: "Hall" };
  const [two] = groupAttention([
    { id: "alarm:lock.door", kind: "alarm", title: "Door lock", detail: "Unlocked", entityId: "lock.door", source: "live", device: dev },
    { id: "fault:f1", kind: "fault", title: "#41 · Door unlocked", detail: "Fault", entityId: "lock.door", ticketId: "f1", stage: "fault", source: "alert", device: dev },
    { id: "fault:f2", kind: "fault", title: "#55 · Door unlocked", detail: "Fault", entityId: "lock.door", ticketId: "f2", stage: "fault", source: "alert", device: dev }]);
  const lines = inside(draw(h(AttentionCard, { card: cockpitCard(two, CADENCE), onOpenEntity: () => {} })), "fm-record-body")
    .split('<li class="cockpit-attention-sub">').slice(1);
  const gutter = (css.match(/\.fm-record-head:has\(> \.fm-record-lead\) \+ \.fm-record-body \{ padding-left: (\d+)px/) ?? [])[1];
  const hung = (css.match(/\.fm-record-gutter > \.fm-record-gutter-icon \{[^}]*position: absolute; left: -(\d+)px/) ?? [])[1];
  ck("  ...a line with its own icon starts its text where a line without one does: the icon hangs in the card's icon column",
     // two sources on the card: each line draws its own (config/cockpitCard.cardIcons), both in the icon column
     lines.length === 2 && /siren/.test(lines[1]) && /lucide-radio/.test(lines[0])
     && lines.every((l) => !/cockpit-source-icons/.test(l.replace(/<span class="fm-record-gutter-icon">[\s\S]*?<\/svg><\/span><\/span>/g, "")))
     && !!gutter && gutter === hung, { gutter, hung, lines });
}

// owner, 2026-10-15: "don't skip a line between the room and the next section" — a card without buttons kept a blank
// line: its problem's line was 36 px high, its text centred, under the row's 12 px gap. What the stylesheet says:
{
  const { readFileSync } = await import("node:fs");
  const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8");
  const rule = (text, sel) => (text.match(new RegExp(`^${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`, "m")) ?? [])[1] ?? "";
  ck("  ...its text right under the room: no height of its own on a problem's line, 4 px under the head",
     !/min-height/.test(rule(css("08-shared.css"), ".cockpit-attention-sub-line"))
     && /row-gap: 4px/.test(rule(css("07-facility.css"), ".fm-record-card .fm-record"))
     && /align-items: flex-start/.test(rule(css("07-facility.css"), ".fm-record-body")));
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
ck("its state pill on the title line, Log and the bin inside on the right, its tint on the card",
   /Pool filter clean[\s\S]*Due soon/.test(inside(task, "fm-record-head")) && /fm-record-actions[\s\S]*Log[\s\S]*aria-label="Remove"/.test(task)
   && /class="fm-record-card state-due-soon"/.test(task), task.slice(0, 300));
ck("  ...nothing to erase by holding it (its bin removes it): no hold-to-erase on it", !/fm-erasable/.test(task));

// owner, 2026-10-18: a problem's words ran on, and no button showed the mouse was on it. Drawn: the words cut on one line
// (whole on hover); in the stylesheets: every button lights under the mouse, the card does not light over a button.
// (Each line's own Close went on 2026-10-30: one Done closes everything on the card.)
{
  const { readFileSync } = await import("node:fs");
  const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8");
  const dev = { key: "lock.door4", label: "Door", room: "Hall" };
  const words = "A long problem that has to be cut on one line";
  const [two] = groupAttention([
    { id: "fault:x", kind: "fault", title: words, detail: "Fault", entityId: "lock.door4", ticketId: "x", stage: "fault", source: "alert", device: dev },
    { id: "fault:y", kind: "fault", title: "Another", detail: "Fault", entityId: "lock.door4", ticketId: "y", stage: "fault", source: "alert", device: dev }]);
  const card = draw(h(AttentionCard, { card: cockpitCard(two, CADENCE), onOpenEntity: () => {} }));
  ck("  ...a problem's words sit in one cut line, whole on hover; no line carries a button of its own",
     card.includes(`<span class="cockpit-attention-sub-title">${words}</span>`)
     && /<Tip text=\{line\.text\}><span className="cockpit-attention-sub-title">/.test(readFileSync(new URL("../../src/components/cockpit/IssueCard.tsx", import.meta.url), "utf8"))
     && !card.includes("cockpit-line-act"), card.slice(0, 600));
  const shared = css("08-shared.css"), fac = css("07-facility.css"), base = css("01-base.css");
  ck("  ...cut with \"…\", in the room the line has",
     /\.cockpit-attention-sub-title \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/.test(shared)
     && /\.cockpit-attention-sub-text \{[^}]*flex: 1 1 0;/.test(shared));
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
done("✅ every Cockpit list is one card, checked as it is drawn");
