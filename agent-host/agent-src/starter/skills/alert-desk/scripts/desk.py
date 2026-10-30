#!/usr/bin/env python3
"""alert-desk: intake, dedup, routing, chase ladder, replies, siren gate, villa-silent watch.

Sub-commands (all print JSON the engine acts on; none sends anything itself):

  desk.py intake   --event event.json     one vesta_critical_event from Home Assistant (or a PM finding)
  desk.py tick                            every 5 min: re-asks, escalations, villa-silent check, fatigue
  desk.py reply    --incident 12 --option done --from fm --name Jim   a button pressed (skill.yaml `buttons`)
  desk.py status                          open incidents, last beats

The event is the one the VESTA rules fire AFTER their own Telegram message
(checked live on 2026-09-29/30; INTEGRATION-PLAN 6b). Every phase of one incident
carries the same incident_id:
  {"blueprint": "critical_condition", "rule_id": "automation.<the rule>",
   "incident_id": "automation.<the rule>-1790000000", "phase": "opened|resolved|abandoned|restated",
   "severity": "critical", "label": "Entrance left unlocked", "entities": ["lock.<a lock>"],
   "summary": "the rule's own message", "timestamp": "...", "reason"?: "...", ...}
Only critical_condition, critical_binary_trip and critical_presence_guard ever
send "resolved"; critical_schedule, critical_system and critical_watchdog send
"opened" only — their incidents close through the ladder (Done), or, for the two whose
claim the desk can read again, by `tick` (see still_there).

The output is the engine's standard form, built with vesta_shared/result.py (the shape there, every word here):
{"send": [message], "actions": [fault | resolved | snapshot], "incident_id", "siren_gate"?, "settle"?}.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
from vesta_shared.store import Incident, Notes, Store, alerted_states, notes_of  # noqa: E402  (PYTHONPATH is set by the engine)
from vesta_shared import alert_watch as W  # noqa: E402  (a closed alert's watch: one owner)
from vesta_shared.params import VillaParams  # noqa: E402
from vesta_shared.maintenance import on as maintenance_on  # noqa: E402  (the villa's maintenance mode: the Kiosk's)
from vesta_shared.timeutil import day_time_label, moment_label, villa_time  # noqa: E402
from vesta_shared.problems import AGAIN_DAYS, Problems, help_key, incident_runs, problem_name  # noqa: E402  (a problem's lifecycle: one owner)
from vesta_shared import result as R  # noqa: E402  (what the engine is asked to do: its shape)
from vesta_shared import script  # noqa: E402  (client, store, settings, zone: one set-up)
from vesta_shared import skill_settings  # noqa: E402  (rules.yaml, the villa's on top)
from vesta_shared.messaging import incident_tag  # noqa: E402
from vesta_shared.message_format import PRESSED, ROLE_SHORT, acted, closing  # noqa: E402  ("<what> on <time> (<who>)", "Cleared on <time>.": one wording each)
from vesta_shared import status_words as SW  # noqa: E402  (the same frames in every language a chat reads)
from vesta_shared import kiosk_words  # noqa: E402
from vesta_shared.timeutil import lasting  # noqa: E402
from vesta_shared.device_state import has_value, out_since  # noqa: E402  ("is it back": one answer)
from vesta_shared.asleep import read_states, unheard  # noqa: E402  (unavailable by design: its last real state)
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.limits import limit  # noqa: E402  (every limit, set on the Limits tab)

FATIGUE_WINDOW_DAYS = limit("alerts.fatigue_window_days", 30, unit="days", group="detect", lo=1, hi=365,
                            says="Days over which an automation's alerts are counted to propose retuning it.",
                            reached="Older alerts do not count.", told="person")

SKILL = os.path.dirname(HERE)
# rules.yaml with the villa's own villa.rules.yaml on top (kept by updates): a villa's route comes FIRST, so it
# replaces the shipped one for its blueprint (the first that matches wins). It was read as shipped only.
RULES = skill_settings.load(SKILL, "rules.yaml", first=("routes",))
DEFAULTS = skill_settings.behaviour(RULES)           # the desk's timings (rules.yaml `behaviour:`)


def _params(params: VillaParams | None) -> VillaParams:
    """The villa's parameters with the desk's own timings to fall back on (none given: the timings alone)."""
    if params is None:
        return VillaParams(defaults=DEFAULTS)
    return params if params.defaults else params.with_defaults(DEFAULTS)
# ⚠️ THE BUTTONS ARE THIS SKILL'S (architecture review, 2026-10-13): skill.yaml `buttons` — the engine draws them and
# passes the option pressed; every sentence about a press names its label. The desk read the label back by its first
# word ("done…"): a button renamed on one side would have become "Noted from …", the alert open and buttonless.
# Owner, 2026-10-10: Not found and Mute removed, "too complex for now".
with open(os.path.join(SKILL, "skill.yaml"), encoding="utf-8") as _fh:
    BUTTONS = {b["option"]: b for b in (yaml.safe_load(_fh) or {}).get("buttons") or []}
# ⚠️ EACH CHAT'S STATUS IN ITS OWN LANGUAGE (owner, 2026-10-23): what the desk says on a card is ITS words, so their
# translations are its own too — words.yaml, one entry per thing said, one line per language. The engine writes the
# step, the moment and "(to: …)" around them in the chat's language and picks the desk's version for it.
with open(os.path.join(SKILL, "words.yaml"), encoding="utf-8") as _fh:
    WORDS = yaml.safe_load(_fh) or {}


class Said(str):
    """Words of the desk: the English they always were (a plain str to every reader before this), knowing their other
    languages (`langs`: {code: text}) — about() hands those on as the message's `status_in`."""
    langs: dict

    def __new__(cls, en: str, langs: dict | None = None):
        out = super().__new__(cls, en)
        out.langs = {k: v for k, v in (langs or {}).items() if k != "en"}
        return out

    def lang(self, code: str) -> str:
        """In language `code`; English when it has none."""
        return self.langs.get(code, str(self))

    def only(self, langs) -> "Said":
        """The same words in `langs` alone (a press in a language its button has no label in reads English whole)."""
        return Said(str(self), {k: v for k, v in self.langs.items() if k in langs})


def _in(value, lang: str) -> str:
    """A placeholder's value in `lang`: words of the desk (Said) in it, a function of the language, else as it is."""
    if isinstance(value, Said):
        return value.lang(lang)
    return str(value(lang) if callable(value) else value)


def say(key: str, **values) -> Said:
    """Entry `key` of words.yaml with its {placeholders} filled, in every language it has (its "en": the English)."""
    entry = WORDS[key]
    fill = lambda tmpl, lang: str(tmpl).format(**{k: _in(v, lang) for k, v in values.items()})
    return Said(fill(entry["en"], "en"), {lang: fill(t, lang) for lang, t in entry.items() if lang != "en" and lang in SW.LANGS})


def joined(words, sep: str = "; ") -> Said:
    """Several Said (or plain texts: a device's own words) as one, in every language: "Door reads on; Lock is open"."""
    langs = {lang for w in words if isinstance(w, Said) for lang in w.langs}
    return Said(sep.join(map(str, words)), {lang: sep.join(_in(w, lang) for w in words) for lang in langs})


def role_in(role: str):
    """A role as the card says it, in each language ("FM", "Propriétaire") — role_said in English."""
    return lambda lang: (SW.who({role}, lang) if role in ROLE_SHORT else "") or role_said(role)


def lasting_in(seconds: float):
    """A duration in each language ("15 min", "15分钟") — timeutil.lasting in English."""
    return lambda lang: SW.duration(seconds, lang)


def label_in(option: str, fallback: str = ""):
    """A button's label in each language (skill.yaml `labels`), its own label in English."""
    b = BUTTONS.get(option) or {}
    return lambda lang: (b.get("labels") or {}).get(lang) or b.get("label") or fallback or option


def ended(tail: Said | str = "") -> Said:
    """message_format.closing in every language: "Cleared on {time}: <tail>.", "Résolu le {time} : <tail>." — every
    language for a plain end, those of `tail` for an end that says more."""
    langs = SW.LANGS[1:] if not isinstance(tail, Said) or not tail else tuple(tail.langs)
    return Said(closing(str(tail)), {lang: SW.closing(_in(tail, lang), lang) for lang in langs})


def watched(said: Said, minutes: float) -> Said:
    """`said` with the watch that follows a close: "… Watch 1 h." — back within `minutes`, the alert reopens under the
    same number. No watch (0, or none): `said` as it is.

    ⚠️ THE WATCH IS SAID, FROM THE SETTING (owner, 2026-10-23): a closed card gave no hint that its alert comes back as
    the same one for a while; the time is the villa's reopen_hours at this close (its helper, villa.rules.yaml, then
    rules.yaml), never a number written here. ⚠️ THE WATCH ITS CLOSE WROTE (architecture review, 2026-10-26): said from
    the incident (alert_watch.minutes), so the words, the Cockpit's "VESTA confirms by" and the "(watch)" title are
    one length — with reopen_hours 0 too."""
    if not minutes or minutes <= 0:
        return said
    w = say("watch", watch=lasting_in(minutes * 60))
    gap = lambda text: "" if str(text).endswith(("。", "．")) else " "
    langs = set(said.langs) | set(w.langs)
    return Said(f"{said}{gap(said)}{w}", {lang: f"{said.lang(lang)}{gap(said.lang(lang))}{w.lang(lang)}" for lang in langs})


def terms(params: VillaParams | None = None) -> dict:
    """What a closed alert's watch is made of (alert_watch.terms), read ONCE from the desk's settings (rules.yaml
    `behaviour:`, the villa's first): reopen_hours, the window an alert back reopens it in, and clear_minutes, the wait
    before a person's close is read again."""
    b = _params(params).behaviour
    return W.terms(b("clear_minutes"), b("reopen_hours"))


def relabel(who) -> Said:
    """"Done (JM)" — a press as check_quiet kept it — with the button's label in each language; a close in the
    Cockpit as kiosk_words kept it, in every language it knows (architecture review O: it read English everywhere)."""
    if isinstance(who, dict):
        w = kiosk_words.read(who)
        return Said(str(w), w.langs)
    for b in BUTTONS.values():
        if str(who).startswith(f"{b['label']} ("):
            rest = str(who)[len(b["label"]):]
            return Said(who, {lang: f"{lab}{rest}" for lang, lab in (b.get("labels") or {}).items()})
    return Said(who)


