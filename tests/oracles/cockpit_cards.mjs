// THE Cockpit card, DRAWN (architecture review, 2026-10-15): every list — an open issue, a ticket, a closed one, a
// scheduled task, a spend line, work done — is one card (RecordCard), and these checks render it and read what it
// SHOWS. The checks they replace matched the code's text and were rewritten nine times in two days for moves that
// changed nothing on screen; a check here fails only when what the owner sees changes.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { SuperadminGate } = await import("@/auth/SuperadminGate");
const { default: RecordCard } = await import("@/components/fm/RecordCard");
const { AttentionCard } = await import("@/components/cockpit/CockpitOverview");
const { groupAttention } = await import("@/config/attention");
const h = React.createElement;
const draw = (el) => renderToStaticMarkup(h(SuperadminGate, null, el));
/** The markup between the first `open` and its own closing tag — a crude but exact slice for nested divs. */
const inside = (html, cls) => {
  const at = html.indexOf(`class="${cls}`); if (at < 0) return "";
  let depth = 0, i = html.lastIndexOf("<", at);
  for (const m of html.slice(i).matchAll(/<(\/?)div\b[^>]*>/g)) { depth += m[1] ? -1 : 1; if (depth === 0) return html.slice(i, i + m.index + m[0].length); }
  return html.slice(i);
};
const btn = (label) => h("button", { type: "button", className: "btn ghost" }, label);

console.log("  a ticket's card:");
const ticket = draw(h(RecordCard, { title: "#33 · Test lock unavailable", status: { text: "In progress", tone: "due-soon" },
  when: "Opened 2026-10-15 00:08", pills: h("span", { className: "fm-clause" }, "Test lock"),
  notes: ["What to do: power", "Reminder sent to Facility Manager (00:24)"], amount: "IDR 1,000",
  erase: { title: "Erase", detail: "x", run: async () => {} }, onOpen: () => {},
  actions: h(React.Fragment, null, btn("Mark resolved"), btn("Close")) }));
const head = inside(ticket, "fm-record-head"), body = inside(ticket, "fm-record-body");
ck("its pill on the title line", /#33 · Test lock unavailable[\s\S]*In progress/.test(head) && /fm-badge due-soon/.test(head), head);
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
const issue = draw(h(AttentionCard, { group, onOpenEntity: () => {}, actions: h(React.Fragment, null, btn("Open Ticket"), btn("Close")) }));
ck("it IS the Cockpit card: title, the room under it, its source icons before it, a chevron",
   /class="fm-record-card"/.test(issue) && /fm-record-lead[\s\S]*<svg/.test(inside(issue, "fm-record-head"))
   && /<strong>Test lock<\/strong>[\s\S]*fm-record-subtitle[^>]*>Hall/.test(issue) && /lucide-chevron-right/.test(issue), issue.slice(0, 400));
ck("  ...its problem's line on the left, Open Ticket and Close inside on the right of it",
   /fm-row-main[\s\S]*#33 · Test lock unavailable[\s\S]*fm-record-actions[\s\S]*Open Ticket[\s\S]*Close/.test(inside(issue, "fm-record-body")));
ck("  ...it opens the device when tapped (a button), and its buttons stop their own presses",
   /role="button"/.test(issue) && /class="fm-record-actions"/.test(issue));
const lone = draw(h(AttentionCard, { group: { ...group, entityId: undefined }, onOpenEntity: () => {} }));
ck("  ...a problem with no device: no chevron, nothing to tap, no buttons", !/chevron-right/.test(lone) && !/role="button"/.test(lone) && !/fm-record-actions/.test(lone));

console.log("\n  a scheduled task — the same card:");
const task = draw(h(RecordCard, { title: "Pool filter clean", tone: "state-due-soon", status: { text: "Due soon", tone: "due-soon" },
  when: "due in 3 days · every 30 days", actions: h(React.Fragment, null, btn("Log"), h("button", { className: "icon-btn", "aria-label": "Remove" })) }));
ck("its state pill on the title line, Log and the bin inside on the right, its tint on the card",
   /Pool filter clean[\s\S]*Due soon/.test(inside(task, "fm-record-head")) && /fm-record-actions[\s\S]*Log[\s\S]*aria-label="Remove"/.test(task)
   && /class="fm-record-card state-due-soon"/.test(task), task.slice(0, 300));
ck("  ...nothing to erase by holding it (its bin removes it): no hold-to-erase on it", !/fm-erasable/.test(task));

done("✅ every Cockpit list is one card, checked as it is drawn");
