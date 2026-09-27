// What React shows of the scene is read from EACH new scene (round 13,
// 2.496.186): after a model upload the new scene starts on floor 1 while the
// HUD kept the old floor, and a teleport judged its room against that copy.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { readSceneMirror } = await import("@/pages/sceneMirror");

const scene = (floor, view = "overview", def = false) => ({ getViewMode: () => view, hasOverviewDefault: () => def, floors: { getCurrentFloor: () => floor } });

const before = readSceneMirror(scene(2, "first-person", true));
const after = readSceneMirror(scene(1));
ck("a new scene's floor, view and saved default are ITS OWN — the reload's floor 1, not the old 2",
   after.floor === 1 && after.viewMode === "overview" && after.hasOverviewDefault === false && before.floor === 2, { before, after });

const dash = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
ck("Dashboard sets the floor, the view and the default from ONE read of each new scene",
   /const m = readSceneMirror\(manager\);\s*setViewMode\(m\.viewMode\);\s*setHasOverviewDefault\(m\.hasOverviewDefault\);\s*setCurrentFloor\(m\.floor\);\s*\}, \[manager\]\);/.test(dash));
ck("  ...and no second effect re-reads part of it on its own", (dash.match(/manager\.getViewMode\(\)\)/g) ?? []).length === 0 && !/setHasOverviewDefault\(manager\?\.hasOverviewDefault\(\)/.test(dash));

done("✅ the scene's state is read from the scene");