#: What a person still being asked can answer: the last line of every message that carries the buttons.
#: The beat the engine writes every minute while its Home Assistant connection is up.
HA_BEAT = "ha_events"

#: ⚠️ OVER WHEN WHAT IT CLAIMS NO LONGER HOLDS (owner, 2026-10-13; still_there): every open incident whose alert sent
#: its `claim` — or, sent before rules carried one, its `bad_states` — is read again by the tick, whichever rule sent it.
#: ⚠️ BY THE RULE'S OWN WORDS, NEVER A GUESS (architecture review 22): 0.12.145 took the state at the alert as "the
#: problem" and any other as "over" — a lock gone from unlocked to jammed was closed as cleared.


def now_utc(fake: str | None = None) -> datetime:
    return datetime.fromisoformat(fake) if fake else datetime.now(timezone.utc)


def route_for(rule_id: str, blueprint: str | None = None) -> dict:
    """A route by the rule's blueprint first (the live event names it), then by rule id prefix; a VESTA rule (it names
    a blueprint) that neither matches takes rules.yaml `unrouted`, by its name.

    ⚠️ AN UNCLASSIFIED ALERT IS NOT A DIGEST LINE (owner, 2026-10-19): a rule of a kind with no route fell to the
    defaults' P3 — kept for the next morning's digest. Now its name decides: `critical_…` is P1, any other P2."""
    r = dict(RULES["defaults"])
    for cand in RULES["routes"]:
        if (blueprint and cand.get("blueprint") == blueprint) or \
                (cand.get("prefix") and rule_id.startswith(cand["prefix"])):
            r.update(cand)
            return r
    if blueprint:
        by_name = RULES.get("unrouted") or {}
        name = rule_id.removeprefix("automation.")
        said = by_name.get("critical_") if name.startswith("critical_") else by_name.get("other")
        if said:                                     # a villa file without it: the defaults', never a guess
            r["severity"] = said
    return r


#: The priorities an alert can carry: what people_roles routes (vesta_shared.result's one list).
PRIORITIES = R.PRIORITIES


def priority(ev: dict, route: dict) -> str:
    """The alert's priority: its own (`priority`, the rule's "VESTA priority" input), else its route's in rules.yaml.

    ⚠️ READ FROM THE ALERT (owner, 2026-10-13: "only if there is a way to read from the alert itself the priority it
    belongs to … the same workflow as P1, P2, P3"): Home Assistant's own word (`severity`: "critical", "warning") was
    kept as the priority whenever it was not "critical" — a "warning" matched no people_roles, so the house pump's
    overdue run was never sent, never chased, and its daily repeats went to the facility manager anyway."""
    for p in (ev.get("priority"), ev.get("severity")):
        if str(p or "").upper() in PRIORITIES:
            return str(p).upper()
    return route["severity"]


def recipients(severity: str) -> list[str]:
    return [role for role, sevs in RULES["people_roles"].items() if severity in sevs and role != "digest"]


# The chase (rules.yaml `chase`): who is asked to answer (Done / Need help) and who hears when nobody does.
CHASE = {"asks": "fm", "escalates_to": "owner", **(RULES.get("chase") or {})}


def role_said(role: str) -> str:
    """A role as an alert card says it ("FM", "Owner": message_format.ROLE_SHORT).

    ⚠️ NEVER A ROLE'S WORD WRITTEN HERE (owner, 2026-10-17: "the label shall never be hardcoded to a value that can be
    changed as parameter of the alert"): "No answer from FM", "the owner is asked to act" named the roles the chase
    happened to have — a villa whose chase asks someone else would read the wrong people."""
    return ROLE_SHORT.get(role, role)
# the notices that ask for an answer: the asked role's carry the buttons
ASKING = {"new", "back", "still", "reminder", "reopened"}


def tell(sev: str, stage: str, *, incident: int, ladder: bool = True, chased: bool = False, mark: str | None = None,
         escalate: bool | None = None, **said) -> list[dict]:
    """Every message of one notice about an incident: who hears it, and with which buttons.

    ⚠️ ONE ANSWER, EVERY NOTICE (architecture review, 2026-10-15; owner, 2026-10-13: "respect what the skill is doing,
    consistently to any P1, P2, P3"): each message named its own people — a repeat was put right on 13 October, while a
    P1's reminder, its reopening in the Cockpit and its "back online" still reached the facility manager alone. Now:
    - `escalated` (or `escalate`: a still-there notice once the rule gave up): the role it escalates to
      (chase.escalates_to), with the buttons — the chase is theirs now;
    - every other notice: the people of its priority (people_roles), and while it is `chased` the asked role
      (chase.asks) as well, whatever the priority. The asked role's notice that asks for an answer (ASKING), on a route
      with the ladder, is marked `first_in_line`, so the engine can tell when none of their chats received it (and the
      desk hands it on: `unreached`). (The engine puts Done / Need help under EVERY copy while the alert is open —
      owner, 2026-10-10: nobody has to type a reply — so who is asked is a matter of who is chased, not of buttons.)"""
    if escalate if escalate is not None else stage == "escalated":
        return [R.message(CHASE["escalates_to"], **said, incident=incident, buttons=True, stage=stage, mark=mark)]
    roles = recipients(sev) + ([CHASE["asks"]] if chased and CHASE["asks"] not in recipients(sev) else [])
    out = []
    for role in roles:
        asked = bool(ladder) and stage in ASKING and role == CHASE["asks"]
        out.append(R.message(role, **said, incident=incident, buttons=asked, stage=stage, mark=mark,
                             first_in_line=asked))
    return out


def details(payload: dict, rule_id: str) -> str:
    """The original alert — Home Assistant's own message, and what to check — as every later message about the
    incident repeats it (owner, 2026-10-09: a chat keeps only an incident's latest message, so each one says
    everything). The check is the route's as it stands now (rules.yaml): its one owner."""
    text = payload.get("message") or rule_id
    check = route_for(rule_id, payload.get("blueprint")).get("check")
    return f"{text}\nWhat to do: {check}" if check else text


def carry_check(store: Store, iid: int, route: dict, p: dict | None = None) -> str:
    """The route's "what to do" as it stands now, written on incident `iid` (store.Notes.CHECK) for the readers outside
    this desk — the Kiosk fault's note, the morning digest's "Still open" line (Problems.check_of) — as the desk carries
    the alert's claim. Written only when the words changed; returns them. `p`: the notes as already read.

    ⚠️ ONE OWNER OF "WHAT TO DO" (architecture review, 2026-10-19): Telegram read the route live, the task froze the
    words at its opening for the Kiosk, and the digest read a key nobody wrote — three answers. The words stay in
    rules.yaml; every reader gets them from here."""
    check = route.get("check") or ""
    if (p if p is not None else notes_of(store.incident(iid))).get(Notes.CHECK) != check:
        store.note(iid, {Notes.CHECK: check})
    return check


def reaches(sev: str) -> list[str]:
    """Whom priority `sev` reaches, as an alert card's "To:" says it: its roles (rules.yaml people_roles) — none, what
    the priority does instead (priority_does: "digest", "log"), so the card says "To: digest" rather than the roles of
    whatever chat the villa's rule posted in (owner, 2026-10-17: "To:" follows the priority, never the chat)."""
    return recipients(sev) or [does(sev)]


def carry_to(store: Store, iid: int, sev: str, p: dict | None = None) -> list[str]:
    """Whom `sev` reaches (`reaches`), written on incident `iid` (store.Notes.TO) for the engine's heading of every copy
    — as the desk carries the check and the claim, so the engine never types people_roles. Written only when it
    changed (a priority raised or lowered while the alert is open); returns it. `p`: the notes as already read."""
    to = reaches(sev)
    if (p if p is not None else notes_of(store.incident(iid))).get(Notes.TO) != to:
        store.note(iid, {Notes.TO: to})
    return to


def about(inc: dict, status: str) -> dict:
    """A message about an incident, as its parts: the original alert as its text, where it stands — in the desk's own
    words — as its status; the engine lays them out (heading, alert, status at the bottom: vesta_agent/layout.py).

    ⚠️ ONE SAYING PER THING (owner, 2026-10-11, the laundry door's #21: "redundant and at different places"): Home
    Assistant's own words for a later phase ("🔶 … no longer tracked after 30 min ("Repeat after"); the next breach
    alerts again.") went under the alert — its name a second time, the rule's jargon, and "no longer tracked" above the
    desk's "VESTA keeps watching it". What happened is the status's, said once."""
    inc = dict(inc)                                # a store row (find_open_incident) or a dict
    langs = status.langs if isinstance(status, Said) else {}
    # `status_in`: the same words in each other language the desk has them in (words.yaml); English stays `status`
    return {"text": details(notes_of(inc), inc["rule_id"]), "status": str(status), **({"status_in": langs} if langs else {})}


def _status(status: Said) -> dict:
    """A status of no alert's text (the villa-silent alert writes its own): {status, status_in}."""
    return {"status": str(status), **({"status_in": status.langs} if status.langs else {})}


def chased(inc: dict) -> bool:
    """Someone is still asked to answer it: its messages keep the buttons."""
    inc = dict(inc)
    return inc.get("state") in Incident.CHASED and not inc.get("closed_at")


def normalise(ev: dict) -> dict:
    """The live event, or an older/internal one ({rule_id, entity_id, message}), as the desk's fields."""
    ents = ev.get("entities")
    if isinstance(ents, str):
        ents = [ents]
    eid = ev.get("entity_id") or (",".join(sorted(str(e) for e in ents)) if ents else "")
    bad = ev.get("bad_states")
    if isinstance(bad, str):                       # one state sent as text, never its letters (architecture review 23)
        ev = {**ev, "bad_states": [bad]}
    return {**ev, "entity_id": eid, "message": ev.get("summary") or ev.get("message") or ev.get("label") or ev.get("rule_id"),
            "phase": ev.get("phase") or "opened", "ha_incident": ev.get("incident_id")}


