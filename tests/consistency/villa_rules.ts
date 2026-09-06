// tests/consistency/villa_rules.ts
// Run: npm run test:villa-rules
// Gated in CI by tests/py/test_villa_rules.py, which runs this file.
//
// ⚠️ THE RULES THAT DECIDE WHAT THE VILLA *IS*, EXECUTED FOR THE FIRST TIME.
// Three clusters of shipped logic — "what devices does this villa have", "what
// IS this device", and "what does a fresh install start with" — were each
// documented at length in prose and asserted by nothing:
//
//   • `selectableDeviceIds` has 21 callers in src/ and no assertion anywhere.
//     Its own docstring records the defect it was written to end: "An operator
//     seeing '3 offline' on the Facility tab and '1 offline' on the HUD badge
//     has no way to know which number is real."
//   • `SWITCH_PURPOSE_HINTS` decides the colour here AND the glyph in
//     babylon/badgeIconKeys.ts — "ONE table so the colour and the icon always
//     agree; they used to be decided separately and drifted". Two adapters,
//     so the seam is real, and nothing held it.
//   • The empty-seed rule is written out in EntityMap.ts, TeleportPoints.ts
//     and ThresholdConfig.ts, and `grep -rn DEFAULT_CONFIG tests/` returned
//     NOTHING. That is the rule this repo has already been bitten by, shipped
//     as "stale entities I can't get rid of".
//
// ⚠️ THIS FILE LIVES IN tests/consistency/ BECAUSE THAT DIRECTORY IS TRACKED.
// `tests/*` is gitignored with three exceptions, so a suite written anywhere
// else under tests/ is absent on a fresh clone and absent from CI — which is
// exactly what makes the existing node suites local-only conveniences rather
// than gates. This one is a gate.

import {
  selectableDeviceIds, unavailableDeviceIds,
} from "../../src/config/deviceGroups.ts";
import {
  effectiveCategory, SWITCH_PURPOSE_HINTS, categorySurface,
} from "../../src/config/EntityCategories.ts";
import { iconKeyFor } from "../../src/babylon/badgeIconKeys.ts";
import { TAP_MOVE_TOL_PX, LONG_PRESS_MS } from "../../src/utils/tapThresholds.ts";
import { prettyState } from "../../src/utils/entityValue.ts";
import {
  outcomeOf, reasonOf, deferredOf, yieldOf, checkIdOf,
  QUIET_REASON, ESCALATED_PREFIX,
} from "../../src/vesta/supervise/passReason.ts";
// ⚠️ THE STUB GOES IN BEFORE THE IMPORT. `loadConfig` reads localStorage at
// call time, and stubbing it lets this suite exercise the REAL merge rather
// than the catch arm — which is the whole point, because the merge is where a
// seed resurrects a deleted entry. `stripStaleVariantEntities` and
// `migrateMotionEntityId` stay private and are reached THROUGH loadConfig,
// which is the interface a caller actually has.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const { DEFAULT_CONFIG, loadConfig, saveConfig } =
  await import("../../src/config/AppConfig.ts");

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

const ent = (id: string, state = "on") =>
  ({ entity_id: id, state, attributes: {} }) as never;
const states = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, ent(id)])) as never;
const map = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { entityId: id, type: id.split(".")[0] }])) as never;

