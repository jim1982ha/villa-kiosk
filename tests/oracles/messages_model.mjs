// The Cockpit's Messages tab (ticket 17 of "One inbox", owner 2026-10-28): one pure model turns the open issues, the
// watched faults and the villa's announcements into what the tab lists, its filters' counts and the item open on the
// right. Every Messages screen reads it. Driven by value; placeholder titles.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { h, draw } from "../consistency/screen.mjs";
import { readFileSync } from "node:fs";
const { messagesView, mergeAnnouncements, FILTERS } = await import("@/messages/messagesModel");

const card = (key, extra = {}) => ({ key, title: `Device ${key}`, lead: null, nextCheck: null, actions: [], lines: [], ...extra });
const ann = (seq, extra = {}) => ({ seq, at: `2026-10-28T1${seq % 10}:00:00+08:00`, title: `T${seq}`, to: "", text: "",
  status: "", photo: null, key: null, buttons: [], ...extra });
const J = JSON.stringify;

console.log("  the filters, on one line:");
ck("All · Open issues · Notifications, in that order", J(FILTERS.map((f) => f.label)) === J(["All", "Open issues", "Notifications"]));
const base = { open: [card("a"), card("b")], watched: [card("w", { look: "watched" })], announcements: [ann(1), ann(2), ann(3)] };
const all = messagesView({ ...base, filter: "all", selected: null });
ck("  ...Open issues counts the open issues only (the watched never counted); the others no count",
   J(all.filters.map((f) => [f.id, f.count])) === J([["all", null], ["issues", 2], ["notifications", null]]), all.filters);

console.log("\n  what each filter lists:");
ck("All: the open issues first, in their order, then the notifications newest first; the watched folded after the issues",
   J(all.issues.map((i) => i.key)) === J(["a", "b"]) && J(all.watched.map((i) => i.key)) === J(["w"])
   && J(all.notifications.map((i) => i.key)) === J(["n3", "n2", "n1"]), all);
const issues = messagesView({ ...base, filter: "issues", selected: null });
ck("  ...Open issues: the issues and the watched, no notification",
   issues.issues.length === 2 && issues.watched.length === 1 && issues.notifications.length === 0, issues);
const notes = messagesView({ ...base, filter: "notifications", selected: null });
ck("  ...Notifications: the notifications alone", notes.issues.length === 0 && notes.watched.length === 0
   && notes.notifications.length === 3, notes);

console.log("\n  the item open on the right:");
ck("the one asked for, wherever it is listed (an issue, a watched fault, a notification)",
   messagesView({ ...base, filter: "all", selected: "b" }).selected?.key === "b"
   && messagesView({ ...base, filter: "all", selected: "w" }).selected?.key === "w"
   && messagesView({ ...base, filter: "all", selected: "n2" }).selected?.key === "n2");
ck("  ...none asked: the first listed (an issue before a notification); nothing listed, none",
   all.selected?.key === "a" && notes.selected?.key === "n3"
   && messagesView({ open: [], watched: [], announcements: [], filter: "all", selected: null }).selected === null);
ck("  ...one the filter does not list is not kept: the first listed instead",
   messagesView({ ...base, filter: "notifications", selected: "a" }).selected?.key === "n3");
ck("  ...one gone (an issue that cleared) gives way to the first listed",
   messagesView({ ...base, filter: "all", selected: "gone" }).selected?.key === "a");
ck("a device window's warning: its issue open, when nothing else was asked",
   messagesView({ ...base, filter: "all", selected: null, focus: (c) => c.key === "b" }).selected?.key === "b");
ck("why it is open: asked for, a warning's, or only the first listed (a phone then shows the list, not an item no one chose)",
   messagesView({ ...base, filter: "all", selected: "b" }).openedBy === "asked"
   && messagesView({ ...base, filter: "all", selected: null, focus: (c) => c.key === "b" }).openedBy === "focus"
   && all.openedBy === "first" && messagesView({ ...base, filter: "all", selected: "gone" }).openedBy === "first"
   && messagesView({ ...base, filter: "all", selected: null, focus: () => false }).openedBy === "first"
   && messagesView({ open: [], watched: [], announcements: [], filter: "all", selected: null }).openedBy === null);
ck("which parts each filter shows (the tab draws those, never its own rule)",
   J(all.shows) === J({ issues: true, notifications: true }) && J(issues.shows) === J({ issues: true, notifications: false })
   && J(notes.shows) === J({ issues: false, notifications: true }));

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

console.log("\n  one line per item, drawn:");
const { MessageRow } = await import("@/components/cockpit/MessagesTab");
const issueLine = draw(h(MessageRow, { item: { kind: "issue", key: "a", card: card("a", { room: "Kitchen",
  lines: [{ key: "l", text: "Too warm", icons: null, latest: null, closing: null, actions: [] }] }) }, selected: true, onSelect() {} }));
ck("an open issue: its device, then its room and its first problem on the line under; chosen, marked",
   /class="messages-row on"/.test(issueLine) && issueLine.includes("<b>Device a</b>") && issueLine.includes("<span>Kitchen · Too warm</span>"), issueLine);
const noteLine = draw(h(MessageRow, { item: { kind: "notification", key: "n1", announcement: ann(1, { title: "🔔 Visitor",
  text: "Someone is at the door.\nGate A", at: "2026-10-28T10:00:00+08:00" }) }, selected: false, onSelect() {} }));
ck("  ...a notification: its title, its first words, when it came; not chosen, not marked",
   /class="messages-row"/.test(noteLine) && noteLine.includes("<b>🔔 Visitor</b>") && noteLine.includes("<span>Someone is at the door.</span>")
   && !noteLine.includes("Gate A") && /messages-row-time">2026-10-28 \d\d:00</.test(noteLine), noteLine);

console.log("\n  the window and the tab read the model:");
const { parseTsx, elements, guardsOf } = await import("../consistency/jsx.mjs");
const modal = parseTsx("components/cockpit/CockpitModal.tsx");
const strip = elements(modal, "ModalTabs")[0];
ck("a guest (one tab, Messages) gets no tab strip: the strip is drawn only with more than one tab",
   !!strip && guardsOf(strip).some((g) => /tabs\.length > 1/.test(g)), strip && guardsOf(strip));
const tab = readFileSync(new URL("../../src/components/cockpit/MessagesTab.tsx", import.meta.url), "utf8");
ck("  ...the tab lists, counts and opens what messagesView says, from the open issues and the page's announcements",
   /const \{ kept \} = useAnnouncements\(\);/.test(tab) && /messagesView\(\{\s*open, watched, announcements: kept, filter, selected,/.test(tab)
   && /view\.filters\.map\(/.test(tab) && /const item = raising \? null : view\.selected;/.test(tab)
   && /const \{ issues: showsIssues, notifications: showsNotes \} = view\.shows;/.test(tab));
ck("  ...a phone shows the item someone chose (a line, a warning, the ticket form), else the list",
   /const reading = !!raising \|\| view\.openedBy === "asked" \|\| view\.openedBy === "focus";/.test(tab)
   && /className=\{`messages\$\{reading \? " reading" : ""\}`\}/.test(tab));

done("✅ the Messages model: what the tab lists, its counts and the item open on the right");
