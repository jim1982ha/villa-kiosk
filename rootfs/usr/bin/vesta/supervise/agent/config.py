"""The agent's settings, and every kill switch. REQ-061.

⚠️ EVERY RISKY BEHAVIOUR IS REVERTIBLE IN ONE WORD. This codebase already has
the convention — `BADGE_PLACEMENT` reverts the whole placement solver,
`WALL_OCCLUSION` reverts a rendering rule — and the reason is that the thing you
most want when a new subsystem misbehaves at a villa you are not standing in is
a single flag, not a release.

⚠️ DEFAULTS ARE APPLIED AT READ TIME AND NEVER PERSISTED, AND THIS IS NOT A
STYLE CHOICE. `config/AppConfig`'s merge-on-load caused a real, hard-to-reproduce
bug: a seed spread underneath stored config RESURRECTED entries the operator had
deleted, and the report was "stale entities I can't delete". A sparse overlay
means an absent key reads as its default and a DELETED key stays deleted.

⚠️ `allowed_senders` AND `actuable_entities` SHIP EMPTY, AND A SEEDED DEFAULT
IN EITHER IS A SECURITY BUG RATHER THAN A CONVENIENCE. An `allowed_senders` with
an entry is an open bot — anyone who finds it can talk to the villa. An
`actuable_entities` with an entry is an agent that acts on a device nobody
authorised. Both must be filled in by a person, deliberately, once.

⚠️ THOSE TWO ARE THE WORST CASES, NOT THE WHOLE LIST — `MUST_BE_EMPTY` has FIVE
entries and a test asserts each is falsy here. Read the declaration, not this
sentence: CLAUDE.md carried exactly this gap about `SHARED_CONFIG_KEYS` (four
named, five declared) and v2.486.0 is what it cost to find.

⚠️ AND IT HOLDS ENTITY IDS, WHICH IT DID NOT UNTIL 2.718.0 — IT HELD PER-RUN
HANDLES, AND THAT MADE IT NOT AN ALLOW-LIST AT ALL. `refs.py` says in its own
docstring that handles are sequential, meaningless and deliberately unstable:
`d1` in one run and `d1` in the next are unrelated. So a stored `["d1"]`
authorised whichever device the model happened to read FIRST — measured: the
pool pump in one run and the front door in the next, from the same stored line.
The harm gate still refused the door (a lock is high-harm at any confidence), so
the exposure was bounded to low-harm devices substituting for one another, which
is precisely what this list exists to prevent. It was never caught because the
one test that populated it built the list FROM the run's own table, so it could
only ever agree with itself.

⚠️ THE KILL SWITCHES ARE INDEPENDENT AND NEST. `enabled: false` stops
everything. `act_enabled: false` leaves the agent reading and reasoning but
unable to touch the villa. A trigger flag stops one entry point. They are
separate because the reasons to reach for them are separate: a noisy agent needs
its triggers cut, a suspicious one needs its hands tied, and a broken one needs
turning off.
"""

from __future__ import annotations

from typing import Any, Dict, Final, List, Mapping, Optional, Tuple

from vesta.supervise.agent import contracts

#: ⚠️ THE SHAPE, NOT THE STORED DOCUMENT. Nothing writes this dict; it is spread
#: UNDER a stored config at read time. Adding a key here changes what an
#: unconfigured villa does, and changes nothing about one already configured.
#: How deep an investigation goes: turns, and tool calls within them.
#: ⚠️ THE ONLY PLACE THESE NUMBERS EXIST. Two free integers in the store let a
#: villa hold a pair that cannot happen (more tool calls than turns can spend),
#: and gave the owner two dials for one decision.
DEPTH: Final[Dict[str, Dict[str, int]]] = {
    "brief":    {"turns": 4,  "tool_calls": 12},
    "normal":   {"turns": 8,  "tool_calls": 24},
    "thorough": {"turns": 12, "tool_calls": 36},
}


