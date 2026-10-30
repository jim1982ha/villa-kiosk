// ONE notice for everything over the villa (components/hud/Notice — owner, 2026-10-18: "make sure all the
// notification appears formatted the same way … it shall call the same piece of code"). Five notices had five looks
// and positions: the connection pill, the update pill placed 48 px under it, the motion notice over both, a failed
// tap in red text, the floor-plan sync problem as a red box at the bottom. Drawn here, and their callers pinned.
import { readFileSync } from "node:fs";
import { React, h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { NoticeView, NoticeStack } = await import("@/components/hud/Notice");
const { STATUS_COLOR } = await import("@/utils/stateColors");
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");

console.log("  one shape, its colour from the map's own legend:");
const icon = h("svg", null);
const shape = (html) => html.replace(/ style="[^"]*"/, "").replace(/ data-tone="[^"]*"/, "").replace(/>[^<]+</g, "><");
const tones = ["active", "unavailable", "alert", "info"].map((t) => draw(h(NoticeView, { tone: t, icon }, "Words")));
ck("every tone is the same element, the same classes, the same inner layout — only its colour differs",
   tones.every((t) => shape(t) === shape(tones[0])) && /class="vesta-notice"/.test(tones[0])
   // the icon, then the words in their own span (they wrap inside the pill, never past it)
   && /<svg><\/svg><span class="vesta-notice-text">Words<\/span>/.test(tones[0]), tones.map(shape));
ck("  ...each status tone IS the map legend's colour (STATUS_COLOR), the news tone the accent",
   tones[0].includes(`--tone:${STATUS_COLOR.active}`) && tones[1].includes(`--tone:${STATUS_COLOR.unavailable}`)
   && tones[2].includes(`--tone:${STATUS_COLOR.alert}`) && tones[3].includes("--tone:var(--accent)"), tones.map((t) => t.match(/--tone:[^;"]+/)?.[0]));
// owner, 2026-10-30: "add consistently to all notification, so clicking on it will close it before the 10sec"
const tap = draw(h(NoticeView, { tone: "info", icon, onTap: () => {} }, "x"));
ck("  ...a notice that acts is the same pill as a button, with no ✕ inside it",
   /^<button type="button" class="vesta-notice tappable"/.test(tap) && !/aria-label="Dismiss"/.test(tap), tap);
ck("  ...every notice that passes by itself has its ✕, with or without someone told of it; a banner that stays has none",
   ["active", "unavailable", "alert", "info"].every((t) => /aria-label="Dismiss"/.test(draw(h(NoticeView, { tone: t, icon }, "x"))))
   && /aria-label="Dismiss"/.test(draw(h(NoticeView, { tone: "alert", icon, onDismiss: () => {} }, "x")))
   && !/aria-label="Dismiss"/.test(draw(h(NoticeView, { tone: "unavailable", icon, stays: true }, "x"))));
ck("  ...the connection banner is the one that stays (its state lasts until the connection is back)",
   /<NoticeView tone="unavailable" icon=\{<WifiOff size=\{16\} \/>\} stays>/.test(
     readFileSync(new URL("../../src/components/hud/ConnectionBanner.tsx", import.meta.url), "utf8")));
// ⚠️ ONE SHAPE (owner, 2026-10-29): the squared corners are the notice's own, never a case's (a photo's, a button's)
{
  const css = readFileSync(new URL("../../src/styles/08-shared.css", import.meta.url), "utf8");
  const own = css.match(/\n\.vesta-notice \{([^}]*)\}/)?.[1] ?? "";
  ck("every notice has the doorbell's squared corners, set once on the shared notice, never per case",
     /border-radius: 12px;/.test(own) && !/\.vesta-notice(?![-\w])[^{]*\{[^}]*border-radius/.test(css.replace(/\n\.vesta-notice \{[^}]*\}/, "")),
     own);
}
ck("the column holds them, one place", /<div id="vesta-notices" class="notice-stack">/.test(draw(h(NoticeStack, null))));

console.log("\n  every notice goes through it:");
const uses = [["components/hud/ConnectionBanner.tsx", /<NoticeView tone="unavailable"/],
  ["components/hud/UpdateBanner.tsx", /<NoticeView tone="info"[\s\S]*?onTap=\{applyUpdate\}/],
  ["components/hud/ServiceErrorToast.tsx", /<NoticeView tone="alert" role="alert"/],
  ["components/hud/AppNotice.tsx", /<NoticeView tone=\{message\.tone\}/],
  ["components/hud/AnnouncementNotice.tsx", /<NoticeView tone="info"/],
  ["components/canvas/BabylonCanvas.tsx", /<Notice tone="alert" role="alert"[\s\S]*?onDismiss=/],
  ["components/settings/TelemetryPanel.tsx", /<NoticeView tone="info"/]];
ck("the connection, a new version, a failed tap, an announcement, a sensor, the floor-plan sync and Settings' own all draw the one notice",
   uses.every(([f, re]) => re.test(src(f))), uses.filter(([f, re]) => !re.test(src(f))).map(([f]) => f));
const dash = src("pages/Dashboard.tsx");
ck("  ...the villa view's own sit in ONE column, the most lasting first",
   /<NoticeStack>\s*<ConnectionBanner \/>\s*<UpdateBanner \/>\s*<ServiceErrorToast \/>\s*<AnnouncementNotice \/>\s*<AppNotice /.test(dash));
ck("  ...a motion notice is the map's \"active\", news is \"info\"",
   /setNotice\(\{ text: room \? `Motion detected · \$\{room\}` : `Motion detected · \$\{label\}`, tone: "active" \}\)/.test(dash) && /isn't modelled yet, coming soon\.`, tone: "info" \}/.test(dash));
const css = ["styles/01-base.css", "styles/02-hud.css", "styles/05-layout.css", "styles/08-shared.css"].map(src).join("\n");
ck("no notice keeps a look of its own", !/\.(service-toast|app-notice|connection-banner|update-banner|sh3d-sync-banner)\b/.test(css));

done("✅ one notice, one place, the map's colours");
