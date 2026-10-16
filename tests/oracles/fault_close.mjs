// How a closed fault was closed — the app's side of ONE set of histories (agent-contract.json
// `ticketUpdate.histories`, architecture review 2026-10-15). The app's figures (fmEngine.lastResolution,
// isClearedStep) and the proxy's retention (_fm_last_resolution, _fm_cleared_step) each answered "of the status
// changes in time order, the last close: cleared or repaired?", each tested on histories of its own — and 2.496.372
// had to fix the same misreading on both. tests/store-doors.py drives the proxy through these same cases.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const contract = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8"));
const H = contract.ticketUpdate.histories;
const E = await import("@/fm/fmEngine");

ck("the agreement holds the histories both sides read", Array.isArray(H?.cases) && H.cases.length >= 10, H && Object.keys(H));
const fault = (c, i) => ({ id: `h${i}`, title: c._, status: "resolved", openedAt: c.updates[0]?.at, resolvedAt: c.resolvedAt,
  photoIds: [], updates: c.updates.map((u) => ({ photoIds: [], ...u })) });
H.cases.forEach((c, i) => {
  const t = fault(c, i);
  const last = E.lastResolution(t);
  const got = { last: last ? t.updates.indexOf(last) : null, cleared: last ? E.isClearedStep(last) : null };
  ck(c._, got.last === c.last && got.cleared === c.cleared, got);
  // the figures count it as the card reads it: closed with no action, or a repair
  if (c.cleared !== null) {
    const s = E.ticketStats([t]);
    ck("  ...and the Tickets figures count it so", s.closedWithoutAction === (c.cleared ? 1 : 0) && s.resolved === (c.cleared ? 0 : 1), s);
  }
});

done("✅ the app reads every agreed fault history as the agreement says");