#: What occupancy answers: the villa empty, someone in it, or it cannot be told.
EMPTY, OCCUPIED, UNKNOWN = "empty", "occupied", "unknown"


def occupancy(client=None) -> str:
    """The villa empty or not, from its one helper (rules.yaml siren.villa_empty: on = empty), read through the
    script's Home Assistant client (vesta_shared.script: the live client, or a test's fixture folder).

    ⚠️ A MODE NO VILLA HAD (owner, 2026-10-18): this read input_select.villa_mode, never created on the villa — every
    intrusion read "unknown" and the siren could never arm. The helper the presence rules read answers it now; an
    unreadable or missing one is UNKNOWN, never empty."""
    ent = RULES["siren"].get("villa_empty")
    try:
        if client is None:
            from vesta_shared.ha_client import McpClient
            client = McpClient()
        st = (client.states([ent]).get(ent) or {}).get("state") if ent else None
    except Exception:  # noqa: BLE001
        return UNKNOWN
    return {"on": EMPTY, "off": OCCUPIED}.get(str(st or "").lower(), UNKNOWN)


def _find_by_ha_incident(store: Store, ha_incident: str | None, closed_within: timedelta | None = None,
                         now: datetime | None = None) -> dict | None:
    """The open incident of Home Assistant's `ha_incident` — or, with `closed_within`, one closed that recently."""
    if not ha_incident:
        return None
    rows = store.incidents(open_only=closed_within is None)
    if closed_within is not None:
        rows = [i for i in rows if i.get("closed_at") and now - datetime.fromisoformat(i["closed_at"]) <= closed_within]
    for inc in rows:
        if notes_of(inc).get("ha_incident") == ha_incident:
            return inc
    return None


def alert_keys(ev: dict) -> tuple[str, str | None]:
    """(the key an alert is filed under, the key an alert of the same rule was filed under before its rule sent its
    permanent number — None when it sends none). An alert is its rule and its device: the rule by its permanent number
    (`rule_uid`, the automation's own id) when it sends one, else by its entity id.

    ⚠️ A NEW NUMBER FOR A NEW NAME (owner, 2026-10-18 — architecture review, one problem one card #1): the laundry
    rule's entity id changed while its alert #41 was open; its next alert, under the new id, became #55 — the same
    door, two faults. The automation's own id survives any rename."""
    eid = ev.get("entity_id", "")
    by_name = f"{ev.get('rule_id', '')}|{eid}"
    uid = str(ev.get("rule_uid") or "").strip()
    return (f"rule:{uid}|{eid}", by_name) if uid else (by_name, None)


def open_alert(store: Store, ev: dict) -> dict | None:
    """The open incident of `ev`'s alert, whatever its rule is called now: filed under its permanent number, or under
    the rule's name before rules sent one (then moved under the number). Its rule's name is brought up to date."""
    key, by_name = alert_keys(ev)
    cur = store.find_open_incident(key)
    if cur is None and by_name:
        cur = store.find_open_incident(by_name)
        if cur is not None:
            store.update_incident(cur["id"], key=key)
    if cur is None:
        return None
    if ev.get("rule_id") and cur["rule_id"] != ev["rule_id"]:
        store.update_incident(cur["id"], rule_id=ev["rule_id"])   # renamed: the name it has now
    if ev.get("rule_uid"):
        store.note(cur["id"], {"rule_uid": str(ev["rule_uid"])})
    return store.incident(cur["id"])


def back_alert(store: Store, ev: dict, now: datetime) -> dict | None:
    """The incident of `ev`'s alert closed and still watched (came_back): under its permanent number, or under its
    rule's name from before rules sent one — then filed under the number, its rule's name brought up to date.

    ⚠️ ONE FILE OF ALERTS (architecture review scan 2, 2026-10-19): open_alert knew both keys and a rename; intake's
    "came back" path re-did the two keys itself and kept the old name. Both ask here and in open_alert: intake no
    longer knows a by-name key exists."""
    key, by_name = alert_keys(ev)
    back = came_back(store, key, now) or (came_back(store, by_name, now) if by_name else None)
    if back is None:
        return None
    fields = {k: v for k, v in (("key", key), ("rule_id", ev.get("rule_id"))) if v and back.get(k) != v}
    if fields:
        store.update_incident(back["id"], **fields)
    return store.incident(back["id"])


#: The phases of a rule's event this desk acts on (a missing phase is "opened": rules saved before phases existed).
PHASES = ("opened", "resolved", "abandoned", "restated")


def intake(store: Store, ev: dict, now: datetime, params: VillaParams | None = None, occupancy_reader=occupancy,
           zone: str | None = None) -> dict:
    """An alert from Home Assistant. `zone`: the villa's time zone (vesta_shared.script's one rule)."""
    ev = normalise(ev)
    if ev["phase"] not in PHASES:
        # ⚠️ A PHASE THIS DESK DOES NOT KNOW IS NOTHING (2026-10-17, 14:41): a newer rule template sent "restated" to a
        # desk that read every phase it did not know as an alert — five false alerts and two reopenings in one
        # minute. A newer rule can never raise an alert on an older desk: recorded, nothing sent, nothing created
        store.audit("alert-desk", "phase_unknown", {"rule": ev.get("rule_id"), "phase": ev["phase"]})
        return {"send": [], "actions": [], "incident_id": None, "decision": "phase_unknown"}
    if ev["phase"] == "resolved":
        return resolved(store, ev, now, params)
    if ev["phase"] == "abandoned":
        return abandoned(store, ev, now, params)
    if ev["phase"] == "restated":
        return restated(store, ev, now)
    rule_id, eid = ev["rule_id"], ev.get("entity_id", "")
    route = route_for(rule_id, ev.get("blueprint"))
    sev = priority(ev, route)
    key = alert_keys(ev)[0]
    out = {"send": [], "actions": [], "incident_id": None, "decision": None}
    # ⚠️ THE KIOSK'S SWITCH (owner, 2026-10-29; vesta_shared.maintenance): no longer a villa helper no screen showed
    if maintenance_on() and sev != "P1":
        out["decision"] = "maintenance_mode"; store.audit("alert-desk", "suppressed_maintenance", ev); return out
    if route.get("intrusion") and not ev.get("occupancy"):
        ev["occupancy"] = occupancy_reader()
    cur = open_alert(store, ev)
    if cur:
        last = datetime.fromisoformat(cur["last_seen_at"])
        store.touch_incident(cur["id"], now.isoformat())
        out["incident_id"] = cur["id"]
        # ⚠️ WHAT IT SAYS NOW (owner, 2026-10-13, the house pump's #5: "last confirmed: 2026-10-01" every morning while
        # Home Assistant's own message said 2026-10-11): a repeat carries the alert's latest words, claim and priority
        cur = _restated(store, cur, ev, sev, now, route, out)
        # the villa's time, written as every message writes one ("Mon 5 Oct, 08:00"): it showed "2026-10-03T00:00", UTC
        since = day_time_label(villa_time(cur["opened_at"], zone or "UTC"), weekday=True)
        status = say("still_count", count=cur["count"] + 1, since=since)
        # Home Assistant's own new message for it takes the incident's number, and replaces its older ones
        # ⚠️ THE RULE ALERTED AGAIN, NOT A REMINDER (owner, 2026-10-17, #45: "Reminder sent 11:38 to Owner & FM" — the
        # load had moved from phase C to phase B and the villa's rule alerted again; a reminder is the desk's own chase)
        out["ha_messages"] = [R.ha_message(cur["id"], context=ev.get("_context_id"), stage="still", **about(cur, status))]
        if (now - last) < timedelta(minutes=route["cooldown_min"]):
            out["decision"] = "counted"  # repeat inside the cooldown: no message of the desk's own
            return out
        out["decision"] = "repeat"
        # ⚠️ TO WHOM ITS PRIORITY SENDS IT (owner, 2026-10-13: "respect what the skill is doing, consistently to any P1,
        # P2, P3"): a repeat went to the facility manager whatever the priority, unlike the alert it repeats
        out["send"] += tell(sev, "still", incident=cur["id"], ladder=route.get("ladder", True), **about(cur, status))
        if route.get("intrusion"):
            out["siren_gate"] = siren_gate(store, ev, now)
        return out
    back = back_alert(store, ev, now)
    if back:
        return reopen(store, back, ev, now, sev, route, out, zone=zone)
    iid = store.new_incident(key, rule_id, eid, sev, ev, now.isoformat())
    carry_check(store, iid, route, ev)
    carry_to(store, iid, sev, ev)
    out["incident_id"] = iid
    out["decision"] = "new"
    # no status: "New" is the heading's (Incident: New #N) — and its "Alert sent" line counts the week when the same
    # alert was seen this week under another number (message_format.STEPS, from problems.incident_runs)
    text = details(ev, rule_id)
    if ev.get("snapshot"):
        out["actions"].append(R.snapshot(ev["snapshot"], iid))
    out["ha_messages"] = [R.ha_message(iid, text, ev.get("_context_id"), stage="new")]
    out["send"] += tell(sev, "new", incident=iid, ladder=route.get("ladder", True), text=text)
    _ladder(store, iid, ev, now, sev, route, out)
    # intrusion: open the siren gate, never fire it
    if route.get("intrusion"):
        # armed: the engine asks the owner to Approve the siren (no siren set: the warning goes to owner and fm)
        out["siren_gate"] = siren_gate(store, ev, now)
    return out


#: What a repeat of an open alert brings that the incident keeps: Home Assistant's latest words and what it claims.
RESTATED = ("message", "summary", "label", "claim", "bad_states", "mode", "state", "entities", "priority", "severity",
            "reason")


def does(sev: str, route: dict | None = None) -> str:
    """What priority `sev` does to an alert (rules.yaml priority_does): "chase", "digest" or "log" — a route without the
    ladder never chases: it records (as before: the roi_ and audit_ routes)."""
    d = RULES["priority_does"].get(sev, "log")
    return "log" if d == "chase" and route is not None and not route.get("ladder", True) else d


