// THE Cockpit card, DRAWN (architecture review, 2026-10-15): every list — an open issue, a ticket, a closed one, a
// scheduled task, a spend line, work done — is one card (RecordCard), and these checks render it and read what it
// SHOWS. The checks they replace matched the code's text and were rewritten nine times in two days for moves that
// changed nothing on screen; a check here fails only when what the owner sees changes.
import { React, h, draw, inside, btn } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { default: RecordCard } = await import("@/components/fm/RecordCard");
const { AttentionCard } = await import("@/components/cockpit/CockpitOverview");
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
ck("it IS the Cockpit card: title, the room under it, its source icons before it, a chevron",
   /class="fm-record-card"/.test(issue) && /fm-record-lead[\s\S]*<svg/.test(inside(issue, "fm-record-head"))
   && /<strong>Test lock<\/strong>[\s\S]*fm-record-subtitle[^>]*>Hall/.test(issue) && /lucide-chevron-right/.test(issue), issue.slice(0, 400));
ck("  ...its problem's line on the left, Open Ticket and Close inside on the right of it",
   /fm-row-main[\s\S]*#33 · Test lock unavailable[\s\S]*fm-record-actions[\s\S]*Open Ticket[\s\S]*Close/.test(inside(issue, "fm-record-body")));
ck("  ...it opens the device when tapped (a button), and its buttons stop their own presses",
   /role="button"/.test(issue) && /class="fm-record-actions"/.test(issue));
// owner, 2026-10-15: "add a small text on the same line as the room, right below the chevron: Next check"
ck("  ...its Next check on the room's line, right under the chevron",
   /fm-record-side[^>]*><svg[^>]*lucide-chevron-right[\s\S]*?<\/svg><span class="fm-record-aside muted"[^>]*>Next check: within 5 min<\/span>/.test(inside(issue, "fm-record-head")),
   inside(issue, "fm-record-head"));
const { nextCheck } = await import("@/fm/faultTiming");
const said = (problems, cadence = CADENCE) => nextCheck(problems, cadence);
ck("  ...each card says when its problems are read again, the Agent's numbers its own",
   said([{ source: "live" }]) === "Next check: live"
   && said([{ source: "night", check: "nightly" }]) === "Next check: 02:00"
   && said([{ source: "night", check: "nightly" }], { checkMinutes: 15, nightlyAt: "04:30" }) === "Next check: 04:30"
   && said([{ source: "live", fault: { source: "night", check: "minutes" } }]) === "Next check: within 5 min"   // offline: rechecked
   && said([{ source: "night", check: "nightly" }, { source: "alert", check: "minutes" }]) === "Next check: within 5 min"
   && said([{ source: "alert" }]) === "Next check: within 5 min" && said([{ source: "night" }]) === "Next check: within 5 min" // older: read at every look now
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
       .every((p) => nextCheck([p], CADENCE, t1310) === "Next check: within 5 min" && when([p], CADENCE, t1310) === "19/10/2026 13:15"));
  ck("  ...a fault written \"nightly\" keeps its nightly time; beside an every-look fault, the sooner wins",
     nextCheck([{ source: "night", check: "nightly" }], CADENCE, t1310) === "Next check: 02:00"
     && nextCheck([{ source: "night", check: "nightly" }, { source: "alert", check: "minutes" }], CADENCE, t1310) === "Next check: within 5 min"
     && nextCheck([{ source: "live", fault: { source: "night", check: "day" } }], CADENCE, new Date(2026, 9, 19, 1, 58)) === "Next check: within 5 min");
  ck("  ...a live item beside them keeps its rule: the faults decide; live alone stays live; a person's alone: by hand",
     nextCheck([{ source: "live" }, { source: "night", check: "minutes" }], CADENCE, t1310) === "Next check: within 5 min"
     && nextCheck([{ source: "live" }], CADENCE, t1310) === "Next check: live"
     && nextCheck([{ source: "night", check: "day" }], null, t1310) === "Next check: by the VESTA Agent");
}
ck("  ...drawn as the hover text of the card's Next check", /<span class="fm-record-aside muted" title="\d\d\/\d\d\/\d{4} \d\d:\d\d">Next check/.test(issue));
// owner, 2026-10-15: "there should always be the room line, to respect a consistent layout"
const [roomless] = groupAttention([{ id: "fault:f9", kind: "fault", title: "Relay dropped", detail: "Fault", entityId: "sensor.relay_t",
  ticketId: "f9", stage: "fault", source: "night", device: { key: "sensor.relay_t", label: "Relay" } }]);
