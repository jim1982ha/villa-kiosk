// Oracle for ticketStats: does a fault with a missing/corrupt status still
// reach the facility report? Replays both rules over the same fixture.
const OLD = (t, s) => { // bare else — what main ships
  if (t.status === "open") s.open++;
  else if (t.status === "in_progress") s.inProgress++;
  else s.resolved++;
};
const NEW = (t, s) => { // explicit: unknown counts as open
  if (t.status === "open") s.open++;
  else if (t.status === "in_progress") s.inProgress++;
  else if (t.status !== "resolved") s.open++;
  else s.resolved++;
};
const run = (rule, tickets) => {
  const s = { open: 0, inProgress: 0, resolved: 0 };
  for (const t of tickets) rule(t, s);
  return s;
};

const fixture = [
  { id: "a", status: "open" },
  { id: "b", status: "in_progress" },
  { id: "c", status: "resolved" },
  { id: "d", status: undefined },   // field never written
  { id: "e", status: "" },          // written empty
  { id: "f", status: "Resolved" },  // case drift from a hand edit
  { id: "g", status: "closed" },    // a status this build does not know
];
const o = run(OLD, fixture), n = run(NEW, fixture);
console.log("  fixture: 1 open, 1 in_progress, 1 resolved, 4 with a status this build cannot read\n");
console.log("  rule                 open  inProgress  resolved");
console.log(`  main (bare else)     ${o.open}     ${o.inProgress}           ${o.resolved}`);
console.log(`  fix  (explicit)      ${n.open}     ${n.inProgress}           ${n.resolved}`);

let fail = 0;
const check = (name, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fail++; };
console.log("\n  assertions on the FIX:");
check("the 4 unreadable statuses are reported as open, not resolved", n.open === 5);
check("only the genuinely resolved ticket is resolved", n.resolved === 1);
check("in_progress is untouched", n.inProgress === 1);
check("every ticket is still counted exactly once", n.open + n.inProgress + n.resolved === fixture.length);
console.log("\n  the defect this replaces:");
check("main hid 4 faults by counting them resolved", o.resolved === 5);
process.exit(fail ? 1 : 0);
