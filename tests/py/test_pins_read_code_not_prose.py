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

import ast
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
#: Files with their own `.tsx` comment stripper, frozen on 2026-09-06.
#:
#: ⚠️ FOURTEEN, NOT TWO. The review found the two that a candidate named; the
#: guard found twelve more. That is what a missing shared tool costs — and
#: `test_module_conventions`' own copy carries the history: "three of eight
#: /dry-audit hits on 2026-08-19 were exactly this mistake".
#:
#: ⚠️ A BACKLOG, NOT AN EXEMPTION, and frozen rather than mass-converted
#: because two bulk edits over these files went wrong the same day: a regex
#: anchored on `sys.path.insert(` matched the first line of a MULTI-LINE call
#: and inserted an import into the middle of it. The list can only shrink.
KNOWN_OWN_TSX_STRIPPER: Set[str] = {
    "test_agent_queue_bulk.py",
    "test_cockpit_reach.py",
    "test_css_classes.py",
    "test_dedupe.py",
    "test_editable_rows.py",
    "test_flag_type_wire.py",
    "test_people.py",
    "test_review_surface.py",
    "test_route_has_a_client.py",
    "test_section_rhythm.py",
    "test_store_envelope.py",
    "test_verification_sweep.py",
}

#: Every raw `inspect.getsource` site, frozen as `file.py:line`.
#:
#: ⚠️ SITES, NOT FILES (2.956.0). This froze 37 FILENAMES, and the detector
#: exempted a whole file for one mention of `strip_prose` — so 107 raw sites
#: across 57 files reported as 37. One of the hidden ones was
#: `test_task_loop.py`'s ordering pin, which matched a COMMENT and passed with
#: the rule it guards reversed, with the whole suite green.
#:
#: ⚠️ THIS LIST MUST ONLY SHRINK. `test_the_frozen_list_does_not_rot` fails on a
#: stale entry, so converting a pin to `code_of` forces its line out. Line
#: numbers move when a file is edited — that is deliberate friction: touching a
#: file with raw pins makes you look at them.
KNOWN_RAW: Set[str] = {
    'test_act_availability.py:130',
    'test_agent_act.py:226',
    'test_agent_act_allowlist.py:115',
    'test_agent_budget.py:258',
    'test_agent_chat.py:1070',
    'test_agent_chat.py:226',
    'test_agent_chat.py:245',
    'test_agent_chat.py:893',
    'test_agent_concerns.py:357',
    'test_agent_concerns.py:358',
    'test_agent_contracts.py:91',
    'test_agent_cost.py:138',
    'test_agent_cost.py:149',
    'test_agent_cost.py:199',
    'test_agent_cost.py:221',
    'test_agent_cost.py:81',
    'test_agent_cost.py:86',
    'test_agent_llm.py:151',
    'test_agent_llm.py:161',
    'test_agent_llm.py:177',
    'test_agent_llm.py:430',
    'test_agent_llm.py:433',
    'test_agent_outbox.py:328',
    'test_agent_outbox.py:331',
    'test_agent_outbox.py:702',
    'test_agent_outbox.py:835',
    'test_agent_outbox.py:852',
    'test_agent_policy.py:61',
    'test_agent_policy.py:90',
    'test_agent_route.py:194',
    'test_agent_route.py:328',
    'test_agent_runtime.py:360',
    'test_agent_scheduler.py:116',
    'test_agent_session.py:107',
    'test_agent_session.py:115',
    'test_agent_sources.py:1164',
    'test_agent_sources.py:1276',
    'test_agent_sources.py:1310',
    'test_agent_sources.py:1345',
    'test_agent_sources.py:1372',
    'test_agent_sources.py:1373',
    'test_agent_sources.py:634',
    'test_agent_sources.py:786',
    'test_agent_sources.py:808',
    'test_agent_triage.py:144',
    'test_agent_triage.py:153',
    'test_analysis.py:422',
    'test_analysis.py:443',
    'test_buttons.py:204',
    'test_buttons.py:210',
    'test_check_switch.py:139',
    'test_collect.py:385',
    'test_compose.py:118',
    'test_compose.py:132',
    'test_coverage_claim.py:99',
    'test_coverage_stamp.py:108',
    'test_coverage_stamp.py:75',
    'test_coverage_stamp.py:83',
    'test_dedupe.py:175',
    'test_dedupe.py:200',
    'test_flag_outcome.py:170',
    'test_flag_outcome.py:173',
    'test_flag_outcome.py:88',
    'test_flag_outcome.py:91',
    'test_heartbeat.py:192',
    'test_heartbeat.py:226',
    'test_help_button.py:151',
    'test_help_button.py:88',
    'test_materiality.py:112',
    'test_module_visibility.py:29',
    'test_module_visibility.py:41',
    'test_module_visibility.py:97',
    'test_narrate_and_deliver.py:141',
    'test_narrate_and_deliver.py:164',
    'test_narrate_and_deliver.py:528',
    'test_narration_provider.py:301',
    'test_narration_provider.py:324',
    'test_pass_trace.py:171',
    'test_playbooks.py:384',
    'test_playbooks.py:461',
    'test_prefix.py:137',
    'test_prefix.py:218',
    'test_prefix.py:244',
    'test_record.py:119',
    'test_record_window.py:126',
    'test_record_window.py:141',
    'test_rich_delivery.py:175',
    'test_rich_delivery.py:257',
    'test_rule_calibration.py:252',
    'test_rule_calibration.py:257',
    'test_security_validation.py:355',
    'test_security_validation.py:464',
    'test_stats_and_ledger.py:190',
    'test_task_loop.py:204',
    'test_task_loop.py:226',
    'test_task_loop.py:435',
    'test_task_loop.py:451',
    'test_task_loop.py:87',
    'test_tool_raise_concern.py:642',
    'test_triage_clock.py:74',
    'test_upstream.py:164',
    'test_upstream.py:172',
    'test_upstream.py:377',
    'test_upstream.py:425',
    'test_upstream.py:472',
    'test_verification_sweep.py:359',
    'test_verification_sweep.py:445',
}


