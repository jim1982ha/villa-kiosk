// The Cockpit's Messages tab (ticket 17 of "One inbox", owner 2026-10-28): one pure model turns the open issues, the
// watched faults and the villa's announcements into what the tab lists, its filters' counts and the item open on the
// right. Every Messages screen reads it. Driven by value; placeholder titles.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { h, draw } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
const { messagesView, mergeAnnouncements, FILTERS, messagePlaces, readAtOpening, openingFilter, followingFilter, shownTogether,
  afterRead, cardsOfIssue } = await import("@/messages/messagesModel");
// the unread mark, as the page's provider reads it (messagePlaces), `issues` the open issues
const unreadOf = (kept, read, issues = []) => messagePlaces({ open: issues, watched: [], announcements: kept, read }).unread;
const { parseVestaMessage, inLanguage } = await import("@/messages/announcements");
const { noticeStep, NO_NOTICE } = await import("@/messages/noticeModel");

const card = (key, extra = {}) => ({ key, title: `Device ${key}`, lead: null, nextCheck: null, actions: [], lines: [], ...extra });
const ann = (seq, extra = {}) => ({ seq, at: `2026-10-28T1${seq % 10}:00:00+08:00`, title: `T${seq}`, to: "", text: "",
  status: "", photo: null, key: null, buttons: [], ...extra });
const J = JSON.stringify;

console.log("  the filters, on one line:");
ck("Issues · Notifications · Reports, in that order, no All (owner, 2026-10-30; 2026-11-01: \"Notifications if it fits\", else \"Notifs\"; 2026-10-28: \"Issues\" holds open, watched and closed; ticket 20: Reports)",
   J(FILTERS.map((f) => f.label)) === J(["Issues", "Notifications", "Reports"]) && J(FILTERS.map((f) => f.short ?? null)) === J([null, "Notifs", null]));
const base = { open: [card("a"), card("b")], watched: [card("w", { look: "watched" })], announcements: [ann(1), ann(2), ann(3)] };
const issues = messagesView({ ...base, filter: "issues", selected: null });
ck("  ...Issues counts the open issues only (the watched never counted); the others no count",
   J(issues.filters.map((f) => [f.id, f.count])) === J([["issues", 2], ["notifications", null], ["reports", null]]), issues.filters);

console.log("\n  what each filter lists:");
ck("Issues: the open issues in their order, the watched folded after them, no notification",
   J(issues.issues.map((i) => i.key)) === J(["a", "b"]) && J(issues.watched.map((i) => i.key)) === J(["w"])
   && issues.notifications.length === 0, issues);
const notes = messagesView({ ...base, filter: "notifications", selected: null });
ck("  ...Notifications: the notifications alone, newest first", notes.issues.length === 0 && notes.watched.length === 0
   && J(notes.notifications.map((i) => i.key)) === J(["n3", "n2", "n1"]), notes);

console.log("\n  the card open:");
ck("the one asked for, wherever it is listed (an issue, a watched fault, a notification)",
   messagesView({ ...base, filter: "issues", selected: "b" }).selected?.key === "b"
   && messagesView({ ...base, filter: "issues", selected: "w" }).selected?.key === "w"
   && messagesView({ ...base, filter: "notifications", selected: "n2" }).selected?.key === "n2");
// owner, 2026-11-01: "directly display the cards (in their collapsed version)"
ck("  ...none asked: every card folded",
   issues.selected === null && notes.selected === null
   && messagesView({ open: [], watched: [], announcements: [], filter: "issues", selected: null }).selected === null);
ck("  ...one the filter does not list is not kept: every card folded",
   messagesView({ ...base, filter: "notifications", selected: "a" }).selected === null);
ck("  ...one gone (an issue that cleared) leaves no other open in its place",
   messagesView({ ...base, filter: "issues", selected: "gone" }).selected === null);
ck("which parts each filter shows (the tab draws those, never its own rule)",
   J(issues.shows) === J({ issues: true, notifications: false, reports: false })
   && J(notes.shows) === J({ issues: false, notifications: true, reports: false }));

console.log("\n  the facility manager's reports (ticket 20 of \"One inbox\"):");
const digest = parseVestaMessage({ seq: 30, at: "2026-10-29T07:00:00+08:00", key: "note:d1", title: "Daily digest", to: "FM",
  body: "New since yesterday", report: "reports:fm-daily" });
// a tablet reads VESTA's records through the provider's one pick (announcements.inLanguage), English by default
const weeklyAsWritten = parseVestaMessage({ seq: 31, at: "2026-10-29T08:00:00+08:00", key: "note:w1", title: "Weekly report", to: "FM",
  body: "Deux choses", report: "reports:fm-weekly", page: "page-fr-0001", language: "fr",
  languages: { en: { body: "Two things", page: "page-en-0001" }, de: { body: "Zwei", page: "page-de-0001" } } });
const weekly = weeklyAsWritten && inLanguage(weeklyAsWritten, "en");
const french = inLanguage(parseVestaMessage({ seq: 32, at: "2026-10-29T08:01:00+08:00", key: "note:w2", title: "Rapport", to: "FM",
  body: "Trois choses", report: "reports:fm-weekly", page: "page-fr-0002", language: "fr",
  languages: { de: { body: "Drei", page: "page-de-0002" } } }), "en");
const card91 = parseVestaMessage({ seq: 33, at: "2026-10-29T09:00:00+08:00", key: "incident:91", title: "#91-P2 (new)",
  body: "Door open", status: ["⚠️ New alert"], stage: "new" });
ck("a report is read with its job and its page; a card is no report",
   digest?.report === "reports:fm-daily" && !digest.page && french?.page === "page-fr-0002" && !card91?.report, [digest, french]);
ck("  ...shown in the tablet's language (English) when VESTA wrote it, its page with it",
   weekly?.text === "Two things" && weekly.page === "page-en-0001", weekly);
ck("  ...else in the language it was written in, with that language's page",
   french?.text === "Trois choses" && french.page === "page-fr-0002", french);
const withReports = { ...base, announcements: [ann(1), digest, weekly, french, card91] };
const onReports = messagesView({ ...withReports, filter: "reports", selected: null });
ck("Reports lists the reports alone, newest first, folded",
   J(onReports.reports.map((i) => i.announcement.seq)) === J([32, 31, 30]) && onReports.notifications.length === 0
   && onReports.issues.length === 0 && onReports.selected === null,
   onReports);
const onNotes = messagesView({ ...withReports, filter: "notifications", selected: null });
ck("  ...a report is never also a notification (one place per thing)",
   J(onNotes.notifications.map((i) => i.announcement.seq)) === J([33, 1]) && onNotes.reports.length === 0, onNotes.notifications);
const asked = messagesView({ ...withReports, filter: "reports", selected: "v:note:d1" });
ck("  ...one asked for opens on Reports",
   asked.reports.length === 3 && asked.selected?.key === "v:note:d1", asked.reports);
ck("  ...Messages opens on Reports when only reports are unread, on Notifications when anything else is",
   openingFilter(2, {}, 2) === "reports" && openingFilter(3, {}, 2) === "notifications" && openingFilter(2, { warning: true }, 2) === "issues");

