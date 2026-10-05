// DRY guard 2 of 2: a rule with an OWNER is not written again elsewhere
// (2.496.263). Each owner below existed, documented as "every site goes
// through here", while other sites wrote the rule out themselves — browser
// storage, money, requests behind the session, device names. Scanned over ALL
// of src (never a hand-kept list of files: that is how stored_wake missed the
// sites it was not told about), comments excluded, with each reviewed
// exception named and justified. Dates are ui_dry's, footers modal_shell's,
// copy-paste in general clone_ratchet's.
import { readFileSync } from "node:fs";
import { ck, done, tsFiles } from "../consistency/check.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;
const code = (f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const files = tsFiles(SRC).map((f) => [f.slice(SRC.length), code(f)]);
const where = (re, keep = []) => files.filter(([f, t]) => re.test(t) && !keep.includes(f)).map(([f]) => f);

console.log("  browser storage → utils/storedJson:");
ck("nothing but storedJson touches localStorage (it never throws; six copies once did)",
   where(/\blocalStorage\s*\./, ["utils/storedJson.ts"]).length === 0, where(/\blocalStorage\s*\./, ["utils/storedJson.ts"]));

console.log("\n  money → utils/money (Home Assistant's currency, one look):");
ck("only utils/money writes a currency", where(/style:\s*"currency"/, ["utils/money.ts"]).length === 0, where(/style:\s*"currency"/, ["utils/money.ts"]));
ck("  ...and no second money formatter exists (fmEngine's and energyModel's are gone)",
   where(/export function (formatMoney|fmtMoney)\b/, ["utils/money.ts"]).length === 0);

console.log("\n  requests behind the session → auth/sessionLost.backendFetch:");
// Reviewed: the sign-in calls (a 401 there is the expected answer, not a lost
// session — sessionLost.ts:14-16) and the telemetry beacon (keepalive, fire
// and forget). Everything else talks to the add-on after sign-in.
const BARE_OK = ["auth/sessionLost.ts", "auth/PinVerifier.ts", "auth/pinOutcome.ts", "auth/ProfileContext.tsx", "utils/telemetry.ts"];
const bare = where(/(^|[^\w.])fetch\(/, BARE_OK);
ck("no other module calls fetch() directly — a 401 must report the session lost", bare.length === 0, bare);

console.log("\n  device names → EntityMap.labelOf / useEntityLabel:");
const handFed = where(/displayLabelFor\(\s*(\w+),\s*(?:config\.)?entityMap\[\1\]\?\.label,\s*entities\[\1\]/, ["config/EntityMap.ts"]);
ck("nobody feeds displayLabelFor the entity map and the entity table by hand", handFed.length === 0, handFed);

console.log("\n  the end of a Facility form → components/fm/FormActions:");
ck("no form writes its own Cancel · Save row", where(/className="modal-actions" style=\{\{ marginTop: 8 \}\}/, ["components/fm/FormActions.tsx"]).length === 0,
   where(/className="modal-actions" style=\{\{ marginTop: 8 \}\}/, ["components/fm/FormActions.tsx"]));

console.log("\n  small owners:");
ck("an entity's domain is utils/entityDomain.domainOf's", where(/\.split\("\."\)\[0\]/, ["utils/entityDomain.ts"]).length === 0,
   where(/\.split\("\."\)\[0\]/, ["utils/entityDomain.ts"]));
ck("a hold's length is utils/tapThresholds' (no 480/600 ms literal beside a setTimeout)",
   where(/HOLD_MS\s*=\s*\d|setTimeout\([^)]*,\s*(480|600)\)/, ["utils/tapThresholds.ts"]).length === 0);
ck("an XZ bounding box is utils/geometry.boundsXZ's", where(/let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity/, ["utils/geometry.ts"]).length === 0);

done("✅ every owned rule has one owner");
