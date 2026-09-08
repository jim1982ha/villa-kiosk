/**
 * What the villa tells you before it runs a scene.
 *
 * ⚠️ THE MESSAGE IS THE FEATURE, NOT THE DIALOG. Asking "Are you sure?" about
 * every scene in the same words trains a person to confirm without reading,
 * which is worse than not asking — they lose the tap AND believe they were
 * warned. So the sentence has to differ with what the scene actually does, and
 * that is a pure rule over `HaSceneInfo`, testable without a browser.
 */
import { sceneMessage, type HaSceneInfo } from "@/config/haScenes";

let failures = 0;
function check(what: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`
    + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}
function has(what: string, got: string, needle: string) {
  const ok = got.includes(needle);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`
    + (ok ? "" : `\n        ${JSON.stringify(got)} does not contain ${JSON.stringify(needle)}`));
}

const sceneOf = (members: number, rooms: string[]): HaSceneInfo => ({
  entityId: "scene.example_evening",
  name: "Evening",
  memberEntityIds: Array.from({ length: members }, (_, i) => `light.example_${i}`),
  rooms,
});

// ── the count is always stated, because it is the reason to ask ────────────
has("one room names it", sceneMessage(sceneOf(3, ["Kitchen"])), "3 devices in Kitchen");
has("several rooms are counted", sceneMessage(sceneOf(14, ["Kitchen", "Hall", "Deck"])),
    "14 devices across 3 rooms");
has("and named", sceneMessage(sceneOf(14, ["Kitchen", "Hall", "Deck"])), "Kitchen, Hall, Deck");

// ⚠️ SINGULAR, because "1 devices" is the tell of a message nobody read.
has("one device reads as one", sceneMessage(sceneOf(1, ["Kitchen"])), "1 device in Kitchen");
check("and not pluralised", sceneMessage(sceneOf(1, ["Kitchen"])).includes("1 devices"), false);

// ── a scene with no resolved room falls back rather than inventing one ─────
has("no room, still counted", sceneMessage(sceneOf(5, [])), "5 devices");
check("no room invented", /\bin\b|\bacross\b/.test(sceneMessage(sceneOf(5, []))), false);

// ── the irreversibility is the point, and must be said every time ──────────
for (const s of [sceneOf(1, ["Kitchen"]), sceneOf(9, []), sceneOf(9, ["A", "B"])]) {
  has(`"${s.memberEntityIds.length}/${s.rooms.length}" says it cannot be undone`,
      sceneMessage(s), "cannot be undone");
}

// ── an empty scene is honest instead of alarming ───────────────────────────
// ⚠️ "This sets 0 devices. It cannot be undone." is a threat about nothing.
check("an empty scene says so",
      sceneMessage(sceneOf(0, [])), "This scene sets nothing. Running it changes nothing.");

console.log(failures === 0 ? "\nall good" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