DEFAULTS: Final[Dict[str, Any]] = {
    # ── the kill switches, and the address they gate ─────────────────────
    #: ⚠️ OFF ON A FRESH INSTALL. An add-on that begins reasoning about a villa
    #: the moment it is installed, before anybody has set a budget or a
    #: recipient, is an add-on that spends money nobody agreed to.
    "enabled": False,
    #: ⚠️ OFF, AND SEPARATELY. Reading and reasoning are safe; acting is not.
    "act_enabled": False,
    #: ⚠️ THE ADDRESS OF THE HOME ASSISTANT MCP ADD-ON, PASTED BY THE OWNER.
    #: Empty is a supported state and the default: no upstream tools, and every
    #: built-in reader answers exactly as it did before. It is not discovered
    #: automatically on purpose — that needs `hassio_role: manager`, which also
    #: grants installing and stopping add-ons, and this is a dashboard.
    #:
    #: ⚠️ NOT A KILL SWITCH, AND THIS BLOCK'S HEADING SAID "the three" UNTIL IT
    #: WAS INSERTED HERE (2.709.0). The three are `enabled`, `act_enabled` and a
    #: trigger flag — see the module docstring. A count in a heading stops being
    #: true the moment anything is added under it, which is why the heading now
    #: names the shape instead of counting it.
    "mcp_url": "",
    # ⚠️ TWO, AND `event` WAS DELETED IN 2.762.0 BECAUSE NOTHING COULD FIRE IT.
    # It was a switch an owner could set and no code path anywhere called
    # `run_once(trigger="event")` — the three real entry points are the clock,
    # the "check the villa now" button and chat. It was never in the UI either,
    # which is the only reason it never misled anybody: flipping it changed
    # nothing in either direction.
    #
    # ⚠️ AND WIRING IT WAS THE OTHER OPTION, REFUSED ON PURPOSE (owner decision,
    # 2026-08-26). A villa event waking the agent means a frontier-model
    # investigation every time something trips, and the `critical_*` blueprints
    # that would trip it ALREADY alert the owner directly in under a second with
    # no add-on and no internet. The agent's job is finding what nobody alarmed
    # on; paying it to react to things that already alarmed is the opposite.
    "triggers": {"scheduled": True, "chat": False},
    # ⚠️ ONE KEY FOR WHAT WAS TWO (2.756.0). `shadow` (bool) and
    # `investigate_mode` ("auto"/"approve") were two stored booleans-in-disguise
    # for ONE three-position choice, and the UI had already merged them into one
    # control that wrote both — so two keys could disagree and nothing could say
    # which the villa was actually in. "ask" investigates only what a person
    # approves; "live" is normal.
    #
    # ⚠️ "observe" DELIVERS SINCE 2026-08-28, BY THE OWNER'S RULING. It used to
    # mean "run everything, deliver nothing" (the shadow-store era, whose diff
    # died in 2.756.0). It now means: investigate everything, raise concerns
    # into the LIVE store, tell people ONCE as an FYI — and never escalate,
    # never raise a to-do job, never push. The stamp is
    # `Concern.informational`, set at raise time in `tools/concern.writer`.
    #
    # ⚠️ "observe" IS STILL THE SHIPPED DEFAULT: a villa that has just switched
    # supervision on is informed without being chased, which is the polite
    # first period — and with no notify target configured yet, nothing sends.
    "mode": "observe",
    #: ⚠️ HOW MANY INVESTIGATIONS ONE PASS MAY START. A bound on the worst case
    #: rather than a judgement about which findings matter: a pass escalating
    #: six subjects would otherwise be six frontier-model runs, and this is the
    #: tier where cost moves from per-PASS to per-FINDING. 3 by the owner's
    #: choice, on the reasoning that a real fault is still a fault fifteen
    #: minutes later — missing the top three delays it by one cadence, it does
    #: not lose it.
    # ⚠️ 3 -> 2 (2.752.0). It BOUND AT 3 ON EVERY ESCALATING PASS of the
    # observed period, so it was not a ceiling, it was the multiplier: three
    # frontier-model investigations per pass at ~$0.37 each. The subject that
    # does not fit is not lost — it is escalated again next pass if it still
    # looks worth a closer look, which is the honest test of whether it was.
    "max_investigations_per_pass": 2,
    #: ⚠️ SHADOW MODE: run everything, deliver NOTHING (ARCH-016). Not a push,
    #: not a brief line, not a kiosk badge. It is how the claim that the agent
    #: outperforms the rules stops being a prediction — the concerns are
    #: recorded and diffed against what the blueprints found, with no
    #: user-visible risk while that evidence is gathered.
    #:
    #: ⚠️ DEFAULT TRUE, WHICH IS THE OPPOSITE OF EVERY OTHER FLAG HERE. The
    #: others ship off so nothing happens; this ships ON so that when the agent
    #: IS switched on, its first period is observed rather than delivered.
    #: Turning it off is the cutover decision, and it should be a decision.
    #: ⚠️ QUIET HOURS SHIP EMPTY, AND EMPTY MEANS NEVER QUIET RATHER THAN
    #: ALWAYS. A property that has not configured a window wants its warnings,
    #: not a silence nobody asked for. "22:00"/"07:00" is the shape; the window
    #: WRAPS midnight, which is the only case that matters and the one a naive
    #: comparison gets exactly backwards. ⚠️ A CRITICAL IGNORES IT ENTIRELY —
    #: `route.MATRIX` decides that, not these keys: if it can wait until
    #: morning it is a warning.
    "quiet_hours_start": "",
    "quiet_hours_end": "",
    #: The property's timezone, for the window above. ⚠️ EMPTY DEGRADES TO UTC,
    #: which is wrong by eight hours on the reference villa — so it is read from
    #: discovery where possible rather than typed.
    "timezone": "",

    # ── cadence ──────────────────────────────────────────────────────────
    "triage_minutes": 15,
    "brief_cadence": "daily",

    # ── cost ─────────────────────────────────────────────────────────────
    "monthly_limit": 4_000,
    # ⚠️ 8 -> 4 (2.752.0), BECAUSE 8 WAS NEVER A CEILING EITHER — all eleven
    # investigations of the observed period used exactly 8 of 8, which means
    # the cap and not the task decided when to stop. The runs that have since
    # completed at 4 turns answered in 20-21 s with 7 tool calls, and the tier
    # is instructed that a partial-and-labelled answer beats silence
    # (`registry.LAST_TURN_NOTE`), so a genuinely deep case degrades rather
    # than vanishing. Cost is `prefix x turns`; this is the second factor.
    # ⚠️ ONE KEY FOR WHAT WAS TWO (2.756.0), for the same reason as `mode`
    # above. `max_turns` and `max_tool_calls` are not independent dials — they
    # are one answer to "how deep should an investigation go", and the UI has
    # only ever offered three presets while the store held two free integers
    # that could contradict each other (24 tool calls across 4 turns is a cap
    # that never binds). `DEPTH` is the table; `policy.for_run` reads it.
    #
    # ⚠️ "brief" IS THE MEASURED DEFAULT, not a cautious guess — see
    # `test_agent_cost.py`. Every investigation on the reference villa used all
    # eight of its old turns, which means the cap and not the task decided when
    # to stop; the runs since answer in four.
    "depth": "brief",

    #: How many output tokens ONE turn may produce. ⚠️ A CEILING, NOT A SPEND —
    #: billing is for tokens actually generated, so raising this costs nothing
    #: until a turn genuinely needs the room. That asymmetry is the whole
    #: argument: too low throws away the turn AND everything paid for before it.
    #:
    #: ⚠️ IT WAS 2048, AS A DEFAULT ARGUMENT NO CALLER EVER PASSED, AND IT WAS
    #: KILLING 7 OF EVERY 8 SUPERVISION PASSES. `thinking` blocks are drawn from
    #: this same budget, so a turn that reasoned before answering spent the lot
    #: on thinking and emitted no text and no tool call — `stop_reason=max_tokens,
    #: saw=thinking`. The adapter correctly called that unusable and the run was
    #: declined, discarding every tool result already gathered. Measured on the
    #: reference villa: 554 s of wall clock, 36 billed turns and 33 tool calls
    #: across seven passes, all producing nothing. The one pass that succeeded
    #: took two turns — the failure rate rose with the amount of thinking, which
    #: is the signature of an output ceiling rather than of a bad prompt.
    "max_output_tokens": 8_192,

    # ── models, per tier ─────────────────────────────────────────────────
    #: ⚠️ PINNED IN CONFIG, NEVER IN CODE (ADR-016). Upgrading a model is then a
    #: config change plus an eval run, not a deploy — which is the whole reason
    #: "will the next model break my villa monitoring?" becomes answerable.
    # ⚠️ OFF, AND IT IS THE LARGEST SINGLE COST DIAL IN THIS FILE. True folds
    # Home Assistant's whole MCP catalogue into the INVESTIGATION tier's tool
    # list — 44 schemas against 10, a 52,108-token prefix against ~9,700, on
    # every turn. See `registry.REASON_TOOLS`. Chat is unaffected either way:
    # a person asking an arbitrary question keeps the full set.
    # ⚠️ 0.0 IS OFF. See `budget.DAILY_USD_KEY` for why a redistributable
    # add-on may not ship a number tuned against one property's spend.
    "daily_usd_limit": 0.0,
    "ha_tools": False,
    "model_triage": "claude-haiku-4-5",
    "model_reason": "claude-opus-5",
    # ⚠️ CHAT HAS ITS OWN TIER, AND IT IS NOT THE FRONTIER MODEL. It ran on
    # `model_reason` until 2.664.0, so every question typed at the villa was
    # answered by the most expensive model in the table — measured on the
    # reference villa at 28 requests and $1.78 in an afternoon of TESTING,
    # 100% of it opus. Answering "is the pool pump ok" is not the same task as
    # investigating why it is not: chat re-reads a document and summarises,
    # which is what the mid-tier is for. `model_reason` stays frontier because
    # judgement is what it is paid for.
    "model_chat": "claude-sonnet-5",
    "model_brief": "claude-sonnet-5",

    # ── the two that MUST be empty ───────────────────────────────────────
    #: ⚠️ EMPTY MEANS NOBODY MAY TALK TO THE BOT. A sender not in this map gets
    #: no run and no reply — silence rather than a refusal, because an error
    #: reply confirms the bot is live to whoever is probing it.
    #:
    #: ⚠️ SUPERSEDED BY `people` AND DELIBERATELY KEPT. `people.people()` reads
    #: this when the new table is empty, so a villa that configured senders
    #: before 2.651.0 does not have its bot go deaf on upgrade — the symptom
    #: would be "it stopped answering me" with nothing visibly wrong.
    "allowed_senders": {},
    #: ⚠️ ONE TABLE FOR BOTH DIRECTIONS, AND THEY ARE NOT SYMMETRIC.
    #: `{name, telegram, targets[], role}`. `telegram` is the only field that
    #: grants anything INBOUND; `targets` are notify destinations, which can
    #: only receive. A person with a device and no chat is delivery-only, which
    #: is a normal row. Empty by the same requirement as `allowed_senders`.
    "people": [],
    #: ⚠️ WHICH SERVICES, as distinct from `actuable_entities`' WHICH DEVICES —
    #: both allow-lists must pass, so `light.turn_off` on an unlisted lamp and
    #: `lock.unlock` on a listed door are refused for different reasons. Empty
    #: by the same requirement: a seeded service list authorises a verb nobody
    #: chose, on every device that ever reaches the ref list.
    "allowed_services": [],
    #: ⚠️ EMPTY MEANS THE AGENT MAY ACT ON NOTHING. Even with `act_enabled`
    #: true, an empty list is a complete stop — the two are AND-ed, so turning
    #: actuation on does not by itself authorise a single device.
    #: ⚠️ ENTITY IDS, NOT HANDLES — see the module docstring. The name said
    #: `refs` and the code compared handles, which made it a slot number rather
    #: than an allow-list.
    # ⚠️ EMPTY, AND EMPTY MEANS THE FACILITY MANAGER LOOP IS OFF. Which to-do list a
    # property uses is a fact about that property; a seeded default would write
    # jobs into a stranger's list. See `agent/task.py`.
    "task_list": "",
    "actuable_entities": [],
    #: Subjects a person has told us to stop raising. Filled by the feedback
    #: loop's counter, never by the agent's judgement.
    "suppressed_subjects": [],
}

