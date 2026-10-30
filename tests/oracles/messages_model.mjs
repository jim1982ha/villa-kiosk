// The Cockpit's Messages tab (ticket 17 of "One inbox", owner 2026-10-28): one pure model turns the open issues, the
// watched faults and the villa's announcements into what the tab lists, its filters' counts and the item open on the
// right. Every Messages screen reads it. Driven by value; placeholder titles.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { h, draw } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
const { messagesView, mergeAnnouncements, FILTERS, unreadOf, markShown, openingFilter, readOnScreen, shownTogether,
  afterRead, cardsOfIssue } = await import("@/messages/messagesModel");
const { parseVestaMessage } = await import("@/messages/announcements");
const { noticeStep, NO_NOTICE } = await import("@/messages/noticeModel");

const card = (key, extra = {}) => ({ key, title: `Device ${key}`, lead: null, nextCheck: null, actions: [], lines: [], ...extra });
const ann = (seq, extra = {}) => ({ seq, at: `2026-10-28T1${seq % 10}:00:00+08:00`, title: `T${seq}`, to: "", text: "",
  status: "", photo: null, key: null, buttons: [], ...extra });
const J = JSON.stringify;

console.log("  the filters, on one line:");
ck("Issues · Notifications · Reports, in that order, no All (owner, 2026-10-30; 2026-10-28: \"Issues\" holds open, watched and closed; ticket 20: Reports)",
   J(FILTERS.map((f) => f.label)) === J(["Issues", "Notifications", "Reports"]));
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

console.log("\n  the item open on the right:");
ck("the one asked for, wherever it is listed (an issue, a watched fault, a notification)",
   messagesView({ ...base, filter: "issues", selected: "b" }).selected?.key === "b"
   && messagesView({ ...base, filter: "issues", selected: "w" }).selected?.key === "w"
   && messagesView({ ...base, filter: "notifications", selected: "n2" }).selected?.key === "n2");
ck("  ...none asked: the first listed; nothing listed, none",
   issues.selected?.key === "a" && notes.selected?.key === "n3"
   && messagesView({ open: [], watched: [], announcements: [], filter: "issues", selected: null }).selected === null);
ck("  ...one the filter does not list is not kept: the first listed instead",
   messagesView({ ...base, filter: "notifications", selected: "a" }).selected?.key === "n3");
ck("  ...one gone (an issue that cleared) gives way to the first listed",
   messagesView({ ...base, filter: "issues", selected: "gone" }).selected?.key === "a");
ck("a device window's warning: its issue open, when nothing else was asked",
   messagesView({ ...base, filter: "issues", selected: null, focus: (c) => c.key === "b" }).selected?.key === "b");
ck("why it is open: asked for, a warning's, or only the first listed (a phone then shows the list, not an item no one chose)",
   messagesView({ ...base, filter: "issues", selected: "b" }).openedBy === "asked"
   && messagesView({ ...base, filter: "issues", selected: null, focus: (c) => c.key === "b" }).openedBy === "focus"
   && issues.openedBy === "first" && messagesView({ ...base, filter: "issues", selected: "gone" }).openedBy === "first"
   && messagesView({ ...base, filter: "issues", selected: null, focus: () => false }).openedBy === "first"
   && messagesView({ open: [], watched: [], announcements: [], filter: "issues", selected: null }).openedBy === null);
ck("which parts each filter shows (the tab draws those, never its own rule)",
   J(issues.shows) === J({ issues: true, notifications: false, reports: false })
   && J(notes.shows) === J({ issues: false, notifications: true, reports: false }));

console.log("\n  the facility manager's reports (ticket 20 of \"One inbox\"):");
const digest = parseVestaMessage({ seq: 30, at: "2026-10-29T07:00:00+08:00", key: "note:d1", title: "Daily digest", to: "FM",
  body: "New since yesterday", report: "reports:fm-daily" });
const weekly = parseVestaMessage({ seq: 31, at: "2026-10-29T08:00:00+08:00", key: "note:w1", title: "Weekly report", to: "FM",
  body: "Deux choses", report: "reports:fm-weekly", page: "page-fr-0001", language: "fr",
  languages: { en: { body: "Two things", page: "page-en-0001" }, de: { body: "Zwei", page: "page-de-0001" } } });
