"""Every route OUT to Home Assistant must translate handles back into ids.

⚠️ THE CLASS, NOT THE INSTANCE — WHICH IS THE LESSON OF THIS WHOLE SESSION. The
agent hands the model opaque handles instead of entity ids (`refs.py`), and
`pseudonymise` does that on the way back from every tool. The outbound half was
missing, and I fixed it ONE TOOL AT A TIME: `read_configuration` in 2.986.0,
then `call_read_only_service`'s payload and all four upstream tools when the
owner asked whether it was universal. It was not. The fifth tool somebody adds
would have forgotten it too.

⚠️ AND THE FAILURE IS SILENT, WHICH IS WHY A GUARD AND NOT CARE. Home Assistant
answers an unknown statistic id or entity id with an EMPTY RESULT, not an error.
So a tool that forgets translates into "I cannot access that" on somebody's
phone, with nothing in any log, and every existing test still green. That is
precisely the shape a machine can check and a reader cannot.

⚠️ WHAT THIS DOES NOT DO. The real fix is one chokepoint — the registry
resolving on the way in to every tool, so no tool CAN forget — and that means
changing every tool that currently resolves for itself. This guard makes the
class impossible to reintroduce in the meantime, and would fail loudly if that
refactor were done wrong.
"""

import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import upstream  # noqa: E402
from vesta.supervise.agent.tools import ha, ledger, logs, playbook, read  # noqa: E402

#: Schema shapes that carry a free-form payload onward. A tool taking only a
#: list of `refs` is already explicit about what it holds; one taking an
#: `object`, or a string that names something in Home Assistant, is the case
#: that can smuggle a handle through untranslated.
_FREE_FORM = ("object", "array")


def _tool_classes():
    for module in (ha, ledger, logs, playbook, read):
        for value in vars(module).values():
            if (inspect.isclass(value)
                    and getattr(value, "name", None)
                    and hasattr(value, "inputSchema")
                    and value.__module__ == module.__name__):
                yield value


def _forwards_a_payload(cls):
    """Does this tool accept an argument it passes on to Home Assistant?"""
    schema = getattr(cls, "inputSchema", {}) or {}
    props = schema.get("properties") or {}
    for name, spec in props.items():
        if name == "refs":
            continue                      # an explicit handle list, resolved by name
        if not isinstance(spec, dict):
            continue
        if spec.get("type") in _FREE_FORM:
            return True
    return False


def _translates(cls) -> bool:
    """⚠️ `code_of`, NOT `inspect.getsource`. Comments and docstrings stripped,
    because this file is FULL of prose mentioning `resolve_handles` and a check
    that counted those would pass on a tool that merely talks about it. Caught
    on the way in by `test_pins_read_code_not_prose`, which exists for exactly
    this."""
    from conftest import code_of
    try:
        src = code_of(cls)
    except (OSError, TypeError):           # pragma: no cover - source always present
        return False
    return "resolve_handles" in src or "_refs.resolve" in src


@pytest.mark.parametrize("cls", list(_tool_classes()), ids=lambda c: c.name)
def test_a_tool_that_forwards_a_payload_translates_handles_first(cls):
    """⚠️ THE GUARD FOR THE WHOLE CLASS. A tool accepting an object or a list it
    hands onward must resolve handles in it, or it asks Home Assistant about
    something that does not exist and is answered with silence."""
    if not _forwards_a_payload(cls):
        pytest.skip(f"{cls.name} forwards no free-form payload")
    assert _translates(cls), (
        f"{cls.name} forwards a payload without resolving handles in it — "
        "Home Assistant will answer an unknown handle with an empty result, "
        "which reaches the reader as 'I cannot access that'")


def test_the_upstream_tools_translate_too():
    """⚠️ THE BIGGEST INSTANCE, AND THE LAST ONE I FOUND. `UpstreamTool` is ONE
    class serving every Home Assistant MCP tool the chat publishes — search,
    state, template, floors — and its arguments are entirely free-form. The
    model's commonest path is `ha_search` then read what it found, which is
    exactly a handle going back out.

    ⚠️ DRIVEN, NOT GREPPED. The first version of this asserted that the class
    SOURCE mentioned `resolve_handles`, and a mutation that removed the CALL
    while leaving the import survived it — an assertion measuring the presence
    of a word. This runs the tool and reads what was actually sent.
    """
    import asyncio

    from vesta.supervise.agent.refs import RefTable

    table = RefTable()
    entity = "sensor.example_main_power_energy"
    handle = table.ref_for(entity)

    sent = {}

    async def fake_rpc(session, url, method, payload):
        sent.update(payload)
        return {"content": [{"type": "text", "text": "ok"}]}

    spec = {"name": "ha_get_state", "description": "", "inputSchema": {}}
    tool = upstream.UpstreamTool(spec, "http://x", lambda: object(), table)

    original = upstream.rpc
    upstream.rpc = fake_rpc              # type: ignore[assignment]
    try:
        asyncio.run(tool.run({"entity_id": handle, "fields": ["state"]}))
    finally:
        upstream.rpc = original          # type: ignore[assignment]

    assert sent["arguments"]["entity_id"] == entity, (
        "a handle reached the Home Assistant MCP server untranslated — it "
        "answers an unknown id with nothing, which the reader sees as "
        "'I cannot find that'")
    assert sent["arguments"]["fields"] == ["state"], "plain values must survive"


def test_the_inbound_half_is_still_there():
    """⚠️ A PAIR, AND EITHER HALF ALONE IS A DEFECT. Without `pseudonymise` an
    entity id reaches the model and `redact.audit` refuses the whole result;
    without the outbound half the model can only ask questions that name
    nothing. This asserts the pair, so a future tidy-up cannot remove one."""
    from vesta.supervise.agent import refs as refs_mod
    assert callable(refs_mod.pseudonymise)
    assert callable(refs_mod.resolve_handles)
    from conftest import code_of
    src = code_of(upstream.UpstreamTool)
    assert "pseudonymise" in src and "resolve_handles" in src


def test_translation_is_a_round_trip():
    """The two halves must actually invert each other for a real payload."""
    from vesta.supervise.agent.refs import RefTable, resolve_handles
    table = RefTable()
    entity = "sensor.example_main_power_energy"
    handle = table.ref_for(entity)
    assert handle != entity
    payload = {"statistic_ids": [handle], "period": "hour",
               "nested": {"also": [handle]}}
    out = resolve_handles(payload, table)
    assert out["statistic_ids"] == [entity]
    assert out["nested"]["also"] == [entity]
    assert out["period"] == "hour", "a plain value must survive untouched"
