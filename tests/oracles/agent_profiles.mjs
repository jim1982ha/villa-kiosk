// The agreement's `profiles` (rootfs/usr/share/vesta/agent-contract.json): each profile's words and what it may read,
// as the VESTA Agent reads them, held equal to the Kiosk's own answers (architecture review round 8, 2026-10-30).
//
// A guest asking VESTA on the tablet ("Is anyone home? Any movement upstairs?") was answered from the people and the
// motion sensors the guest's tablet hides: the Agent never read the role table (rootfs/usr/share/vesta/roles.json),
// and wrote its own role words ("Facility Manager", "FM") beside the tablet's ("Facility manager"). One owner per
// predicate: the agreement carries the Kiosk's answer, and this drives the Kiosk's resolvers (src/auth/permissions.ts,
// src/auth/roles.ts) by value against it. The proxy's half (`domains`, _read_allowed) is tests/proxy-rules.py's.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { hasCapability, isCategoryAllowed, isTypeAllowed } = await import("@/auth/permissions");
const R = await import("@/auth/roles");
const { CATEGORY_ORDER } = await import("@/config/EntityCategories");
const { ENTITY_DOMAINS } = await import("@/types/ha.types");

const read = (name) => JSON.parse(readFileSync(new URL(`../../rootfs/usr/share/vesta/${name}`, import.meta.url), "utf8"));
const contract = read("agent-contract.json");
const table = read("roles.json").profiles;
const P = contract.profiles;
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));

console.log("  one entry per profile:");
ck("the agreement's profiles are exactly the app's", sameSet(Object.keys(P ?? {}), R.ROLE_ORDER), Object.keys(P ?? {}));
ck("and exactly the ones a tablet conversation answers (conversation.profiles)",
   sameSet(Object.keys(contract.conversation.profiles), R.ROLE_ORDER), contract.conversation.profiles);

console.log("\n  the words are the role table's, as the app shows them:");
for (const [field, app] of [["label", R.ROLE_LABELS], ["short", R.ROLE_SHORT], ["initials", R.ROLE_INITIALS],
  ["description", R.ROLE_DESCRIPTIONS]]) {
  ck(`${field}: the agreement's, the table's and the app's are one`,
     R.ROLE_ORDER.every((r) => typeof P[r][field] === "string" && P[r][field] && P[r][field] === table[r][field]
       && app[r] === P[r][field]), R.ROLE_ORDER.map((r) => `${r}: ${P[r][field]} / ${table[r][field]} / ${app[r]}`));
}
ck("formerLabels: the table's", R.ROLE_ORDER.every((r) => JSON.stringify(P[r].formerLabels ?? [])
   === JSON.stringify(table[r].formerLabels ?? [])), R.ROLE_ORDER.map((r) => P[r].formerLabels));
// the owner's rule (2026-10-30): "Facility Manager", capital M, everywhere
ck("the facility profile is named Facility Manager, FM where space is tight",
   R.ROLE_LABELS.ops === "Facility Manager" && R.ROLE_SHORT.ops === "FM", [R.ROLE_LABELS.ops, R.ROLE_SHORT.ops]);

console.log("\n  what each profile reads is what the app shows it:");
for (const r of R.ROLE_ORDER) {
  const reads = P[r].reads;
  // deniedTypes: every device type the app knows, asked of the app's own resolver
  const hidden = ENTITY_DOMAINS.filter((t) => !isTypeAllowed(r, t));
  ck(`${r}: deniedTypes are the types the app hides (isTypeAllowed)`,
     Array.isArray(reads.deniedTypes) && sameSet(reads.deniedTypes, hidden), [reads.deniedTypes, hidden]);
  const shown = CATEGORY_ORDER.filter((c) => isCategoryAllowed(r, c));
  ck(`${r}: categories are the ones the app shows (isCategoryAllowed), "all" when every one`,
     shown.length === CATEGORY_ORDER.length ? reads.categories === "all"
       : Array.isArray(reads.categories) && sameSet(reads.categories, shown), [reads.categories, shown]);
  ck(`${r}: people exactly when the app shows them (seePeople)`, reads.people === hasCapability(r, "seePeople"));
  ck(`${r}: every domain only for the profile the proxy holds to no read rule (administer)`,
     (reads.domains === "all") === hasCapability(r, "administer"), reads.domains);
}
// the case the review found, said in the owner's words: a guest's VESTA hears of no person, no motion, no camera
ck("a guest reads no person, no motion sensor, no camera",
   P.guest.reads.people === false && P.guest.reads.deniedTypes.includes("binary_sensor")
   && !P.guest.reads.domains.includes("camera") && !P.guest.reads.domains.includes("person"), P.guest.reads);

console.log("\n  a step's author, from its id or its old words:");
ck("a profile's stamp is its id and its label",
   R.ROLE_ORDER.every((r) => { const s = R.authorStamp(r); return s.role === r && s.by === R.ROLE_LABELS[r]; }));
ck("an old step's words read as their profile, the current label or a former one",
   R.roleOfStamp({ by: "Facility manager" }) === "ops" && R.roleOfStamp({ by: R.ROLE_LABELS.owner }) === "owner"
   && R.authorWords({ by: "Facility manager" }) === "Facility Manager");
ck("the id wins over the words (a renamed profile renames its old steps)",
   R.authorWords({ role: "ops", by: "Ops" }) === R.ROLE_LABELS.ops && R.roleOfStamp({ role: "guest", by: "Owner" }) === "guest");
ck("the VESTA Agent's stamp and a typed name are nobody's profile, shown as written",
   R.roleOfStamp({ by: contract.ticket.agentStamp }) === null && R.authorWords({ by: contract.ticket.agentStamp }) === contract.ticket.agentStamp
   && R.authorWords({ by: "Wayan" }) === "Wayan" && R.authorWords(undefined) === "" && R.authorWords({ role: "nobody" }) === "");

done("✅ the agreement carries each profile's words and reads as the Kiosk has them");
