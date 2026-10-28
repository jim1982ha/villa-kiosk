// The villa's announcements on the tablet (ticket 13 of "One inbox", owner 2026-10-28): what the add-on keeps is read
// into its parts — never shown as HTML — and each one kept after the page opened is a notice, once; a reload does not
// announce the last ring again. Texts in the shape the villa's layout writes (custom_templates/vesta_message.jinja's
// own example and a ring), with placeholder words.
import { readFileSync } from "node:fs";
import { h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { readLayout, parseAnnouncement, watchAnnouncements, ANNOUNCEMENT_NOTICE_MS } = await import("@/messages/announcements");
const { AnnouncementNoticeView } = await import("@/components/hud/AnnouncementNotice");
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");

console.log("  an announcement read into its parts:");
const alert = "<b>🔥 Mains phase overload</b>\nTo: Owner\n<blockquote>Phase C 4450 W</blockquote>\n\nStatus:\n"
  + "<blockquote><i>⚠️ New alert</i></blockquote>";
ck("the layout: title, who it is for, what it says, its bottom line",
   JSON.stringify(readLayout(alert)) === JSON.stringify(
     { title: "🔥 Mains phase overload", to: "Owner", text: "Phase C 4450 W", status: "⚠️ New alert" }), readLayout(alert));
const ring = "<b>🔔 Visitor at Gate A</b>\nTo: Owner &amp; FM\n<blockquote>Someone is at the door.</blockquote>";
ck("  ...without a bottom line, and its escaped & read back", JSON.stringify(readLayout(ring)) === JSON.stringify(
  { title: "🔔 Visitor at Gate A", to: "Owner & FM", text: "Someone is at the door.", status: "" }), readLayout(ring));
const tags = "<b>A &lt;b&gt; title</b>\nTo: Owner\n<blockquote><a href=\"x\">link</a> &#8364;5</blockquote>";
ck("  ...a tag inside is dropped and an escaped one stays words (it is never drawn as HTML)",
   readLayout(tags).title === "A <b> title" && readLayout(tags).text === "link €5", readLayout(tags));
ck("  ...plain text (the layout missing): its first line is the title",
   JSON.stringify(readLayout("Water leak\nUnder the sink")) === JSON.stringify(
     { title: "Water leak", to: "", text: "Under the sink", status: "" }), readLayout("Water leak\nUnder the sink"));
ck("a stored record becomes an announcement; one this build cannot read is left out",
   parseAnnouncement({ seq: 3, at: "2026-10-28T10:00:00+00:00", message: ring })?.title === "🔔 Visitor at Gate A"
   && parseAnnouncement({ seq: "3", message: ring }) === null && parseAnnouncement({ seq: 3, message: "  " }) === null
   && parseAnnouncement(null) === null);

console.log("\n  each one kept after the page opened is shown once:");
const a = (seq) => ({ seq, at: "", title: `T${seq}`, to: "", text: "", status: "" });
const answers = [{ items: [a(1), a(2)], last: 2 }, null, { items: [a(3)], last: 3 }, { items: [], last: 3 },
  { items: [a(4), a(5)], last: 5 }, { items: [], last: 1 }, { items: [a(2)], last: 2 }];
const asked = [];
const shown = [];
const stop = new AbortController();
const pauses = [];
await watchAnnouncements(async (after) => {
  asked.push(after);
  if (!answers.length) { stop.abort(); return null; }
  return answers.shift();
}, (items) => shown.push(items.map((x) => x.seq)), stop.signal, async (ms) => { pauses.push(ms); });
ck("the first read is the baseline (nothing shown); then each read asks for what came after the last",
   JSON.stringify(asked) === JSON.stringify([null, 2, null, 3, 3, 5, 1, 2]), asked);
ck("  ...what arrived is shown, together when it came together; nothing when nothing came",
   JSON.stringify(shown) === JSON.stringify([[4, 5], [2]]), shown);
ck("  ...an unreachable add-on (or a read a sleeping tablet left open) is asked again after a pause, and what came"
   + " meanwhile is not shown: the next read is a new baseline", pauses.length === 1 && pauses[0] > 0 && asked[2] === null
   && !shown.flat().includes(3), { pauses, asked, shown });

console.log("\n  drawn as every notice, for 10s, in the villa view's column:");
const html = draw(h(AnnouncementNoticeView, { announcement: { ...a(1), title: "🔔 Visitor", text: "At the door\nmore" } }));
ck("the one notice, news tone, title then the first line of what it says",
   /class="vesta-notice"/.test(html) && html.includes("--tone:var(--accent)")
   && html.includes("🔔 Visitor · At the door") && !html.includes("more"), html);
ck("  ...shown for 10s", ANNOUNCEMENT_NOTICE_MS === 10_000, ANNOUNCEMENT_NOTICE_MS);
ck("  ...in the column, before the passing notice (a motion notice never replaces a ring)",
   /<ServiceErrorToast \/>\s*<AnnouncementNotice \/>\s*<AppNotice /.test(src("pages/Dashboard.tsx")));

done("✅ the villa's announcements: read into words, shown once, each in the one notice");