#: Keys whose default is EMPTY BY SECURITY REQUIREMENT rather than by taste. A
#: test asserts each of these is falsy in DEFAULTS, so a helpful seed cannot be
#: added without the build failing.
MUST_BE_EMPTY: Final[Tuple[str, ...]] = ("allowed_senders", "people",
                                        "actuable_entities", "allowed_services",
                                        "suppressed_subjects")


def view(raw: Any) -> Dict[str, Any]:
    """The EFFECTIVE config: stored values over defaults, computed per read.

    ⚠️ SHALLOW, EXCEPT FOR `triggers`, AND THE EXCEPTION IS DELIBERATE.
    `store.config_view` is shallow throughout and documents why: a nested merge
    means an operator who removes ONE key inside a slice silently gets it back
    and has no way to express its absence. `triggers` is merged one level
    because its members are independent kill switches — an operator turning
    `chat` off must not have to restate `scheduled` and `event` to keep them,
    and forgetting one would turn a switch ON, which is the wrong direction to
    fail.

    ⚠️ UNKNOWN KEYS ARE KEPT, same rule as the reports config: a config written
    by a NEWER version must survive a downgrade untouched.
    """
    out: Dict[str, Any] = {k: (dict(v) if isinstance(v, dict) else
                               list(v) if isinstance(v, list) else v)
                           for k, v in DEFAULTS.items()}
    if not isinstance(raw, Mapping):
        return out
    for key, value in raw.items():
        if key == "triggers" and isinstance(value, Mapping):
            merged = dict(DEFAULTS["triggers"])
            merged.update({str(k): bool(v) for k, v in value.items()})
            out["triggers"] = merged
            continue
        out[str(key)] = value

    # ⚠️ A STORED CONFIG WRITTEN BEFORE 2.756.0 IS MIGRATED ON READ, NEVER
    # REWRITTEN. Every villa already has `shadow` and `investigate_mode` on
    # disk, and a straight rename would have silently reset each one to the
    # shipped default — supervision back to "observe" on a property running
    # live. Derived here, so an old file keeps meaning what it meant and a new
    # write simply stops carrying the old keys.
    #
    # ⚠️ THE NEW KEY WINS WHERE BOTH EXIST. `mode` is what this version writes,
    # so a file holding both was written by this version and the legacy pair is
    # a leftover.
    # ⚠️ ONLY WHEN THE OLD KEY IS ACTUALLY PRESENT. The first cut ran this
    # whenever `mode` was absent from the raw document, which is true of a
    # FRESH config too — so `out.get("shadow")` read None, fell to the else
    # branch and produced "ask" for a villa that had never configured anything.
    # `DEFAULTS["mode"]` is already in `out`; migration must only ever
    # OVERRIDE it, never fill it in.
    stored = raw if isinstance(raw, Mapping) else {}
    if "mode" not in stored:
        if "shadow" in stored and bool(stored.get("shadow")):
            out["mode"] = "observe"
        elif "investigate_mode" in stored or "shadow" in stored:
            out["mode"] = ("live"
                           if str(stored.get("investigate_mode", "auto")) == "auto"
                           else "ask")
    if "depth" not in stored:
        turns = stored.get("max_turns")
        if isinstance(turns, (int, float)) and not isinstance(turns, bool):
            out["depth"] = ("brief" if turns <= 5
                            else "thorough" if turns >= 11 else "normal")
    return out


