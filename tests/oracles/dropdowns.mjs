// Every choice-from-a-list is the app's own Dropdown (2.496.275, owner
// 2026-10-04: "a lot of dropdown menus are badly rendered … make sure it
// always looks integrated"). A native <select> opens the platform's picker —
// Android's grey radio sheet, iOS's wheel — which no theme reaches.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { dropdownPlacement, DROPDOWN_ROW_PX } = await import("@/components/common/dropdownPlacement");

const root = new URL("../../src/", import.meta.url);
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = new URL(f, dir);
  return statSync(p).isDirectory() ? walk(new URL(`${f}/`, dir)) : /\.tsx$/.test(f) ? [p] : [];
});
const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\/?\*|\{\/\*)/.test(l)).join("\n");
const natives = walk(root).filter((p) => /<select\b|<option\b/.test(code(readFileSync(p, "utf8"))))
  .map((p) => p.pathname.split("/src/")[1]);
ck("no screen draws a native <select> (it opens the platform's picker)", natives.length === 0, natives);
ck("  ...and the Dropdown's list is portalled out of the window, on the dismissal stack",
   /createPortal\(/.test(readFileSync(new URL("components/common/Dropdown.tsx", root), "utf8"))
   && /useBackToClose\(\(\) => close\(\), open\)/.test(readFileSync(new URL("components/common/Dropdown.tsx", root), "utf8")));

const vp = { width: 400, height: 800 };
const btn = (top, left = 16, width = 200) => ({ top, bottom: top + 44, left, width });
const mid = dropdownPlacement(btn(100), vp, 5);
ck("room below: it opens under the button, the whole list shown", !mid.above && mid.top === 148 && mid.maxHeight === 5 * DROPDOWN_ROW_PX + 8, mid);
const foot = dropdownPlacement(btn(700), vp, 10);
ck("at the foot of a phone screen: it opens UPWARDS rather than cut to two rows", foot.above && foot.bottom === 104, foot);
ck("  ...and never taller than the room it has", foot.maxHeight <= 700 - 12);
const narrow = dropdownPlacement(btn(100, 300, 60), vp, 3);
ck("as wide as its button, at least 180 px, and kept on screen", narrow.width === 180 && narrow.left + narrow.width <= 392, narrow);
const tight = dropdownPlacement(btn(380), { width: 400, height: 800 }, 30);
ck("a long list in the middle takes the bigger side and scrolls", tight.maxHeight < 30 * DROPDOWN_ROW_PX && tight.maxHeight >= 2 * DROPDOWN_ROW_PX, tight);
done("✅ every dropdown is the app's own");
