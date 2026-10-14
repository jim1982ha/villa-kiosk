// Settings → Device Telemetry's "Diagnose" (owner, 2026-10-14).
//
// Its "Device" button built this device's report by CAPTURING a made-up MANUAL_DIAGNOSTICS error: every press was sent
// to the fleet's telemetry as an error and became this device's "last error", and the report opened on "[Error]" and a
// stack trace of the click. A report asked for is not an error: the panel asks for buildReport(null) and never captures.
// The paging size is the owner's 10 rows, and the copy reaches the clipboard through the one helper.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { PAGE_ROWS } = await import("@/components/common/paging");

const panel = readFileSync(new URL("../../src/components/settings/TelemetryPanel.tsx", import.meta.url), "utf8");
const diag = readFileSync(new URL("../../src/utils/diagnostics.ts", import.meta.url), "utf8");

ck("the panel never captures an error to build a report", !/captureError/.test(panel));
ck("  ...it asks for this device's report: buildReport(null)", /buildReport\(null\)/.test(panel));
ck("  ...which opens on [Session], not [Error], when no error is given",
   /primary \? "\[Error\]" : "\[Session\]"/.test(diag));
ck("Device and Probe are one Diagnose menu, each result copied", /aria-label="Diagnose"/.test(panel)
   && (panel.match(/copyResult\(text, "/g) ?? []).length === 2 && /import \{ copyText \} from "@\/utils\/clipboard"/.test(panel));
ck("a paged table shows 10 rows", PAGE_ROWS === 10, PAGE_ROWS);

done("✅ Diagnose reports, copies, and logs no fake error");
