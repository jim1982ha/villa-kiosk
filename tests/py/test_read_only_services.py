"""The one generic way to ask Home Assistant to work something out.

⚠️ WHY THIS REPLACED TWO TOOLS. 2.979.0 added `read_energy` and 2.980.0 added
`read_weather`, each answering ONE anticipated question. The owner's objection
was the right one: villas differ and questions cannot be enumerated, so a tool
per question is a dataset nobody can finish. Both are deleted; what they could
do that `ha_search` and `ha_get_state` could not was call a service that RETURNS
something, and that is a general capability, not a weather one.

⚠️ THE SAFETY GATE IS HOME ASSISTANT'S OWN DECLARATION, NOT A LIST HERE. A
service whose `response` metadata says it is response-ONLY cannot change the
property — it exists to compute an answer. `OPTIONAL` may act as well, and is
refused. A hand-kept allow-list of service names would be the anticipation trap
one level down and would go stale the first time an integration shipped one.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent.sources import _response_only  # noqa: E402


@pytest.mark.parametrize("meta", [
    {"response": {"optional": False}},          # Core's websocket shape
    {"supports_response": "only"},              # older builds
    {"supports_response": "ONLY"},
])
def test_a_response_only_service_is_allowed(meta):
    """These compute and return; they cannot act."""
    assert _response_only(meta) is True


@pytest.mark.parametrize("meta", [
    {},                                          # says nothing: not allowed
    {"response": {"optional": True}},            # MAY act as well
    {"supports_response": "optional"},
    {"supports_response": "none"},
    {"response": None},
    {"fields": {"brightness": {}}},              # an ordinary acting service
])
def test_anything_that_could_act_is_refused(meta):
    """⚠️ THE WHOLE SAFETY MODEL IS THIS DISTINCTION. `OPTIONAL` means the
    service may return data AND do something; treating it like `ONLY` would
    hand the model a way to switch the villa through a tool whose name promises
    it cannot. Silence means refused, so a metadata shape nobody here
    anticipated fails CLOSED."""
    assert _response_only(meta) is False


def test_the_gate_does_not_name_a_single_service():
    """⚠️ ASSERTED, BECAUSE A LIST WOULD BE THE SAME MISTAKE ONE LEVEL DOWN.
    The moment a service name appears in shipped source, this is a catalogue
    somebody has to maintain and the next integration breaks it."""
    from conftest import code_of
    from vesta.supervise.agent import sources
    src = code_of(sources)
    for named in ("get_forecasts", "weather.", "energy/get_prefs",
                  "get_statistics"):
        assert named not in src, f"a service name reached shipped code: {named}"


def test_the_deleted_question_shaped_tools_are_really_gone():
    """⚠️ THE POINT OF THE EXERCISE, PINNED. Re-adding a tool per question is
    the habit this replaced, and a deletion nothing checks comes back."""
    from vesta.supervise.agent.tools import ha
    names = {cls.name for cls in ha.HA_TOOLS}
    assert "read_energy" not in names
    assert "read_weather" not in names
    assert "call_read_only_service" in names


# ── what a tool ADVERTISES must be what it can do ───────────────────────────
def _description(name):
    from vesta.supervise.agent.tools import ha
    for cls in ha.HA_TOOLS:
        if cls.name == name:
            return cls.description
    raise AssertionError(f"no tool named {name}")


def test_the_service_tool_does_not_advertise_figures_over_time():
    """⚠️ MEASURED ON THE VILLA, NOT SUPPOSED. The trace read:

        chat … declined in 8 turn(s), 11 tool call(s); tools used:
          call_read_only_servicex3 read_configurationx3 ha_searchx2 …

    Three of eight turns went to `call_read_only_service` because its
    description offered "a statistics summary" — and statistics are NOT a
    service in Home Assistant, they are `recorder/statistics_during_period`,
    which belongs to `read_configuration`. The model followed the description
    into a dead end I had written, was refused three times, and ran out of
    turns with the answer still unassembled.

    A description is an instruction. Advertising a capability a tool does not
    have costs exactly as much as the capability being missing, and is harder
    to see because every test still passes.

    ⚠️ AND THE FIRST CUT OF THIS TEST WAS ALSO WRONG, THE SAME WAY. It banned
    the WORD "statistic" — and the corrected description mentions it inside a
    DISCLAIMER ("NOT figures over a time period: … statistics are
    read_configuration's job"), which is the single most useful sentence in it.
    A banned word is not a banned claim. What must be absent is the OFFER.
    """
    text = _description("call_read_only_service").lower()
    for claimed in ("statistic", "history"):
        if claimed not in text:
            continue
        where = text.index(claimed)
        window = text[max(0, where - 120):where]
        assert "not " in window, (
            f"call_read_only_service mentions {claimed!r} without disclaiming "
            "it — the model follows a description into whichever tool offers "
            "the thing, and this one cannot do it")


def test_the_configuration_tool_advertises_what_it_actually_owns():
    """The counterpart: the tool that CAN answer "how much since 1pm" has to
    say so, or the model has no reason to reach for it."""
    text = _description("read_configuration").lower()
    assert "statistics_during_period" in text
    assert "energy/get_prefs" in text
    assert "period" in text
