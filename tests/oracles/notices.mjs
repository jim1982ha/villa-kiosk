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
ck("  ...a notice that acts is the same pill as a button; one that stays has its Dismiss",
   /^<button type="button" class="vesta-notice tappable"/.test(draw(h(NoticeView, { tone: "info", icon, onTap: () => {} }, "x")))
   && /aria-label="Dismiss"/.test(draw(h(NoticeView, { tone: "alert", icon, onDismiss: () => {} }, "x"))));
ck("the column holds them, one place", /<div id="vesta-notices" class="notice-stack">/.test(draw(h(NoticeStack, null))));

console.log("\n  every notice goes through it:");
const uses = [["components/hud/ConnectionBanner.tsx", /<NoticeView tone="unavailable"/],
  ["components/hud/UpdateBanner.tsx", /<NoticeView tone="info"[\s\S]*?onTap=\{applyUpdate\}/],
  ["components/hud/ServiceErrorToast.tsx", /<NoticeView tone="alert" role="alert"/],
  ["components/hud/AppNotice.tsx", /<NoticeView tone=\{message\.tone\}/],
  ["components/canvas/BabylonCanvas.tsx", /<Notice tone="alert" role="alert"[\s\S]*?onDismiss=/],
  ["components/settings/TelemetryPanel.tsx", /<NoticeView tone="info"/]];
ck("the connection, a new version, a failed tap, a sensor, the floor-plan sync and Settings' own all draw the one notice",
   uses.every(([f, re]) => re.test(src(f))), uses.filter(([f, re]) => !re.test(src(f))).map(([f]) => f));
const dash = src("pages/Dashboard.tsx");
ck("  ...the villa view's own sit in ONE column, the most lasting first",
   /<NoticeStack>\s*<ConnectionBanner \/>\s*<UpdateBanner \/>\s*<ServiceErrorToast \/>\s*<AppNotice /.test(dash));
ck("  ...a motion notice is the map's \"active\", news is \"info\"",
   /setNotice\(\{ text: room \? `Motion detected · \$\{room\}` : `Motion detected · \$\{label\}`, tone: "active" \}\)/.test(dash) && /isn't modelled yet — coming soon\.`, tone: "info" \}/.test(dash));
const css = ["styles/01-base.css", "styles/02-hud.css", "styles/05-layout.css", "styles/08-shared.css"].map(src).join("\n");
ck("no notice keeps a look of its own", !/\.(service-toast|app-notice|connection-banner|update-banner|sh3d-sync-banner)\b/.test(css));

done("✅ one notice, one place, the map's colours");
