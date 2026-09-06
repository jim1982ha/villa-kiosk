"""Reading code and asserting on it must not read the PROSE around it.

A pin that spells a call in a substring is how this suite holds a cross-artefact
contract no type checker can see. It has one failure mode, and the suite hit it
four times before this file existed: the needle matches inside a COMMENT or a
DOCSTRING. Each time the assertion measured prose — passing because a remark
mentioned the identifier, or failing because a remark explained the history of
the very thing it forbids. The last one failed a correct change because a
comment quoted the literal it bans.

⚠️ IT IS FIXED BY A TOOL, NOT BY REMEMBERING. `conftest.code_of(obj)` returns a
function's source with comments and docstrings blanked IN PLACE — every other
character keeps its column, so an existing pin that spells a call the way a
human writes it still matches. `strip_prose(text)` does the same for text
already in hand.

⚠️ SIX FILES HAD ALREADY NOTICED AND EACH INVENTED THE SAME WRONG FIX:
`re.sub(r"#[^\n]*", "", ...)`. That regex leaves DOCSTRINGS — where this
codebase keeps most of its prose — and eats any `#` inside a string literal. So
the trap survived in precisely the places that had seen it. Those six now call
the shared helper and the regex is banned below.
"""

from __future__ import annotations

import os
from typing import List, Set

from conftest import strip_prose

HERE = os.path.dirname(os.path.abspath(__file__))


def _code(name: str) -> str:
    """⚠️ THIS FILE MUST NOT MEASURE PROSE EITHER, AND ITS FIRST VERSION DID.
    Every check below scans the suite for a pattern, and this file DESCRIBES
    those patterns — so it matched itself and failed the moment it was written.
    A detector that cannot be pointed at its own subject is not a detector."""
    with open(os.path.join(HERE, name), encoding="utf-8") as handle:
        return strip_prose(handle.read())

#: Files that read source WITHOUT stripping prose, frozen on 2026-09-06.
#:
#: ⚠️ A BACKLOG, NOT AN EXEMPTION. Every entry is a file whose pins can still
#: match a comment; the freeze exists so no NEW one joins them, and so the list
#: can only shrink. Converting one means deleting its line — and a line that no
#: longer describes a file fails the rot test below, so the list cannot become
#: a record of things that were once true.
KNOWN_RAW: Set[str] = {
    "test_act_availability.py",
    "test_agent_act.py",
    "test_agent_act_allowlist.py",
    "test_agent_budget.py",
    "test_agent_chat.py",
    "test_agent_concerns.py",
    "test_agent_contracts.py",
    "test_agent_cost.py",
    "test_agent_policy.py",
    "test_agent_runtime.py",
    "test_agent_session.py",
    "test_agent_sources.py",
    "test_agent_triage.py",
    "test_analysis.py",
    "test_check_switch.py",
    "test_collect.py",
    "test_compose.py",
    "test_coverage_claim.py",
    "test_coverage_stamp.py",
    "test_dedupe.py",
    "test_flag_outcome.py",
    "test_heartbeat.py",
    "test_help_button.py",
    "test_materiality.py",
    "test_module_visibility.py",
    "test_narrate_and_deliver.py",
    "test_narration_provider.py",
    "test_playbooks.py",
    "test_prefix.py",
    "test_record.py",
    "test_record_window.py",
    "test_rich_delivery.py",
    "test_rule_calibration.py",
    "test_security_validation.py",
    "test_stats_and_ledger.py",
    "test_tool_raise_concern.py",
    "test_triage_clock.py",
    "test_upstream.py",
}


def _reads_source_rawly() -> Set[str]:
    found = set()
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".py") or name == "conftest.py":
            continue
        text = _code(name)
        if "getsource(" in text and "strip_prose" not in text \
                and "code_of" not in text:
            found.add(name)
    return found


def test_no_NEW_test_reads_source_without_stripping_prose() -> None:
    new = sorted(_reads_source_rawly() - KNOWN_RAW)
    assert not new, (
        "test file(s) read source and assert on it without removing comments "
        "and docstrings, so a pin can match prose:\n  " + "\n  ".join(new)
        + "\n\nUse `from conftest import code_of` and assert on `code_of(fn)` "
          "instead of `inspect.getsource(fn)`.")


def test_the_frozen_list_does_not_rot() -> None:
    """⚠️ A CONVERTED FILE MUST LEAVE THE LIST. Otherwise this slowly becomes a
    record of files that once had the problem, which is the same rot every
    hand-kept set in this suite has been bitten by."""
    stale = sorted(KNOWN_RAW - _reads_source_rawly())
    assert not stale, (
        "these no longer read source rawly — delete their lines, the backlog "
        "has shrunk: " + ", ".join(stale))


def test_the_broken_stripper_never_comes_back() -> None:
    """⚠️ IT LEAVES DOCSTRINGS AND EATS `#` INSIDE STRINGS. Six files invented
    it independently, which is what a missing shared tool looks like."""
    guilty: List[str] = []
    for name in sorted(os.listdir(HERE)):
        # ⚠️ THE DETECTOR IS NOT ITS OWN SUBJECT. This file has to SPELL the
        # pattern it bans, in a string literal, which `strip_prose` correctly
        # preserves — so scanning itself reports itself, for ever.
        if not name.endswith(".py") or name == os.path.basename(__file__):
            continue
        if 're.sub(r"#[^' in _code(name).replace("_re.", "re."):
            guilty.append(name)
    assert not guilty, (
        "file(s) strip comments with a regex that leaves docstrings and eats "
        "`#` inside string literals — use `strip_prose`: " + ", ".join(guilty))


def test_the_helper_actually_removes_both_kinds_of_prose() -> None:
    """⚠️ MUTATION-PROOFING. Every assertion above is satisfied by a helper
    that does nothing at all, because they only check who CALLS it."""
    from conftest import strip_prose

    sample = ('def f():\n    """Doc says WIDGET."""\n'
              '    # comment says WIDGET\n'
              '    x = "literal with # and WIDGET"\n'
              '    return mod.call(x)\n')
    out = strip_prose(sample)
    assert "Doc says WIDGET" not in out, "docstrings survive the stripper"
    assert "comment says WIDGET" not in out, "comments survive the stripper"
    assert "# and WIDGET" in out, "a `#` inside a string literal was eaten"
    assert "mod.call(x)" in out, (
        "the stripper reformatted the code — a pin spelling a call the way a "
        "human writes it would stop matching")
