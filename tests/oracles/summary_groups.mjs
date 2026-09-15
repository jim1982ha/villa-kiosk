// Oracle for summaryGroups: does a light that is not the villa's get counted?
const ents = {
  "light.lounge":        { entity_id: "light.lounge",        state: "on" },
  "light.terrace":       { entity_id: "light.terrace",       state: "off" },
  "light.wled_helper":   { entity_id: "light.wled_helper",   state: "on" },  // not the villa's
  "light.neighbour_shed":{ entity_id: "light.neighbour_shed",state: "on" },  // not the villa's
  "lock.front":          { entity_id: "lock.front",          state: "locked" },
  "lock.test_lock":      { entity_id: "lock.test_lock",      state: "unlocked" }, // not the villa's
};
const villa = new Set(["light.lounge", "light.terrace", "lock.front"]);

const lights = (allowed) => Object.values(ents).filter(
  (e) => e.entity_id.startsWith("light.") && (!allowed || allowed.has(e.entity_id)));
const locks = (allowed) => Object.values(ents).filter(
  (e) => e.entity_id.startsWith("lock.") && (!allowed || allowed.has(e.entity_id)));

const oldL = lights(undefined), newL = lights(villa);
const oldK = locks(undefined),  newK = locks(villa);
console.log("  fixture: 2 villa lights (1 on), 2 foreign lights (both on)");
console.log("           1 villa lock (locked), 1 foreign lock (unlocked)\n");
console.log(`  lights counted   main ${oldL.length}   fix ${newL.length}`);
console.log(`    of those "on"  main ${oldL.filter(e=>e.state==="on").length}   fix ${newL.filter(e=>e.state==="on").length}`);
console.log(`  locks  counted   main ${oldK.length}   fix ${newK.length}`);
console.log(`    all locked?    main ${oldK.every(l=>l.state==="locked")}   fix ${newK.every(l=>l.state==="locked")}`);

let fail = 0;
const check = (n, ok) => { console.log(`    ${ok?"PASS":"FAIL"}  ${n}`); if(!ok) fail++; };
console.log("\n  assertions on the FIX:");
check("counts only the villa's 2 lights", newL.length === 2);
check("counts only the villa's 1 lock", newK.length === 1);
check('"all doors locked" is now TRUE (a foreign lock no longer holds it false)',
      newK.every(l => l.state === "locked"));
console.log("\n  the defect this replaces:");
check("main counted 4 lights for a villa that has 2", oldL.length === 4);
check("main reported the villa unlocked because of a lock that is not its own",
      !oldK.every(l => l.state === "locked"));
console.log("\n  omitting `allowed` keeps the old behaviour (safe for any unmigrated caller):");
check("lights(undefined) === old count", lights(undefined).length === 4);
process.exit(fail ? 1 : 0);
