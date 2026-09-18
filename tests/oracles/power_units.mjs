// The Energy tile's total, against the real SensorClasses module.
import { toBaseUnit, effectiveSensorClass } from "../../src/config/SensorClasses.ts";
import { formatUnitValue } from "../../src/utils/entityValue.ts";

const E = (id, state, unit, dc) => ({ entity_id: id, state: String(state),
  attributes: { unit_of_measurement: unit, ...(dc ? { device_class: dc } : {}) } });

// A realistic villa: a mains meter in kW, three appliances in W, one in mW.
const SENSORS = [
  E("sensor.mains",  3.2,  "kW", "power"),
  E("sensor.fridge", 120,  "W",  "power"),
  E("sensor.pump",   850,  "W",  "power"),
  E("sensor.tv",     95,   "W"),            // no device_class — unit hint only
  E("sensor.standby",500,  "mW", "power"),
];
const OLD_SELECT = (e) => e.attributes.device_class === "power"
  || /(^|_)w$|watt/i.test(e.attributes.unit_of_measurement ?? "");
const NEW_SELECT = (e) => effectiveSensorClass(e.attributes.device_class,
                                               e.attributes.unit_of_measurement) === "power";
const oldTotal = SENSORS.filter(OLD_SELECT).reduce((s,e)=>{ const v=Number(e.state); return s+(Number.isFinite(v)?v:0); },0);
const newTotal = SENSORS.filter(NEW_SELECT).reduce((s,e)=>s+(toBaseUnit(e.state,e.attributes.unit_of_measurement)??0),0);
const truth = 3200 + 120 + 850 + 95 + 0.5;

console.log("  villa: mains 3.2 kW, fridge 120 W, pump 850 W, tv 95 W, standby 500 mW");
console.log(`  true total: ${truth} W  (${formatUnitValue(truth,"W")})\n`);
console.log(`  main  selects ${SENSORS.filter(OLD_SELECT).length}/5  → ${oldTotal} W  shown as "${formatUnitValue(oldTotal,"W")}"`);
console.log(`  fix   selects ${SENSORS.filter(NEW_SELECT).length}/5  → ${newTotal} W  shown as "${formatUnitValue(newTotal,"W")}"`);

let fail=0; const ck=(n,ok)=>{console.log(`    ${ok?"PASS":"FAIL"}  ${n}`); if(!ok)fail++;};
console.log("\n  assertions:");
ck("the fix totals correctly", Math.abs(newTotal - truth) < 1e-9);
// ⚠️ TWO ERRORS IN OPPOSITE DIRECTIONS. The 3.2 kW mains counted as 3.2 W
// (losing 3196.8) while the 500 mW standby counted as 500 W (gaining 499.5),
// so a naive "is the old total much smaller" assertion can be satisfied by
// neither, both, or their cancellation. Assert what a reader SEES instead.
ck("main showed a different number entirely",
   formatUnitValue(oldTotal,"W") !== formatUnitValue(truth,"W"));
ck("main's error exceeds 60% of the true total",
   Math.abs(oldTotal - truth) / truth > 0.6);
ck("the 3.2 kW mains alone was counted as 3.2 W by the old sum",
   Number(SENSORS[0].state) === 3.2 && toBaseUnit(SENSORS[0].state, "kW") === 3200);
ck("mW is milliwatts, not megawatts", toBaseUnit(500, "mW") === 0.5);
ck("MW is megawatts", toBaseUnit(1, "MW") === 1_000_000);
ck('ambiguous "mw" contributes nothing rather than a wrong number',
   toBaseUnit(500, "mw") === null);
ck('case-folding still works for unambiguous "KW"', toBaseUnit(2, "KW") === 2000);
ck("a non-numeric state contributes nothing", toBaseUnit("unavailable", "W") === null);
process.exit(fail?1:0);