console.log("\n  a ring and its rewrite are one notification:");
const ring = ann(4, { key: "run-1", status: "⚠️ New alert" });
const rewrite = ann(6, { key: "run-1", status: "✅ Opened at 14:05:10" });
const merged = mergeAnnouncements([ann(1), ring, ann(5)], [rewrite]);
ck("the rewrite (same key, a new number) replaces the ring it rewrites, at its own place in time",
   J(merged.map((a) => a.seq)) === J([1, 5, 6]) && merged.find((a) => a.key === "run-1")?.status === "✅ Opened at 14:05:10", merged);
ck("  ...one without a key is its own line, and one already held is not listed twice",
   J(mergeAnnouncements([ann(1)], [ann(1), ann(2)]).map((a) => a.seq)) === J([1, 2]));
ck("  ...an older copy arriving late never replaces the newer",
   mergeAnnouncements([rewrite], [ring])[0].status === "✅ Opened at 14:05:10");

console.log("\n  unread, per tablet (ticket 18 of \"One inbox\"):");
const kept3 = [ann(1), ann(2), ann(3)];
const seen = readAtOpening([], kept3);
ck("an announcement not yet read on this tablet is unread; once the Cockpit opened it is read",
   unreadOf(kept3, []) === 3 && unreadOf(kept3, seen) === 0, seen);
const kept4 = [...kept3, ann(4)];
ck("  ...a new one makes one unread, the ones already shown stay read", unreadOf(kept4, seen) === 1);
const rung = ann(5, { key: "run-1" });
const rewritten = ann(7, { key: "run-1", at: "2026-10-28T19:00:00+08:00" });
ck("  ...a rewrite of one already read is news again (it came with a new number): unread",
   unreadOf([rewritten], readAtOpening([], [rung])) === 1);
const restarted = ann(1, { at: "2026-10-29T08:00:00+08:00" });
ck("  ...the add-on's store started again: its first new one, with an old number, is unread",
   unreadOf([restarted], readAtOpening([], [ann(1)])) === 1);
const pruned = readAtOpening(seen, [ann(3), ann(4)]);
ck("  ...the list keeps only what the add-on still keeps (it never grows past it)", pruned.length === 2, pruned);

ck("something unread: Messages opens on Notifications; nothing unread, on Issues (the default)",
   openingFilter(1) === "notifications" && openingFilter(0) === "issues");
ck("  ...opened for a device window's warning, never on Notifications, so nothing is read unseen: on Issues",
   openingFilter(1, { warning: true }) === "issues"
   && openingFilter(0, { warning: true }) === "issues");

console.log("\n  one line per item, drawn:");
const { InboxCard } = await import("@/components/cockpit/MessagesTab");
// an issue whole, a notification or a report folded until tapped (owner, 2026-11-01)
const listed = (item) => draw(h(InboxCard, { item, opened: item.kind === "issue", onToggle: item.kind === "issue" ? undefined : () => {}, canManage: false, onOpenEntity() {}, onEditTicket() {}, onRaiseTicket() {} }));
const issueLine = listed({ kind: "issue", key: "a", card: card("a", { room: "Kitchen",
  lines: [{ key: "l", text: "Too warm", icons: null, story: [], closing: null, actions: [] }] }) });
// owner, 2026-11-01: the room the opened card's pill (RecordCard Pill), on its own line; then its first problem
const { Pill } = await import("@/components/fm/RecordCard");
const pill = draw(h(Pill, { text: "Kitchen" }));
ck("an open issue: its device; its room, the opened card's own pill, on the line under; then its first problem",
   /class="fm-record-card/.test(issueLine) && issueLine.includes("<strong>Device a</strong>") && !/role="button"/.test(issueLine)
   && issueLine.includes(`<span class="card-pill-line">${pill}</span>`) && pill.includes("fm-entity-chip")
   && issueLine.includes('<span class="cockpit-attention-sub-title">Too warm</span>')
   && issueLine.indexOf("card-pill-line") < issueLine.indexOf("cockpit-attention-sub-title"), issueLine);
{
  const { AttentionCard } = await import("@/components/cockpit/IssueCard");
  const opened = draw(h(AttentionCard, { card: card("a", { room: "Kitchen", lines: [{ key: "l", text: "Too warm", story: [], closing: null }] }),
    onOpenEntity() {} }));
  ck("  ...the opened card draws its room with the same pill", opened.includes(pill), opened);
}
const noteLine = listed({ kind: "notification", key: "n1", announcement: ann(1, { title: "🔔 Visitor",
  text: "Someone is at the door.\nGate A", at: "2026-10-28T10:00:00+08:00" }) });