def _restated(store: Store, cur: dict, ev: dict, sev: str, now: datetime, route: dict, out: dict) -> dict:
    """`cur` with what Home Assistant says of it now (RESTATED), and its priority — what the new priority does
    (priority_does): the ladder started when it chases on an incident that was not chased; the chase stopped when it
    no longer does.

    ⚠️ LOWERED, STILL CHASED (architecture review, 2026-10-19 evening): a rule's priority lowered from P2 to P3 while
    its alert was open changed the number only — the facility manager was reminded, the owner told after 45 min, and
    its Kiosk fault stayed open, for an alert now meant for the morning digest."""
    cur = dict(cur)                                # a store row
    # it fired again: whatever was seen clearing is not over
    p = store.note(cur["id"], {k: ev[k] for k in RESTATED if ev.get(k) is not None}, drop=("clear_since",))
    carry_check(store, cur["id"], route, p)
    _reprioritised(store, cur, p, sev, now, route, out)
    return store.incident(cur["id"])


def _reprioritised(store: Store, cur: dict, p: dict, sev: str, now: datetime, route: dict, out: dict) -> None:
    """Open alert `cur` (its payload `p`) now at priority `sev`: the ladder started when it chases on an incident that
    was not chased; the chase stopped, its task and Kiosk fault closed and every copy saying why, when it no longer
    does. Whether the rule alerted again or was only saved (restated)."""
    if cur["severity"] == sev:
        return
    store.update_incident(cur["id"], severity=sev)
    carry_to(store, cur["id"], sev, p)                 # its card's "To:" follows the new priority at once
    if cur["state"] in (Incident.LOGGED, Incident.DIGEST):
        # raised back to a chase after a lowering: the SAME task and Kiosk fault open again (one problem, one fault),
        # the reopening saying why (rules.yaml raised_words, as a lowering says lowered_words)
        words = RULES.get("raised_words") or "Raised to {priority}."
        _ladder(store, cur["id"], {**p, "rule_id": cur["rule_id"], "entity_id": cur["entity_id"],
                                   "message": p.get("message") or cur["rule_id"]}, now, sev, route, out,
                note=words.replace("{priority}", sev))
    elif cur["state"] in Incident.CHASED and does(sev, route) != "chase":
        now_does = does(sev, route)
        store.update_incident(cur["id"], state=Incident.DIGEST if now_does == "digest" else Incident.LOGGED)
        if Problems(store).settle(f"incident:{cur['id']}", note=f"Lowered to {sev}."):
            out["actions"].append(R.faults_changed())          # its task closed: the engine's repair closes its fault
        words = (RULES.get("lowered_words") or {}).get(now_does) or "Lowered to {priority} on {time}."
        others = ((WORDS.get("lowered") or {}).get(now_does) or {})
        out.setdefault("settle", []).append(R.settle(cur["id"], words.replace("{priority}", sev), note_in={
            lang: str(t).replace("{priority}", sev) for lang, t in others.items() if lang in SW.LANGS}))


def _ladder(store: Store, iid: int, ev: dict, now: datetime, sev: str, route: dict, out: dict,
            again: str | None = None, note: str = "Back again.") -> None:
    """Where an incident opened (or opened `again`, under that title) starts: the facility manager asked, with its task
    and Kiosk fault — the same ones open again when it came back, or was raised back to a chase, `note` saying why
    (Problems.reopen_task: the ONE opener; new only when it never had one) — (P1, P2 with the ladder); the morning
    list (P3); the record (P4).

    ⚠️ ONE OPENER (architecture review, 2026-10-19): a first opening went through open_task, which knows only OPEN
    tasks — an alert lowered to P3 (its task closed "Lowered to P3.") and raised again got a second task and a second
    Kiosk fault for the same number, and the repair's double check skips a fault a task holds."""
    if does(sev, route) == "chase":
        store.update_incident(iid, state=Incident.ASKED, asked_at=now.isoformat(), assignee=CHASE["asks"])
        eid, check = ev.get("entity_id", ""), route.get("check") or ""
        # its task is named as every page names the alert (problems.problem_name), "(again: …)" included when it came back
        title = again or problem_name(ev["message"])["headline"]
        Problems(store).reopen_task("incident", iid, ev["rule_id"], eid, title, check, note=note)
        # new, reopened or still open: the engine makes its fault what the task says (tickets.repair, Problems.card)
        out["actions"].append(R.faults_changed())
    elif does(sev, route) == "digest":
        store.update_incident(iid, state=Incident.DIGEST)
    else:
        store.update_incident(iid, state=Incident.LOGGED)


def came_back(store: Store, key: str, now: datetime) -> dict | None:
    """The incident of `key` still watched after its close (alert_watch.reopens), if any: an alert back so soon is the
    SAME problem again.

    ⚠️ BACK AGAIN IS NOT NEW (architecture review 23): an access point dropping every hour got a new number, a new
    "New" message with buttons and a new Kiosk fault each time the desk closed it — the "repeat after" applied only to
    an incident still open, and the retune proposal then counted the desk's own closes."""
    closed = [i for i in store.incidents(open_only=False) if i["key"] == key and i.get("closed_at") and W.reopens(i, now)]
    return closed[-1] if closed else None


def reopen(store: Store, inc: dict, ev: dict, now: datetime, sev: str, route: dict, out: dict,
           status: str | None = None, zone: str | None = None) -> dict:
    """`inc`, closed, open again under its own number — the ONE way an incident reopens (architecture review 24: two
    hand-written copies differed on the count, the alert's text, the heading). Without `status`: it came back (an alert
    within reopen_hours) — a new run of it, counted, its text and states Home Assistant's latest, "Back again". With
    `status`: it never went away (still bad after a Done or a close in the Kiosk) — the same run, "Still there", and
    the desk watches it from now on (seen_again). Either way its ladder starts again and its task and Kiosk fault open
    again, titled with how often it came back.

    ⚠️ "STILL THERE" IS NOT "BACK AGAIN" (architecture review 25): a door never locked was reopened "Back again".

    ⚠️ A RUN'S "CLEAR SINCE" ENDS WITH IT (villa's #54, 2026-10-18): main power back at 11:30:15 was closed at
    11:30:17 — the "back to normal since 10:40" of the run closed at 10:50 was still on the incident, so the new run
    read as 50 minutes clear. Either way it reopens, it is bad now: seen_again counts its clear_minutes afresh."""
    store.note(inc["id"], drop=("clear_since", "silent_told"))
    came_back_now = status is None
    if came_back_now:
        ended = notes_of(store.incident(inc["id"])).get(Notes.MESSAGE)   # the run that ended keeps its own words
        p = store.note(inc["id"], {k: ev[k] for k in ("mode", "bad_states", "state", "ha_incident", "message", "summary",
                                                      "entities") if ev.get(k) is not None}, drop=("abandoned", W.CHECK))
        store.reopen_incident(inc["id"], now.isoformat(), message=ended)
        store.touch_incident(inc["id"], now.isoformat())
    else:
        # Home Assistant no longer watches it: the desk does (seen_again)
        p = store.note(inc["id"], {"abandoned": True}, drop=(W.CHECK,), closed_at=None, reply=None)
    carry_check(store, inc["id"], route, p)
    carry_to(store, inc["id"], sev, p)
    inc = store.incident(inc["id"])
    runs = incident_runs(inc, store)
    title = problem_name(str(p.get("message") or inc["rule_id"]), runs - 1)["headline"]
    _ladder(store, inc["id"], {**p, "rule_id": inc["rule_id"], "entity_id": inc["entity_id"],
                               "message": p.get("message") or inc["rule_id"]}, now, sev, route, out, again=title,
            note="Back again." if came_back_now else "Still there after the close.")
    if came_back_now:
        # one counter, the Kiosk fault's and the digest's (architecture review 25: "N times since the 1st" and "again:
        # M times in 7 days" drifted apart)
        status = say("back_again", runs=runs, days=AGAIN_DAYS)
        out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), stage="back", **about(inc, status))]
        if ev.get("snapshot"):
            out["actions"].append(R.snapshot(ev["snapshot"], inc["id"]))
        if route.get("intrusion"):
            out["siren_gate"] = siren_gate(store, ev, now)
    out["send"] += tell(sev, "back" if came_back_now else "still", incident=inc["id"], ladder=route.get("ladder", True),
                        **about(inc, status))
    out["incident_id"], out["decision"] = inc["id"], "reopened"
    store.audit("alert-desk", "reopened", {"incident": inc["id"], "status": status})
    return out


def resolved(store: Store, ev: dict, now: datetime, params: VillaParams | None = None) -> dict:
    """Home Assistant says the condition cleared. Close the incident; the chase stops.

    Home Assistant already sent its own all-clear to the group: the desk writes only
    when a person was being chased, to tell them no reply is needed any more."""
    out = {"send": [], "actions": [], "incident_id": None, "decision": "resolved_unknown"}
    inc = _find_by_ha_incident(store, ev.get("ha_incident")) or open_alert(store, ev)
    if not inc:
        # ⚠️ ALREADY CLOSED HERE, STILL ITS MESSAGE (architecture review 22): the desk saw it over first (seen_again, a
        # Done) — Home Assistant's all-clear then stayed a second message in the group, without its incident's number
        late = _find_by_ha_incident(store, ev.get("ha_incident"), closed_within=timedelta(days=W.late_close_days()), now=now)
        if late:
            out["incident_id"], out["decision"] = late["id"], "resolved_late"
            out["ha_messages"] = [R.ha_message(late["id"], context=ev.get("_context_id"), stage="closed",
                                               **about(late, watched(ended(), W.minutes(late))))]
        return out
    over = _close(store, inc, now, out, ended(), terms=terms(params))
    out["incident_id"], out["decision"] = inc["id"], "resolved"
    # Home Assistant's all-clear takes the incident's number and the original alert, and replaces its older ones
    # its status in the desk's words, as every other end says it (never "✅ <the alert's name> — resolved after …")
    # ⚠️ A CLOSING STEP (owner, 2026-10-16, #43): recorded without a stage, the rule's own all-clear was "Update sent
    # 15:40 to Owner" beside "Closing note sent 15:40 to FM" — one end, two lines. Now ONE: "Closing note sent … to
    # Owner & FM"
    out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), stage="closed",
                                       **about(inc, over))]
    store.audit("alert-desk", "resolved", {"incident": inc["id"]})
    return out


