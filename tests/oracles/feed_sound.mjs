// Whether a camera feed carries sound: the sound button shows only then (owner, 2026-10-25: "you are displaying the
// Sound icon for Hikvision camera feed … but there is no Sound coming these camera").
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { feedHasSound } = await import("@/components/panels/feedSound");

let fail = 0;
const eq = (n, got, want) => {
  const ok = got === want;
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `  →  ${got} (wanted ${want})`}`);
  if (!ok) fail++;
};
const live = (tracks) => ({ srcObject: { getAudioTracks: () => tracks } });

console.log("  the live feed: an audio track is always asked for");
eq("a track that never received anything is no sound", feedHasSound(live([{ muted: true, readyState: "live" }])), false);
eq("no audio track at all is no sound", feedHasSound(live([])), false);
eq("a track receiving sound is sound", feedHasSound(live([{ muted: false, readyState: "live" }])), true);
eq("an ended track is no sound", feedHasSound(live([{ muted: false, readyState: "ended" }])), false);
console.log("  the HLS feed: what the element says");
eq("Safari: an audio track listed", feedHasSound({ srcObject: null, audioTracks: { length: 1 } }), true);
eq("Safari: none listed", feedHasSound({ srcObject: null, audioTracks: { length: 0 } }), false);
eq("Firefox: mozHasAudio", feedHasSound({ srcObject: null, mozHasAudio: false }), false);
eq("Chrome: audio decoded", feedHasSound({ srcObject: null, webkitAudioDecodedByteCount: 2048 }), true);
eq("Chrome: nothing decoded yet", feedHasSound({ srcObject: null, webkitAudioDecodedByteCount: 0 }), false);
eq("nothing known", feedHasSound({ srcObject: null }), false);


console.log("  the callers");
const { readFileSync } = await import("node:fs");
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const panel = src("components/panels/CameraPanel.tsx");
eq("the sound button is drawn only for a feed with sound",
  /&& hasSound && \(\s*<button\s+className=\{`icon-btn camera-sound-btn/.test(panel), true);
eq("hasSound comes from feedHasSound on the playing video", /if \(!feedHasSound\(v\)\) return;\s*setHasSound\(true\)/.test(panel), true);
const buttons = src("components/panels/CameraDeviceButtons.tsx");
eq("sounding the siren asks first (useConfirmDialog), stopping does not",
  /if \(sounding\) \{ void callService\("siren", "turn_off"/.test(buttons)
  && /run: \(\) => void callService\("siren", "turn_on"/.test(buttons)
  && !/callService\("siren", sounding \? "turn_off" : "turn_on"/.test(buttons)
  && /\{dialog\}/.test(buttons), true);
const scenes = src("hooks/useSceneConfirm.tsx");
eq("scenes ask through the same hook", /useConfirmDialog\(\)/.test(scenes) && !/<AskDialog/.test(scenes), true);

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the sound button and the siren's question hold");
process.exit(fail ? 1 : 0);
