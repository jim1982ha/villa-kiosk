"""What the autonomous tiers are allowed to cost, pinned where it is decided.

⚠️ PAID FOR ON 2026-08-25: $8.55/day of scheduled supervision on a villa nobody
was chatting to, against an owner's target of $1-2. The measurement came from
three independent sources that agreed, and every number below is one of them —
`agent/prefix.py`'s own log line, the usage CSV, and the add-on's `tools used:`
trace:

    investigation prefix   52,108 tok/turn
      tools               43,700 tok   84%   n=44
      playbook             5,600 tok   11%
      document             2,100 tok    4%
      instructions           635 tok    1%

Cost here is `prefix x turns`, and BOTH factors were wrong. All eleven
investigations of the observed period used exactly 8 of 8 turns — a cap that
binds every time is not a ceiling, it is a multiplier — and 84% of the prefix
was Home Assistant's whole MCP catalogue, of which the agent's own trace shows
it reached for exactly one tool, whose results the redaction audit then refused.

⚠️ THESE ARE NOT STYLE PINS. Each one guards a change that a later edit could
undo invisibly, because the symptom is a bill at the end of the month and not a
failing request. That is the same shape as every other silent-cost defect in
this subsystem, and it is why they are asserted rather than commented.
"""

from __future__ import annotations

import inspect
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "rootfs", "usr", "bin"))

from agent import budget, config as agent_config, reason, registry, runtime, triage  # noqa: E402


def test_the_investigation_tier_does_NOT_get_the_upstream_catalogue() -> None:
    """⚠️ 84% OF THE PREFIX, ON EVERY TURN. `build_registry` folds Home
    Assistant's MCP tools in beside VESTA's (ADR-023), which is right for CHAT —
    a person asks an arbitrary question and is watching — and was the whole cost
    problem for the scheduled tiers."""
    assert reason.tool_names_for({}) == registry.REASON_TOOLS, (
        "the investigation tier no longer narrows its tool set")
    # ⚠️ NAMED, NOT COUNTED. A count passes while the list drifts to the wrong
    # ten; these are the tools whose absence would remove real capability.
    for name in ("read_villa", "read_state", "read_history", "read_salient",
                 "read_coverage", "read_concerns", "read_playbook"):
        assert name in registry.REASON_TOOLS, f"{name} was dropped"
    assert not [n for n in registry.REASON_TOOLS if n.startswith("ha_")], (
        "an upstream tool is back on the autonomous tier's list")


def test_the_escape_hatch_puts_the_catalogue_BACK() -> None:
    """⚠️ REMOVING CAPABILITY NEEDS A WAY BACK, or the next owner who genuinely
    needs HA's query surface has to edit JSON on the box. `None` means "every
    tool the deployment offers" to `runtime.investigate`."""
    assert reason.tool_names_for({"ha_tools": True}) is None
    assert agent_config.DEFAULTS["ha_tools"] is False, (
        "the expensive path became the default")


def test_narrowing_happens_at_the_ONE_construction_site() -> None:
    """⚠️ ARCH-012, AND IT ALREADY BIT ONCE THIS RELEASE. The first cut built a
    second registry inside `reason`, which broke the wiring suite immediately —
    that suite patches `triage.build_registry` and `runtime.build_registry` BY
    NAME, because a module importing the symbol gets its own binding, and
    `reason` had quietly become a third importer."""
    # ⚠️ CODE LINES ONLY, AND THIS IS THE SECOND TIME THE SAME TRAP CAUGHT ME
    # IN ONE SESSION: the first version matched `build_registry` inside the
    # comment EXPLAINING why it is not called — a pin failing on the prose that
    # records its own finding. Strip docstrings and comments, then look.
    src = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(reason))
    code = "\n".join(l for l in src.splitlines()
                     if not l.lstrip().startswith("#"))
    assert "build_registry" not in code, (
        "reason builds its own registry again; it must pass NAMES to runtime")
    wiring = inspect.getsource(runtime.investigate)
    assert "narrowed(reg, tool_names)" in wiring
    # ⚠️ AND THE GUARD MUST BE THE ARGUMENT. `if False:` left the line present
    # and the pin green while every investigation went back to 44 tools — a
    # mutation that survived the first version of this assertion.
    assert re.search(r"if tool_names is not None:\s*\n\s*reg = narrowed",
                     wiring), "the narrowing is present but unreachable"