def _close(store: Store, inc: dict, now: datetime, out: dict, settled: str,
           note: str = "Cleared: back to normal.", terms: dict | None = None) -> str:
    """An incident that is over: closed with its task and its Kiosk fault (`note`: what the fault says), its messages in
    every chat lose their buttons and say `settled`; the facility manager, when still chased, is told the same — ONE
    wording per end (owner, 2026-10-11: the group read "Cleared in Home Assistant on …" and the
    facility manager "Closed: Home Assistant reports it cleared on … No reply needed." for the same end).

    `settled` is message_format.closing — "Cleared on {time}." with what the end adds after a colon — the words the
    villa's own all-clear says too (owner, 2026-10-19: one closing wording; "Closed on …" is no longer written).

    `terms`: the desk's (terms()) — it is watched as its close says (alert_watch.close), and `settled` ends with that
    watch (watched); None — an end that cannot come back (its automation gone) — takes any watch away. Returns the
    words said."""
    out["actions"] += Problems(store).close_incident(inc["id"], Incident.RESOLVED, now.isoformat(), note,
                                                     can_come_back=terms is not None, terms=terms)
    settled = watched(settled, W.minutes(store.incident(inc["id"])))
    # its alert and reminders, in every chat, lose their buttons: nobody presses for something already over
    out.setdefault("settle", []).append(R.settle(inc["id"], settled,
                                                 note_in=settled.langs if isinstance(settled, Said) else None))
    if inc["state"] in Incident.CHASED:
        # the same words as every other copy (owner, 2026-10-11: one incident, one picture; ✅ already says no reply)
        out["send"] += tell(inc["severity"], "closed", incident=inc["id"], chased=True, **about(inc, settled))
    return settled


def rule_states(inc: dict) -> tuple[list[str], set[str]] | None:
    """(entities, bad states) when the incident's alert said which states are bad — its `bad_states`, else the `state`
    it alerted on — and its states are what it is about (no `mode`, or "state": a number's bad states only say when it
    cannot be read); None otherwise. An alert's own `claim` comes first (still_there): this is what an alert sent
    before its rule carried one tells. The reading is vesta_shared.store.alerted_states, the night check's too."""
    return alerted_states(inc)


def judged(inc: dict) -> bool:
    """Can the desk tell, from Home Assistant now, whether this incident's alert still holds? Its claim, or its bad
    states (alert_watch.can_read_again: the watch after a person's close asks the same)."""
    return W.can_read_again(inc)


def _pack():
    """The knowledge pack the engine gives every job (VESTA_PACK), once; None when there is none."""
    if "pack" not in _PACK:
        path = os.environ.get("VESTA_PACK")
        _PACK["pack"] = KnowledgePack.read(path) if path else None
    return _PACK["pack"]


_PACK: dict = {}


def still_there(inc: dict, client, now: datetime | None = None) -> tuple[bool | None, list[str]]:
    """Does what the incident's alert claims still hold, read from Home Assistant now? (True, what still says so) ·
    (False, []) · (None, what each device reads) when the desk cannot tell — no claim, or a device does not answer.

    ⚠️ THE ALERT SAYS WHAT IT CLAIMS (owner, 2026-10-13: "when an alert is claiming something, it should be cleared if
    what it claims is no longer happening … the most universal way … never hardcode"): the house pump's "no run in over
    1 day" stayed open for 10 days across two real runs — its rule sent no all-clear, and the desk knew how to read
    again only two blueprints, by name. Every rule now sends its `claim`: a Home Assistant template, written by the rule
    with its own entities and limits, true while what it reported holds. The desk renders it and knows no rule.

    ⚠️ ONE ANSWER, EVERY CLOSE (architecture review 25): checked only when the rule named its states, a Done — or a close
    in the Kiosk — on a door still unlocked dropped the check without a word, and nothing watched the door again."""
    p = notes_of(inc)
    rs = rule_states(inc)
    ents = rs[0] if rs else [e for e in (p.get("entities") or [inc["entity_id"]]) if e and "." in e]
    # ⚠️ ASLEEP IS NOT GONE (owner, 2026-10-21): a device unavailable by design reads its last real state here; the
    # rule's claim, rendered by the villa's system on "unavailable", cannot judge it, so its own states do instead
    # `now`: the tick's moment (the clock when not given), the same one seen_again reads the close at
    states = read_states(client, _pack(), now or datetime.now(timezone.utc), ents) if ents else {}
    asleep = [e for e in ents if (states.get(e) or {}).get("asleep")]

    def name(e):
        return ((states.get(e) or {}).get("attributes") or {}).get("friendly_name") or e

    def silent(e):        # an alert's device that cannot be told right: absent, offline, or without a value
        return not has_value((states.get(e) or {}).get("state"))

    def mute(e):          # asleep with no report in days says so (vesta_shared.asleep.unheard), never "does not answer"
        words = unheard(states.get(e) or {}, now or datetime.now(timezone.utc))
        return f"{name(e)}: {words}" if words else say("not_answering", name=name(e))

    def readings():
        # each in every language the desk has (words.yaml); the device's name and state as the villa's system says them
        return [joined([say("reads", name=name(e), state=states[e]["state"])] +
                       ([say("last_report")] if e in asleep else []), "")
                if not silent(e) else mute(e) for e in ents]
    if p.get("claim") and not asleep:
        said = str(client.template(str(p["claim"]))).strip().lower()
        if said == "true":
            return True, [say("still_reported")]
        return (False, []) if said == "false" else (None, readings())
    if rs:
        bad = [say("still_reads", name=name(e), state=states[e]["state"])
               for e in ents if (states.get(e) or {}).get("state") in rs[1]]
        if bad:
            return True, bad
        # ⚠️ A DEVICE THAT DOES NOT ANSWER IS NOT FIXED (architecture review 26): an offline lock after Done counted as
        # "not in a bad state" — closed without a word. Unless its rule calls that state bad, the desk cannot tell.
        quiet = [mute(e) for e in ents if silent(e)]
        return (None, quiet) if quiet else (False, [])
    return None, readings()


def quiet_after_done(store: Store, now: datetime, client, clear_minutes: float, out: dict,
                     t: dict | None = None) -> list[int]:
    """Every incident answered Done — or closed in the Kiosk — `clear_minutes` ago or more and not yet checked, read
    again once (still_there): still bad, it reopens — "…, but … still reads …: still open" — and the desk watches it
    until it is right; unknown (its rule names no states), the people asked are told what each device reads, that VESTA
    cannot check it. `t`: the desk's terms (terms()). Returns the ids reopened."""
    reopened = []
    for inc in store.incidents(open_only=False):
        if f'"{W.CHECK}"' not in (inc.get("payload") or ""):
            continue                                                       # most are not waiting for it: not read
        p = notes_of(inc)
        if t is not None and W.rewatch(store, inc, t):
            # watched without its length (closed before a tick carried it, or the wait edited since): its Kiosk fault
            # learns when it is confirmed (Problems.card confirms_by)
            _faults_follow(out)
        if not (inc.get("closed_at") and p.get(W.CHECK)) or \
                now - datetime.fromisoformat(inc["closed_at"]) < timedelta(minutes=clear_minutes):
            continue
        try:
            there, words = still_there(inc, client, now)
        except Exception:  # noqa: BLE001 — Home Assistant not readable now: the next tick
            return reopened
        # checked once, whatever it reads — taken from the record as it stands now: a fault reopened in the Kiosk
        # while the villa was read took the check away (problems.reopen_task) and its own note stays
        who = store.take_note(inc["id"], W.CHECK)
        if who is None:
            continue
        # ⚠️ THE WATCH IS OVER, WHATEVER IT READ (owner, 2026-10-23): the Kiosk fault said "VESTA confirms by …" since the
        # close (Problems.card confirms_by, while check_quiet waits) — the repair now takes that away, or reopens it
        _faults_follow(out)
        if there:
            reopen(store, store.incident(inc["id"]), {}, now, inc["severity"], route_for(inc["rule_id"], p.get("blueprint")),
                   out, status=say("still_after_done", who=relabel(who), words=joined(words)))
            store.audit("alert-desk", "not_quiet", {"incident": inc["id"], "still": words})
            reopened.append(inc["id"])
        elif there is None and words:
            inc = store.incident(inc["id"])
            out["send"] += tell(inc["severity"], "closed", incident=inc["id"], mark="unchecked",   # ☑️ closed, not checked
                                **about(inc, watched(say("cannot_check", who=relabel(who), words=joined(words)),
                                                     W.minutes(inc, read_again=False))))
        elif there is False:
            # ⚠️ THE WATCH ENDS OUT LOUD (owner, 2026-10-23: "10 min later, i still see 'VESTA will monitor it for 10 min'
            # — I expected an update saying the test lock is confirmed OK"): a Done that held closed the check without a
            # word, and the card promised a watch nobody saw end
            inc = store.incident(inc["id"])
            out["send"] += tell(inc["severity"], "closed", incident=inc["id"],
                                **about(inc, watched(say("confirmed_after_done", who=relabel(who),
                                                         after=lasting_in(clear_minutes * 60)),
                                                     W.minutes(inc, read_again=False))))
    return reopened


