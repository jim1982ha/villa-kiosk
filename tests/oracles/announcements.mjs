// The villa's announcements on the tablet (ticket 13 of "One inbox", owner 2026-10-28): what the add-on keeps is read
// into its parts — never shown as HTML — and each one kept after the page opened is a notice, once; a reload does not
// announce the last ring again. Texts in the shape the villa's layout writes (custom_templates/vesta_message.jinja's
// own example and a ring), with placeholder words.
import { readFileSync } from "node:fs";
import { h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { readLayout, parseAnnouncement, ANNOUNCEMENT_NOTICE_MS, noticeFor, pressButton, PRESS_SAID } =
  await import("@/messages/announcements");
const { watchFeed } = await import("@/messages/feed");
const { afterRead, announcementWords } = await import("@/messages/messagesModel");
const { pressesOf } = await import("@/messages/presses");
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
const a = (seq) => ({ seq, at: "", title: `T${seq}`, to: "", text: "", status: "", photo: null, key: null, buttons: [] });
const answers = [{ items: [a(1), a(2)], last: 2, kept: [1, 2] }, null, { items: [a(3)], last: 3 }, { items: [], last: 3 },
  { items: [a(4), a(5)], last: 5 }, { items: [], last: 1 }, { items: [a(2)], last: 2 }];
const asked = [];
const shown = [];
const stop = new AbortController();
const pauses = [];
const reads = [];
const keptSaid = [];
// the add-on's feed, watched as every feed is (messages/feed, review Q 4): what is NEW is a read that is not a baseline
await watchFeed(async (after) => {
  asked.push(after);
  if (!answers.length) { stop.abort(); return null; }
  return answers.shift();
}, (items, full, _first, kept) => {
  reads.push([full, items.map((x) => x.seq)]);
  keptSaid.push(kept ?? null);
  const { arrived } = afterRead([], items, full);
  if (arrived.length) shown.push(arrived.map((x) => x.announcement.seq));
}, stop.signal, async (ms) => { pauses.push(ms); });
ck("each read hands on what the add-on says it keeps", JSON.stringify(keptSaid[0]) === "[1,2]" && keptSaid[1] === null, keptSaid);
ck("the first read is the baseline (nothing shown); then each read asks for what came after the last",
   JSON.stringify(asked) === JSON.stringify([null, 2, null, 3, 3, 5, null, 2]), asked);
ck("  ...what arrived is shown, together when it came together; nothing when nothing came",
   JSON.stringify(shown) === JSON.stringify([[4, 5]]), shown);
ck("  ...a store started again (a reinstall: its count went back) is read again whole, at once, as a new baseline:"
   + " what it holds is listed, nothing of it shown as news", asked[6] === null && pauses.length === 1, { asked, pauses });
ck("  ...an unreachable add-on (or a read a sleeping tablet left open) is asked again after a pause, and what came"
   + " meanwhile is not shown: the next read is a new baseline", pauses.length === 1 && pauses[0] > 0 && asked[2] === null
   && !shown.flat().includes(3), { pauses, asked, shown });
ck("every read also reaches the page's list (the Cockpit's Notifications): all the add-on keeps on a baseline,"
   + " only what came after on the others; a store started again is read whole",
   JSON.stringify(reads) === JSON.stringify([[true, [1, 2]], [true, [3]], [false, []], [false, [4, 5]], [true, [2]]]), reads);

console.log("\n  a rewrite is known from what the page held (review Q 1):");
const ringA = { ...a(7), key: "run-1", title: "🔔 Visitor", status: "⚠️ New alert" };
const answered = { ...a(8), key: "run-1", title: "🔔 Visitor", status: "🔕 Not opened: nobody answered within 2min." };
const baseline = afterRead([], [a(6), ringA], true);
const then = afterRead(baseline.kept, [answered], false);
ck("a ring read in a baseline (a reload, a wake-up), then its rewrite: a rewrite, so it never takes the screen",
   baseline.arrived.length === 0 && then.arrived.length === 1 && then.arrived[0].announcement.seq === 8
   && then.arrived[0].rewrite === true && then.kept.map((x) => x.seq).join() === "6,8", then);
ck("  ...a baseline is what the add-on keeps now: what the page held before is replaced (a store that started again)",
   afterRead([a(1), a(2)], [a(3)], true).kept.map((x) => x.seq).join() === "3");
ck("  ...what the add-on no longer keeps (below the first number it still keeps) goes from the page (review Q round 2)",
   afterRead([a(1), a(2), a(3)], [a(4)], false, 3).kept.map((x) => x.seq).join() === "3,4"
   && afterRead([a(1), a(2)], [], false, 0).kept.length === 2);
ck("  ...one erased (held, then the superadmin code; owner 2026-10-29) goes too: the page keeps only what the add-on names",
   afterRead([a(1), a(2), a(3)], [a(4)], false, 0, [1, 3, 4]).kept.map((x) => x.seq).join() === "1,3,4"
   && afterRead([a(1), a(2)], [], false, 0, null).kept.length === 2);
ck("  ...a new ring (no key held) is not; every one of a read arrives, oldest first (one in a read with another is shown)",
   afterRead(baseline.kept, [{ ...a(9), key: "run-2" }], false).arrived[0]?.rewrite === false
   && afterRead([], [a(10), a(12), a(11)], false).arrived.map((x) => x.announcement.seq).join() === "10,11,12");
const notice = src("components/hud/AnnouncementNotice.tsx");
ck("  ...the notice sends each to the notice model and keeps no memory of its own",
   /for \(const \{ announcement, rewrite \} of fresh\?\.arrived \?\? \[\]\)/.test(notice)
   && /useReducer\(noticeStep, NO_NOTICE\)/.test(notice) && !/seenKeys|useRef\(new Set/.test(notice));

{
  const { fetchFeed } = await import("@/messages/feed");
  const saved = globalThis.fetch;
  globalThis.window = globalThis.window ?? { location: { pathname: "/" } };
  globalThis.fetch = async () => new Response(JSON.stringify({ announcements: [{ seq: 4, message: "<b>R</b>" }, { seq: "x" }], last: 4, first: 3, kept: [3, 4] }));
  const got = await fetchFeed("announcements", "announcements", parseAnnouncement, null, new AbortController().signal);
  globalThis.fetch = async () => new Response(JSON.stringify({ announcements: [], last: 4, first: 3 }));
  const older = await fetchFeed("announcements", "announcements", parseAnnouncement, null, new AbortController().signal);
  globalThis.fetch = saved;
  ck("a read carries the first number still kept and every one kept, and leaves out a record it cannot read",
     got?.first === 3 && got.last === 4 && got.items.map((x) => x.seq).join() === "4" && got.kept?.join() === "3,4", got);
  ck("  ...an add-on that does not name what it keeps: nothing dropped for it", older?.kept === null, older);
  const { eraseMessage } = await import("@/messages/announcements");
  const sent = [];
  const send = async (url, init) => { sent.push([url, init.method, init.body]); return { ok: true, status: 200 }; };
  const ok = await eraseMessage({ ...a(7), feed: "vesta" }, "tok", send);
  await eraseMessage(a(5), "tok2", send);
  ck("an erase names the message's feed and number with its one-shot authorisation",
     ok === true && JSON.stringify(sent) === JSON.stringify([
       ["/message-erase", "POST", JSON.stringify({ feed: "vesta", seq: 7, elevation: "tok" })],
       ["/message-erase", "POST", JSON.stringify({ feed: "villa", seq: 5, elevation: "tok2" })]]), sent);
  const tab = src("components/cockpit/MessagesTab.tsx");
  ck("  ...a notification's and a report's line are held to erase them, the code asked first (never a button)",
     /paged\.page\.map\(\(n\) => <ErasableMessageRow /.test(tab) && /reportsPaged\.page\.map\(\(r\) => <ErasableMessageRow /.test(tab)
     && /useSuperadminDelete\(\{ title: "Delete message"/.test(tab) && /eraseMessage\(a, token, backendFetch\)/.test(tab)
     && /if \(!consumeClick\(\)\) onSelect\(item\.key\)/.test(tab));
  const ctx = src("messages/AnnouncementsContext.tsx");
  ck("  ...and the page's watch hands what is kept to the merge", /\(items, full, first, kept\) =>/.test(ctx)
     && /afterRead\(s\.kept, items, full, first, kept\)/.test(ctx));
}
const settingsSrc = src("components/settings/MessagesSettings.tsx");
ck("\"Full screen for\" offers the titles of the villa's own announcements the page holds (never VESTA's cards), never a read of its own",
   /const \{ villa: kept, loaded \} = useAnnouncements\(\);/.test(settingsSrc) && !/fetchAnnouncements/.test(settingsSrc));

console.log("\n  what is on screen, announcement by announcement (review Q round 2: a ring that stays, stays):");
{
  const { noticeStep, NO_NOTICE } = await import("@/messages/noticeModel");
  const S = { fullScreenFor: ["🔔 Visitor at Gate A"], ringShownForS: 60, ringsFullScreen: true };
  const go = (state, ...events) => events.reduce(noticeStep, state);
  const arrive = (x, rewrite = false, settings = S) => ({ type: "arrived", announcement: x, rewrite, settings });
  const ringB = { ...a(40), key: "ring-b", title: "🔔 Visitor at Gate B", buttons: [{ label: "Unlock", command: "/u" }] };
  const power = { ...a(41), title: "⚡ Power dropped", status: "⚠️ New alert" };
  let st = go(NO_NOTICE, arrive(ringB), arrive(power));
  ck("a ring offering Unlock stays when another arrives; the other passes beside it for 10s",
     st.staying.map((x) => x.seq).join() === "40" && st.passing?.announcement.seq === 41 && st.passing.ms === 10_000, st);
  st = go(st, { type: "passingEnded", id: "41" });
  ck("  ...the other gone, the ring is still there", st.staying.length === 1 && st.passing === null, st);
  st = go(st, arrive({ ...ringB, seq: 42, buttons: [], status: "✅ Opened at 14:05" }, true));
  ck("  ...its rewrite (answered) takes its place: the Unlock is gone, the answer passes",
     st.staying.length === 0 && st.passing?.announcement.seq === 42, st);
  const ringA = { ...a(50), key: "ring-a", title: "🔔 Visitor at Gate A", buttons: [{ label: "Unlock", command: "/u" }] };
  st = go(NO_NOTICE, arrive(ringA), arrive(power));
  ck("a picked ring takes the whole screen for \"Ring shown for\"; another arriving passes, the screen stays the ring's",
     st.full?.announcement.seq === 50 && st.full.ms === 60_000 && st.passing?.announcement.seq === 41, st);
  st = go(st, { type: "fullEnded" });
  ck("  ...its time over (or Close, or this tablet's switch off), it carries on as a notice while it offers Unlock",
     st.full === null && st.staying.map((x) => x.seq).join() === "50", st);
  ck("  ...not on a tablet that does not let rings take the screen, nor for its rewrite",
     go(NO_NOTICE, arrive(ringA, false, { ...S, ringsFullScreen: false })).full === null
     && go(NO_NOTICE, arrive(ringA, true)).full === null);
  const ringB2 = { ...ringB, seq: 44, key: "ring-b2" };
  ck("  ...two rings waiting both stay; a second picked ring takes the screen, the first keeps its notice and Unlock",
     go(NO_NOTICE, arrive(ringB), arrive(ringB2)).staying.map((x) => x.seq).join() === "40,44"
     && (() => { const t = go(NO_NOTICE, arrive(ringA), arrive({ ...ringA, seq: 51, key: "ring-a2" }));
       return t.full?.announcement.seq === 51 && t.staying.map((x) => x.seq).join() === "50"; })());
  ck("  ...a staying one goes with its ✕; an earlier timer never ends a later passing one",
     go(NO_NOTICE, arrive(ringB), { type: "dismissed", id: "40" }).staying.length === 0
     && go(NO_NOTICE, arrive(power), arrive({ ...power, seq: 43 }), { type: "passingEnded", id: "41" }).passing?.announcement.seq === 43);
}

console.log("\n  one record of presses for the page (review Q 2):");
{
  const sent = [];
  let answer;
  const presses = pressesOf((key, command) => { sent.push([key, command]); return new Promise((r) => { answer = r; }); });
  const ring = { ...a(20), key: "run-9", buttons: [{ label: "Unlock", command: "/unlock" }] };
  let told = 0;
  presses.subscribe(() => { told += 1; });
  presses.press(ring, "/unlock");                                   // pressed on the notice
  const notice1 = presses.get(ring), messages1 = presses.get({ ...ring });   // read by the notice and by Messages
  presses.press({ ...ring }, "/unlock");                            // pressed again in Messages while it is sent
  answer("sent");
  await new Promise((r) => setTimeout(r, 0));
  ck("pressed on one screen, every screen shows it: one send, the same outcome", sent.length === 1
     && notice1 === messages1 && notice1["/unlock"] === "sending" && presses.get(ring)["/unlock"] === "sent" && told >= 2,
     { sent, state: presses.get(ring) });
  presses.press(ring, "/unlock");
  ck("  ...a button already sent is not sent again", sent.length === 1, sent);
  const failing = pressesOf(async () => "failed");
  const other = { ...ring, seq: 21 };
  failing.press(other, "/unlock");
  await new Promise((r) => setTimeout(r, 0));
  ck("  ...one that failed may be pressed again; a rewrite (a new number) starts afresh",
     failing.get(other)["/unlock"] === "failed" && Object.keys(presses.get({ ...ring, seq: 22 })).length === 0);
  const content = src("components/messages/AnnouncementContent.tsx");
  ck("  ...no screen keeps its own: the notice and Messages read the page's one (AnnouncementsContext)",
     !/function useAnnouncementPress|PressState>\(/.test(content) && /useAnnouncementPress\(/.test(src("components/cockpit/MessagesTab.tsx"))
     && /from "@\/messages\/AnnouncementsContext"/.test(src("components/cockpit/MessagesTab.tsx"))
     && /useAnnouncementPress, useAnnouncements \} from "@\/messages\/AnnouncementsContext"/.test(notice));
}

console.log("\n  one wording on every screen (review Q 5):");
const statusOnly = { ...a(30), title: "Weekly siren test", status: "✅ Done at 10:00" };
ck("an announcement's line is the first of what it says, else its bottom line",
   announcementWords(statusOnly).line === "✅ Done at 10:00" && announcementWords({ ...statusOnly, text: "Sirens\nmore" }).line === "Sirens");
ck("  ...the notice says it so too (it showed the title alone)",
   draw(h(AnnouncementNoticeView, { announcement: statusOnly })).includes("Weekly siren test · ✅ Done at 10:00"));

console.log("\n  drawn as every notice, for 10s, in the villa view's column:");
const html = draw(h(AnnouncementNoticeView, { announcement: { ...a(1), title: "🔔 Visitor", text: "At the door\nmore" } }));
ck("the one notice, news tone, title then the first line of what it says",
   /class="vesta-notice"/.test(html) && html.includes("--tone:var(--accent)")
   && html.includes("🔔 Visitor · At the door") && !html.includes("more"), html);
ck("  ...shown for 10s", ANNOUNCEMENT_NOTICE_MS === 10_000, ANNOUNCEMENT_NOTICE_MS);
globalThis.window = { location: { pathname: "/" } };   // the add-on's own address (no Ingress prefix)
const photoHtml = draw(h(AnnouncementNoticeView, { announcement: { ...a(1), title: "🔔 Visitor", photo: "x.jpg" } }));
// owner, 2026-10-28 (2.496.562): the pill's round ends around a photo read "pretty much wrong"; the photo keeps its size
ck("  ...a ring's photo above its words, served by the add-on, the notice then square-cornered; none drawn without one",
   /<span class="vesta-notice-text"><img class="vesta-notice-photo" src="\/announcement-photo\/x\.jpg" alt=""\/>🔔 Visitor<\/span>/.test(photoHtml)
   && /\.vesta-notice:has\(\.vesta-notice-photo\) \{ border-radius: 12px; \}/.test(readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8"))
   && !html.includes("<img"), photoHtml);

console.log("\n  what a record says about itself:");
const rec = parseAnnouncement({ seq: 4, message: ring, photo: "0123456789abcdef0123456789abcdef.jpg" });
ck("its photo, by the add-on's id", rec?.photo === "0123456789abcdef0123456789abcdef.jpg", rec);
const sly = parseAnnouncement({ seq: 5, message: ring, photo: "../../options.json" });
ck("  ...a photo name that is not one of the add-on's ids is not drawn", sly?.photo === null, sly);
ck("  ...in the column, before the passing notice (a motion notice never replaces a ring)",
   /<ServiceErrorToast \/>\s*<AnnouncementNotice \/>\s*<AppNotice /.test(src("pages/Dashboard.tsx")));

// the shared settings' empty defaults ("Full screen for" empty), a tablet that allows full screen
const NONE_FULL = { fullScreenFor: [], ringShownForS: 60, ringsFullScreen: true };

console.log("\n  a button the announcement offers (ticket 15: the doorbell's Unlock, pressed on the tablet):");
const offered = parseAnnouncement({ seq: 6, message: ring, key: "run-1", buttons: [[["🔓 Unlock", "/unlock"], ["Later", "/later"]]] });
ck("its buttons, label and command as the villa sent them, and its key",
   JSON.stringify(offered?.buttons) === JSON.stringify([{ label: "🔓 Unlock", command: "/unlock" }, { label: "Later", command: "/later" }])
   && offered?.key === "run-1", offered);
ck("  ...none without a key: the press must name its ring, or no automation can tell it is for it",
   parseAnnouncement({ seq: 7, message: ring, buttons: [[["🔓 Unlock", "/unlock"]]] })?.buttons.length === 0);
ck("  ...a malformed button is left out, never drawn blank",
   parseAnnouncement({ seq: 8, message: ring, key: "k", buttons: [[["", "/x"], ["ok", 3], "z", ["Fine", "/f"]]] })
     ?.buttons.map((b) => b.label).join() === "Fine");
ck("a notice offering a button stays until the rewrite withdraws it; any other goes after 10s",
   noticeFor(offered, NONE_FULL).noticeMs === null
   && noticeFor(parseAnnouncement({ seq: 9, message: ring, key: "run-1" }), NONE_FULL).noticeMs === ANNOUNCEMENT_NOTICE_MS);
const pressed = [];
const btnHtml = draw(h(AnnouncementNoticeView, { announcement: offered, onPress: () => {}, onDismiss: () => {}, presses: {} }));
ck("each button drawn with the announcement's own label (the Kiosk names no device and no command)",
   /<button[^>]*class="[^"]*\bvesta-notice-action\b[^"]*"[^>]*>🔓 Unlock<\/button>/.test(btnHtml) && btnHtml.includes(">Later</button>")
   && !btnHtml.includes("/unlock"), btnHtml);
ck("  ...with its ✕ while it stays", btnHtml.includes('aria-label="Dismiss"'), btnHtml);
const sentHtml = draw(h(AnnouncementNoticeView, { announcement: offered, onPress: () => {}, presses: { "/unlock": "sent" } }));
ck("  ...a pressed button is not pressed twice, and says what happened",
   /<button[^>]*disabled=""[^>]*>🔓 Unlock<\/button>/.test(sentHtml) && sentHtml.includes(PRESS_SAID.sent), sentHtml);
const replies = { 200: "sent", 409: "withdrawn", 502: "failed", 401: "failed" };
for (const [status, want] of Object.entries(replies)) {
  const got = await pressButton("run-1", "/unlock", async (url, init) => {
    pressed.push([url, init.method, init.body]);
    return { ok: Number(status) === 200, status: Number(status) };
  });
  ck(`  ...the add-on's ${status}: ${want}`, got === want, got);
}
ck("the press names the ring's key and the button's command, posted to the add-on",
   JSON.stringify(pressed[0]) === JSON.stringify(["/announcement-press", "POST", JSON.stringify({ key: "run-1", command: "/unlock" })]),
   pressed[0]);
ck("  ...a lost connection is not sent", await pressButton("k", "/c", async () => { throw new Error("offline"); }) === "failed");

console.log("\n  how it shows (ticket 16: full screen for what the owner picked, a problem stays, the rest 10s):");
const { stageOf } = await import("@/messages/announcements");
// the layout writes the stage as a mark before the status, before the rule's own words when it has some — the marks the
// agreement lists (agent-contract.json `stageMarks`, review Q 3): read from the file, so a mark the Agent changes
// there is the one checked here
const MARKS = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8")).stageMarks;
const WANT = { new: "new", existing: "existing", watch: "closed", closed: "closed" };
ck("its stage, from the agreement's mark that opens its bottom line (both ends, watch and closed, an ended problem)",
   Object.keys(WANT).every((st) => MARKS[st] && stageOf(`${MARKS[st]} Some words`) === WANT[st])
   && stageOf(`${MARKS.existing} Still not clear after 10min`) === "existing" && stageOf(`${MARKS.new} Power dropped`) === "new",
   Object.fromEntries(Object.entries(MARKS).filter(([k]) => !k.startsWith("_")).map(([k, m]) => [k, stageOf(`${m} x`)])));
ck("  ...none without a mark (the weekly test, a ring not opened) or without a bottom line",
   stageOf("Test message: no action needed.") === null && stageOf("🔕 Not opened: nobody answered within 2min.") === null
   && stageOf("") === null, ["Test message", "🔕", ""].map(stageOf));

const said = (title, status, extra = {}) => ({ ...a(1), title, status, ...extra });
const picked = { fullScreenFor: ["🔔 Visitor at Gate A"], ringShownForS: 45, ringsFullScreen: true };
// owner, 2026-10-28 (2.496.562): "the notification disappears after 10sec, as the user shall not have to press the X"
ck("every announcement's notice goes by itself after 10s: a problem (raised, still open), cleared, a test, a digest",
   [said("🔥 Overload", "⚠️ New alert"), said("🔥 Overload", "⚠️ ⚙️ Still open"), said("🔥 Overload", "✅ Cleared on 28/10/2026 14:05."),
    said("Weekly test", "Test message: no action needed."), said("Digest", "")]
     .every((x) => JSON.stringify(noticeFor(x, NONE_FULL)) === JSON.stringify({ fullScreenMs: null, noticeMs: 10_000 })),
   noticeFor(said("Digest", ""), NONE_FULL));
ck("a title the owner picked takes the whole screen for \"Ring shown for\" (its own number), then is gone",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", ""), picked)) === JSON.stringify({ fullScreenMs: 45_000, noticeMs: 0 }),
   noticeFor(said("🔔 Visitor at Gate A", ""), picked));
ck("  ...a problem too: no notice once the full screen ends",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "⚠️ New alert"), picked)) === JSON.stringify({ fullScreenMs: 45_000, noticeMs: 0 }),
   noticeFor(said("🔔 Visitor at Gate A", "⚠️ New alert"), picked));
ck("  ...a ring offering its button stays as its notice, the button still pressable, until the villa withdraws it",
   JSON.stringify(noticeFor({ ...offered, title: "🔔 Visitor at Gate A" }, picked)) === JSON.stringify({ fullScreenMs: 45_000, noticeMs: null }));
ck("  ...never on a tablet that refuses full screen: its notice instead",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "⚠️ New alert"), { ...picked, ringsFullScreen: false }))
     === JSON.stringify({ fullScreenMs: null, noticeMs: 10_000 }));
ck("  ...nor for a title not picked, nor when the ring is answered (its cleared rewrite is a 10s notice)",
   noticeFor(said("🔔 Visitor at Gate B", ""), picked).fullScreenMs === null
   && JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "✅ Opened at 14:05:10 from the tablet"), picked))
     === JSON.stringify({ fullScreenMs: null, noticeMs: 10_000 }));