ck("  ...a notification, folded: the same card: its title, its first words, when it came, as a pill",
   /class="fm-record-card/.test(noteLine) && noteLine.includes("<strong>🔔 Visitor</strong>") && !noteLine.includes("card-pill-line") && noteLine.includes('<span class="fm-card-folded">Someone is at the door.</span>')
   && !noteLine.includes("Gate A") && /fm-record-check">28\/10\/2026 \d\d:00</.test(noteLine), noteLine);

{
  // owner, 2026-11-01: "show their number between () in the tab Ticket label"
  const { default: ModalTabs } = await import("@/components/common/ModalTabs");
  const { Wrench, Inbox } = await import("lucide-react");
  const strip = (n) => draw(h(ModalTabs, { tabs: [{ id: "messages", label: "Inbox", icon: Inbox }, { id: "tickets", label: "Tickets", icon: Wrench }],
    active: "messages", onSelect() {}, label: "x", counts: { tickets: n } }));
  ck("the Tickets tab says how many are in progress: \"Tickets (3)\"; none, its name alone",
     strip(3).includes("<span>Tickets (3)</span>") && strip(0).includes("<span>Tickets</span>") && strip(3).includes("<span>Inbox</span>"), strip(3));
  const modalSrc = readFileSync(new URL("../../src/components/cockpit/CockpitModal.tsx", import.meta.url), "utf8");
  ck("  ...counted as the tab's own \"in progress\" figure is (openCounts), on the window's strip",
     /openCounts\(data\.tickets, deviceOfRecord\)\.tickets/.test(modalSrc) && /counts=\{\{ tickets: ticketsOpen \}\}/.test(modalSrc));
}

console.log("\n  the window and the tab read the model:");
const { parseTsx, elements, guardsOf, propText } = await import("../consistency/jsx.mjs");
const modal = parseTsx("components/cockpit/CockpitModal.tsx");
const strip = elements(modal, "ModalTabs")[0];
ck("a guest (one tab, Messages) gets no tab strip: the strip is drawn only with more than one tab",
   !!strip && guardsOf(strip).some((g) => /tabs\.length > 1/.test(g)), strip && guardsOf(strip));
const tab = readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8");
ck("  ...the tab lists, counts and opens what messagesView says, from the open issues and the page's announcements",
   /const \{ kept, unread, unreadReports \} = useAnnouncements\(\);/.test(tab) && /messagesView\(\{\s*open, watched, closed, announcements: kept, filter, selected \}/.test(tab)
   && /view\.filters\.map\(/.test(tab) && /const item = view\.selected;/.test(tab)
   && /const \{ issues: showsIssues, notifications: showsNotes, reports: showsReports \} = view\.shows;/.test(tab));

{
  // owner, 2026-11-01: "I expect to see them go in the closed section"
  const gone = card("closed:f", { look: "closed", closedAt: "2026-10-30T10:00:00+08:00", nextCheck: null, lines: [{ key: "l", text: "Pump", story: [], closing: "Done" }] });
  const told = card("closed:g", { look: "closed", closedAt: "2026-10-30T10:00:00+08:00", nextCheck: null, lines: [{ key: "m", text: "Lock", story: [], alertNumber: 90, closing: "Done" }] });
  const msg = ann(50, { feed: "vesta", key: "incident:90", at: "2026-10-31T10:00:00+08:00", status: "✅ Closed" });
  const v = messagesView({ ...base, announcements: [], closed: [gone, told], filter: "issues", selected: null });
  const w = messagesView({ ...base, announcements: [msg], closed: [gone, told], filter: "issues", selected: null });
  ck("a fault that left Watch is in Closed, a card of its own", v.closed.map((i) => i.key).join() === "closed:f,closed:g", v.closed);
  ck("  ...one VESTA holds a message for is listed once, by that message", !w.closed.some((i) => i.key === "closed:g"), w.closed);
}

{
  // owner, 2026-11-01: "shall not have a collapsed version", "the header … shall always be visible"
  const propsOf = elements(parseTsx("components/cockpit/MessagesTab.tsx"), "InboxCard")[0];
  const css = readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8");
  ck("under Issues every card is whole and not pressed; a notification or a report folds",
     propText(propsOf, "opened") === "showsIssues || item?.key === i.key" && /^showsIssues \? undefined : /.test(propText(propsOf, "onToggle")), propText(propsOf, "onToggle"));
  ck("  ...and the filters' line stays in view, over what scrolls", /\.messages-toolbar \{[^}]*position: sticky; top: 0;[^}]*background: var\(--bg-modal\);/.test(css));
}

console.log("\n  opening the Cockpit clears the unread mark (owner, 2026-10-31):");
{
  // twelve notifications (a page holds ten: two on page 2), two reports, VESTA's card at a reminder step
  const notes12 = Array.from({ length: 12 }, (_, i) => ann(i + 1));
  const reports2 = [ann(20, { feed: "vesta", key: "note:r1", report: "weekly" }), ann(21, { feed: "vesta", key: "note:r2", report: "weekly" })];
  const step = parseVestaMessage({ seq: 22, at: "2026-10-31T09:00:00+08:00", key: "incident:95", title: "#95-P2 (existing)",
    body: "Door", status: ["⚠️ ⚙️ Reminder sent"], stage: "existing" });
  const keptNow = [...notes12, ...reports2, step];
  const before = unreadOf(keptNow, []), beforeReports = unreadOf(keptNow.filter((a) => !!a.report), []);
  const read = readAtOpening([], keptNow);
  ck("unread on page 2, under Reports and at a reminder step: the Cockpit opened, the mark is out",
     before === 15 && beforeReports === 2
     && unreadOf(keptNow, read) === 0 && unreadOf(keptNow.filter((a) => !!a.report), read) === 0, { before, read });
  ck("  ...the Inbox opens on Notifications all the same: its filter is picked from what was unread before the opening",
     openingFilter(before, {}, beforeReports) === "notifications"
     && followingFilter(openingFilter(before, {}, beforeReports), unreadOf(keptNow, read)) === "notifications");
  ck("  ...on Reports when only reports were unread; on Issues when nothing was",
     openingFilter(beforeReports, {}, beforeReports) === "reports" && openingFilter(0) === "issues");
  const later = [...keptNow, ann(30, { at: "2026-10-31T10:00:00+08:00" })];
  const nextStep = [...keptNow.filter((a) => a !== step), { ...step, seq: 23, status: "🚨 Escalated" }];
  ck("  ...something after the opening lights it again: a new one, or VESTA's card at a new step",
     unreadOf(later, read) === 1 && unreadOf(nextStep, read) === 1);
  ck("  ...and the open Inbox follows it to Notifications unless a filter was chosen",
     followingFilter("issues", 1) === "notifications" && followingFilter("issues", 0) === "issues");
  ck("  ...opening again with nothing new gives the same list, in the order it was read (so nothing draws again)",
     J(readAtOpening(read, keptNow)) === J(read) && J(readAtOpening(["gone@1", ...read], keptNow)) === J(read)
     && J(readAtOpening([...read].reverse(), keptNow)) === J([...read].reverse()));
  // the wiring, read through the compiler's tree (whatever its layout): the window's one opening, the page's one mark
  const ts = (await import("typescript")).default;
  const { parseTsx: tree } = await import("../consistency/jsx.mjs");
  const calls = (t, name) => { const out = []; const v = (n) => { if (ts.isCallExpression(n) && n.expression.getText() === name) out.push(n); ts.forEachChild(n, v); }; v(t); return out; };
  const cockpit = tree("components/cockpit/CockpitModal.tsx");
  const fromHook = calls(cockpit, "useAnnouncements").map((c) => c.parent).filter(ts.isVariableDeclaration)
    .map((d) => d.name.getText().replace(/\s+/g, " "));
  const onOpen = calls(cockpit, "useEffect").filter((c) => calls(c.arguments[0], "opened").length > 0);
  ck("  ...the Cockpit window marks it once, at its opening, whichever tab it opens on",
     fromHook.join() === "{ opened }" && onOpen.length === 1 && onOpen[0].arguments[1]?.getText() === "[]"
     && calls(cockpit, "opened").length === 1, { fromHook, effects: onOpen.map((c) => c.getText()) });
  const ctxTree = tree("messages/AnnouncementsContext.tsx");
  const marks = calls(ctxTree, "readAtOpening");
  let holder = marks[0];
  while (holder && !(ts.isVariableDeclaration(holder) && holder.name.getText() === "opened")) holder = holder.parent;
  ck("  ...the page's mark is readAtOpening, of what it had read and what is kept, only when the window opens",
     marks.length === 1 && marks[0].arguments.map((a) => a.getText()).join() === "r,kept" && !!holder
     && calls(holder, "setRead").length === 1, marks.map((m) => m.getText()));
}

console.log("\n  the unread mark, drawn where the model says (ticket 18):");
const hud = parseTsx("components/hud/HUD.tsx");
const mark = elements(hud, "span").find((e) => propText(e, "className") === '"unread-mark"');
ck("the light mark is drawn only while something is unread, the count read from the page's announcements",
   !!mark && guardsOf(mark).some((g) => /^unread > 0$/.test(g))
   && /const \{ unread \} = useAnnouncements\(\);/.test(hud.getText()), mark && guardsOf(mark));
const buttons = elements(hud, "button");
const holds = (pick) => buttons.filter(pick).some((b) => b.getText().includes("{unreadMark}"));
ck("  ...on the robot, apart from its count of open issues", holds((b) => propText(b, "onClick") === "onOpenCockpit"));
ck("  ...on a phone, on the gear and on the menu's Cockpit row",
   holds((b) => /Menu/.test(propText(b, "aria-label") ?? "")) && holds((b) => propText(b, "role") === '"menuitem"'
     && /onOpenCockpit\(\)/.test(propText(b, "onClick") ?? "")));
ck("Messages opens where the model says, and marks nothing itself (the Cockpit's opening does: readAtOpening)",
   /useState<MessagesFilter>\(\(\) => openingFilter\(unread, opening, unreadReports\)\)/.test(tab) && !/shown\(/.test(tab)
   // ...and until a filter is chosen it follows what is unread (VESTA's feed read after the Cockpit opened)
   && /if \(!chosen\) setFilter\(\(f\) => followingFilter\(f, unread, opening, unreadReports\)\);/.test(tab)
   && /onClick=\{\(\) => pickFilter\(f\.id\)\}/.test(tab));

console.log("\n  a report, drawn (ticket 20):");
const { NoteDetail, ReportDetail } = await import("@/components/cockpit/MessagesTab");
globalThis.window = globalThis.window ?? { location: { pathname: "/" } };   // the add-on's own address (no Ingress prefix)
const opened = draw(h(ReportDetail, { announcement: weekly, canOpenPage: true }));
// ⚠️ THE COCKPIT'S ONE CARD (owner, 2026-10-29: "notification cards shall use the same shared card component used across
// all Cockpit lists"): its frame, title and when as an issue's, its buttons under its words
{
  const ring = ann(9, { title: "🔔 Visitor", text: "Someone is at the door.", key: "R1",
    buttons: [{ label: "Unlock", command: "/unlock" }] });
  const card = draw(h(NoteDetail, { announcement: ring }));
  ck("an open notification is the shared card (RecordCard): its title in the card's head, its words in its body, its "
     + "buttons in the card's own row", /class="fm-record-card"/.test(card) && /fm-record-head[\s\S]*🔔 Visitor/.test(card)
     && /fm-record-body[\s\S]*Someone is at the door\.[\s\S]*fm-record-actions[\s\S]*Unlock/.test(card), card);
  ck("  ...a report too", /class="fm-record-card"/.test(opened));
  // it owns its press (architecture review 2026-10-29 #4): no screen passes one, so a card wherever it shows (an issue's
  // VESTA card, a report) draws the buttons it carries
  ck("  ...its buttons drawn with no press handed in: the card presses them itself",
     /fm-record-actions[\s\S]*Unlock/.test(draw(h(NoteDetail, { announcement: ring }))));
}
// ⚠️ AN ALERT'S ISSUE IS ONE CARD (owner, 2026-10-29: "no need to split the card into 2 distinct components, since the
// same button shall consistently appear for any type"): the issue's head, VESTA's message in its line, every card's
// buttons. ⚠️ AND IT IS TOLD ONCE (architecture review round 13): the issue is joined to VESTA's messages in the model
// (issueAsTold), and the row, the opened card and the Watch card read the same lines.
{
  const { AttentionCard, CockpitAttentionRow } = await import("@/components/cockpit/IssueCard");
  const { issueAsTold, messageOfLine } = await import("@/messages/messagesModel");
  const { elements, guardsOf, parseTsx } = await import("../consistency/jsx.mjs");
  const alert = parseVestaMessage({ seq: 30, key: "incident:92", title: "#92-P2 (new)", to: "To: Facility manager",
    body: "The pool pump stopped.", status: ["⚠️ New alert"],
    buttons: [{ label: "Done", kind: "i", id: "92:done" }, { label: "Need help", kind: "i", id: "92:need_help" }] });
  const issue = card("p", { lines: [{ key: "l1", text: "Pump stopped", story: [{ at: "2026-10-29T10:00:00+08:00",
    note: "SHORT STORY" }], alertNumber: 92 }] });
  const told = (c, kept = [alert]) => issueAsTold(c, kept);
  const drawn = draw(h(AttentionCard, { card: told(issue), onOpenEntity() {} }));
  ck("an alert's issue is ONE card: the issue's head, VESTA's message inside its line, in place of its short story",
     (drawn.match(/class="fm-record-card/g) ?? []).length === 1 && /fm-record-head[\s\S]*Device p/.test(drawn)
     && drawn.includes("The pool pump stopped.") && !drawn.includes("SHORT STORY"), drawn);
  const watched = draw(h(AttentionCard, { card: told({ ...issue, look: "watched", lines: [{ ...issue.lines[0],
    text: "#92-P2 · LINE WORDS", closing: "CLOSING WORDS" }] }), onOpenEntity() {} }));
  ck("  ...each thing said once: the line named by VESTA's title, its words and how it closed in VESTA's message "
     + "(owner, 2026-10-29 screenshot)", watched.includes("#92-P2 (new)") && !watched.includes("LINE WORDS")
     && !watched.includes("CLOSING WORDS"), watched);
  ck("  ...an open issue's \"closes at about …\" kept (VESTA's message does not say it)",
     draw(h(AttentionCard, { card: told({ ...issue, lines: [{ ...issue.lines[0], closing: "CLOSES SOON" }] }),
       onOpenEntity() {} })).includes("CLOSES SOON"));
  ck("  ...a line whose alert VESTA holds no card for keeps its story", messageOfLine(issue.lines[0], []) === null
     && draw(h(AttentionCard, { card: told(issue, []), onOpenEntity() {} })).includes("SHORT STORY"));
  // owner, 2026-10-30: the onsen pump's night-check line, drawn under #96's Status, "feels like it belongs to the
  // history section": another problem of the device comes first, as "Also: …", then the alert with its icon
  const both = { ...issue, lead: { sources: ["alert", "night"], severities: ["warn", "warn"] }, lines: [
    { ...issue.lines[0], own: { sources: ["alert"], severities: ["warn"] } },
    { key: "l2", text: "Pump ran shorter than expected", story: [], own: { sources: ["night"], severities: ["warn"] } }] };
  const two = draw(h(AttentionCard, { card: told(both), onOpenEntity() {} }));
  const at = (t) => two.indexOf(t);
  ck("  ...a device's other problem comes first, \"Also: …\", then the alert's message, never under its Status",
     at("Also: Pump ran shorter than expected") > -1 && at("Also: Pump ran shorter than expected") < at("#92-P2 (new)")
     && at("#92-P2 (new)") < at("The pool pump stopped.")
     && (two.match(/fm-record-gutter-icon/g) ?? []).length === 2, two);
  // owner, 2026-10-30: "i see twice the same icons in the cards" — each icon drawn once in an open card
  const icons = (two.match(/fm-record-gutter-icon|cockpit-source-icons/g) ?? []).length;
  const sourcesDrawn = (two.match(/cockpit-attention-icon/g) ?? []).length;
  ck("  ...each icon once in the open card: the lines' own, none repeated before its name",
     sourcesDrawn === 2 && icons >= 2, [sourcesDrawn, icons]);
  ck("  ...and the card keeps its icon column, so the lines' icons stay inside it (owner, 2026-10-30)",
     /class="fm-record-lead"/.test(two), two);
  ck("  ...a card with only the alert says no \"Also\"", !draw(h(AttentionCard, { card: told(issue), onOpenEntity() {} })).includes("Also:"));
  // owner, 2026-10-30: "a unique configuration … Done / Need Help / Open Ticket consistently for all of them" — the alert's
  // card drew VESTA's own Done · Need help, a fault's Open Ticket · Close
  const ic = parseTsx("components/cockpit/IssueCard.tsx");
  ck("  ...its buttons the row of every issue card (LineActions, each problem's Done · Need help · Open Ticket), never VESTA's own",
     elements(ic, "LineActions").length === 1 && elements(ic, "RecordButtons").length === 0);
  const tab = parseTsx("components/cockpit/MessagesTab.tsx");
  ck("  ...the Inbox draws every issue, alert or not, watched or not, as THE issue card (a watched one has no buttons to draw)",
     elements(tab, "CockpitAttentionRow").length === 1 && elements(tab, "AttentionCard").length === 0
     && elements(tab, "NoteDetail").every((e) => !/cardsOfIssue|messageOfLine/.test(e.getText())));

  console.log("\n  the row, the opened card and the Watch card say an alert alike (architecture review round 13):");
  // the review's case: the lock missing from the villa's system, its alert taken on, another problem of the device
  const lock = card("lock", { lines: [
    { key: "fault:t1", text: "In progress: #100-P1 · Outdoor entrance lock is missing",
      story: [{ at: "2026-11-01T08:00:00+08:00", note: "Ticket opened in the Cockpit" }], alertNumber: 100, closing: null },
    { key: "night:x", text: "Battery low", story: [], closing: null }], status: [{ text: "Missing", tone: "tone-warn" }, { text: "In progress", tone: "tone-warn" }] });
  const msg100 = parseVestaMessage({ seq: 40, key: "incident:100", title: "#100-P1 (existing)", to: "To: Owner",
    body: "The outdoor entrance lock is missing.", status: ["⚠️ New alert"], buttons: [] });
  const msg92 = parseVestaMessage({ seq: 41, key: "incident:92", title: "#92-P2 (cleared)", to: "To: Owner",
    body: "The pool pump runs again.", status: ["✅ Cleared"], buttons: [] });
  const pumpWatch = card("watched:p", { look: "watched", lines: [{ key: "fault:p", text: "#92-P2 · Pool pump stopped",
    story: [], alertNumber: 92, closing: "Done on 01/11/2026 09:00 (JM)" }] });
  const v = messagesView({ open: [lock], watched: [pumpWatch], announcements: [msg100, msg92], filter: "issues", selected: null });
  const words = (html, cls) => (html.match(new RegExp(`class="${cls}">([^<]*)<`)) ?? [])[1];
  const lines = (html) => [...html.matchAll(/class="cockpit-attention-sub-title">([^<]*)</g)].map((m) => m[1]);
  for (const [what, item, Card] of [["an open issue", v.issues[0], CockpitAttentionRow], ["a watched one", v.watched[0], AttentionCard]]) {
    const row = listed(item);
    const opened = draw(h(Card, { card: item.card, onOpenEntity() {}, canManage: false, onEditTicket() {}, onRaiseTicket() {} }));
    const alertName = lines(opened).find((l) => l.includes("#"));
    ck(`${what}: listed and drawn alone it names the alert as Telegram does, in the same words`,
       !!alertName && lines(row).includes(alertName) && /^#(100-P1|92-P2) \(/.test(alertName), { row: lines(row), card: lines(opened) });
  }
  {
    // owner, 2026-11-01: "isn't it already covered by the 2 above lines ?"
    const same = card("same", { lines: [
      { key: "a", text: "x", story: [], alertNumber: 100, closing: null, own: { sources: ["alert"], severities: ["warn"] }, records: [{ id: "r1", stage: "fault" }] },
      { key: "n", text: "the outdoor entrance lock is missing", story: [], closing: null, own: { sources: ["night"], severities: ["warn"] }, records: [{ id: "r2", stage: "fault" }] },
      { key: "o", text: "Battery low", story: [], closing: null, own: { sources: ["night"], severities: ["warn"] } }] });
    const told = messagesView({ open: [same], watched: [], announcements: [msg100], filter: "issues", selected: null }).issues[0].card;
    ck("a problem an alert tells already is no \"Also\": its words go, its icon stays on the alert; another stays",
       told.lines.map((l) => l.text).join("|") === "Also: Battery low|#100-P1 (existing)" && told.lines[1].own.sources.join() === "alert,night", told.lines);
    ck("  ...and its record: the alert's Done closes both", told.lines[1].actions.find((x) => x.kind === "done")?.ids.join() === "r1,r2", told.lines[1]);
  }
  {
    // ⚠️ ONE COMPARER OF "THIS TEXT ALREADY SAYS THAT" (architecture review round 16, 2026-11-03): a device's state beside
    // its fault and a card's pills judged it by whole words, an "Also:" line under an alert by a plain substring. Each
    // pair is driven through the three places that ask it: the "Also" line under an alert (othersFirst), a state pill
    // beside the words of the card's lines (issueAsTold), a device's own state beside the fault folded onto it
    // (stateBesideFault, through the card's pills); each must answer as the comparer does, and the comparer as the table.
    const { saysWord, cockpitCard, ALSO } = await import("@/config/cockpitCard");
    const { groupAttention } = await import("@/config/attention");
    const PAIRS = [
      // [the text, the shorter words, does the text say them?]
      ["Laundry Room door unlocked", "Unlocked", true],
      ["Pump offline for 3h", "Offline", true],
      ["The outdoor entrance lock is missing.", "the outdoor entrance lock is missing", true],   // the owner's case, 2026-11-01
      ["The outdoor entrance lock is missing", "The outdoor entrance lock is missing.", true],   // a closing stop aside
      ["Door reopened at 10:00", "Open", false],                                                // a substring, not the word
      ["Battery lower than expected", "Battery low", false],
      ["Pump monitoring stopped", "On", false],
    ];
    const asked = [];
    for (const [text, words, says] of PAIRS) {
      const one = saysWord(text, words);
      // an "Also:" line under an alert whose message is `text`
      const alert = parseVestaMessage({ seq: 70, key: "incident:170", title: "#170-P1 (new)", to: "To: Owner", body: text, status: ["⚠️ New alert"], buttons: [] });
      const also = card("also", { lines: [{ key: "a", text: "x", story: [], alertNumber: 170, closing: null, records: [] }, { key: "o", text: words, story: [], closing: null, records: [] }] });
      const alsoKept = messagesView({ open: [also], watched: [], announcements: [alert], filter: "issues", selected: null }).issues[0].card
        .lines.some((l) => l.text === ALSO + words);
      // a state pill beside a line saying `text`
      const pilled = card("pill", { lines: [{ key: "p", text, story: [], closing: null }], status: [{ text: words, tone: "tone-warn" }] });
      const pillKept = (messagesView({ open: [pilled], watched: [], announcements: [], filter: "issues", selected: null }).issues[0].card.status ?? [])
        .some((x) => x.text === words);
      // a device's own state (`words`) beside its fault titled `text`
      const dev = { key: "lock.example_says", label: "Lock", room: "Hall" };
      const [g] = groupAttention([
        { id: "alarm:lock.example_says", kind: "alarm", title: "Lock", detail: words, entityId: dev.key, source: "live", device: dev },
        { id: "fault:s1", kind: "fault", title: text, detail: "Fault", entityId: dev.key, ticketId: "s1", stage: "fault", source: "alert", device: dev }]);
      const besideKept = cockpitCard(g, null).status.some((x) => x.text === words);
      asked.push({ text, words, says, one, alsoKept, pillKept, besideKept, folded: !!g.items[0].fault });
    }
    const wrong = asked.filter((a) => a.one !== a.says || a.alsoKept === a.one || a.pillKept === a.one || a.besideKept === a.one || !a.folded);
    ck("each pair: the comparer answers as the table, and the \"Also\" line, the state pill and a device's state beside its fault all follow it",
       wrong.length === 0, wrong);
  }
  const opened = draw(h(CockpitAttentionRow, { card: v.issues[0].card, onOpenEntity() {}, canManage: false, onEditTicket() {}, onRaiseTicket() {} }));
  // owner, 2026-11-01: "Missing" beside words saying it was clutter; a state nothing says stays
  const stated = /class="fm-badge tone-warn">Missing</;
  const quiet = card("q", { lines: [{ key: "q", text: "Battery low", story: [], closing: null }], status: [{ text: "Missing", tone: "tone-warn" }] });
  ck("  ...a state its words say is no pill, on the card; a state nothing says stays one",
     !stated.test(opened) && !stated.test(listed(v.issues[0])) && stated.test(listed(messagesView({ open: [quiet], watched: [], announcements: [], filter: "issues", selected: null }).issues[0])));
  ck("  ...the open one: the alert named alone, the other problem as \"Also\", VESTA's words in it",
     JSON.stringify(lines(opened)) === JSON.stringify(["Also: Battery low", "#100-P1 (existing)"])
     && opened.includes("The outdoor entrance lock is missing."), lines(opened));
  const rowTimeShown = words(listed(v.issues[0]), "fm-entity-chip fm-chip-static fm-record-check");
  ck("  ...and its time pill is its alert's, not the other problem's", !!rowTimeShown && rowTimeShown.length > 0, rowTimeShown);
}
ck("its words, then its page opened in the document viewer (the add-on's sandboxed page)",
   opened.includes("Two things") && opened.includes('href="/fm-document/page-en-0001"') && opened.includes("Open the page"), opened);
ck("  ...no page link for a profile the add-on serves no page to, nor for a report without a page",
   !draw(h(ReportDetail, { announcement: weekly, canOpenPage: false })).includes("Open the page")
   && !draw(h(ReportDetail, { announcement: digest, canOpenPage: true })).includes("Open the page"));
const reportLine = listed(onReports.reports[0]);
ck("  ...folded: its title and first words", reportLine.includes("<strong>Rapport</strong>") && reportLine.includes('<span class="fm-card-folded">Trois choses</span>'), reportLine);
const sections = elements(parseTsx("components/cockpit/MessagesTab.tsx"), "MessagesSection").map((e) => propText(e, "title"));
ck("the tab draws a Reports section, its lines from the model's reports",
   sections.includes('"Reports"') && /reportsPaged = usePaged\(view\.reports\)/.test(tab), sections);


// ── VESTA's card in place of the villa's own message (tickets 26-27 of "One inbox", owner 2026-10-28: "update the
// existing card, the same way it is done on Telegram") ──────────────────────────────────────────────────────────────
console.log("\n  VESTA's card, one per alert, as on Telegram:");
{
  const record = (seq, extra = {}) => ({ seq, key: "incident:90", at: `2026-10-28T20:${10 + seq}:00+08:00`,
    title: "#90-P2 (new)", roles: ["Owner", "FM"], to: "Owner & FM", lead: "", body: "🔓 Door unlocked\nWhat to do: Check it.",
    status: ["⚠️ New alert"], takes: ["RUN-A"], ...extra });
  const card90 = parseVestaMessage(record(1));
  ck("a record reads as Telegram heads it: number and priority, To:, the alert, its bottom line; no button drawn",
     card90.title === "#90-P2 (new)" && card90.to === "Owner & FM" && card90.text.startsWith("🔓 Door unlocked")
     && card90.status === "⚠️ New alert" && J(card90.story) === "[]" && card90.buttons.length === 0 && card90.feed === "vesta",
     card90);
  const later = parseVestaMessage(record(2, { title: "#90-P2 (watch)",
    status: ["- Alert sent 19:42 (to: FM)", "- Reminder sent 20:02 (to: FM)", "✅ Cleared 20:58: back to normal."] }));
  ck("  ...its Status story above its bottom line, in order",
     J(later.story) === J(["- Alert sent 19:42 (to: FM)", "- Reminder sent 20:02 (to: FM)"]) && later.status.startsWith("✅"), later);
  const villa = [ann(1, { run: "RUN-A", title: "Entrance door unlocked", at: "2026-10-28T19:42:00+08:00" }),
                 ann(2, { run: "RUN-A", title: "Entrance door unlocked", at: "2026-10-28T20:12:00+08:00" }),
                 ann(3, { run: "RUN-B", title: "Weekly test", at: "2026-10-28T20:30:00+08:00" })];
  // numbered by its own feed (9), yet listed by time: two feeds' numbers never compare
  const shown = shownTogether(villa, [{ ...later, seq: 9 }]);
  ck("the villa's own messages of a run VESTA took over give way to its ONE card; another run's stay; newest last by time",
     J(shown.map((a) => a.title)) === J(["#90-P2 (watch)", "Weekly test"]), shown.map((a) => a.title));
  ck("  ...without VESTA's card (VESTA stopped) the villa's own show: never blank",
     shownTogether(villa, []).length === 3);
  const view = messagesView({ open: [], watched: [], announcements: shown, filter: "notifications", selected: null });
  ck("  ...listed newest first by time, VESTA's card keyed by its thread (one line as it is rewritten)",
     J(view.notifications.map((i) => i.key)) === J(["n3", "v:incident:90"]), view.notifications.map((i) => i.key));
  const step = afterRead([card90], [later], false, 0);
  ck("a rewrite that is a new step (cleared) replaces the card and is news", step.kept.length === 1
     && step.kept[0].title === "#90-P2 (watch)" && step.arrived.length === 1 && step.arrived[0].rewrite, step);
  const quiet = afterRead([later], [parseVestaMessage(record(3, { title: "#90-P2 (closed)",
    status: later.story.concat(later.status) }))], false, 0);
  ck("  ...a quiet rewrite (its bottom line unchanged: a title retouched) replaces it and is no news, as a quiet edit",
     quiet.kept[0].title === "#90-P2 (closed)" && quiet.arrived.length === 0, quiet);
  const settings = { fullScreenFor: [], ringShownForS: 60, ringsFullScreen: true };
  // the villa's alarm offering a button (it stays on screen), then VESTA's card of it
  const staying = { ...villa[0], key: "k1", buttons: [{ label: "Silence", command: "/silence" }] };
  let n = noticeStep(NO_NOTICE, { type: "arrived", announcement: staying, rewrite: false, settings });
  n = noticeStep(n, { type: "arrived", announcement: card90, rewrite: false, settings });
  ck("the villa's notice of the alert gives way to VESTA's card of it",
     n.shown.length === 1 && n.shown[0].announcement.feed === "vesta", n);
  // the ring's end never arrived on this page (asleep, offline): the add-on keeps only its end now
  const ringing = noticeStep(NO_NOTICE, { type: "arrived", announcement: staying, rewrite: false, settings });
  const ringEnd = { ...staying, seq: 7, buttons: [], status: "🔕 Not opened" };
  const ended = noticeStep(ringing, { type: "kept", kept: [ringEnd] });
  ck("a ring that ended while the page was not listening leaves the screen at the next read (owner, 2026-10-28)",
     ringing.shown.length === 1 && ended.shown.length === 0, ended);
  ck("  ...and one still kept as it was stays", noticeStep(ringing, { type: "kept", kept: [staying] }).shown.length === 1);
  ck("  ...and VESTA's card of the villa's alarm takes its place there too, by the same rule as the list (supersedes)",
     noticeStep(ringing, { type: "kept", kept: [staying, { ...card90, takes: ["RUN-A"] }] }).shown.length === 0);
  const issue = card("d", { lines: [{ key: "fault:t1", text: "#90 · Door", icons: null, story: [], closing: null,
    actions: [], alertNumber: 90 }] });
  const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
  const { incidentKey } = await import("@/messages/announcements");
  ck("the card's key is the agreement's form (vestaMessage.incidentKey), the one the Agent writes",
     incidentKey(90) === contract.vestaMessage.incidentKey.replace("{number}", "90") && incidentKey(90) === "incident:90");
  ck("an alert's open issue finds VESTA's card of it (its number); one with no alert number none",
     J(cardsOfIssue(issue, shown).map((a) => a.title)) === J(["#90-P2 (watch)"])
     && cardsOfIssue(card("e", { lines: [{ key: "x", text: "", icons: null, story: [], closing: null, actions: [] }] }), shown).length === 0);
  const { AnnouncementContent } = await import("@/components/messages/AnnouncementContent");
  const drawn = draw(h(AnnouncementContent, { announcement: later })).replace(/<[^>]+>/g, "|");
  ck("the card is drawn as Telegram shows it: To:, the alert, Status:, each story line, then where it stands",
     /To: Owner &amp; FM.*🔓 Door unlocked.*Status:.*- Alert sent 19:42.*- Reminder sent 20:02.*✅ Cleared/s.test(drawn), drawn);
  const watchedCard = card("w90", { look: "watched", lines: [{ key: "fault:t9", text: "", icons: null, story: [], closing: null,
    actions: [], alertNumber: 90 }] });
  const withWatch = messagesView({ open: [], watched: [watchedCard], announcements: shown, filter: "notifications", selected: null });
  const watchList = messagesView({ open: [], watched: [watchedCard], announcements: shown, filter: "issues", selected: null });
  ck("an alert in Watch is listed there only: its card leaves Notifications (owner, 2026-10-28)",
     J(withWatch.notifications.map((i) => i.key)) === J(["n3"]) && watchList.watched.length === 1, withWatch.notifications);
  const closed90 = parseVestaMessage(record(5, { key: "incident:89", title: "#89-P2 (closed)", stage: "closed",
    status: ["✅ Closed on 28/10/2026 21:58."] }));
  const withClosed = messagesView({ open: [], watched: [], announcements: [...shown, closed90], filter: "issues", selected: null });
  const closedNotes = messagesView({ open: [], watched: [], announcements: [...shown, closed90], filter: "notifications",
    selected: null });
  const onlyNotes = messagesView({ open: [], watched: [watchedCard], announcements: [...shown, closed90], filter: "notifications",
    selected: null });
  const onlyIssues = messagesView({ open: [], watched: [watchedCard], announcements: [...shown, closed90], filter: "issues",
    selected: null });
  ck("Watch and Closed are the issues' (a problem's later life), never the notifications' (owner, 2026-10-28)",
     onlyNotes.closed.length === 0 && onlyNotes.watched.length === 0 && onlyNotes.notifications.length > 0
     && onlyIssues.closed.length === 1 && onlyIssues.watched.length === 1 && onlyIssues.notifications.length === 0,
     { notes: onlyNotes, issues: onlyIssues });
  ck("an alert that is over goes to Closed, after Watch, never among the notifications (owner, 2026-10-28)",
     J(withClosed.closed.map((i) => i.key)) === J(["v:incident:89"])
     && !closedNotes.notifications.some((i) => i.key === "v:incident:89"), withClosed);
  const villaClosed = ann(8, { at: "2026-10-28T21:00:00+08:00", title: "Doorbell", status: "✅ Opened at 21:00 at the gate" });
  const both = messagesView({ open: [], watched: [], announcements: [villaClosed, closed90], filter: "issues", selected: null });
  const bothNotes = messagesView({ open: [], watched: [], announcements: [villaClosed, closed90], filter: "notifications",
    selected: null });
  ck("  ...by ONE reader of the stage (alertStage): the villa's own closed message goes to Closed too, an alert not over stays",
     J(both.closed.map((i) => i.announcement.title)) === J(["Doorbell", "#89-P2 (closed)"]) && bothNotes.notifications.length === 0
     && messagesView({ open: [], watched: [], announcements: [ann(9, { status: "⚠️ New alert" })], filter: "notifications", selected: null })
       .notifications.length === 1, both);
  ck("  ...and is no unread: the mark never stays lit for a folded card", unreadOf([closed90], []) === 0
     && unreadOf([later], []) === 1);
  const seenStep = readAtOpening([], [card90]);
  const quietAgain = { ...card90, seq: 40, at: "2026-10-28T23:00:00+08:00", title: "#90-P2 (existing)" };
  ck("a quiet rewrite of a card read already stays read; a new step (its bottom line) is unread (spec review, 2026-10-29)",
     unreadOf([quietAgain], seenStep) === 0 && unreadOf([{ ...quietAgain, status: "⚠️ ⚙️ Reminder sent" }], seenStep) === 1);
  const openIssue = card("o90", { lines: [{ key: "fault:t1", text: "#90-P2 · Door", icons: null, story: [], closing: null,
    actions: [], alertNumber: 90 }] });
  const withOpen = messagesView({ open: [openIssue], watched: [], announcements: shown, filter: "issues", selected: null });
  const openNotes = messagesView({ open: [openIssue], watched: [], announcements: shown, filter: "notifications", selected: null });
  ck("an OPEN alert with a ticket is listed once, as its open issue: its card leaves Notifications (owner, 2026-10-29)",
     J(openNotes.notifications.map((i) => i.key)) === J(["n3"]) && withOpen.issues.length === 1, openNotes.notifications);
  ck("  ...and its card is read once the Cockpit opens, as everything kept",
     withOpen.issues.length === 1 && unreadOf(shown, readAtOpening([], shown)) === 0);
  ck("what this tablet read of one feed is not read of the other (two feeds number apart)",
     unreadOf([ann(1), { ...card90, seq: 1, at: ann(1).at }], readAtOpening([], [ann(1)])) === 1);
}

const ctx = readFileSync(new URL("../../src/messages/AnnouncementsContext.tsx", import.meta.url), "utf8");
ck("what this tablet has read is kept through storedJson alone (private mode or a full store never throws)",
   /readJson\(READ_KEY, isIds\)/.test(ctx) && /writeJson\(READ_KEY, read\)/.test(ctx) && !/localStorage/.test(ctx));

console.log("\n  architecture review 2026-10-29, round 1:");
const newCard = parseVestaMessage({ seq: 12, at: "2026-10-29T09:00:00+08:00", key: "incident:90", title: "#90-P2 (new)",
  body: "Door open", status: ["⚠️ New alert"], stage: "new" });
const withIssue = card("d", { lines: [{ key: "l", text: "Open", icons: null, story: [], closing: null, actions: [], alertNumber: 90 }] });
ck("a card listed under its open issue lights no unread mark (the issue has its own count); without the issue it does",
   unreadOf([newCard], [], [withIssue]) === 0 && unreadOf([newCard], []) === 1);
ck("  ...so Messages opens on Issues' own place, never on an empty Notifications",
   openingFilter(unreadOf([newCard], [], [withIssue])) === "issues");
{
  // the provider hands messagePlaces the issues WHOLE (useCockpitIssues, the list Messages draws): it cannot pick a subset
  const ts = (await import("typescript")).default;
  const calls = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText() === "messagePlaces") calls.push(n.arguments[0]);
    ts.forEachChild(n, visit);
  };
  const ctxTree = parseTsx("messages/AnnouncementsContext.tsx");
  visit(ctxTree);
  const arg = calls[0];
  const spread = arg && ts.isObjectLiteralExpression(arg) ? arg.properties.filter(ts.isSpreadAssignment).map((p) => p.expression.getText()) : [];
  const issuesFrom = /const issues = useCockpitIssues\(\);/.test(ctxTree.text);
  ck("  ...and the page's unread count is read by messagePlaces from the Cockpit's issues, whole (open AND watched)",
     calls.length === 1 && spread.join() === "issues" && issuesFrom, { calls: calls.length, spread });
}

console.log("\n  architecture review 2026-10-29, round 2: one rule places a record and counts it:");
const { placeOf } = await import("@/messages/messagesModel");
const stageCard = (seq, stage, n) => parseVestaMessage({ seq, at: `2026-10-29T1${seq % 10}:00:00+08:00`, key: `incident:${n}`,
  title: `#${n}-P2 (${stage})`, body: "Door", status: ["- Alert sent"], stage });
const mixes = [];
// ⚠️ ONE FUNCTION PLACES AND COUNTS (architecture review round 16): every stage, with no issue, under an open issue or a
// watched one: the place messagePlaces gives is the section messagesView lists it in, and the mark counts exactly what
// Notifications and Reports list
const holdsMsg = (i, a) => (i.kind === "issue" ? cardsOfIssue(i.card, [a]).length > 0 : i.announcement === a);
const sectionOf = (v, a) => [["issue", [...v.issues, ...v.watched.filter((i) => i.kind === "issue")]],
  ["notification", v.notifications], ["report", v.reports], ["watch", v.watched.filter((i) => i.kind !== "issue")], ["closed", v.closed]]
  .filter(([, items]) => items.some((i) => holdsMsg(i, a))).map(([p]) => p);
for (const stage of ["new", "existing", "watch", "closed", "report"]) {
  for (const held of ["none", "open", "watched"]) {
    const a = stage === "report" ? digest : stageCard(40, stage, 77);
    const iss = held === "none" ? [] : [card("h", { lines: [{ key: "l", text: "", icons: null, story: [], closing: null, actions: [], alertNumber: 77 }] })];
    const lists = { open: held === "open" ? iss : [], watched: held === "watched" ? iss : [] };
    const views = ["issues", "notifications", "reports"].map((filter) => messagesView({ ...lists, announcements: [a], filter, selected: null }));
    const listed = new Set(views.flatMap((v) => sectionOf(v, a)));
    const places = messagePlaces({ ...lists, announcements: [a], read: [] });
    const listedNew = views.reduce((n, v) => n + v.notifications.length + v.reports.length, 0);
    const tag = `${stage}${held === "none" ? "" : `+${held}`}`;
    if ([...listed].join() !== places.of(a)) mixes.push(`${tag}: placed ${places.of(a)}, listed ${[...listed].join("|")}`);
    if (places.unread !== listedNew) mixes.push(`${tag}: unread ${places.unread}, listed ${listedNew}`);
    if (places.unreadReports !== views[2].reports.length) mixes.push(`${tag}: unread reports ${places.unreadReports}, listed ${views[2].reports.length}`);
    const read = messagePlaces({ ...lists, announcements: [a], read: readAtOpening([], [a]) });
    if (read.unread !== 0 || read.unreadReports !== 0) mixes.push(`${tag}: read, still unread ${read.unread}/${read.unreadReports}`);
  }
}
ck("every stage, with no issue, an open one or a watched one: one place, the section it is listed in, and the mark counts exactly what Notifications and Reports list",
   mixes.length === 0, mixes);
{
  const placed = (a, watched = []) => messagePlaces({ open: [], watched, announcements: [a] }).of(a);
  const held = card("h", { lines: [{ key: "l", text: "", story: [], actions: [], alertNumber: 77 }] });
  const got = [placed(stageCard(40, "new", 77)), placed(digest), placed(stageCard(40, "watch", 77)), placed(stageCard(40, "closed", 77)),
    placed(stageCard(40, "new", 77), [held])];
  ck("  ...the table reaches every place (a notification, a report, Watch, Closed, with its issue)",
     got.join() === "notification,report,watch,closed,issue", got);
}
const cleared = messagesView({ open: [], watched: [], announcements: [stageCard(41, "watch", 78)], filter: "issues", selected: null });
const clearedNotes = messagesView({ open: [], watched: [], announcements: [stageCard(41, "watch", 78)], filter: "notifications",
  selected: null });
ck("  ...an alert that cleared, with no ticket, is parked in Watch (owner, 2026-10-28), never a notification",
   placeOf(stageCard(41, "watch", 78)) === "watch" && cleared.watched.length === 1 && clearedNotes.notifications.length === 0, cleared);
ck("  ...a report under Reports, an open alert a notification, a closed one in Closed",
   placeOf(digest) === "report" && placeOf(stageCard(42, "new", 79)) === "notification" && placeOf(stageCard(43, "closed", 80)) === "closed");

// ⚠️ NOTIFICATIONS HOLD WHAT STILL WAITS FOR SOMEONE (owner, 2026-10-29: "anything finished goes to Closed … in a generic
// and consistent way"): one rule for every record that asked — whoever asked it
{
  const { parseAnnouncement } = await import("@/messages/announcements");
  const { isFinished } = await import("@/messages/messagesModel");
  const ring = (extra) => parseAnnouncement({ seq: 60, at: "2026-10-29T14:17:00+08:00", key: "R9",
    message: "🔔 Visitor\nSomeone is at the door.", ...extra });
  const approval = (extra) => parseVestaMessage({ seq: 61, key: "thread:ap9", title: "Approval request",
    body: "Turn on the light?", ...extra });
  ck("a request answered or over is Closed, whoever asked: a ring opened or missed, an approval approved, refused or "
     + "expired (the add-on's `asked`, no button left)", placeOf(ring({ asked: true })) === "closed"
     && placeOf(approval({ asked: true })) === "closed" && isFinished(approval({ asked: true })));
  ck("  ...still waiting (its buttons offered) is a notification, rewritten or not",
     placeOf(ring({ buttons: [["Unlock", "/unlock"]] })) === "notification"
     && placeOf(approval({ asked: true, buttons: [{ label: "Approve", kind: "a", id: "ap9:y" }] })) === "notification");
  ck("  ...a note that never asked stays a notification; an alert goes by its stage (Done pressed, still open: a "
     + "notification)", placeOf(ring({})) === "notification"
     && placeOf(parseVestaMessage({ seq: 62, key: "incident:5", title: "#5-P2 (existing)", body: "Door",
       stage: "existing", asked: true })) === "notification");
  ck("  ...the Closed section counts items, not alerts, and says what it holds",
     ((c) => !!c && propText(c, "unit") === '"closed item"' && /^"Finished:/.test(String(propText(c, "tip"))))(
       elements(parseTsx("components/cockpit/MessagesTab.tsx"), "FoldedRows").find((e) => propText(e, "title") === '"Closed"')));
}

// owner, 2026-10-30: two doorbell rings, both answered (so under Issues › Closed), and Notifications said "Nothing
// announced yet"
{
  const { NOTHING_YET, NOTHING_WAITING } = await import("@/messages/messagesModel");
  const answered = ann(9, { asked: true, buttons: [] });
  const none = messagesView({ open: [], watched: [], announcements: [], filter: "notifications", selected: null });
  const done_ = messagesView({ open: [], watched: [], announcements: [answered], filter: "notifications", selected: null });
  ck("Notifications empty with a finished ring under Closed says where it went; with nothing at all, nothing yet",
     done_.notifications.length === 0 && done_.notificationsEmpty === NOTHING_WAITING && none.notificationsEmpty === NOTHING_YET
     && NOTHING_WAITING.includes("Issues › Closed"), [done_.notificationsEmpty, none.notificationsEmpty]);
  ck("  ...the tab says the view's words", readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8")
     .includes("{view.notificationsEmpty}") && !readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8").includes("Nothing announced yet."));
}
done("✅ the Messages model: what the tab lists, its counts and the card open");