def seen_again(store: Store, now: datetime, client, clear_minutes: float, out: dict,
               t: dict | None = None) -> list[int]:
    """Every open incident whose alert says what it claims (judged), read again: one whose claim no longer holds —
    `clear_minutes` on end — is closed (`_close`, watched by the desk's terms `t`). Returns their ids.

    ⚠️ OVER WHEN HOME ASSISTANT NO LONGER SAYS SO (villa, 2026-10-10: the Cockpit kept "Entrance door unlocked" hours
    after the door was locked). Read for every open incident that carries a claim, whichever rule sent it — a rule
    that also says "resolved" itself closes it first, or finds it closed (resolved_late)."""
    closed = []
    for inc in store.incidents(open_only=True):
        if not judged(inc):
            continue
        try:
            there, words = still_there(inc, client, now)
        except Exception:  # noqa: BLE001 — Home Assistant not readable now, or the claim not renderable: the next tick
            continue
        p = notes_of(inc)
        if there is None:
            # ⚠️ A DEVICE THAT DOES NOT ANSWER IS NOT "OVER" (owner's choice, architecture review 29): it stays open,
            # said once, until the device answers and is right. Cannot be told: whatever was seen clearing is not over
            if not p.get("silent_told"):
                out["send"] += tell(inc["severity"], "update", incident=inc["id"],
                                    **about(inc, say("cannot_tell", words=joined(words))))
            store.note(inc["id"], {"silent_told": True}, drop=("clear_since", Notes.CLOSES_AT))
            _closes_at_changed(p, None, out)
            continue
        if there:
            # still holds: whatever was seen clearing is not over
            store.note(inc["id"], drop=("clear_since", "silent_told", Notes.CLOSES_AT))
            _closes_at_changed(p, None, out)
            continue
        if p.get("claim"):
            # out of it `clear_minutes` on end, as the desk saw it (a claim is a verdict, not a state with its time)
            since = p.get("clear_since") or now.isoformat()
            closes = (datetime.fromisoformat(since) + timedelta(minutes=clear_minutes)).isoformat()
            store.note(inc["id"], {"clear_since": since, Notes.CLOSES_AT: closes}, drop=("silent_told",))
            _closes_at_changed(p, closes, out)
            if now - datetime.fromisoformat(since) < timedelta(minutes=clear_minutes):
                continue
            said = say("back_to_normal")
        else:
            ents, bad = rule_states(inc)
            # a device asleep between its reports reads its last real state, as still_there read it
            now_states = read_states(client, _pack(), now, ents)
            # out of its bad states since one moment (out_since): the time shown and the close are the same reading
            since = out_since(client, ents, now_states, bad, now, clear_minutes, pack=_pack())
            closes = (since + timedelta(minutes=clear_minutes)).isoformat() if since else None
            store.note(inc["id"], {Notes.CLOSES_AT: closes} if closes else None,
                       drop=("silent_told",) if closes else ("silent_told", Notes.CLOSES_AT))
            _closes_at_changed(p, closes, out)
            if since is None or now - since < timedelta(minutes=clear_minutes):
                continue
            said = joined([say("is_now", name=(now_states[e].get("attributes") or {}).get("friendly_name") or e,
                                   state=now_states[e]["state"]) for e in ents])
        _close(store, store.incident(inc["id"]), now, out, ended(said),
               note="Cleared: back to normal, read again by the VESTA Agent.", terms=t)
        store.audit("alert-desk", "seen_again", {"incident": inc["id"], "now": str(said)})
        closed.append(inc["id"])
    return closed


def watch_over(store: Store, now: datetime, out: dict, zone: str | None = None) -> list[int]:
    """Every closed alert whose watch ended (alert_watch.until — the moment its Kiosk fault leaves the Cockpit's Watched list)
    and did not come back (alert_watch.over): every copy of it gets its last word, "Closed on {time}: it did not come back within 1h.", the
    title "(closed)" and its alert's text struck (the engine's settle `final`). Once per close (Notes.WATCH_OVER: that
    close's moment); not while a person's close waits to be read again (check_quiet); a watch that ended more than
    alerts.late_close_days ago is left as it is (an alert closed before this existed). "Closed on" says the moment its watch
    ended, in the villa's time (`zone`) — the time its Cockpit card said "VESTA confirms by" — never the look that
    noticed it, up to a tick later. Returns their ids.

    ⚠️ "WATCH 1H." WAS THE LAST THING SAID (owner, 2026-10-25): the watch ended and nothing told it — the card read
    "(closed)" from the moment it cleared, while it could still come back as the same alert."""
    told = []
    every = store.incidents(open_only=False)
    for inc in every:
        if not inc.get("closed_at") or f'"{Notes.WATCH_MINUTES}"' not in (inc.get("payload") or ""):
            continue                                                       # open, or never watched: not read
        how = W.over(inc, now, every)
        if how is None:
            continue
        W.told_over(store, inc)
        if how == W.CAME_BACK_AS_NEW:
            # ⚠️ IT DID COME BACK (architecture review, 2026-10-26): the villa silent again 40 minutes after #1 closed
            # was #2, and #1 then read "it did not come back within 4h". A close that cannot come back keeps no watch
            # now (alert_watch.close); one an older desk watched ends without that false word
            store.audit("alert-desk", "watch_over", {"incident": inc["id"], "came_back_as_new": True})
            continue
        until = W.until(inc)
        said = say("watch_over", time=moment_label(until, zone) if zone else "{time}",
                   watch=lasting_in(W.minutes(inc) * 60))
        out.setdefault("settle", []).append(R.settle(inc["id"], str(said), note_in=said.langs, final=True))
        store.audit("alert-desk", "watch_over", {"incident": inc["id"]})
        told.append(inc["id"])
    return told


def _faults_follow(out: dict) -> None:
    """The Kiosk faults are brought up to date after this tick (the engine's repair): once, however many asked."""
    if R.faults_changed() not in out["actions"]:
        out["actions"].append(R.faults_changed())


def _closes_at_changed(p: dict, closes: str | None, out: dict) -> None:
    """When the incident would close changed (Notes.CLOSES_AT): its Kiosk fault is brought up to date — "closes at about
    14:49 if it stays locked" (owner, 2026-10-21), or that line taken away when it holds again."""
    if p.get(Notes.CLOSES_AT) != closes and R.faults_changed() not in out["actions"]:
        out["actions"].append(R.faults_changed())


def rule_gone(store: Store, now: datetime, client, clear_minutes: float, out: dict) -> list[int]:
    """Every open incident whose rule — an automation of the villa — the villa's system says it no longer has (its
    entity ID changed, or it was deleted), `clear_minutes` on end: closed, saying why. Returns their ids.

    ⚠️ AN ALERT NOBODY COULD CLOSE (owner, 2026-10-18): the laundry rule's entity ID changed while its alert #41 was
    open; its next alert came under the new ID as #55 — the same door, two faults, and the Cockpit's Close closes a
    device's faults together. An incident is its rule's: a rule that is gone can never clear it. Only the villa's own
    "not found" counts (client.not_found): a read that fails is not a rule deleted."""
    rules = [i for i in store.incidents(open_only=True) if str(i.get("rule_id") or "").startswith("automation.")]
    if not rules:
        return []
    try:
        gone = client.not_found(sorted({i["rule_id"] for i in rules}))
    except Exception:  # noqa: BLE001 — the villa's system not readable now: the next tick
        return []
    closed = []
    renamed: dict[str, str | None] | None = None
    for inc in rules:
        p = notes_of(inc)
        if inc["rule_id"] in gone and p.get("rule_uid"):
            # ⚠️ RENAMED IS NOT GONE (one problem one card #1): a rule that sends its permanent number is looked for by
            # it; found under a new entity id, its alert carries on under that name. Not readable: nothing is closed
            if renamed is None:
                renamed = _automations_by_uid(client)
            now_named = (renamed or {}).get(str(p["rule_uid"])) if renamed is not None else None
            if renamed is None or renamed == {} or now_named:
                if now_named:
                    store.update_incident(inc["id"], rule_id=now_named)
                store.note(inc["id"], drop=("rule_gone_since",))
                continue
        if inc["rule_id"] not in gone:
            if p.get("rule_gone_since"):
                store.note(inc["id"], drop=("rule_gone_since",))       # back (a restart read it too early): still its
            continue
        since = p.get("rule_gone_since")
        if not since:
            store.note(inc["id"], {"rule_gone_since": now.isoformat()})
            continue
        if now - datetime.fromisoformat(since) < timedelta(minutes=clear_minutes):
            continue
        _close(store, store.incident(inc["id"]), now, out,
               ended(say("rule_gone")),
               note="Closed: the automation that sent it no longer exists (its entity ID changed, or it was deleted).")
        store.audit("alert-desk", "rule_gone", {"incident": inc["id"], "rule": inc["rule_id"]})
        closed.append(inc["id"])
    return closed


def _automations_by_uid(client) -> dict[str, str] | None:
    """{an automation's own id: its entity id now}, read from the villa's system; None when it cannot be read (then
    no rule counts as gone by its number)."""
    try:
        ids = [e for e in client.all_entity_ids() if e.startswith("automation.")]
        return {str(a["attributes"]["id"]): e for e, a in (client.states(ids) or {}).items()
                if (a.get("attributes") or {}).get("id") is not None}
    except Exception:  # noqa: BLE001 — not readable now (or a client that cannot list): the next tick
        return None


#: What a rule restating itself changes on its open alert: how it is judged from now on — never its words.
RESTATES = ("claim", "bad_states", "mode", "entities")


def restated(store: Store, ev: dict, now: datetime) -> dict:
    """The rule restated what it claims now (it was saved, reloaded, or the villa's system started): its open alert is
    judged from now by that claim (seen_again), at that priority. Nothing is sent to anyone.

    ⚠️ AN ALERT JUDGED BY A LIMIT THAT IS GONE (owner, 2026-10-17, #45): the mains overload rule went from 4000 to
    6200 W while its alert was open; the save cancelled the rule's run, so no all-clear ever came, and the desk kept
    reading the alert against 4000 W with 6000 W on the phase — it could never close, and a Done would reopen it."""
    out = {"send": [], "actions": [], "incident_id": None, "decision": "restated_nothing_open"}
    cur = open_alert(store, ev)
    if not cur:
        return out
    out["incident_id"], out["decision"] = cur["id"], "restated"
    p = store.note(cur["id"], {k: ev[k] for k in RESTATES if ev.get(k) is not None})
    route = route_for(ev["rule_id"], ev.get("blueprint"))
    carry_check(store, cur["id"], route, p)
    sev = priority(ev, route)
    # ⚠️ SAVED AT A LOWER PRIORITY, STILL CHASED (owner, 2026-10-19: "is it possible to lower a priority?"): the rule
    # saved with P3 changed the number only; the FM was still reminded until the rule alerted again
    _reprioritised(store, cur, p, sev, now, route, out)
    store.audit("alert-desk", "restated", {"incident": cur["id"], "priority": sev})
    return out