def depth_of(config: Any = None) -> Dict[str, int]:
    """The turn and tool-call budget for this villa's chosen depth.

    ⚠️ AN UNKNOWN VALUE FALLS BACK TO THE DEFAULT rather than raising: this is
    read on every run, and a config someone hand-edited to `depth: "deep"` must
    produce a working investigation, not take supervision down."""
    chosen = str(view(config).get("depth") or "")
    return dict(DEPTH.get(chosen) or DEPTH[str(DEFAULTS["depth"])])


def errors(value: Any) -> List[str]:
    """Everything wrong with a proposed config. Empty is the pass.

    ⚠️ CHECKS ONLY KEYS IT KNOWS, and keeps the rest — same contract as
    `store.validate_config`. Refusing an unknown key would make a downgrade
    reject the newer version's settings wholesale.
    """
    problems: List[str] = []
    if not isinstance(value, Mapping):
        return ["config is not an object"]

    for flag in ("enabled", "act_enabled"):
        if flag in value and not isinstance(value[flag], bool):
            problems.append(f"{flag} must be true or false")

    triggers = value.get("triggers")
    if triggers is not None:
        if not isinstance(triggers, Mapping):
            problems.append("triggers must be an object")
        else:
            for name, on in triggers.items():
                if not isinstance(on, bool):
                    problems.append(f"triggers.{name} must be true or false")

    chosen = value.get("mode")
    if chosen is not None and chosen not in ("observe", "ask", "live"):
        problems.append("mode must be 'observe', 'ask' or 'live'")
    depth = value.get("depth")
    if depth is not None and depth not in DEPTH:
        problems.append("depth must be " + ", ".join(repr(k) for k in DEPTH))

    # ⚠️ THE LEGACY KEY IS STILL VALIDATED, AND NOT BY OVERSIGHT. `view()`
    # reads it to migrate a pre-2.756.0 document, so a malformed value there
    # would silently migrate to "ask" — supervision holding every escalation for
    # a person on a villa that had chosen otherwise. It is validated because it
    # is still READ, and it stops being read the day no stored document has it.
    mode = value.get("investigate_mode")
    if mode is not None and mode not in ("auto", "approve"):
        # ⚠️ REFUSED, NOT DEFAULTED — the same rule `allowed_senders` states
        # below. Defaulting a typo here would silently pick one of two
        # behaviours that differ by whether the villa spends money unattended.
        problems.append("investigate_mode must be 'auto' or 'approve'")

    for name in ("triage_minutes", "monthly_limit",
                 "max_investigations_per_pass",
                 "max_output_tokens", "daily_usd_limit"):
        if name not in value:
            continue
        raw = value[name]
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            problems.append(f"{name} must be a number")
        elif raw < 0:
            problems.append(f"{name} may not be negative")

    # ⚠️ BOOLEANS ARE CHECKED SEPARATELY FROM THE NUMERIC LOOP ABOVE, which
    # refuses a bool explicitly (`isinstance(raw, bool)`) precisely so a flag
    # cannot arrive as 0/1 and be read as a ceiling.
    for flag in ("ha_tools",):
        if flag in value and not isinstance(value[flag], bool):
            problems.append(f"{flag} must be true or false")

    senders = value.get("allowed_senders")
    if senders is not None:
        if not isinstance(senders, Mapping):
            problems.append("allowed_senders must be an object of id -> role")
        else:
            for sender, role in senders.items():
                if not str(sender).strip():
                    problems.append("allowed_senders has an empty sender id")
                if role not in contracts.SENDER_ROLE:
                    # ⚠️ AN UNKNOWN ROLE IS REFUSED, not defaulted. Defaulting
                    # would grant SOME access to a typo, and this map is the
                    # only thing standing between the villa and anyone who
                    # finds the bot.
                    problems.append(
                        f"allowed_senders[{sender}] role {role!r} is not one "
                        f"of {', '.join(contracts.SENDER_ROLE)}")

    for name in ("actuable_entities", "allowed_services", "suppressed_subjects"):
        if name in value and not isinstance(value[name], list):
            problems.append(f"{name} must be a list")

    return problems


