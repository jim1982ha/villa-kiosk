// The villa's announcements on the tablet (ticket 13 of "One inbox", owner 2026-10-28): what the add-on keeps is read
// into its parts — never shown as HTML — and each one kept after the page opened is a notice, once; a reload does not
// announce the last ring again. Texts in the shape the villa's layout writes (custom_templates/vesta_message.jinja's
// own example and a ring), with placeholder words.
import { readFileSync } from "node:fs";
import { h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { readLayout, parseAnnouncement, watchAnnouncements, ANNOUNCEMENT_NOTICE_MS, noticeFor, pressButton, PRESS_SAID } =
  await import("@/messages/announcements");
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
globalThis.window = { location: { pathname: "/" } };   // the add-on's own address (no Ingress prefix)
const photoHtml = draw(h(AnnouncementNoticeView, { announcement: { ...a(1), title: "🔔 Visitor", photo: "x.jpg" } }));
ck("  ...a ring's photo above its words, served by the add-on; none drawn without one",
   /<span class="vesta-notice-text"><img class="vesta-notice-photo" src="\/announcement-photo\/x\.jpg" alt=""\/>🔔 Visitor<\/span>/.test(photoHtml)
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
// the layout writes the stage as a mark before the status (vesta_message.jinja: "⚠️" new, "⚠️ ⚙️" still open, "✅"
// cleared), before the rule's own words when it has some
ck("its stage, from the mark that opens its bottom line",
   stageOf("⚠️ New alert") === "new" && stageOf("⚠️ Power dropped") === "new" && stageOf("⚠️ ⚙️ Still open") === "existing"
   && stageOf("⚠️ ⚙️ Still not clear after 10min") === "existing" && stageOf("✅ Cleared on 28/10/2026 14:05.") === "closed",
   ["⚠️ New alert", "⚠️ ⚙️ Still open", "✅ Cleared"].map(stageOf));
ck("  ...none without a mark (the weekly test, a ring not opened) or without a bottom line",
   stageOf("Test message: no action needed.") === null && stageOf("🔕 Not opened: nobody answered within 2min.") === null
   && stageOf("") === null, ["Test message", "🔕", ""].map(stageOf));

const said = (title, status, extra = {}) => ({ ...a(1), title, status, ...extra });
const picked = { fullScreenFor: ["🔔 Visitor at Gate A"], ringShownForS: 45, ringsFullScreen: true };
ck("a problem (raised or still open) is a notice that stays until dismissed",
   [said("🔥 Overload", "⚠️ New alert"), said("🔥 Overload", "⚠️ ⚙️ Still open")]
     .every((x) => JSON.stringify(noticeFor(x, NONE_FULL)) === JSON.stringify({ fullScreenMs: null, noticeMs: null })),
   noticeFor(said("🔥 Overload", "⚠️ New alert"), NONE_FULL));
ck("  ...anything else (cleared, a test, a digest) a 10s notice",
   [said("🔥 Overload", "✅ Cleared on 28/10/2026 14:05."), said("Weekly test", "Test message: no action needed."), said("Digest", "")]
     .every((x) => JSON.stringify(noticeFor(x, NONE_FULL)) === JSON.stringify({ fullScreenMs: null, noticeMs: 10_000 })),
   noticeFor(said("Digest", ""), NONE_FULL));
ck("a title the owner picked takes the whole screen for \"Ring shown for\" (its own number), then is gone",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", ""), picked)) === JSON.stringify({ fullScreenMs: 45_000, noticeMs: 0 }),
   noticeFor(said("🔔 Visitor at Gate A", ""), picked));
ck("  ...a problem stays as its notice once the full screen ends",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "⚠️ New alert"), picked)) === JSON.stringify({ fullScreenMs: 45_000, noticeMs: null }),
   noticeFor(said("🔔 Visitor at Gate A", "⚠️ New alert"), picked));
ck("  ...never on a tablet that refuses full screen: its notice instead",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "⚠️ New alert"), { ...picked, ringsFullScreen: false }))
     === JSON.stringify({ fullScreenMs: null, noticeMs: null }));
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
const staysHtml = draw(h(AnnouncementNoticeView, { announcement: said("🔥 Overload", "⚠️ New alert"), onDismiss: () => {}, stays: true }));
ck("a notice that stays carries its ✕ (a problem without a button too); a 10s one none",
   staysHtml.includes('aria-label="Dismiss"') && !html.includes('aria-label="Dismiss"'), staysHtml);
ck("  ...the tablet's notice decides by this rule, with the villa's and this tablet's settings",
   /noticeFor\(a, settings\.current, \{ rewrite \}\)/.test(src("components/hud/AnnouncementNotice.tsx"))
   && /noticeFor\(shown\.a, config, \{ rewrite: shown\.rewrite \}\)/.test(src("components/hud/AnnouncementNotice.tsx"))
   && /stays=\{how\.noticeMs === null\}/.test(src("components/hud/AnnouncementNotice.tsx")));

ck("a ring's rewrite (its answer, its time out) never takes the screen again: its own notice, in place",
   JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "🔕 Not opened: nobody answered within 2min."), picked, { rewrite: true }))
     === JSON.stringify({ fullScreenMs: null, noticeMs: 10_000 })
   && JSON.stringify(noticeFor(said("🔔 Visitor at Gate A", "⚠️ ⚙️ Still open"), picked, { rewrite: true }))
     === JSON.stringify({ fullScreenMs: null, noticeMs: null }));

console.log("\n  Advanced Settings › Messages › \"Full screen for\": what the villa has announced, never named in code:");
const { announcedTitles } = await import("@/messages/announcements");
const kept = [said("🔔 Visitor at Gate A", ""), said("🔥 Overload", "⚠️ New alert"), said("🔔 Visitor at Gate A", "✅ Opened"),
  said("Weekly test", "")];
ck("each title the store holds, once, in order, without the ones already picked",
   JSON.stringify(announcedTitles(kept, ["🔥 Overload"])) === JSON.stringify(["🔔 Visitor at Gate A", "Weekly test"]),
   announcedTitles(kept, ["🔥 Overload"]));

done("✅ the villa's announcements: read into words, shown once, each in the one notice");