def _raw_sites() -> Set[str]:
    """Every `inspect.getsource(...)` whose result is NOT stripped, as
    `file.py:line`.

    ⚠️ SITE-SCOPED, NOT FILE-SCOPED (2.956.0), AND THAT CHANGE IS WHY THIS
    EXISTS AT ALL. The old detector asked whether the WHOLE FILE mentioned
    `strip_prose` or `code_of` anywhere, so one import bought blanket immunity
    for every other pin in it. Measured when this was fixed: 136 `getsource`
    call sites across 57 files, with files like `test_task_loop.py` (6 sites, 2
    mentions) fully exempt.

    That exemption hid a real defect. `test_task_loop`'s ordering pin compared
    two `str.index()` offsets over raw source, and `_mark_delivered` appears
    TWICE in its subject — once as code, once in the comment below it. The pin
    matched the PROSE and passed with the two calls reversed; the whole 2,313
    test suite stayed green. See `outbox.Delivery`.

    ⚠️ A CALL IS "STRIPPED" ONLY IF ITS RESULT GOES STRAIGHT INTO `strip_prose`
    OR `code_of`. Assigning it and stripping later is not recognised, on
    purpose: the pin that bit us assigned first.
    """
    found: Set[str] = set()
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".py") or name == "conftest.py":
            continue
        try:
            tree = ast.parse(_code(name))
        except SyntaxError:                                # pragma: no cover
            continue
        wrapped: Set[int] = set()
        for node in ast.walk(tree):
            # `strip_prose(inspect.getsource(x))` / `code_of(x)` — the argument
            # of a stripping call is the one place a raw read is fine.
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and node.func.id in ("strip_prose", "strip_tsx_prose"):
                for arg in node.args:
                    for inner in ast.walk(arg):
                        if isinstance(inner, ast.Call):
                            wrapped.add(id(inner))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            is_getsource = (isinstance(func, ast.Attribute)
                            and func.attr == "getsource")
            if is_getsource and id(node) not in wrapped:
                found.add(f"{name}:{node.lineno}")
    return found


def test_no_NEW_test_reads_source_without_stripping_prose() -> None:
    new = sorted(_raw_sites() - KNOWN_RAW)
    assert not new, (
        "test file(s) read source and assert on it without removing comments "
        "and docstrings, so a pin can match prose:\n  " + "\n  ".join(new)
        + "\n\nUse `from conftest import code_of` and assert on `code_of(fn)` "
          "instead of `inspect.getsource(fn)`.")


def test_the_frozen_list_does_not_rot() -> None:
    """⚠️ A CONVERTED FILE MUST LEAVE THE LIST. Otherwise this slowly becomes a
    record of files that once had the problem, which is the same rot every
    hand-kept set in this suite has been bitten by."""
    stale = sorted(KNOWN_RAW - _raw_sites())
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


def test_no_file_rolls_its_own_TSX_comment_stripper() -> None:
    """⚠️ THE SAME "EVERYONE INVENTS IT" PATTERN, ON THE OTHER HALF OF THE TREE.
    Two files carried a private `_strip_comments` for `.tsx`, written the same
    way, for the same reason the Python side had six copies of a regex: no
    shared tool existed. `conftest.strip_tsx_prose` is it.

    ⚠️ A file may still DEFINE `_strip_comments` as a thin alias — what is
    banned is a second implementation, spotted by the block-comment regex all
    of them are built on."""
    guilty = set()
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".py") or name == os.path.basename(__file__):
            continue
        code = _code(name)
        if 're.sub(r"/\\*' in code and "strip_tsx_prose" not in code:
            guilty.add(name)
    new = sorted(guilty - KNOWN_OWN_TSX_STRIPPER)
    assert not new, (
        "file(s) strip TSX comments with their own regex instead of the "
        "shared `strip_tsx_prose`: " + ", ".join(new))
    stale = sorted(KNOWN_OWN_TSX_STRIPPER - guilty)
    assert not stale, (
        "these no longer roll their own — delete their lines: "
        + ", ".join(stale))


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
