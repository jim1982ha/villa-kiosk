// What a badge's value line reads: a device group's readings joined, and any line cut to what its container draws.
//
// It was private to EntityVisuals (groupedValue, clampToLabelWidth) until 2026-11-21; the cut decides the width the
// placement solver reserves, so a line longer than the container grouped badges early (/dry-audit 2.423.0).
import { ck, done } from "../consistency/check.mjs";
const { groupValueText, clampToLabelWidth, GROUP_VALUE_SEPARATOR } = await import("@/babylon/badgeValueText");
const { badgeMetricsFor } = await import("@/babylon/badgeMetrics");

for (const pointer of ["coarse", "fine"]) {
  const m = badgeMetricsFor(pointer);
  for (const card of [false, true]) {
    const where = `${pointer} ${card ? "card" : "classic"}`;
    console.log(`  ${where}:`);
    ck("a temp+humidity pair reads both, in order", groupValueText("24°C", ["58%"], m, card) === `24°C${GROUP_VALUE_SEPARATOR}58%`,
      groupValueText("24°C", ["58%"], m, card));
    ck("a member with no reading adds no separator", groupValueText("24°C", ["", "58%", ""], m, card) === `24°C${GROUP_VALUE_SEPARATOR}58%`);
    ck("a primary with no reading starts at its first member", groupValueText("", ["58%"], m, card) === "58%");
    ck("nothing to read is an empty line", groupValueText("", ["", ""], m, card) === "");

    const long = groupValueText("1234.5 kWh", ["6570.9 W", "230.1 V", "12.34 A", "49.98 Hz"], m, card);
    const raw = ["1234.5 kWh", "6570.9 W", "230.1 V", "12.34 A", "49.98 Hz"].join(GROUP_VALUE_SEPARATOR);
    ck("a five-reading group is cut, with an ellipsis", long.length < raw.length && long.endsWith("…"), long);
    ck("  ...and still starts with the primary's reading", long.startsWith("1234.5 kWh"), long);
    ck("  ...and a cut line is not cut again", clampToLabelWidth(long, m, card) === long);
    ck("a line that fits is left as it is", clampToLabelWidth("21.5°C", m, card) === "21.5°C");
  }
}

{
  const m = badgeMetricsFor("coarse");
  const text = "x".repeat(200);
  const narrow = clampToLabelWidth(text, { ...m, labelMaxWidthPx: m.labelMaxWidthPx / 2 }, false);
  const wide = clampToLabelWidth(text, m, false);
  ck("a narrower container cuts the same line shorter", narrow.length < wide.length, [narrow.length, wide.length]);
  ck("a container too narrow for one character still shows one and the ellipsis",
    clampToLabelWidth("abc", { ...m, labelMaxWidthPx: 0 }, false) === "a…");
}

done("✅ badge value text: group readings joined, cut to the container");
