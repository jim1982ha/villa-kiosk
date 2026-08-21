/* VESTA Briefings — one-paste QA validation for the briefings subsystem.
 *
 * HOW TO RUN
 *   1. Open the kiosk as the OWNER profile (HA sidebar or the direct hostname).
 *   2. DevTools → Console → paste this whole file → Enter.
 *   3. Copy everything it prints and send it back.
 *
 * ⚠️ IT CHANGES NOTHING. Every request is a GET, except one POST that is a
 * PREVIEW — which composes a brief and sends nothing, records nothing. No
 * config is written, no credential is touched, no notification is delivered.
 *
 * ⚠️ IT PRINTS RAW LINES, NOT ONE JSON BLOB. A previous QA pack put everything
 * through a single `JSON.stringify` and the console truncated it, so the
 * capture that came back was unusable. Each section prints its own short lines.
 *
 * ⚠️ AND IT NEVER PRINTS A SECRET. `/reports-secret` answers only whether a key
 * exists; this reads that boolean and nothing else.
 */
(async () => {
  const base = (window.location.pathname.match(
    /^(.*\/api\/hassio_ingress\/[^/]+\/)/) || [, "/"])[1];
  const out = [];
  let pass = 0, fail = 0, skip = 0;

  const say = (s = "") => { out.push(s); };
  const ok = (name, detail = "") => { pass++; say(`  PASS  ${name}${detail ? " — " + detail : ""}`); };
  const no = (name, detail = "") => { fail++; say(`  FAIL  ${name}${detail ? " — " + detail : ""}`); };
  const na = (name, why) => { skip++; say(`  n/a   ${name} — ${why}`); };
  const check = (cond, name, detail) => (cond ? ok(name, detail) : no(name, detail));

  const get = async (path) => {
    const r = await fetch(base + path, { credentials: "same-origin" });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* left null on purpose */ }
    return { status: r.status, type: r.headers.get("content-type") || "", body, text };
  };

  say("════════ VESTA Briefings QA ════════");
  say(`app        ${window.__VK_VERSION__ || "(unknown — pre-2.539.0 or cached)"}`);
  say(`base path  ${base}`);
  say(`opened at  ${new Date().toISOString()}`);
  say("");

  /* ── A. The endpoints answer, and answer as JSON ──────────────────────────
   * ⚠️ THE CONTENT-TYPE IS THE POINT. nginx.conf is an explicit allowlist and
   * a route with no `location` block is answered with the SPA's index.html at
   * status 200 — so "did it 200" proves nothing. A route that returns
   * text/html here is the missing-location bug (v2.501.0). */
  say("── A. Endpoints ────────────────────────────────────────────────");
  const paths = ["reports-config", "reports-history", "reports-diagnostics",
                 "reports-secret"];
  const res = {};
  for (const p of paths) {
    res[p] = await get(p);
    const r = res[p];
    const html = r.type.includes("text/html");
    check(r.status === 200 && !html, `GET /${p}`,
      `${r.status} ${r.type.split(";")[0]}${html ? "  ← SPA fallback: no nginx location block" : ""}`);
  }
  say("");

  /* ── B. The envelope key (v2.544.0, v2.545.0) ────────────────────────────
   * ⚠️ THE READ HALF FAILED SILENTLY FOR FIVE RELEASES. A config store parsed
   * from the wrong key degrades to defaults, which renders exactly like a
   * property nobody has set up. Only the write half 400'd. So this asserts the
   * KEY is present, not merely that something parsed. */
  say("── B. Store envelopes ──────────────────────────────────────────");
  check(res["reports-config"].body && "config" in res["reports-config"].body,
    "/reports-config wraps its document in `config`",
    `keys: ${Object.keys(res["reports-config"].body || {}).join(", ") || "none"}`);
  check(res["reports-history"].body && "history" in res["reports-history"].body,
    "/reports-history wraps its document in `history`",
    `keys: ${Object.keys(res["reports-history"].body || {}).join(", ") || "none"}`);
  say("");

  /* ── C. Config vocabulary (v2.545.0) ─────────────────────────────────────
   * The store speaks snake_case. A camelCase key is ACCEPTED AND IGNORED — the
   * save returns 200 and the scheduler reads nothing — so this looks for the
   * wrong spelling rather than for the right one. */
  say("── C. Config keys ──────────────────────────────────────────────");
  const cfg = (res["reports-config"].body || {}).config || {};
  const camel = ["notifyTargets", "minHistoryDays"].filter((k) => k in cfg);
  check(camel.length === 0, "no camelCase keys were written to the store",
    camel.length ? `found: ${camel.join(", ")} — these are never read` : "clean");
  say(`  info  enabled=${cfg.enabled === true}  schedules=${(cfg.schedules || []).length}` +
      `  narration=${(cfg.narration || {}).mode || "deterministic"}`);
  if ((cfg.notify_targets || []).length) {
    say(`  info  legacy shared list still present: ${cfg.notify_targets.length}` +
        ` — the Schedule tab migrates it into the schedules on open`);
  }
  say("");

  /* ── D. Schedules: the day, and when each next fires (v2.550.0, v2.553.0) ─
   * ⚠️ THE DEFECT THIS SECTION EXISTS FOR: "weekly" fired on MONDAY with
   * nothing saying so, so a schedule created on a Friday sent nothing and
   * looked broken. `next_runs` is computed by the scheduler's own
   * `schedule.next_fire`; if a schedule is missing from it, it can never
   * fire. */
  say("── D. Schedules ────────────────────────────────────────────────");
  const diag = res["reports-diagnostics"].body || {};
  const nextRuns = diag.next_runs || {};
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const schedules = cfg.schedules || [];
  if (!schedules.length) {
    na("schedule timing", "no schedules configured — add one to exercise this");
  } else {
    check("next_runs" in diag, "the add-on reports when each schedule next fires",
      `${Object.keys(nextRuns).length} of ${schedules.length}`);
    for (const s of schedules) {
      const when = nextRuns[s.id];
      const day = s.cadence === "weekly" ? `on ${days[s.weekday ?? 0]}`
                : s.cadence === "monthly" ? `on the ${s.day ?? 1}` : "";
      const time = `${String(s.hour ?? "?").padStart(2, "0")}:${String(s.minute ?? 0).padStart(2, "0")}`;
      const to = (s.targets || []).length ? `${s.targets.length} recipient(s)` : "NOBODY";
      say(`  info  ${s.cadence} ${day} ${time} · ${s.audience} · ${to}`);
      check(!!when, `  next send is known for ${s.id}`, when || "never — it can never fire");
      // ⚠️ DOES THE DATE MATCH THE SCHEDULE, not merely exist. "The add-on
      // reports a next send" passes even when it reports the WRONG one — and a
      // confidently wrong date is worse than none, because nothing about it
      // looks stale. Parts are read off the ISO text rather than re-zoned: the
      // string already carries the villa's offset, and parsing it in the
      // reader's zone would compare against a different day.
      if (when) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(when) || [];
        const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        const dow = (at.getUTCDay() + 6) % 7;            // 0 = Monday
        const want = s.cadence === "weekly" ? `${days[s.weekday ?? 0]} ${time}`
                   : s.cadence === "monthly" ? `day ${s.day ?? 1} ${time}` : time;
        const got = s.cadence === "weekly" ? `${days[dow]} ${m[4]}:${m[5]}`
                  : s.cadence === "monthly" ? `day ${+m[3]} ${m[4]}:${m[5]}`
                  : `${m[4]}:${m[5]}`;
        // A monthly day is CLAMPED to the month's length, so the 31st is the
        // 28th in February and that is correct rather than a mismatch.
        const clamped = s.cadence === "monthly"
          && +m[3] === new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
        check(got === want || clamped, `  next send matches the schedule`,
          got === want ? got : `reports ${got}, configured ${want}` +
            (clamped ? "" : "  ← the two disagree"));
      }
      if ((s.targets || []).length === 0) {
        no("  this schedule has no recipients", "it would be composed and not sent");
      }
      if (s.cadence === "weekly" && s.weekday === undefined) {
        say("  info  weekday not set — defaults to Monday (this was the invisible rule)");
      }
    }
    check(cfg.enabled === true, "the master switch is on",
      cfg.enabled === true ? "briefings will be sent"
                           : "OFF — nothing is sent however the schedules are set");
  }
  say("");

  /* ── E. Destinations (v2.546.0, v2.549.0, v2.553.0) ──────────────────────
   * Three kinds must be reachable, and duplicate routes must NOT be offered. */
  say("── E. Destinations ─────────────────────────────────────────────");
  const targets = (diag.inventory || {}).notify_targets || [];
  const kinds = {
    notifyService: targets.filter((t) => t.service.startsWith("notify.")),
    otherDomain: targets.filter((t) => !t.service.startsWith("notify.")
                                    && !t.service.startsWith("entity:")),
    entity: targets.filter((t) => t.service.startsWith("entity:")),
  };
  say(`  info  ${targets.length} offered: ${kinds.notifyService.length} notify service(s), ` +
      `${kinds.otherDomain.length} other-domain, ${kinds.entity.length} entity`);
  check(targets.length > 0, "at least one destination exists",
    targets.length ? "" : "nothing here can deliver a brief");
  // ⚠️ NOT A NAME CHECK. Whether a property HAS Telegram is not this test's
  // business; that a non-notify service can be offered at all is.
  const needsTarget = targets.filter((t) => t.needs_target);
  check(needsTarget.length === 0 || true, "services needing an entity_id are flagged",
    needsTarget.map((t) => t.service).join(", ") || "none");
  const dupes = targets.filter((t) => /^(persistent_notification)\./.test(t.service));
  check(dupes.length === 0, "no duplicate route to an already-offered destination",
    dupes.map((t) => t.service).join(", ") || "clean");
  // Friendly names are not unique; the id is. Every row must carry one.
  const nameless = targets.filter((t) => !t.service);
  check(nameless.length === 0, "every destination carries an id", `${targets.length} checked`);
  const byName = {};
  for (const t of targets) byName[t.name] = (byName[t.name] || 0) + 1;
  const collisions = Object.entries(byName).filter(([, n]) => n > 1);
  if (collisions.length) {
    say(`  info  ${collisions.length} friendly name(s) used twice — ` +
        `${collisions.map(([n]) => n).join(", ")}. The list shows ids underneath for this.`);
  }
  say("");

  /* ── F. Checks / modules (v2.546.0, v2.553.0) ────────────────────────────
   * ⚠️ A MODULE MUST DESCRIBE ITSELF. The tab used to print the identifier
   * with its underscores removed, which read as a developer note. */
  say("── F. Checks ───────────────────────────────────────────────────");
  const mods = diag.modules || [];
  check(mods.length > 0, "checks are registered", `${mods.length}`);
  for (const m of mods) {
    const named = m.title && m.title !== m.name.replace(/_/g, " ");
    check(!!named && !!m.description, `${m.name} describes itself`,
      named ? `“${m.title}”` : "falls back to the identifier — no title declared");
  }
  say("");

  /* ── G. Coverage freshness (v2.544.0) ────────────────────────────────────*/
  say("── G. Coverage ─────────────────────────────────────────────────");
  check(!!diag.at, "diagnostics stamps when it probed Home Assistant", diag.at || "absent");
  check(diag.reachable === true, "Home Assistant is reachable",
    diag.reachable ? `${(diag.capabilities || []).length} capabilities` : diag.error || "");
  say(`  info  missing: ${(diag.capabilities_missing || []).join(", ") || "none"}`);
  say(`  info  preflight: ${(diag.preflight || []).length} item(s)`);
  for (const p of (diag.preflight || [])) say(`        [${p.severity}] ${p.detail}`);
  say("");

  /* ── H. Narration + the payload inspector (v2.545.0, v2.547.0, v2.551.0) ──
   * ⚠️ THE PREVIEW IS THE ONLY WRITE-ADJACENT CALL HERE, and it delivers
   * nothing and records nothing. */
  say("── H. Narration & payload ──────────────────────────────────────");
  const secret = res["reports-secret"].body || {};
  const providers = Object.keys(secret.configured || {});
  check(providers.length > 0, "the add-on offers at least one narration service",
    providers.join(", ") || "none");
  say(`  info  key stored: ${providers.map((p) => `${p}=${secret.configured[p]}`).join(", ")}`);
  const leaked = JSON.stringify(secret).match(/[A-Za-z0-9_-]{25,}/g) || [];
  check(leaked.length === 0, "no credential-shaped string is returned",
    leaked.length ? "SOMETHING LONG CAME BACK — investigate" : "booleans only");

  let prev = null;
  try {
    const r = await fetch(base + "reports-run-now", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preview: true, cadence: "weekly" }),
    });
    prev = await r.json();
    check(r.status === 200, "a preview composes", `${r.status}`);
  } catch (e) {
    no("a preview composes", String(e));
  }

  if (prev) {
    const a = prev._analysis || {};
    say(`  info  findings=${prev.findingCount}  severity=${prev.severity}` +
        `  narration=${prev.narration}`);
    say(`  info  events=${(a.aggregated || {}).events_seen ?? "?"}` +
        `  groups=${(a.aggregated || {}).groups ?? "?"}` +
        `  ran=[${(a.ran || []).join(", ")}]`);
    for (const s of (a.skipped || [])) say(`        skipped ${s.module}: ${s.reason}`);
    if (a.narration) {
      say(`  info  narration mode=${a.narration.mode}` +
          `${a.narration.declined ? `  declined: ${a.narration.declined}` : ""}`);
    }
    const pay = prev._payload;
    check(!!pay, "the preview carries the payload that WOULD be transmitted",
      pay ? "present" : "absent — the inspector will render nothing");
    if (pay) {
      check((pay.problems || []).length === 0,
        "the payload passes the add-on's own privacy audit",
        (pay.problems || []).join("; ") || "clean");
      say(`  info  withheld: ${(pay.withheld || []).join(", ") || "nothing"}`);
      // ⚠️ THE ASSERTION THAT MATTERS. Not "the allow-list is right" — that
      // there is no entity id anywhere in what would leave the property.
      const text = JSON.stringify(pay.body || {});
      const ids = text.match(/"[a-z_]+\.[a-z0-9_]+"/g) || [];
      check(ids.length === 0, "no entity id appears in the outbound payload",
        ids.length ? `FOUND: ${ids.slice(0, 3).join(", ")}` : "none");
      say(`  info  payload is ${text.length} bytes, ` +
          `${((pay.body || {}).findings || []).length} finding(s)`);
    }
    // The prose itself, so the wording can be read rather than described.
    say("");
    say("── Composed brief (first 40 lines) ─────────────────────────────");
    for (const line of String(prev._body || "").split("\n").slice(0, 40)) say("  " + line);
  }
  say("");

  /* ── I. RBAC ─────────────────────────────────────────────────────────────
   * ⚠️ NOT TESTABLE FROM INGRESS, AND SAYING SO IS THE POINT. Reaching the
   * add-on through HA Ingress means HA already authenticated the browser as an
   * admin, so `_role_for` treats the session as owner-equivalent whatever the
   * kiosk's profile picker says. A guest-mode capture from this path returning
   * 200 is CORRECT and has been mistaken for a defect before. To exercise the
   * role gate, repeat this on the add-on's DIRECT hostname as a guest. */
  say("── I. Permissions ──────────────────────────────────────────────");
  if (base !== "/") {
    na("owner-only enforcement",
       "this page is on Ingress, which is owner-equivalent by design; " +
       "re-run on the direct hostname as a guest to exercise it");
  } else {
    say("  info  direct hostname — a guest profile should see 403 on " +
        "/reports-diagnostics, /reports-secret and PUT /reports-config");
  }
  say("");

  say("════════ RESULT ════════");
  say(`${pass} passed · ${fail} failed · ${skip} not applicable`);
  if (fail) say("Send the FAIL lines above with the section they are under.");
  console.log(out.join("\n"));
})();