def test_the_narrowing_actually_SELECTS() -> None:
    """⚠️ BEHAVIOUR, BESIDE THE WIRING CHECK ABOVE. One proves the call is made,
    this proves the call does something — and neither alone would have caught
    both mutations."""
    class _T:
        def __init__(self, name): self.name = name
        description = ""
        inputSchema: dict = {}
        mode = "READ"

    full = registry.Registry([_T("read_villa"), _T("ha_get_integration")],
                             refs="TABLE")
    kept = registry.narrowed(full, registry.REASON_TOOLS)
    assert list(kept.names) == ["read_villa"], list(kept.names)
    # ⚠️ THE REF TABLE SURVIVES. A narrowed registry that drops it mints handles
    # nothing can resolve, and `raise_concern` refuses every subject as "not a
    # device handle from this run".
    assert kept.refs == "TABLE"


def test_both_factors_of_prefix_times_turns_are_bounded() -> None:
    """⚠️ THE CAP THAT BINDS EVERY TIME IS A MULTIPLIER, NOT A CEILING. 8/8 on
    all eleven investigations; 3 of 3 investigations on every escalating pass."""
    assert agent_config.depth_of({})["turns"] <= 4, (
        "the turn cap is back above the measured level")
    assert agent_config.DEFAULTS["max_investigations_per_pass"] <= 2
    # ⚠️ ONE NUMBER, TWO HOMES — `reason.DEFAULT_CAP` is the fallback when the
    # config has no value, and an existing pin already requires them equal.
    # Restated here because this file is where someone will come to raise it.
    assert reason.DEFAULT_CAP == agent_config.DEFAULTS[
        "max_investigations_per_pass"]


def test_the_daily_ceiling_is_money_and_covers_EVERYTHING() -> None:
    """⚠️ A REQUEST COUNT IS NOT A BUDGET. One triage pass cost $0.010 and one
    investigation $0.37 — 37x inside one unit — so `monthly_limit` is a ceiling
    nobody can price. And this one may not exempt chat the way the chat
    sub-ceiling deliberately exempts supervision: that one protects the product,
    this one bounds the invoice, and a ceiling with a way around it is not one.
    """
    assert budget.daily_limit_of({"daily_usd_limit": 2}) == 2.0
    assert budget.daily_limit_of({}) == 0.0, "off must be the shipped default"
    assert budget.daily_limit_of({"daily_usd_limit": -5}) == 0.0
    src = inspect.getsource(budget.check)
    day = src[src.index("daily = daily_limit_of"):]
    assert 'if kind == "chat"' not in day[:day.index("return Verdict")], (
        "the daily ceiling is inside the chat branch, so supervision can spend "
        "past it")
    assert "spent_today" in day, "the ceiling is not compared against spend"


def test_spend_is_read_from_the_ledger_and_never_recounted() -> None:
    """⚠️ A SECOND TALLY IS A SECOND NUMBER FOR ONE FACT, and the first day they
    disagree the owner cannot tell which one is the bill."""
    src = inspect.getsource(budget.spent_today)
    assert "usage_mod.rows" in src
    assert "cost_of" not in src, "budget prices requests itself again"


def test_the_daily_window_is_the_OWNERS_day_not_UTC() -> None:
    """A villa at UTC+8 told its allowance resets at 08:00 has been given a fact
    about our servers.

    ⚠️ BEHAVIOUR, NOT THE WORD "localtime" IN THE SOURCE — which is what the
    first version asserted, and it stayed GREEN when the call was mutated to
    `gmtime` because the word also appears in the function's own docstring
    explaining the choice. Third time in one session that a pin matched the
    prose recording its finding rather than the code.
    """
    import time as _t
    was = os.environ.get("TZ")
    try:
        os.environ["TZ"] = "Asia/Singapore"   # UTC+8, no DST
        _t.tzset()
        # 2026-08-25 03:00 UTC is 11:00 local, so local midnight is 8 h earlier
        # than the UTC one — a UTC implementation returns the later instant.
        noon_utc = _t.mktime((2026, 8, 25, 11, 0, 0, 0, 0, 0))
        start = budget._day_start(noon_utc)
        assert _t.localtime(start).tm_hour == 0, (
            "the day does not start at the owner's midnight")
        assert noon_utc - start == 11 * 3600
    finally:
        if was is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = was
        _t.tzset()


# ── the handover join ───────────────────────────────────────────────────────
def test_an_escalated_device_carries_its_ENTITY_ID_not_its_handle() -> None:
    """⚠️ WHY `both` WAS 0 BY CONSTRUCTION. `raise_concern` keys on
    `sha256(entity_id)` given a `ref` and on `sha256("topic:"+text)` otherwise,
    and the rules side ALWAYS hashes an entity id — so a free-text subject
    produced a key nothing else could ever produce, and no amount of the agent
    improving could move the Handover page's matched column.

    ⚠️ AND IT MUST BE THE ID, NOT THE REF. Handles are per RUN by design
    (`refs.py`), so triage's `d1` is meaningless inside the investigation; the
    id travels in our memory and is re-minted as a fresh handle on arrival.
    """
    assert "entity_id" in triage.Escalation.__dataclass_fields__
    assert triage.Escalation(subject="x", reason="y").entity_id == ""

    seeded = inspect.getsource(runtime._seeded)
    assert "ref_for(" in seeded, "the id is not minted into the run's table"
    assert "refs.ref_for" in seeded
    # the model must never be shown the id itself
    assert "{entity_id}" not in seeded and "entity_id})" not in seeded, (
        "the entity id is interpolated into the note sent to the model")