def abandoned(store: Store, ev: dict, now: datetime, params: VillaParams | None = None) -> dict:
    """The rule stopped watching. Still true: the owner hears it, and the desk reads it again from now on (seen_again).
    Back to normal just as it gave up (its `still_true` false): the incident is over.

    ⚠️ "STOPPED WATCHING" IS NOT "STILL NOT CLEAR" (architecture review 22): the rule's own message said "cleared just
    inside the limit — back to normal now", and the desk told the owner "Still not clear" with Done / Need help."""
    out = {"send": [], "actions": [], "incident_id": None, "decision": "abandoned_unknown"}
    inc = _find_by_ha_incident(store, ev.get("ha_incident")) or open_alert(store, ev)
    if not inc:
        return out
    out["incident_id"] = inc["id"]
    if str(ev.get("still_true")).lower() == "false":
        cleared = _close(store, inc, now, out, ended(say("stopped_watching")), terms=terms(params))
        out["decision"] = "abandoned_cleared"
        # ⚠️ ITS OWN MESSAGE SAYS THE SAME END (architecture review 23): taken over with the rule's "🔶 no longer
        # tracked" as its status, Home Assistant's "✅ cleared just inside the limit" became an orange warning
        out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), stage="closed", **about(inc, cleared))]
        return out
    store.note(inc["id"], {"abandoned": True, **{k: ev[k] for k in ("mode", "bad_states") if ev.get(k) is not None}},
               state=Incident.ESCALATED, escalated_at=now.isoformat(), assignee=CHASE["escalates_to"])
    out["decision"] = "abandoned"
    # who watches it now, and what to do: the rule stopped, the desk did not (seen_again)
    # ⚠️ SHORT, IN THE READER'S WORDS (owner, 2026-10-15: "I don't understand this latest update"): "when the alert
    # stopped watching it", "VESTA keeps watching it and closes it once it is right" — two sentences about the machinery.
    # The words are the owner's own (2026-10-15)
    # ⚠️ NOT A SECOND ESCALATION (owner, 2026-10-17, #45: "Escalation sent 10:09 to Owner", then "Escalation sent 10:24
    # to Owner"): the rule giving up is a still-there notice, sent where an escalation goes. Its line says its own time
    # ("Still-there alert sent 17/10/2026 10:24 to Owner — Still not fixed …"), so the words no longer repeat it
    said = about(inc, say("still_not_fixed", done=label_in("done", "Done")))
    out["ha_messages"] = [R.ha_message(inc["id"], context=ev.get("_context_id"), stage="still", **said)]
    out["send"] += tell(inc["severity"], "still", incident=inc["id"], escalate=True, **said)
    return out


def siren_minutes() -> int:
    """How long the siren sounds: policy.yaml's siren_auto_off_min, the one place it is set
    (owner, 2026-10-01). The engine reads the same value when it switches the siren off."""
    from vesta_agent.policy import Policy
    return Policy.load(os.environ.get("VESTA_POLICY", "")).siren_auto_off_min


def siren_gate(store: Store, ev: dict, now: datetime) -> dict:
    cfg = RULES["siren"]
    window = now - timedelta(minutes=cfg["window_min"])
    recent = [i for i in store.incidents(open_only=True)
              if route_for(i["rule_id"], notes_of(i).get(Notes.BLUEPRINT)).get("intrusion")
              # ⚠️ WHEN IT LAST TRIPPED, NOT WHEN IT FIRST OPENED (architecture review 24): reopened "Back again", the
              # garden alert of 20:00 tripping again at 22:00 counted as 20:00 — two sensors in a minute, no siren asked
              and datetime.fromisoformat(i.get("last_seen_at") or i["opened_at"]) >= window]
    signals = {i["entity_id"] for i in recent}
    mode = (ev.get("occupancy") or UNKNOWN).lower()
    armed = len(signals) >= cfg["min_signals"] and mode == EMPTY
    prompt = ""
    if armed:
        # The engine turns this into an Approve / Refuse request to the owner (outcome.carry_out). Its durations as
        # both apps word one (timeutil.lasting: "1 h 30 min", never "90 min")
        prompt = (f"Intrusion suspected: {len(signals)} independent sensors in {lasting(cfg['window_min'] * 60)} while "
                  f"the villa is {mode}: {', '.join(sorted(signals))}. Look at the snapshot. Approving sounds the siren "
                  f"for {lasting(siren_minutes() * 60)}.")
    return R.siren(armed, prompt, ("owner", "fm"), signals=sorted(signals), occupancy=mode,
                   reason=None if armed else ("villa not empty" if mode != EMPTY else "single signal"))


def reply(store: Store, iid: int, option: str, sender_role: str, now: datetime, params: VillaParams | None = None,
          name: str | None = None) -> dict:
    """A person's answer to incident `iid`: the `option` of the button pressed (BUTTONS). `name`: the person, as the People list
    names them — every line about the answer says it the way the button's own footer does ("Done pressed by Fabien on
    …"): owner, 2026-10-11, the same press read "Done pressed by Fabien" on one message and "Done answered by the
    facility manager" on the next."""
    inc = store.incident(iid)
    out = {"send": [], "actions": []}
    if not inc:
        out["send"].append(R.message("here", f"There is no alert {incident_tag(iid)}.")); return out
    button = BUTTONS.get(option) or {"label": option, "mark": None}
    label = button["label"]
    who = name or role_said(sender_role)
    # "Done on {time} (JM)" — without its full stop, as the sentences below go on — in every language the button has a
    # label in (skill.yaml `labels`): a language it has none for reads the whole line in English, never half
    labels = button.get("labels") or {}
    who_in = (lambda lang: SW.who({sender_role}, lang) or who) if not name and sender_role in ROLE_SHORT else who
    act = Said(acted(label, "{time}", who), {lang: SW.acted(lab, "{time}", _in(who_in, lang), lang)
                                             for lang, lab in labels.items() if lang in SW.LANGS})
    pressed = Said(PRESSED.format(label=label, name=who, time="{time}"),
                   {lang: text + SW.stop(lang) for lang, text in act.langs.items()})   # "{time}": the engine's

    def here(status: str, stage: str = "update", mark: str | None = None) -> dict:
        """The answer in the chat it came from: it replaces the incident's message there, so it says it all."""
        return R.message("here", **about(inc, status), incident=iid, stage=stage, mark=mark)
    if inc.get("closed_at"):
        out["send"].append(here(say("already_closed"), "closed")); return out
    if option == "done":
        # the one close of an alert (alert_watch.close): a person's, read again after the desk's wait, with its watch
        out["actions"] += Problems(store).close_incident(iid, Incident.DONE, now.isoformat(),
                                                         f"{label} on Telegram ({who}).", who=who, reply=label,
                                                         person=f"{label} ({who})", terms=terms(params))
        # ⚠️ A PROMISE THE CODE KEEPS (architecture review 23): "will check it stays quiet" was written since 0.9.0 and
        # nothing ever checked — a Done on a door still unlocked closed it for good. The tick reads it again (quiet_after_done)
        # read again whatever the rule: still bad, it reopens; not knowable, the people asked are told (still_there)
        checks = judged(inc)
        # how long VESTA watches it is the desk's own setting (clear_minutes), said as every duration (owner, 2026-10-19:
        # "✅ Done on 19/10/2026 02:10 (JM), VESTA will monitor it for …")
        monitoring = say("will_monitor", pressed=act, watch=lasting_in(_params(params).behaviour("clear_minutes") * 60))
        # closed at once when it cannot be read again: its watch is said here, as at every close (review J, 0.12.341:
        # "✅ Done on … (JM)." and nothing more, yet it reopened under the same number within reopen_hours)
        if not checks:
            pressed = watched(pressed, W.minutes(store.incident(iid)))   # and on the alert in every other chat (settle below)
        out["send"].append(here(monitoring.only(act.langs) if checks else pressed, "closed"))
    elif option == "need_help":
        helped = need_help(store, inc, act, now, out, mark=button.get("mark"), reply=label)
        out["send"].append(here(helped, "pressed", mark=button.get("mark")))
    else:
        store.update_incident(iid, reply=label)
        noted = lambda lang: SW.acted(_in(say("noted_word"), lang), "{time}", _in(who_in, lang), lang)
        out["send"].append(here(say("noted", noted=noted, label=label_in(option, label)), "pressed"))
    # the answer, on the alert and its reminders in every chat (a button press has already done it, by name)
    if option in BUTTONS:
        out["settle"] = [R.settle(iid, pressed, mark=button.get("mark"), note_in=pressed.langs)]
    store.audit("alert-desk", "reply", {"incident": iid, "by": sender_role, "option": option})
    return out


def need_help(store: Store, inc: dict, pressed: Said, now: datetime, out: dict, mark: str | None = None,
              reply: str = "Need help") -> Said:
    """Need help on alert `inc`, wherever it was pressed (a Telegram button, a Cockpit card): escalated to the chase's
    escalates_to, told to them with the buttons, in ONE sentence ("{pressed}: Owner is asked to act."). The
    sentence, for the chat it was pressed in."""
    store.update_incident(inc["id"], state=Incident.ESCALATED, reply=reply, escalated_at=now.isoformat(),
                          assignee=CHASE["escalates_to"])
    # ONE sentence in every chat (owner, 2026-10-11: one incident, one picture — "over to you" / "the owner has been
    # told" were two)
    helped = say("asked_to_act", pressed=pressed, role=role_in(CHASE["escalates_to"])).only(pressed.langs)
    out["send"] += tell(inc["severity"], "escalated", incident=inc["id"], mark=mark, **about(inc, helped))
    return helped


