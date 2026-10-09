// A colour that tells one series from another must not say anything else (architecture review 11, 2026-10-09).
//
// The four status colours mean one thing each, everywhere (STATUS_COLOR): red is "needs attention", amber
// "Home Assistant lost contact". The Energy window handed its meters and devices colours BY POSITION, and six
// of those slots were mixed from --status-danger / --status-warning: the third meter was drawn in the alarm
// red because of the order it was listed in. The grouped device window had already stated the rule; this
// enforces it on every series palette.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const css = readFileSync(new URL("../../src/styles/03-panels.css", import.meta.url), "utf8");
// Every rule whose selector is ONE energy slot: ".e-s2 { --e: … }".
const slots = [...css.matchAll(/^\.(e-[a-z0-9]+)\s*\{([^}]*)\}/gm)].map((m) => ({ cls: m[1], body: m[2] }));
ck("the scan found the Energy slots", slots.length >= 18, slots.length);
const STATUS_ON_PURPOSE = new Set(["e-standout"]); // a day well above typical IS "needs attention"
const bad = slots.filter((s) => !STATUS_ON_PURPOSE.has(s.cls) && /--status-/.test(s.body)).map((s) => s.cls);
ck("no Energy series slot is mixed from a status colour", bad.length === 0, bad);
ck("  ...the standout day keeps its red (the one slot that IS an alert)", /--status-danger/.test(slots.find((s) => s.cls === "e-standout")?.body ?? ""));

const dg = readFileSync(new URL("../../src/components/panels/DeviceGroupPanel.tsx", import.meta.url), "utf8");
const palette = dg.match(/const SERIES_COLORS = \[([^\]]*)\]/)?.[1] ?? "";
ck("the grouped device window's series palette names no status colour", palette !== "" && !/--status-/.test(palette), palette);

done("✅ series colours carry no status meaning");