const french = parseVestaMessage({ seq: 32, at: "2026-10-29T08:01:00+08:00", key: "note:w2", title: "Rapport", to: "FM",
  body: "Trois choses", report: "reports:fm-weekly", page: "page-fr-0002", language: "fr",
  languages: { de: { body: "Drei", page: "page-de-0002" } } });
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
ck("Reports lists the reports alone, newest first; the first open on the right",
   J(onReports.reports.map((i) => i.announcement.seq)) === J([32, 31, 30]) && onReports.notifications.length === 0
   && onReports.issues.length === 0 && onReports.selected?.key === "v:note:w2" && onReports.selected?.kind === "report",
   onReports);
const onNotes = messagesView({ ...withReports, filter: "notifications", selected: null });
ck("  ...a report is never also a notification (one place per thing)",
   J(onNotes.notifications.map((i) => i.announcement.seq)) === J([33, 1]) && onNotes.reports.length === 0, onNotes.notifications);
const asked = messagesView({ ...withReports, filter: "reports", selected: "v:note:d1" });
ck("  ...one asked for opens on Reports",
   asked.reports.length === 3 && asked.selected?.key === "v:note:d1", asked.reports);
ck("  ...a report open, or the Reports page shown, is read; on another filter a report is not",
   J(readOnScreen("reports", { reports: onReports.reports.slice(0, 2) }, null).map((a) => a.seq)) === J([32, 31])
   && readOnScreen("issues", { reports: asked.reports }, null).length === 0
   && J(readOnScreen("issues", {}, asked.selected).map((a) => a.seq)) === J([30]));
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
const seen = markShown([], kept3, kept3);
ck("an announcement not yet shown on this tablet is unread; once shown in Messages it is read",
   unreadOf(kept3, []) === 3 && unreadOf(kept3, seen) === 0, seen);
const kept4 = [...kept3, ann(4)];
ck("  ...a new one makes one unread, the ones already shown stay read", unreadOf(kept4, seen) === 1);
ck("  ...only what was shown is read (a page of ten shows ten, not the eleventh)",
   unreadOf(kept4, markShown(seen, [ann(4)], kept4)) === 0 && unreadOf(kept4, markShown([], [ann(4)], kept4)) === 3);
const rung = ann(5, { key: "run-1" });
const rewritten = ann(7, { key: "run-1", at: "2026-10-28T19:00:00+08:00" });
ck("  ...a rewrite of one already read is news again (it came with a new number): unread",
   unreadOf([rewritten], markShown([], [rung], [rung])) === 1);
const restarted = ann(1, { at: "2026-10-29T08:00:00+08:00" });
ck("  ...the add-on's store started again: its first new one, with an old number, is unread",
   unreadOf([restarted], markShown([], [ann(1)], [ann(1)])) === 1);
const pruned = markShown(seen, [ann(4)], [ann(3), ann(4)]);
ck("  ...the list keeps only what the add-on still keeps (it never grows past it)", pruned.length === 2, pruned);

ck("something unread: Messages opens on Notifications, its newest open on the right; nothing unread, on Issues (the default)",
   openingFilter(1) === "notifications" && openingFilter(0) === "issues"
   && messagesView({ ...base, filter: openingFilter(1), selected: null }).selected?.key === "n3");
ck("  ...opened for something else, never on Notifications, so nothing is read unseen: a warning or the wrench's form on Issues",
   openingFilter(1, { warning: true }) === "issues" && openingFilter(1, { form: true }) === "issues"
   && openingFilter(0, { warning: true }) === "issues");

console.log("\n  one line per item, drawn:");
const { MessageRow } = await import("@/components/cockpit/MessagesTab");
const issueLine = draw(h(MessageRow, { item: { kind: "issue", key: "a", card: card("a", { room: "Kitchen",
  lines: [{ key: "l", text: "Too warm", icons: null, story: [], closing: null, actions: [] }] }) }, selected: true, onSelect() {} }));
ck("an open issue: its device, then its room and its first problem on the line under; chosen, marked",
   /class="messages-row on"/.test(issueLine) && issueLine.includes("<b>Device a</b>") && issueLine.includes("<span>Kitchen · Too warm</span>"), issueLine);
const noteLine = draw(h(MessageRow, { item: { kind: "notification", key: "n1", announcement: ann(1, { title: "🔔 Visitor",
  text: "Someone is at the door.\nGate A", at: "2026-10-28T10:00:00+08:00" }) }, selected: false, onSelect() {} }));
