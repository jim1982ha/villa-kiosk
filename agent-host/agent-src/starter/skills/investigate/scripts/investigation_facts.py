"""The facts of an investigation, from its records — what the page states beside what the AI says it means.

⚠️ FACTS FROM CODE (owner, 2026-10-11: "the investigate skill is not providing any added-value against a 'normal'
query"). What the records PROVE is laid out by code, from the investigate skill's own readings — the AI only explains
it. ⚠️ GROUPED, IN PLAIN WORDS (owner, 2026-10-12: "you keep repeating the same lines … group the findings per
information they are providing"): one entry per KIND of finding, its devices listed under it.

  log        every moment, in time order, each marked "unusual" (a period flagged against the device's own normal, a
             device that stopped answering), "usual" (an automation that ran, a device back) or "reported" (what the
             account says a person saw or did)
  findings   grouped: what the records rule out (switches that stayed off, automations that can only notify, leads the
             records contradict), what to check (an automation that could act on a device read here, or not readable),
             and what the records cannot tell (no reading kept, a history cut short, and the AI's own)
  alerts     per device, each limit once: when an alert on it would have fired, how long before the trouble ended, and
             the other times it would have fired again
  key        the one line of facts the chat message starts with
  lanes      what else happened, on the charts' time axis (the strip under them)

Nothing here knows a device, a room or a villa: every name, time and limit comes from the readings
(investigate.py timeline / around --out), which carry the settings they were judged with.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from vesta_shared import periods                         # the period kinds and their words (investigate.py's)
from vesta_shared.past import unread                     # the one "could not be read whole: nothing is known after"
from vesta_shared.periods import did
from vesta_shared.timeutil import day_time_label, lasting  # the one day format, the one duration wording


def _on(a: dict) -> str:
    """What an automation that can change things acts on: the devices it names, else its kinds of action."""
    named = [t.get("name") or t.get("id") for t in a.get("targets") or []]
    return ", ".join(named[:6]) + (f" and {len(named) - 6} more" if len(named) > 6 else "") if named else \
        "(" + ", ".join(a.get("changes") or []) + ")"


def _t(iso) -> datetime | None:
    try:
        return datetime.fromisoformat(str(iso))
    except (TypeError, ValueError):
        return None


class _Clock:
    """Times as the page writes them: "03:09", with the day when the period spans several."""

    def __init__(self, data: dict):
        self.zone = ZoneInfo(data.get("zone") or "UTC")
        a, b = _t(data.get("start")), _t(data.get("end"))
        self.days = bool(a and b and (b - a).total_seconds() > 86400)

    def __call__(self, t: datetime) -> str:
        t = t.astimezone(self.zone)
        return day_time_label(t) if self.days else f"{t:%H:%M}"


def _flagged(data: dict) -> list[dict]:
    """Every unusual period of every device, in time order: {name, kind, start, end, seconds, why, alert}."""
    out = []
    for e in data.get("entities") or []:
        for p in e.get("periods") or []:
            a, b = _t(p.get("start")), _t(p.get("end"))
            if p.get("why") and a and b:
                out.append({"name": e.get("label") or e.get("entity_id"), "kind": p.get("kind") or "",
                            "start": a, "end": b, "seconds": float(p.get("seconds") or (b - a).total_seconds()),
                            "why": p["why"], "alert": p.get("alert")})
    return sorted(out, key=lambda x: x["start"])


def _grouped(items: list[dict], clock) -> list[list[dict]]:
    groups: dict[str, list[dict]] = {}
    for x in sorted(items, key=lambda x: x["at"]):
        groups.setdefault(clock(_t(x["at"])), []).append(x)
    return list(groups.values())


def _near(t: datetime, moments: list[datetime], within: float) -> bool:
    return any(abs((t - m).total_seconds()) <= within for m in moments)


def _and(xs: list[str]) -> str:
    """"a, b and c" — a list as a person says it."""
    xs = [str(x) for x in xs if str(x)]
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


def _names(xs: list[str], most: int = 8) -> str:
    return ", ".join(xs[:most]) + (f" and {len(xs) - most} more" if len(xs) > most else "")


def facts(data: dict | None, around: dict | None, notes: dict | None = None) -> dict:
    """The page's facts from investigate.py's readings (`data`: timeline --out, `around`: around --out) and the AI's
    account (`notes`: only its leads judged "not supported", what it cannot tell and the moments a person reported)."""
    data, around, notes = data or {}, around or {}, notes or {}
    clock = _Clock(data if data.get("zone") else around)
    within = float((data.get("settings") or around.get("settings") or {}).get("coincide_s") or 0)
    flagged = _flagged(data)
    # ⚠️ NEXT TO WHAT BEGAN (2026-10-11, on the villa's records): with the ends too, 22 moments ± 10 min covered half the
    # day and every automation of the day looked "next to" the trouble. A cause comes before or at a start.
    moments = [f["start"] for f in flagged]
    rows: list[dict] = []
    off_controls, harmless, contradicted, check, cannot = [], [], [], [], []
    warned: dict[str, dict[str, list]] = {}

    # ------------------------------------------------------------------ each device, against its own normal
    ran = [e for e in data.get("entities") or [] if e.get("runs") and not e.get("control")]
    for f in flagged:
        rows.append({"at": f["start"], "pill": "unusual",
                     "text": f"{f['name']} {did(f['kind'])} "
                             f"{'in' if periods.base(f['kind']) == periods.RESTARTS else 'for'} {lasting(f['seconds'])}, "
                             f"until {clock(f['end'])} — {f['why']}"})
        al = f.get("alert") or {}
        fired = _t(al.get("at"))
        # ⚠️ EARLIER MEANS IN TIME TO MATTER: an alert 11 s before a 71-s drop-out ended warned of nothing — only one
        # that fires in the first half of the trouble is said
        if fired and al.get("rule") and (f["end"] - fired) >= (fired - f["start"]):
            warned.setdefault(f["name"], {}).setdefault(al["rule"], []).append((fired, f))
    who = ", ".join(r.get("label") or r.get("entity_id") for r in ran)
    days = data.get("baseline_days")
    before = f" and the {days:g} days before" if isinstance(days, (int, float)) and days > 0 else ""
    for e in data.get("entities") or []:
        name = e.get("label") or e.get("entity_id")
        if e.get("nothing"):
            cannot.append(f"{name}: no reading of it was kept in this period, so it cannot be judged.")
        cut = _t(e.get("cut"))
        if cut:
            cannot.append(f"{name}: {unread('its records', clock(cut))}.")
        if e.get("control") == "off" and ran:
            off_controls.append(name)
        elif e.get("control") == "on" and ran:
            cannot.append(f"{name} stayed on for the whole period{before}: it may supply {who}, but its state does "
                          "not explain their starts and stops.")

    # ------------------------------------------------------------------ what else happened next to those moments
    read = {e.get("entity_id") for e in data.get("entities") or []}      # their own drop-outs are flagged above
    went = [x for x in around.get("offline") or [] if _t(x.get("at")) and x.get("id") not in read]
    near_went = [x for x in went if _near(_t(x["at"]), moments, within)]
    near_ids = {x.get("id") for x in near_went}
    came = [x for x in around.get("back") or [] if x.get("id") in near_ids and _t(x.get("at"))]
    for xs in _grouped(near_went, clock):
        rows.append({"at": _t(xs[0]["at"]), "pill": "unusual",
                     "text": _names([x["name"] for x in xs]) + (" stops" if len(xs) == 1 else " stop") + " reporting"})
    for xs in _grouped(came, clock):
        rows.append({"at": _t(xs[0]["at"]), "pill": "usual",
                     "text": _names([x["name"] for x in xs]) + (" reports" if len(xs) == 1 else " report") + " again"})

    acted, unproven, harmless_other = [], [], 0
    for a in around.get("automations") or []:
        times = [t for t in (_t(x) for x in a.get("times") or []) if t]
        close = [t for t in times if _near(t, moments, within)]
        if not close:
            harmless_other += a.get("can") == "nothing"
            continue
        if a.get("can") == "nothing":
            harmless.append(f"{a.get('name')} ({_and(a.get('does') or []) or 'nothing'})")
            what = "it only " + (_and(a.get("does") or []) or "watches")
        elif a.get("can") == "changes":
            acted.append((a, close))
            what = "it can act on " + _on(a)
        else:
            unproven.append((a, close))
            what = "what it can do could not be read"
        for t in close[:3]:
            rows.append({"at": t, "pill": "usual", "text": f"Automation “{a.get('name')}” runs — {what}"})
    for a, close in acted:
        mine = {t.get("id") for t in a.get("targets") or []} & read
        if mine or not a.get("targets"):
            check.append(f"Automation “{a.get('name')}” ran at {clock(close[0])} and can act on {_on(a)}"
                         + (" — one of the devices read here: check whether it did." if mine else
                            " — its targets could not be read: check whether it acted on the device."))
    for a, close in unproven:
        check.append(f"Automation “{a.get('name')}” ran at {clock(close[0])}, but what it can do could not be read: "
                     "it is neither proven nor ruled out.")

    # ------------------------------------------------------------------ the AI's account: only what it adds
    for c in notes.get("causes") or []:
        if isinstance(c, dict) and c.get("verdict") == "not supported":
            contradicted.append(f"{c.get('cause')}" + (f" — {c['evidence']}" if c.get("evidence") else ""))
    cannot += [str(x) for x in notes.get("cannot_tell") or [] if str(x).strip()]
    told = [r for r in notes.get("timeline") or [] if isinstance(r, dict) and r.get("text")]

    findings = []
    if off_controls or harmless or harmless_other or contradicted:
        out = []
        if off_controls:
            out.append({"lead": f"Stayed off for the whole period{before}, so it did not turn {who} on:",
                        "items": off_controls})
        if harmless or harmless_other:
            out.append({"lead": "Ran next to an unusual moment, but can only notify or record, so it switched nothing:",
                        "items": harmless + ([f"and {harmless_other} other automation"
                                              f"{'s' if harmless_other > 1 else ''} that ran in the period (the same)"]
                                             if harmless_other else [])})
        if contradicted:
            out.append({"lead": "Leads the records contradict:", "items": contradicted})
        findings.append({"title": "Ruled out", "groups": out})
    if check:
        findings.append({"title": "To check", "groups": [{"lead": "", "items": check}]})
    if cannot:
        findings.append({"title": "What the records cannot tell", "groups": [{"lead": "", "items": cannot}]})

    alerts = [{"name": name, "items": [
        {"rule": rule, "at": clock(times[0][0]), "ahead": lasting((times[0][1]["end"] - times[0][0]).total_seconds()),
         "what": did(times[0][1]["kind"]), "span": f"{clock(times[0][1]['start'])}–{clock(times[0][1]['end'])}",
         "again": [clock(t) for t, _ in times[1:]]} for rule, times in rules.items()]}
        for name, rules in warned.items()]

    rows.sort(key=lambda r: r["at"])
    log = [{"time": clock(r["at"]), "text": r["text"], "pill": r["pill"]} for r in rows[:80]]
    # what a person saw or did is not in the records: kept, marked as reported, after the recorded moments
    log += [{"time": str(r.get("time") or ""), "text": str(r["text"]), "pill": "reported"} for r in told]
    return {"log": log, "findings": findings, "alerts": alerts, "recorded": bool(rows),
            "key": key_line(flagged, clock), "lanes": _lanes(data, near_went, acted, unproven),
            # what the page states, for the AI to read back before sending (compose.py's result)
            "established": [r["text"] for r in log if r["pill"] == "unusual"],
            "ruled_out": [f"{g['lead']} {', '.join(g['items'])}".strip() for f in findings if f["title"] == "Ruled out"
                          for g in f["groups"]]}


def _lanes(data: dict, went: list[dict], acted: list, unproven: list) -> list[dict]:
    """The strip under the charts: a lane per device read that gave no numbers (its states as bands), then the other
    devices that stopped answering and the automations that could act — each only when it has something to show."""
    end = _t(data.get("end"))
    out = []
    for e in data.get("entities") or []:
        states = [s for s in e.get("states") or [] if _t(s.get("at"))]
        if not states or not end:
            continue
        # the last band ends where its reading stopped, never at the period's end past it (vesta_shared.past)
        last = min(end, _t(e.get("cut")) or end)
        bands = [{"start": _t(s["at"]), "end": _t(states[i + 1]["at"]) if i + 1 < len(states) else last,
                  "state": s.get("state"), "as": s.get("as")} for i, s in enumerate(states)]
        out.append({"name": e.get("label") or e.get("entity_id"), "bands": bands})
    if went:
        out.append({"name": "Other devices that stopped reporting", "marks": [
            {"at": _t(xs[0]["at"]), "text": ", ".join(x["name"] for x in xs), "as": "went"}
            for xs in _grouped(went, lambda t: t.replace(second=0, microsecond=0))]})
    marks = [{"at": t, "text": f"“{a.get('name')}” (can act on: {_on(a)})", "as": "can_act"}
             for a, close in acted for t in close] + \
            [{"at": t, "text": f"“{a.get('name')}” (what it can do could not be read)", "as": "unproven"}
             for a, close in unproven for t in close]
    if marks:
        out.append({"name": "Automations that could act", "marks": sorted(marks, key=lambda m: m["at"])})
    return out


KEY_MAX = 200


def key_line(flagged: list[dict], clock) -> str:
    """The facts the chat message starts with: the LONGEST unusual periods (the page has them all), as many as fit in
    KEY_MAX, said per device in time order — never more than KEY_MAX characters."""
    def said(chosen: list[dict]) -> str:
        by: dict[str, list[dict]] = {}
        for f in sorted(chosen, key=lambda f: f["start"]):
            by.setdefault(f["name"], []).append(f)
        out = "; ".join(name + ": " + ", ".join(f"{did(f['kind'])} {clock(f['start'])}–{clock(f['end'])} "
                                                f"({lasting(f['seconds'])})" for f in fs) for name, fs in by.items())
        more = len(flagged) - len(chosen)
        return "Recorded: " + out + (f"; +{more} more" if more else "") + "."
    chosen: list[dict] = []
    for f in sorted(flagged, key=lambda f: -f["seconds"]):
        if len(said(chosen + [f])) > KEY_MAX:
            break
        chosen.append(f)
    if chosen:
        return said(chosen)
    if not flagged:
        return ""
    return said(flagged[:1])[:KEY_MAX - 1].rsplit(" ", 1)[0] + "…"           # one too long for the room: cut