const { AnnouncementFullScreenView } = await import("@/components/hud/AnnouncementNotice");
const fullHtml = draw(h(AnnouncementFullScreenView, { announcement: { ...offered, photo: "x.jpg", text: "Someone is at the door.\nGate A",
  status: "⚠️ New alert" }, onPress: () => {}, onDismiss: () => {}, presses: {} }));
ck("full screen: its title, then its photo large, all it says, its bottom line, its buttons, and Close",
   /class="announcement-full-photo" src="\/announcement-photo\/x\.jpg"/.test(fullHtml) && fullHtml.includes(">🔔 Visitor at Gate A</h2>")
   && fullHtml.includes("Gate A</p>") && fullHtml.includes("⚠️ New alert") && fullHtml.includes(">🔓 Unlock</button>")
   && /class="modal-footer"[\s\S]*Close/.test(fullHtml), fullHtml);
const problemHtml = draw(h(AnnouncementNoticeView, { announcement: said("🔥 Overload", "⚠️ New alert"), onDismiss: () => {}, onPress: () => {} }));
ck("a notice that goes by itself carries no ✕ (a problem included): nothing to press", !problemHtml.includes('aria-label="Dismiss"'), problemHtml);
ck("  ...the tablet's notice decides by this rule (the notice model calls it), with the villa's and this tablet's settings",
   /noticeFor\(a, e\.settings, \{ rewrite: e\.rewrite \}\)/.test(src("messages/noticeModel.ts"))
   && /send\(\{ type: "arrived", announcement, rewrite, settings: settings\.current \}\)/.test(src("components/hud/AnnouncementNotice.tsx")));

ck("a ring's rewrite (its answer, its time out) never takes the screen again: its own notice, in place",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "🔕 Not opened: nobody answered within 2min."), picked, { rewrite: true }))
     === JSON.stringify({ fullScreenMs: null, noticeMs: 10_000 })
   && JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "⚠️ ⚙️ Still open"), picked, { rewrite: true }))
     === JSON.stringify({ fullScreenMs: null, noticeMs: 10_000 }));

console.log("\n  Advanced Settings › Messages › \"Full screen for\": what the villa has announced, never named in code:");
const { announcedTitles } = await import("@/messages/announcements");
const kept = [said("🔔 Visitor at Gate A", ""), said("🔥 Overload", "⚠️ New alert"), said("🔔 Visitor at Gate A", "✅ Opened"),
  said("Weekly test", "")];
ck("each title the store holds, once, in order, without the ones already picked",
   JSON.stringify(announcedTitles(kept, ["🔥 Overload"])) === JSON.stringify(["🔔 Visitor at Gate A", "Weekly test"]),
   announcedTitles(kept, ["🔥 Overload"]));

done("✅ the villa's announcements: read into words, shown once, each in the one notice");