def test_a_run_with_NO_seed_is_byte_identical() -> None:
    """⚠️ CHAT MUST NOT ACQUIRE A SENTENCE ABOUT A DEVICE NOBODY NAMED. Every
    path that passes no seed has to send exactly what it sent before."""
    msgs = [{"role": "user", "content": "hello"}]
    assert runtime._seeded(msgs, None, object()) is msgs
    assert runtime._seeded(msgs, ("", ""), object()) is msgs
    assert runtime._seeded(msgs, ("light.x", "X"), None) is msgs


def test_identification_reports_how_many_it_could_name() -> None:
    """⚠️ "identified 0 of 3" AND "identified 3 of 3" ARE THE TWO OUTCOMES that
    decide whether the Handover page can ever show a match, and from outside
    they are otherwise indistinguishable — which is the shape of instrument this
    project has shipped blind four times."""
    assert re.search(r"identified", inspect.getsource(triage.run)), (
        "the identification rate is not logged, so a regression to 0 is silent")


def test_a_subject_with_no_device_behind_it_stays_a_topic() -> None:
    """"Coverage incomplete" is a real subject with no equipment behind it. It
    must keep the topic key rather than be forced onto some nearby device."""
    class _Refs:
        def known(self): return ("d1",)
        def label(self, ref): return "Pool pump"
        def resolve(self, ref): return "switch.pool_pump"

    items = [triage.Escalation(subject="Coverage incomplete", reason="r"),
             triage.Escalation(subject="Pool pump", reason="r"),
             triage.Escalation(subject="the pool pump circuit", reason="r")]
    triage._identify(items, _Refs())
    assert items[0].entity_id == "", "a topic was forced onto a device"
    assert items[1].entity_id == "switch.pool_pump", "an exact label missed"
    assert items[2].entity_id == "switch.pool_pump", (
        "a label inside a longer phrase missed — which is how a model writes")


def test_the_ha_tools_copy_states_the_REAL_tool_count() -> None:
    """⚠️ A NUMBER IN PROSE THAT NOBODY CHECKS DRIFTS, AND THIS ONE ALREADY DID.
    The same tooltip shipped "about five times cheaper", which is the PREFIX
    ratio (5.3x) and not the cost one (~2x — uncached input and output do not
    shrink with the tool list). It read as an order of magnitude to anyone
    deciding whether to switch it on.

    The count is the checkable half: the copy promises the assistant keeps "its
    own 10" tools, and `REASON_TOOLS` is what it actually keeps. A list that
    grows to twelve without the sentence moving is the drift this catches.
    """
    panel = os.path.join(ROOT, "src", "components", "settings",
                         "AgentTuningPanel.tsx")
    with open(panel, "r", encoding="utf-8") as handle:
        src = handle.read()
    block = src[src.index('checked={draft.haTools}'):]
    block = block[:block.index("      />")]
    # ⚠️ CONDITIONAL, NOT MANDATORY — AND THE FIRST VERSION HAD THAT BACKWARDS.
    # It REQUIRED the copy to say "its own 10", so when the third rewrite dropped
    # the count as jargon (a reader does not think in tool descriptions) the test
    # went red and would have forced the number back into the UI. A pin exists to
    # stop a stated number DRIFTING from the list it describes; it has no
    # business insisting the number be stated at all. Copy is not the test's to
    # decide.
    stated = re.findall(r"its own (\d+)", block)
    for count in stated:
        assert int(count) == len(registry.REASON_TOOLS), (
            f"the tooltip says {count} tools and the list holds "
            f"{len(registry.REASON_TOOLS)}")
    # ⚠️ AND THE COST CLAIM MAY NOT OVERSTATE ITSELF AGAIN. The error was not
    # the NUMBER — "five times more sent" is true and is in this copy on
    # purpose. It was attaching that ratio to the PRICE. So the pin targets the
    # false pairing, not the digit: a first version forbidding "five times"
    # anywhere in the sentence went red on the correct use of it, which is a
    # pin measuring the wrong thing one word away from the right one.
    flat = " ".join(block.split()).lower()
    for wrong in ("five times cheaper", "five times less expensive",
                  "five times the price", "a fifth of the cost"):
        assert wrong not in flat, (
            f"the copy says {wrong!r}: five times is what is SENT, about twice "
            "is what is PAID — uncached input and output do not shrink with the "
            "tool list")