ck("  ...a device no room holds still has its room line: Other, as By Room files it",
   /fm-record-subtitle[^>]*>Other</.test(draw(h(AttentionCard, { card: cockpitCard(roomless, CADENCE), onOpenEntity: () => {} }))));
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
     lines.length === 2 && /siren/.test(lines[1]) && !/<svg/.test(lines[0])
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
     faultTitle(t, at("2026-10-15T11:00:00Z")) === "Sensor offline for 6 d 2 h."
     && faultTitle(t, at("2026-10-09T10:15:00Z")) === "Sensor offline for 1 h 15 min."
     && faultTitle({ ...t, alertNumber: 5 }, at("2026-10-15T11:00:00Z")) === "#5 · Sensor offline for 6 d 2 h."
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

// owner, 2026-10-18: a problem's question was squeezed beside its words with full-size buttons, the words ran on, and
// no button showed the mouse was on it. Drawn: the words cut on one line (whole on hover), a line's own buttons in
// their own slot; in the stylesheets: every button lights under the mouse, the card does not light over a button.
{
  const { readFileSync } = await import("node:fs");
  const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8");
  const dev = { key: "lock.door4", label: "Door", room: "Hall" };
  const words = "A long problem that has to be cut on one line";
  const [two] = groupAttention([
    { id: "fault:x", kind: "fault", title: words, detail: "Fault", entityId: "lock.door4", ticketId: "x", stage: "fault", source: "alert", device: dev },
    { id: "fault:y", kind: "fault", title: "Another", detail: "Fault", entityId: "lock.door4", ticketId: "y", stage: "fault", source: "alert", device: dev }]);
  const card = draw(h(AttentionCard, { card: cockpitCard(two, CADENCE), onOpenEntity: () => {}, lineActions: () => btn("Close") }));
  ck("  ...a problem's words sit in one cut line, whole on hover; its own Close in its own slot beside them",
     card.includes(`<span class="cockpit-attention-sub-title" title="${words}">${words}</span>`)
     && (card.match(/<span class="cockpit-line-act">/g) ?? []).length === 2, card.slice(0, 600));
  const shared = css("08-shared.css"), fac = css("07-facility.css"), base = css("01-base.css");
  ck("  ...cut with \"…\", and the cut words never push a line's Close off its line",
     /\.cockpit-attention-sub-title \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/.test(shared)
     && /\.cockpit-attention-sub-text \{[^}]*flex: 1 1 0;/.test(shared));
  ck("  ...a line's question gets a row of its own, its two small buttons together",
     /\.cockpit-line-act:has\(> \.modal-actions\) \{ flex: 1 1 100%; \}/.test(fac)
     && /\.cockpit-line-act \.modal-actions \{[^}]*flex-wrap: nowrap;/.test(fac) && /\.cockpit-line-act \.modal-actions \.btn \{ min-height: 0;/.test(fac));
  ck("every button lights under the mouse, and the card does not light while the mouse is on any of its buttons",
     /@media \(hover: hover\) \{\s*\.btn:hover:not\(:disabled\) \{/.test(base)
     && /\.fm-record-card:has\(> \.fm-openable\):hover:not\(:has\(\.fm-record-actions:hover\)\):not\(:has\(button:hover\)\)/.test(fac));
}

done("✅ every Cockpit list is one card, checked as it is drawn");