// ═══════════════════════════════════════════════════════════════════════════
console.log("— what devices does this villa have —");
// ═══════════════════════════════════════════════════════════════════════════
{
  const ids = ["light.a", "light.b", "sensor.c"];
  const all = selectableDeviceIds(map(...ids), [], new Set(ids), states(...ids));
  eq("every mapped, live device counts", all.length, 3);

  // ⚠️ THE DEFECT THIS MODULE EXISTS FOR: one physical device, one count.
  const grouped = selectableDeviceIds(
    map("sensor.combo_temp", "sensor.combo_hum"), 
    [{ name: "combo", primaryEntityId: "sensor.combo_temp",
       memberEntityIds: ["sensor.combo_hum"] }] as never,
    new Set(["sensor.combo_temp", "sensor.combo_hum"]),
    states("sensor.combo_temp", "sensor.combo_hum"));
  eq("a two-entity combo sensor is ONE device, not two", grouped.length, 1);
  eq("…and it is the PRIMARY that represents it", grouped[0], "sensor.combo_temp");

  // Each exclusion, for its own reason.
  const disabled = selectableDeviceIds(
    { "light.a": { entityId: "light.a", type: "light", disabled: true } } as never,
    [], new Set(["light.a"]), states("light.a"));
  eq("a disabled row is excluded", disabled.length, 0);

  const debris = selectableDeviceIds(
    map("light.ghost"), [], new Set(), {} as never);
  eq("config debris — no HA entity AND no geometry — is excluded", debris.length, 0);

  // ⚠️ A DISMISSAL IS CONDITIONAL, NOT A BLOCKLIST — and getting this backwards
  // is what I did on the first write of this test. `dismissedEntitySet` keeps
  // only ids Home Assistant STILL does not know: the mesh knows `light.gone`
  // (so it is a candidate), HA does not, and the owner dismissed it.
  const meshOnly = new Set(["light.a", "light.gone"]);
  const dismissed = selectableDeviceIds(
    map("light.a", "light.gone"), [], meshOnly, states("light.a"), ["light.gone"]);
  eq("a device HA has forgotten AND the owner dismissed is excluded",
    dismissed.length, 1);

  // The other half of the same rule, and the reason it is not a blocklist: if
  // HA reports the entity again, the dismissal lapses and the device returns.
  const returned = selectableDeviceIds(
    map("light.a", "light.gone"), [], meshOnly,
    states("light.a", "light.gone"), ["light.gone"]);
  eq("…and it comes BACK the moment HA reports it again", returned.length, 2);

  // ⚠️ THE OPTIONAL ARGUMENT IS A TRAP. `dismissedEntityIds` defaults to [],
  // so a caller who forgets it silently gets the pre-fix behaviour back — the
  // resurrection bug, from the caller's side rather than the store's.
  const forgot = selectableDeviceIds(
    map("light.a", "light.gone"), [], meshOnly, states("light.a"));
  check("omitting dismissedEntityIds reinstates a removed device (documents the trap)",
    forgot.length === 2 && dismissed.length === 1,
    `forgot=${forgot.length} passed=${dismissed.length}`);

  // The invariant the docstring asserts in prose.
  const withDead = { ...states("light.a", "light.b"),
    "light.b": { entity_id: "light.b", state: "unavailable", attributes: {} } } as never;
  const sel = selectableDeviceIds(map("light.a", "light.b"),
    [], new Set(["light.a", "light.b"]), withDead);
  const dead = unavailableDeviceIds(map("light.a", "light.b"),
    [], new Set(["light.a", "light.b"]), withDead);
  check("unavailableDeviceIds ⊆ selectableDeviceIds",
    dead.every((d: string) => sel.includes(d)), `${JSON.stringify(dead)} vs ${JSON.stringify(sel)}`);
  eq("…and the offline one is found", dead.length, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n— what IS this device: one table, two surfaces —");
// ═══════════════════════════════════════════════════════════════════════════
{
  // ⚠️ THE TWO REVERTED SUBSTRING COLLISIONS, from the table's own comment.
  eq("a pool light switch is ENERGY, not light (table order + anchoring)",
    effectiveCategory("switch.outdoor_swimming_pool_light_patio_top", "switch"), "energy");
  eq("a plain outdoor light switch is still LIGHT",
    effectiveCategory("switch.outdoor_light", "switch"), "light");
  eq("'door' does not match inside 'outdoor'",
    effectiveCategory("switch.outdoor_socket", "switch"), "energy");
  eq("'gate' does not match inside 'aggregate'",
    effectiveCategory("switch.aggregate_meter", "switch"), "others");

  // System beats fixture — behaviour, not table order held by care.
  eq("a pump beats a light in the same id",
    effectiveCategory("switch.pool_pump_light", "switch"), "energy");

  // ⚠️ ONE TABLE DECIDES BOTH THE COLOUR AND THE GLYPH. This is the drift the
  // comment fears — "a 'pool light' switch drew a lightbulb on an
  // 'others'-grey badge" — and nothing guarded it before now.
  let paired = 0;
  for (const [re, category, key] of SWITCH_PURPOSE_HINTS) {
    // Build an id that matches this row and no earlier one.
    const source = re.source;
    const word = (source.match(/\(\?:([a-z_]+)[|)]/) ?? [])[1];
    if (!word) continue;
    const id = `switch.${word}_probe`;
    const gotCat = effectiveCategory(id, "switch");
    const gotKey = iconKeyFor("switch", ent(id));
    if (gotCat === category && gotKey === key) paired++;
    else check(`colour and glyph agree for ${id}`, false,
      `cat ${gotCat}/${category} key ${gotKey}/${key}`);
  }
  check(`all ${paired} hint rows pair their category with their glyph`, paired > 0);

  // The legacy-default rule: "user chose this" vs "auto-assigned, re-bucket".
  eq("a stored category the user genuinely chose wins",
    effectiveCategory("switch.pool_pump", "switch", "comfort"), "comfort");

  // ⚠️ TESTABLE WITH NO DOM — cssVar guards `typeof window === "undefined"`.
  const un = categorySurface("light", "unavailable");
  const alert = categorySurface("light", "alert");
  check("an unavailable device is never danger-red",
    JSON.stringify(un) !== JSON.stringify(alert), JSON.stringify(un));
  check("categorySurface answers with no DOM at all", typeof un === "object" && un !== null);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n— what does a FRESH INSTALL start with —");
// ═══════════════════════════════════════════════════════════════════════════
{
  // ⚠️ THE FIRST HARD RULE, EXECUTED. Nothing villa-specific may ship, and a
  // seed spread UNDER stored config resurrects entries the owner deleted.
  eq("DEFAULT_CONFIG ships no entity map", Object.keys(DEFAULT_CONFIG.entityMap).length, 0);
  eq("…no mesh bindings", Object.keys(DEFAULT_CONFIG.meshBindings).length, 0);
  eq("…no teleport points", DEFAULT_CONFIG.teleportPoints.length, 0);
  eq("…no alert thresholds", Object.keys(DEFAULT_CONFIG.alertThresholds).length, 0);
  eq("…and no site title", DEFAULT_CONFIG.siteTitle, "");

  // ⚠️ THE MERGE DIRECTION, PROVED WITH A SYNTHETIC SEED rather than by the
  // seed happening to be empty today. This is what "deleting one of those
  // entries in the UI silently came back on the next reload" looked like.
  const seeded = { "light.ghost": { entityId: "light.ghost", type: "light" } };
  const merged = { ...seeded, ...({} as Record<string, unknown>) };
  check("a spread seed DOES resurrect an absent key (why the seed must stay empty)",
    Object.keys(merged).length === 1);

  // Through the real entry point, with a real store behind it.
  saveConfig({ ...DEFAULT_CONFIG,
    entityMap: { "cover.x": { entityId: "cover.x", type: "cover" },
                 "cover.x__closed": { entityId: "cover.x__closed", type: "cover" } },
    meshBindings: { "cover.x__closed": "Mesh_1", "cover.x": "Mesh_2" } } as never);
  const loaded = loadConfig();
  check("a stale __variant is dropped from entityMap",
    !("cover.x__closed" in loaded.entityMap));
  check("…and from meshBindings too",
    !("cover.x__closed" in (loaded.meshBindings ?? {})));
  check("…while the real device is untouched", "cover.x" in loaded.entityMap);

  // ⚠️ THE SECOND RESURRECTION SHAPE, which the prose does not describe.
  // `teleportPoints` is LENGTH-gated, not spread: clear every point and the
  // shipped defaults return. Latent only because the default is empty.
  saveConfig({ ...DEFAULT_CONFIG, teleportPoints: [] } as never);
  eq("clearing every teleport point stays cleared",
    loadConfig().teleportPoints.length, 0);

  // And the merge direction itself, at the real entry point.
  saveConfig({ ...DEFAULT_CONFIG,
    entityMap: { "light.kept": { entityId: "light.kept", type: "light" } } } as never);
  const after = loadConfig();
  eq("a stored entity map survives the merge", Object.keys(after.entityMap).length, 1);
  check("…and nothing the owner never asked for joins it",
    !("light.ghost" in after.entityMap));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n— what a TRIAGE pass actually did (the consumer half) —");
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ NEVER EXECUTED BEFORE 2.949.0. These rules lived in a .tsx, which node
// refuses outright, so `test_pass_reason_contract.py` could only assert
// `"outcomeOf(" in panel` about them. Its own docstring names the stakes:
// reword the quiet literal and the Handover page reclassifies every quiet pass
// as "could not run" — a villa whose supervision appears to have failed.
{
  eq("the escalated prefix classifies as RAISED",
    outcomeOf("escalated 2 (investigated 1): pool pump"), "raised");
  eq("the quiet literal classifies as QUIET", outcomeOf(QUIET_REASON), "quiet");
  // ⚠️ DERIVED BY EXCLUSION, so a NEW guard in scheduler._run_once lands here
  // as "could not run" without anybody remembering to update the rule.
  eq("a budget refusal is BLOCKED", outcomeOf("budget: monthly cap reached"), "blocked");
  eq("a triage refusal is BLOCKED", outcomeOf("triage failed: no provider"), "blocked");
  eq("an empty reason is BLOCKED", outcomeOf(""), "blocked");
  check("the two producer literals are the ones scheduler.py writes",
    ESCALATED_PREFIX === "escalated " && QUIET_REASON === "nothing to escalate");

  eq("reasonOf keeps only the human half",
    reasonOf({ detail: "nothing to escalate | doc=900c/40L | escalated=0" }),
    "nothing to escalate");
  eq("…including a reason that itself contains a pipe character",
    reasonOf({ detail: "stopped a|b | doc=1c/1L" }), "stopped a|b");
  eq("…and a missing detail is empty, not a crash", reasonOf({}), "");

  // ⚠️ READ, NOT SUBTRACTED — a pass that stopped for a budget or provider
  // reason must not be counted as having deferred anything.
  eq("deferredOf reads the stated figure",
    deferredOf("escalated 5 (investigated 2, 3 left for next pass): x"), 3);
  eq("…and is 0 when the pass stopped for another reason",
    deferredOf("escalated 5 (investigated 2, stopped; cap reached): x"), 0);

  // ⚠️ "reached 0 of 24" vs "looked twenty times and concluded nothing".
  eq("yieldOf separates looking from finding",
    JSON.stringify(yieldOf("escalated 3 (investigated 20, 0 concerns): x")),
    JSON.stringify({ looked: 20, raised: 0 }));
  eq("…and reads the singular 'concern' too",
    yieldOf("escalated 1 (investigated 2, 1 concern): x").raised, 1);
  eq("…with nothing investigated reading as 0, not absent",
    yieldOf(QUIET_REASON).looked, 0);

  eq("checkIdOf strips a TRAILING -eN", checkIdOf("check-123-e2"), "check-123");
  eq("…and leaves a mid-string -e alone", checkIdOf("check-e2-abc"), "check-e2-abc");
  eq("…and an id with no suffix is unchanged", checkIdOf("check-123"), "check-123");
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n— one answer per question, across surfaces —");
// ═══════════════════════════════════════════════════════════════════════════
{
  // ⚠️ TWO ANSWERS TO "WHAT IS A TAP" ON ONE TABLET, until 2.949.0.
  // CameraPanel had 12px/400ms against TapRecognizer's 14px/500ms — so the
  // same finger was a tap in the 3D villa and a drag on the camera feed.
  eq("the tap slop is the recogniser's generous value", TAP_MOVE_TOL_PX, 14);
  eq("…and the long-press threshold is its 500ms", LONG_PRESS_MS, 500);
  check("both are plain numbers a panel can share without touching the scene",
    typeof TAP_MOVE_TOL_PX === "number" && typeof LONG_PRESS_MS === "number");

  // ⚠️ THE NINTH prettyState. StateTimeline had its own, diverging on
  // whitespace-only input — which renders identically, which is how a ninth
  // copy survives unnoticed.
  eq("not_home reads as a sentence", prettyState("not_home"), "Not home");
  eq("…and whitespace-only trims to empty (the divergence)", prettyState("   "), "");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