ck("  ...a notification: its title, its first words, when it came; not chosen, not marked",
   /class="messages-row"/.test(noteLine) && noteLine.includes("<b>🔔 Visitor</b>") && noteLine.includes("<span>Someone is at the door.</span>")
   && !noteLine.includes("Gate A") && /messages-row-time">28\/10\/2026 \d\d:00</.test(noteLine), noteLine);

console.log("\n  the window and the tab read the model:");
const { parseTsx, elements, guardsOf, propText } = await import("../consistency/jsx.mjs");
const modal = parseTsx("components/cockpit/CockpitModal.tsx");
const strip = elements(modal, "ModalTabs")[0];
ck("a guest (one tab, Messages) gets no tab strip: the strip is drawn only with more than one tab",
   !!strip && guardsOf(strip).some((g) => /tabs\.length > 1/.test(g)), strip && guardsOf(strip));
const tab = readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8");
ck("  ...the tab lists, counts and opens what messagesView says, from the open issues and the page's announcements",
   /const \{ kept, unread, unreadReports, shown \} = useAnnouncements\(\);/.test(tab) && /messagesView\(\{\s*open, watched, announcements: kept, filter, selected,/.test(tab)
   && /view\.filters\.map\(/.test(tab) && /const item = raising \? null : view\.selected;/.test(tab)
   && /const \{ issues: showsIssues, notifications: showsNotes, reports: showsReports \} = view\.shows;/.test(tab));
ck("  ...a phone shows the item someone chose (a line, a warning, the ticket form), else the list",
   /const reading = !!raising \|\| view\.openedBy === "asked" \|\| view\.openedBy === "focus";/.test(tab)
   && /className=\{`messages\$\{reading \? " reading" : ""\}`\}/.test(tab));

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
ck("Messages opens where the model says, and marks read what it shows",
   /useState<MessagesFilter>\(\(\) => openingFilter\(unread, opening, unreadReports\)\)/.test(tab) && /if \(onScreen\.length\) shown\(onScreen\);/.test(tab)
   // ...and until a filter is chosen it follows what is unread (VESTA's feed read after the Cockpit opened)
   && /if \(!chosen\) setFilter\(openingFilter\(unread, opening, unreadReports\)\);/.test(tab)
   && /onClick=\{\(\) => pickFilter\(f\.id\)\}/.test(tab)
   && /const onScreen = readOnScreen\(filter, \{ notifications: paged\.page, reports: reportsPaged\.page \}, item, kept\);/.test(tab));

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
// same button shall consistently appear for any type"): the issue's head, VESTA's message in its line, VESTA's buttons
{
  const { AlertIssueCard } = await import("@/components/cockpit/IssueCard");
  const { messageOfLine } = await import("@/messages/messagesModel");
  const { elements, guardsOf, parseTsx, propText } = await import("../consistency/jsx.mjs");
  const alert = parseVestaMessage({ seq: 30, key: "incident:92", title: "#92-P2 (new)", to: "To: Facility manager",
    body: "The pool pump stopped.", status: ["⚠️ New alert"],
    buttons: [{ label: "Done", kind: "i", id: "92:done" }, { label: "Need help", kind: "i", id: "92:need_help" }] });
  const issue = card("p", { lines: [{ key: "l1", text: "Pump stopped", story: [{ at: "2026-10-29T10:00:00+08:00",
    note: "SHORT STORY" }], alertNumber: 92 }] });
  const drawn = draw(h(AlertIssueCard, { card: issue, messages: (l) => messageOfLine(l, [alert]), onOpenEntity() {} }));
  ck("an alert's issue is ONE card: the issue's head, VESTA's message inside its line, in place of its short story",
     (drawn.match(/class="fm-record-card/g) ?? []).length === 1 && /fm-record-head[\s\S]*Device p/.test(drawn)
     && drawn.includes("The pool pump stopped.") && !drawn.includes("SHORT STORY"), drawn);
  const watched = draw(h(AlertIssueCard, { card: { ...issue, look: "watched", lines: [{ ...issue.lines[0],
    text: "#92-P2 · LINE WORDS", closing: "CLOSING WORDS" }] }, messages: (l) => messageOfLine(l, [alert]), onOpenEntity() {} }));
  ck("  ...each thing said once: the line named by VESTA's title, its words and how it closed in VESTA's message "
     + "(owner, 2026-10-29 screenshot)", watched.includes("#92-P2 (new)") && !watched.includes("LINE WORDS")
     && !watched.includes("CLOSING WORDS"), watched);
  ck("  ...an open issue's \"closes at about …\" kept (VESTA's message does not say it)",
     draw(h(AlertIssueCard, { card: { ...issue, lines: [{ ...issue.lines[0], closing: "CLOSES SOON" }] },
       messages: (l) => messageOfLine(l, [alert]), onOpenEntity() {} })).includes("CLOSES SOON"));
  ck("  ...a line whose alert VESTA holds no card for keeps its story", messageOfLine(issue.lines[0], []) === null
     && draw(h(AlertIssueCard, { card: issue, messages: () => null, onOpenEntity() {} })).includes("SHORT STORY"));
  // owner, 2026-10-30: the onsen pump's night-check line, drawn under #96's Status, "feels like it belongs to the
  // history section": another problem of the device comes first, as "Also: …", then the alert with its icon
  const both = { ...issue, lead: { sources: ["alert", "night"], severities: ["warn", "warn"] }, lines: [
    { ...issue.lines[0], icons: null, own: { sources: ["alert"], severities: ["warn"] } },
    { key: "l2", text: "Pump ran shorter than expected", story: [], icons: { sources: ["night"], severities: ["warn"] } }] };
  const two = draw(h(AlertIssueCard, { card: both, messages: (l) => messageOfLine(l, [alert]), onOpenEntity() {} }));
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
  ck("  ...a card with only the alert says no \"Also\"", !draw(h(AlertIssueCard, { card: issue,
     messages: (l) => messageOfLine(l, [alert]), onOpenEntity() {} })).includes("Also:"));
  // owner, 2026-10-30: "a unique configuration … Done / Need Help / Open Ticket consistently for all of them" — the alert's
  // card drew VESTA's own Done · Need help, a fault's Open Ticket · Close
  const ic = parseTsx("components/cockpit/IssueCard.tsx");
  const rows = elements(ic, "CardActions");
  ck("  ...its buttons the row of every issue card (CardActions, the card's Done · Need help · Open Ticket), never VESTA's own",
     rows.length === 2 && elements(ic, "RecordButtons").length === 0
     && readFileSync(new URL("../../src/components/cockpit/IssueCard.tsx", import.meta.url), "utf8")
       .split("export function AlertIssueCard")[1].includes("<CardActions card={card}"), rows.map((r) => r.getText()));
  const tab = parseTsx("components/cockpit/MessagesTab.tsx");
  ck("  ...the Inbox draws it in place of the two stacked cards (no VESTA card above an issue's own)",
     elements(tab, "AlertIssueCard").length === 1 && elements(tab, "NoteDetail").every((e) => !/cardsOfIssue/.test(e.getText()))
     && guardsOf(elements(tab, "AlertIssueCard")[0]).includes("cardsOfIssue(item.card, kept).length > 0")
     && guardsOf(elements(tab, "CockpitAttentionRow")[0]).includes("cardsOfIssue(item.card, kept).length === 0"));
}
ck("its words, then its page opened in the document viewer (the add-on's sandboxed page)",
   opened.includes("Two things") && opened.includes('href="/fm-document/page-en-0001"') && opened.includes("Open the page"), opened);
ck("  ...no page link for a profile the add-on serves no page to, nor for a report without a page",
   !draw(h(ReportDetail, { announcement: weekly, canOpenPage: false })).includes("Open the page")
   && !draw(h(ReportDetail, { announcement: digest, canOpenPage: true })).includes("Open the page"));
const reportLine = draw(h(MessageRow, { item: onReports.reports[0], selected: false, onSelect() {} }));
ck("  ...its line: its title and first words", reportLine.includes("<b>Rapport</b>") && reportLine.includes("<span>Trois choses</span>"), reportLine);
const sections = elements(parseTsx("components/cockpit/MessagesTab.tsx"), "MessagesSection").map((e) => propText(e, "title"));
ck("the tab draws a Reports section, its lines from the model's reports",
   sections.includes('"Reports"') && /reportsPaged = usePaged\(view\.reports\)/.test(tab), sections);
// what counts as read, driven by value (review Q 5: it was decided in the tab, pinned by its source text)
{
  const page = notes.notifications.slice(0, 2), opened = notes.notifications[2], issue = issues.issues[0];
  const seqs = (xs) => xs.map((x) => x.seq).join();
  ck("  ...read: the Notifications page shown and the one open; on another filter, only the one open; an open issue is no announcement",
     seqs(readOnScreen("notifications", { notifications: page }, opened)) === "3,2,1"
     && seqs(readOnScreen("issues", { notifications: page }, opened)) === "1"
     && seqs(readOnScreen("issues", { notifications: page }, issue)) === "" && seqs(readOnScreen("issues", {}, null)) === ""
     && seqs(readOnScreen("reports", { notifications: page }, null)) === "",
     [readOnScreen("notifications", { notifications: page }, opened), readOnScreen("issues", { notifications: page }, opened)]);
}


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
  const seenStep = markShown([], [card90], [card90]);
  const quietAgain = { ...card90, seq: 40, at: "2026-10-28T23:00:00+08:00", title: "#90-P2 (existing)" };
  ck("a quiet rewrite of a card read already stays read; a new step (its bottom line) is unread (spec review, 2026-10-29)",
     unreadOf([quietAgain], seenStep) === 0 && unreadOf([{ ...quietAgain, status: "⚠️ ⚙️ Reminder sent" }], seenStep) === 1);
  const openIssue = card("o90", { lines: [{ key: "fault:t1", text: "#90-P2 · Door", icons: null, story: [], closing: null,
    actions: [], alertNumber: 90 }] });
  const withOpen = messagesView({ open: [openIssue], watched: [], announcements: shown, filter: "issues", selected: null });
  const openNotes = messagesView({ open: [openIssue], watched: [], announcements: shown, filter: "notifications", selected: null });
  ck("an OPEN alert with a ticket is listed once, as its open issue: its card leaves Notifications (owner, 2026-10-29)",
     J(openNotes.notifications.map((i) => i.key)) === J(["n3"]) && withOpen.issues.length === 1, openNotes.notifications);
  ck("  ...and its card, shown on the right when its line is open, is read there",
     J(readOnScreen("issues", {}, withOpen.issues[0], shown).map((a) => a.key)) === J(["incident:90"]));
  ck("what this tablet read of one feed is not read of the other (two feeds number apart)",
     unreadOf([ann(1), { ...card90, seq: 1, at: ann(1).at }], markShown([], [ann(1)], [ann(1)])) === 1);
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
const ctxNow = readFileSync(new URL("../../src/messages/AnnouncementsContext.tsx", import.meta.url), "utf8");
ck("  ...and the page's unread count is given the open and watched issues",
   /unreadOf\(kept, read, issueCards\)/.test(ctxNow) && /const \{ open, watched \} = useCockpitIssues\(\);/.test(ctxNow));
const tabNow = readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8");
ck("what is marked read is keyed by each record's identity (two feeds number apart), never its number alone",
   /onScreen\.map\(idOf\)\.join\(","\)/.test(tabNow));

console.log("\n  architecture review 2026-10-29, round 2: one rule places a record and counts it:");
const { placeOf } = await import("@/messages/messagesModel");
const stageCard = (seq, stage, n) => parseVestaMessage({ seq, at: `2026-10-29T1${seq % 10}:00:00+08:00`, key: `incident:${n}`,
  title: `#${n}-P2 (${stage})`, body: "Door", status: ["- Alert sent"], stage });
const mixes = [];
for (const stage of ["new", "existing", "watch", "closed"]) {
  for (const held of [false, true]) {
    const a = stageCard(40, stage, 77);
    const iss = held ? [card("h", { lines: [{ key: "l", text: "", icons: null, story: [], closing: null, actions: [], alertNumber: 77 }] })] : [];
    const listedNew = ["notifications", "reports"].map((filter) =>
      messagesView({ open: iss, watched: [], announcements: [a], filter, selected: null }))
      .reduce((n, v) => n + v.notifications.length + v.reports.length, 0);
    if (unreadOf([a], [], iss) !== listedNew) mixes.push(`${stage}${held ? "+issue" : ""}: unread ${unreadOf([a], [], iss)}, listed ${listedNew}`);
  }
}
ck("every stage, with or without its issue: the mark counts exactly what Notifications and Reports list", mixes.length === 0, mixes);
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
done("✅ the Messages model: what the tab lists, its counts and the item open on the right");
