"""The facts of an investigation, from its records — what the page states before the AI says what it means.

⚠️ FACTS FIRST (owner, 2026-10-11: "the investigate skill is not providing any added-value against a 'normal' query").
The page was the AI's retelling of the script's lines: a summary, a timeline and causes it chose to write, no better than
a chat answer. What the records PROVE is now laid out by code, from the investigate skill's own readings — the AI only
explains it:

  established   each unusual period of each device (when, how long, against its own normal), a reading that stops,
                a control that stayed on, what else stopped answering or ran next to an unusual moment
  ruled_out     a control that never left "off" while the device ran; an automation that ran but can switch nothing;
                a lead from the web the records contradict (the AI's verdict "not supported")
  timeline      those moments in order, from the records (and what the account says a person saw, marked so)
  alerts        when an alert on the same limit that flagged a period would have fired, and how long before it ended
  key           the one line of facts the chat message starts with
  lanes         what else happened, on the charts' time axis: each device read without numbers (its states), the other
                devices that stopped answering and the automations that could act next to an unusual moment

Nothing here knows a device, a room or a villa: every name, time and limit comes from the readings
(investigate.py timeline / around --out), which carry the settings they were judged with.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from vesta_shared.timeutil import day_time_label        # the one day format


def _on(a: dict) -> str:
    """What an automation that can change things acts on: the devices it names, else its kinds of action."""
    named = [t.get("name") or t.get("id") for t in a.get("targets") or []]
    return ", ".join(named[:6]) + (f" and {len(named) - 6} more" if len(named) > 6 else "") if named else \
        "(" + ", ".join(a.get("changes") or []) + ")"


def lasting(seconds) -> str:
    s = int(round(float(seconds)))
    return f"{s} s" if s < 90 else f"{s // 60} min" if s < 5400 else f"{s // 3600} h {s % 3600 // 60} min"


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


def _by_minute(items: list[dict], clock, one: str, many: str) -> list[dict]:
    """Things that did the same in the same minute as ONE row: a device and its own readings drop off together."""
    return [{"at": _t(xs[0]["at"]), "text": ", ".join(x["name"] for x in xs) + " " + (one if len(xs) == 1 else many),
             "unusual": False} for xs in _grouped(items, clock)]


def _grouped(items: list[dict], clock) -> list[list[dict]]:
    groups: dict[str, list[dict]] = {}
    for x in sorted(items, key=lambda x: x["at"]):
        groups.setdefault(clock(_t(x["at"])), []).append(x)
    return list(groups.values())


def _near(t: datetime, moments: list[datetime], within: float) -> bool:
    return any(abs((t - m).total_seconds()) <= within for m in moments)


def facts(data: dict | None, around: dict | None, notes: dict | None = None) -> dict:
    """The page's facts from investigate.py's readings (`data`: timeline --out, `around`: around --out) and the AI's
    account (`notes`: only its web leads judged "not supported" and the moments a person reported)."""
    data, around, notes = data or {}, around or {}, notes or {}
    clock = _Clock(data if data.get("zone") else around)
    within = float((data.get("settings") or around.get("settings") or {}).get("coincide_s") or 0)
    flagged = _flagged(data)
    # ⚠️ NEXT TO WHAT BEGAN (2026-10-11, on the villa's records): with the ends too, 22 moments ± 10 min covered half the
    # day and every automation of the day looked "next to" the trouble. A cause comes before or at a start.
    moments = [f["start"] for f in flagged]
    established, ruled_out, rows, alerts = [], [], [], []
    warned: dict[tuple, list] = {}

    # ------------------------------------------------------------------ each device, against its own normal
    ran = [e for e in data.get("entities") or [] if e.get("runs") and not e.get("control")]
    for f in flagged:
        established.append(f"{f['name']}: {f['kind']} from {clock(f['start'])} to {clock(f['end'])} "
                           f"({lasting(f['seconds'])}) — {f['why']}.")
        rows.append({"at": f["start"], "text": f"{f['name']}: {f['kind']} begins — {f['why']}", "unusual": True})
        rows.append({"at": f["end"], "text": f"{f['name']}: {f['kind']} ends, after {lasting(f['seconds'])}",
                     "unusual": False})
        al = f.get("alert") or {}
        fired = _t(al.get("at"))
        # ⚠️ EARLIER MEANS IN TIME TO MATTER: an alert 11 s before a 71-s drop-out ended warned of nothing — only one
        # that fires in the first half of the trouble is said
        if fired and al.get("rule") and (f["end"] - fired) >= (fired - f["start"]):
            warned.setdefault((f["name"], al["rule"]), []).append((fired, f))
    for (name, rule), times in warned.items():
        first, f = times[0]
        alerts.append(f"An alert on “{name}: {rule}” would have warned at {clock(first)}, "
                      f"{lasting((f['end'] - first).total_seconds())} before that {f['kind']} ended "
                      f"({clock(f['start'])} to {clock(f['end'])})"
                      + (f"; and again at {', '.join(clock(t) for t, _ in times[1:])}" if len(times) > 1 else "") + ".")
    for e in data.get("entities") or []:
        name = e.get("label") or e.get("entity_id")
        if e.get("nothing"):
            established.append(f"{name}: Home Assistant kept no reading of it in this period — nothing to judge it by.")
        cut = _t(e.get("cut"))
        if cut:
            established.append(f"{name}: its records could not be read after {clock(cut)} — nothing is known of it "
                               "after that.")
        if e.get("control") in ("off", "on") and ran:
            who = ", ".join(r.get("label") or r.get("entity_id") for r in ran)
            days = data.get("baseline_days")
            before = f" and the {days:g} days before" if isinstance(days, (int, float)) and days > 0 else ""
            if e["control"] == "off":
                ruled_out.append(f"{name} stayed off for the whole period{before}, while {who} ran: it did not turn "
                                 f"{'it' if len(ran) == 1 else 'them'} on.")
            else:
                established.append(f"{name} stayed on for the whole period{before}: it may supply {who}, but its "
                                   "state does not explain their starts and stops.")

    # ------------------------------------------------------------------ what else happened next to those moments
    read = {e.get("entity_id") for e in data.get("entities") or []}      # their own drop-outs are flagged above
    went = [x for x in around.get("offline") or [] if _t(x.get("at")) and x.get("id") not in read]
    near_went = [x for x in went if _near(_t(x["at"]), moments, within)]
    if near_went:
        groups = _grouped(near_went, clock)
        established.append("Also stopped answering next to an unusual moment: "
                           + "; ".join(f"{clock(_t(xs[0]['at']))} {', '.join(x['name'] for x in xs)}" for xs in groups[:8])
                           + (f" (and {len(groups) - 8} more moments)" if len(groups) > 8 else "") + ".")
    near_ids = {x.get("id") for x in near_went}
    came = [x for x in around.get("back") or [] if x.get("id") in near_ids and _t(x.get("at"))]
    rows += _by_minute(near_went, clock, "stops answering", "stop answering")
    rows += _by_minute(came, clock, "answers again", "answer again")

    acted, unproven, harmless_near, harmless_other = [], [], [], 0
    for a in around.get("automations") or []:
        times = [t for t in (_t(x) for x in a.get("times") or []) if t]
        close = [t for t in times if _near(t, moments, within)]
        if a.get("can") == "nothing":
            if close:
                harmless_near.append(a)
            else:
                harmless_other += 1
        elif close:
            (acted if a.get("can") == "changes" else unproven).append((a, close))
            for t in close[:3]:
                rows.append({"at": t, "text": f"Automation “{a.get('name')}” runs ("
                             + ("it can act on: " + _on(a) if a.get("can") == "changes"
                                else "what it can do could not be read") + ")", "unusual": False})
    for a, close in acted:
        mine = {t.get("id") for t in a.get("targets") or []} & read
        established.append(f"Automation “{a.get('name')}” ran next to an unusual moment ({clock(close[0])}) and can act "
                           f"on: {_on(a)}" + (" — among the devices read here: check whether it acted" if mine else
                                              " — none of the devices read here" if a.get("targets") else
                                              " — check whether it acted on the device") + ".")
    for a, close in unproven:
        established.append(f"Automation “{a.get('name')}” ran next to an unusual moment ({clock(close[0])}); what it "
                           "can do could not be read, so it is neither proven nor ruled out.")
    for a in harmless_near:
        does = " and ".join(a.get("does") or []) or "nothing"
        ruled_out.append(f"Automation “{a.get('name')}” ran then, but all it can do is: {does} — it switched nothing.")
    if harmless_other:
        ruled_out.append(f"{harmless_other} other automation{'s' if harmless_other > 1 else ''} that ran in the period "
                         "switch nothing (they only notify or record).")

    # ------------------------------------------------------------------ the AI's account: only what it adds
    for c in notes.get("causes") or []:
        if isinstance(c, dict) and c.get("verdict") == "not supported":
            ruled_out.append(f"{c.get('cause')}" + (f" — {c['evidence']}" if c.get("evidence") else "")
                             + (f" (lead from: {c['source']})" if c.get("source") else "") + ".")
    told = [r for r in notes.get("timeline") or [] if isinstance(r, dict) and r.get("text")]

    lanes = _lanes(data, near_went, acted, unproven)
    rows.sort(key=lambda r: r["at"])
    timeline = [{"time": clock(r["at"]), "text": r["text"], "unusual": r["unusual"]} for r in rows[:60]]
    if timeline:
        # what a person saw or did is not in the records: kept, marked as reported, after the recorded moments
        timeline += [{"time": str(r.get("time") or ""), "text": str(r["text"]), "unusual": bool(r.get("unusual")),
                      "reported": True} for r in told]
    else:
        timeline = [{"time": str(r.get("time") or ""), "text": str(r["text"]), "unusual": bool(r.get("unusual"))}
                    for r in told]
    return {"established": established, "ruled_out": ruled_out, "timeline": timeline, "alerts": alerts,
            "recorded": bool(rows), "key": key_line(flagged, clock), "lanes": lanes}


def _lanes(data: dict, went: list[dict], acted: list, unproven: list) -> list[dict]:
    """The strip under the charts: a lane per device read that gave no numbers (its states as bands), then the other
    devices that stopped answering and the automations that could act — each only when it has something to show."""
    end = _t(data.get("end"))
    out = []
    for e in data.get("entities") or []:
        states = [s for s in e.get("states") or [] if _t(s.get("at"))]
        if not states or not end:
            continue
        bands = [{"start": _t(s["at"]), "end": _t(states[i + 1]["at"]) if i + 1 < len(states) else end,
                  "state": s.get("state"), "as": s.get("as")} for i, s in enumerate(states)]
        out.append({"name": e.get("label") or e.get("entity_id"), "bands": bands})
    if went:
        out.append({"name": "Other devices that stopped answering", "marks": [
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
        out = "; ".join(name + ": " + ", ".join(f"{f['kind']} {clock(f['start'])}–{clock(f['end'])} "
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