def may_act(config: Optional[Mapping[str, Any]], entity_id: str) -> bool:
    """Is this specific device authorised for autonomous action?

    ⚠️ IT TAKES THE ENTITY ID, AND TAKING A HANDLE WAS THE BUG. Handles are
    per-run and deliberately unstable (`refs.py`), so a stored list of them
    authorised a position rather than a device. The caller resolves the handle
    first and passes what it resolved to — which is also the only value that
    means anything in a file an owner edits once and keeps.

    ⚠️ BOTH CONDITIONS, AND-ED. `act_enabled` is the master switch and
    `actuable_entities` is the list; neither alone is authorisation. Turning
    actuation on with an empty list authorises nothing, which is the correct
    default for a switch somebody may flip to see what happens.

    ⚠️ COMPARED CASE-INSENSITIVELY AND TRIMMED, because this list is TYPED BY A
    PERSON now that there is an editor for it. Home Assistant ids are lower-case
    by construction, so this can only ever forgive a typo — it cannot admit a
    device that is not named.

    ⚠️ THIS IS NOT THE HARM GATE. `policy.may_act` still applies and still
    refuses every high-harm action regardless of what this returns — a device
    can be on this list and still never be actuated autonomously.
    """
    cfg = view(config)
    if not cfg.get("act_enabled"):
        return False
    allowed = cfg.get("actuable_entities")
    if not isinstance(allowed, list):
        return False
    wanted = str(entity_id or "").strip().lower()
    return bool(wanted) and wanted in {str(a).strip().lower() for a in allowed}


def trigger_enabled(config: Optional[Mapping[str, Any]], name: str) -> bool:
    """May this entry point start a run? `enabled` gates all of them."""
    cfg = view(config)
    if not cfg.get("enabled"):
        return False
    triggers = cfg.get("triggers")
    if not isinstance(triggers, Mapping):
        return False
    return bool(triggers.get(str(name), False))
