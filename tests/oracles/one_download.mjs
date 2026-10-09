// A file is saved to the reader's device in one place: utils/download.ts (architecture review 11, 2026-10-09).
//
// The helper's header says five hand-written copies were migrated to it. Two were not: the Spend and Recap tabs
// still made their own object URL, and revoked it only if the click did not throw — the leak the helper's
// `finally` exists to prevent, on a kiosk that runs for months. Pins OWNERSHIP across the tracked source, by text.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ck, done } from "../consistency/check.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: ROOT }).split("\n").filter((f) => /\.tsx?$/.test(f));
ck("the scan reached the source tree", files.length > 100, files.length);

// ModelLoader hands the 3D model's bytes to Babylon as an object URL — loading, not saving.
const ALLOWED = new Set(["src/utils/download.ts", "src/babylon/ModelLoader.ts"]);
const own = files.filter((f) => !ALLOWED.has(f) && /URL\.createObjectURL\(/.test(readFileSync(ROOT + f, "utf8")));
ck("no screen makes its own object URL to save a file", own.length === 0, own);
const users = ["src/components/fm/SpendTab.tsx", "src/components/fm/RecapTab.tsx"];
ck("  ...the Spend and Recap tabs save through downloadFile", users.every((f) => /downloadFile\(/.test(readFileSync(ROOT + f, "utf8"))));

const weather = readFileSync(ROOT + "src/components/panels/WeatherPanel.tsx", "utf8");
ck("Weather's \"ago\" is the app's one duration (fmtDuration), not its own rounding", /fmtDuration\(now - Date\.parse\(iso\)\)/.test(weather) && !/Math\.round\(s \/ 3600\)/.test(weather));
const cockpit = readFileSync(ROOT + "src/components/cockpit/CockpitOverview.tsx", "utf8");
ck("the Cockpit's activity is fetched through useHistory, not an eighth hand-written effect", /useHistory\("logbook/.test(cockpit) && !/let cancelled/.test(cockpit));

done("✅ shared pieces are used, not copied");