def help_alerts(store: Store, now: datetime, out: dict) -> list[int]:
    """⚠️ NEED HELP ON A FAULT WITH NO ALERT (owner, 2026-10-30: every Cockpit card offers Done · Need help · Open Ticket):
    a night-check finding or a person's ticket gets an alert of its own, already escalated to the chase's escalates_to,
    standing for that fault (Notes.HELP_OF) — its Done on Telegram closes the fault, the fault's Done in the Cockpit
    closes it (Problems.close_incident, closed_in_kiosk). One open per fault (problems.help_key). Its ids."""
    made = []
    for subject, h in Problems(store).help_asked().items():
        if store.find_open_incident(help_key(subject)):
            continue
        title = str(h.get("title") or "")
        iid = store.new_incident(help_key(subject), str(h.get("rule_id") or "kiosk_help"), str(h.get("entity_id") or ""),
                                 "P2", {Notes.MESSAGE: title, Notes.HELP_OF: subject}, now.isoformat())
        carry_to(store, iid, "P2")
        store.update_incident(iid, state=Incident.ESCALATED, asked_at=now.isoformat(), escalated_at=now.isoformat(),
                              assignee=CHASE["escalates_to"])
        pressed = kiosk_words.read(h.get("said"))
        helped = say("asked_to_act", pressed=Said(str(pressed), getattr(pressed, "langs", None)),
                     role=role_in(CHASE["escalates_to"]))
        out["send"] += tell("P2", "escalated", incident=iid, text=title, **_status(helped))
        out["actions"].append(R.faults_changed())       # the fault's card carries the alert's number and story
        made.append(iid)
    return made


def tick(store: Store, now: datetime, params: VillaParams | None = None, client=None, zone: str | None = None) -> dict:
    """Every 5 minutes: what Home Assistant will never say is over (`client`: its states, read again), chase ladder,
    villa-silent watch, alert fatigue."""
    params = _params(params)                       # no parameters given: the desk's own timings, never a copy here
    reask = params.behaviour("reask_minutes")
    escal = params.behaviour("escalate_minutes")
    silent_min = params.behaviour("villa_silent_minutes")
    out = {"send": [], "actions": [], "escalated": [], "reasked": []}
    if client is not None:
        out["cleared"] = seen_again(store, now, client, params.behaviour("clear_minutes"), out, terms(params))
        out["not_quiet"] = quiet_after_done(store, now, client, params.behaviour("clear_minutes"), out, terms(params))
        out["rule_gone"] = rule_gone(store, now, client, params.behaviour("clear_minutes"), out)
    out["watch_over"] = watch_over(store, now, out, zone)
    out["helped"] = help_alerts(store, now, out)
    for inc in store.incidents(open_only=True):
        p = notes_of(inc)
        # the route's "what to do" edited while the alert is open (a villa's rules.yaml): the Kiosk fault's note and
        # the digest follow within a tick, as Telegram's next message does
        carry_check(store, inc["id"], route_for(inc["rule_id"], p.get(Notes.BLUEPRINT)), p)
        carry_to(store, inc["id"], inc["severity"], p)     # an incident of an older desk gets it at the next tick
        W.carry(store, inc["id"], terms(params), p)       # a close in the Cockpit knows its watch at once (alert_watch.close)
        if p.get(Notes.KIOSK_HELP):
            # Need help pressed on its card in the Cockpit: the same escalation as the Telegram button's
            asked = kiosk_words.read(store.take_note(inc["id"], Notes.KIOSK_HELP))
            need_help(store, inc, Said(str(asked), getattr(asked, "langs", None)), now, out)
            out["escalated"].append(inc["id"])
            continue
        said = store.take_note(inc["id"], Notes.KIOSK_REOPENED, assignee=CHASE["asks"]) \
            if p.get(Notes.KIOSK_REOPENED) else None
        if said:
            # ⚠️ A FAULT A PERSON REOPENED IN THE KIOSK (architecture review 25): the facility manager is asked at once,
            # its buttons back — the ladder runs from now
            # who and when the Kiosk recorded, in the one wording (vesta_shared.kiosk_words; review 29) — an older
            # record held only the name
            # (a record written before 0.12.202 says "in the VESTA Kiosk": kept as written); since 0.12.364 it is kept
            # in every language (kiosk_words.stored), each chat's card saying its own (architecture review O)
            if isinstance(said, dict):
                said = kiosk_words.read(said)
            elif not said.startswith(("Reopened in the Cockpit", "Reopened in the VESTA Kiosk")):
                said = kiosk_words.reopened(said, None, "")
            said = Said(str(said), getattr(said, "langs", None))
            out["send"] += tell(inc["severity"], "reopened", incident=inc["id"], chased=True, **about(inc, said))
            continue
        if p.get(Notes.UNREACHED) and inc["state"] in (Incident.ASKED, Incident.REASKED) and \
                store.take_note(inc["id"], Notes.UNREACHED, state=Incident.ESCALATED, escalated_at=now.isoformat(),
                                assignee=CHASE["escalates_to"]):
            # ⚠️ NOBODY OF THE FACILITY MANAGER'S RECEIVED IT (architecture review 25): Telegram refused every chat of
            # theirs, and the owner heard of it only at the 45-minute escalation — told now
            out["send"] += tell(inc["severity"], "escalated", incident=inc["id"],
                                **about(inc, say("not_delivered", asked=role_in(CHASE["asks"]),
                                                 to=role_in(CHASE["escalates_to"]))))
            out["escalated"].append(inc["id"])
            continue
        if inc["state"] not in (Incident.ASKED, Incident.REASKED):
            continue
        asked = datetime.fromisoformat(inc["asked_at"])
        age = now - asked
        # only if it is still where it was read (store.move): taken on in the Cockpit meanwhile, it is chased no more
        if inc["state"] == Incident.ASKED and age >= timedelta(minutes=reask) and \
                store.move(inc["id"], (Incident.ASKED,), Incident.REASKED, reasked_at=now.isoformat()):
            out["send"] += tell(inc["severity"], "reminder", incident=inc["id"], chased=True,
                                # the engine writes the step first: "Reminder sent … to FM — No answer after 15 min";
                                # the duration as both apps word one (timeutil.lasting: "1 h 30 min", never "90 min")
                                **about(inc, say("no_answer", after=lasting_in(reask * 60))))
            out["reasked"].append(inc["id"])
        elif inc["state"] == Incident.REASKED and age >= timedelta(minutes=escal) and \
                store.move(inc["id"], (Incident.REASKED,), Incident.ESCALATED, escalated_at=now.isoformat(),
                           assignee=CHASE["escalates_to"]):
            out["send"] += tell(inc["severity"], "escalated", incident=inc["id"],
                                **about(inc, say("no_answer_from", role=role_in(CHASE["asks"]),
                                                 after=lasting_in(escal * 60))))
            out["escalated"].append(inc["id"])
    # villa silent: the engine's Home Assistant connection has been down too long
    last = store.last_beat(HA_BEAT)
    if last and now - datetime.fromisoformat(last) > timedelta(minutes=silent_min):
        key = "critical_internet---villa_silent|agent"
        if not store.find_open_incident(key):
            iid = store.new_incident(key, "critical_internet---villa_silent", "agent", "P1",
                                     {"message": f"No contact with the villa's system for {lasting((now - datetime.fromisoformat(last)).total_seconds())}: internet, power or the villa's system is down."},
                                     now.isoformat())
            store.update_incident(iid, state=Incident.ASKED, asked_at=now.isoformat(), assignee=CHASE["asks"])
            out["send"] += tell("P1", "new", incident=iid, ladder=False,   # the priority is the heading's; the villa's time
                                text="No contact with the villa's system. Check power, the router and the internet link.",
                                **_status(say("villa_silent",
                                              since=day_time_label(villa_time(last, zone or "UTC"), weekday=True))))
    elif last:
        cur = store.find_open_incident("critical_internet---villa_silent|agent")
        if cur:
            # ⚠️ BACK ONLINE CANNOT COME BACK (architecture review, 2026-10-26): its next outage opens a NEW number (no
            # reopening here), yet the watch every open alert carries stayed on it — #2 opened 40 minutes later and #1,
            # "(watch)" all along, then read "Closed on …: it did not come back within 4h." No watch: nothing says one
            out["actions"] += Problems(store).close_incident(cur["id"], Incident.RECOVERED, now.isoformat(),
                                                             can_come_back=False)
            out["send"] += tell("P1", "closed", incident=cur["id"], chased=True,
                                **about(cur, ended(say("back_online"))))
    # alert fatigue: a rule firing more than N times in 30 days without acknowledgement
    limit = params.behaviour("alert_fatigue_per_month")
    since = (now - timedelta(days=FATIGUE_WINDOW_DAYS)).isoformat()
    # every rule's runs counted in ONE pass (architecture review 25: a pass per rule over all history, every 5 minutes)
    for r, n in store.incident_counts(since).items():
        if n >= limit:
            # one proposal per rule: its count lives in the detail (architecture review 24: the count in the title made a
            # new open proposal at every new count — "fired 21 times", "fired 22 times"…)
            store.add_proposal("retune", f"Retune {r}: it fires too often",
                               f"The automation {r} fired {n} times in {FATIGUE_WINDOW_DAYS} days. Either the threshold is too tight or the device needs attention. "
                               "The VESTA Agent proposes a new threshold in the weekly report and applies nothing.", "Fewer useless messages")
    store.beat("agent_tick", now.isoformat())
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["intake", "tick", "reply", "status"])
    script.arguments(ap)                           # --store --zone --fixture-dir --now: one set-up for every script
    ap.add_argument("--event"); ap.add_argument("--incident", type=int); ap.add_argument("--option"); ap.add_argument("--from", dest="sender", default="fm"); ap.add_argument("--name")
    a = ap.parse_args(argv)
    ctx = script.Context(a, skill=SKILL, settings_file="rules.yaml")
    store = ctx.store
    now = now_utc(a.now)
    # the villa's own parameters (its maintenance mode, its timings): Home Assistant's live helpers kept ten
    # minutes (params.live_params) — a test gives its fixture folder, never a flag of its own
    params = ctx.params
    if a.cmd == "intake":
        ev = json.load(open(a.event)) if a.event else json.load(sys.stdin)
        res = intake(store, ev, now, params, lambda: occupancy(ctx.client), zone=ctx.zone)
    elif a.cmd == "tick":
        res = tick(store, now, params, ctx.live_client, zone=ctx.zone)
    elif a.cmd == "reply":
        res = reply(store, a.incident, a.option or "", a.sender, now, params, name=a.name)
    else:
        res = {"open": store.incidents(), "beats": {n: store.last_beat(n) for n in (HA_BEAT, "agent_tick", "maintenance_nightly")}}
    print(json.dumps(res, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
