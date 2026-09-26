// The villa's live device model, owned once (config/VillaModel, round 10,
// 2.496.161): the readers ask it; nobody threads `mappedEntityIds` by hand or
// rebuilds the device set or the attention count.
import { readFileSync } from "node:fs";
let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const readers = ["components/hud/HUD.tsx", "components/hud/SummaryBar.tsx", "components/cockpit/CockpitModal.tsx",
  "components/fm/FacilityModal.tsx", "components/panels/SummaryGroupPanel.tsx"];
const threaded = readers.filter((f) => /mappedEntityIds[=:]\s*(\{|Set<)/.test(src(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")));
ck("no reader takes or passes mappedEntityIds as a prop", threaded.length === 0, threaded);
ck("the Dashboard provides the model once, from the set it builds", /<VillaModelProvider mappedEntityIds=\{effectiveMappedEntityIds\}>/.test(src("pages/Dashboard.tsx")));
const hook = src("components/cockpit/useVillaAttention.ts");
ck("the attention count is the model's — computed once, for the HUD badge and the Cockpit alike",
   /return useVillaModel\(\)\.attention;/.test(hook) && !/buildAttentionItems\(/.test(hook) && /buildAttentionItems\(/.test(src("config/VillaModel.tsx")));
ck("the bottom bar counts the VISIBLE devices; the Facility the full set",
   /visibleDevices: villaDeviceSet \} = useVillaModel\(\)/.test(src("components/hud/SummaryBar.tsx")) && /const \{ devices \} = useVillaModel\(\);/.test(src("components/fm/FacilityModal.tsx")));
if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ the villa's device model, owned once");
