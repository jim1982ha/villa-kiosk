// The config-slice guard: a freshly parsed but IDENTICAL slice must not count
// as a change, or every tab focus buys a multi-second rebuild.
import { sliceChanged } from "../../src/babylon/entityMapDiff.ts";
let fail=0; const ck=(n,ok)=>{console.log(`    ${ok?"PASS":"FAIL"}  ${n}`); if(!ok)fail++;};

const groups = [{ primaryEntityId: "light.a", memberEntityIds: ["light.b"] }];
const reparsed = JSON.parse(JSON.stringify(groups));   // what pull() hands over

console.log("  the case that caused four separate field fixes:");
ck("a freshly parsed identical slice is NOT a change", sliceChanged(groups, reparsed) === false);
ck("...and it really is a different object", groups !== reparsed);

console.log("\n  it still detects real changes:");
ck("an added member",   sliceChanged(groups, [{ primaryEntityId:"light.a", memberEntityIds:["light.b","light.c"] }]) === true);
ck("a changed primary", sliceChanged(groups, [{ primaryEntityId:"light.z", memberEntityIds:["light.b"] }]) === true);
ck("an emptied list",   sliceChanged(groups, []) === true);
ck("undefined vs []",   sliceChanged(undefined, []) === true);

console.log("\n  cheap path:");
ck("the same reference short-circuits", sliceChanged(groups, groups) === false);
process.exit(fail?1:0);
