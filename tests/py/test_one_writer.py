"""The concern store has ONE write path.

⚠️ THE LEAK THIS PAYS FOR (2026-09-06). `concerns._write` is private, and
`outbox.py` called it anyway — twice, from `_mark_escalated` and
`_mark_delivered` — after doing the store's own "read → scan for the id →
mutate" by hand. Each also carried its own
`time.strftime("%Y-%m-%dT%H:%M:%SZ", ...)`, a second spelling of
`concerns._now_iso`, in a second module. That is the same defect `_minutes_since`
was already fixed for one module over: one format, two implementations, and
nothing to make them agree.

⚠️ THE COST IS NOT TIDINESS. A store whose write path has two entrances has
nowhere to put a rule that must hold for every write — the `updated_at` stamp,
the `MAX_CONCERNS` bound, the no-op suppression. Every such rule then has to be
remembered at each entrance, which is how one of them ends up applied at one
site out of nine.
"""

from __future__ import annotations

import ast
import os
import sys

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AGENT = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta",
                     "supervise", "agent")
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.agent import concerns  # noqa: E402


def _modules():
    for name in sorted(os.listdir(AGENT)):
        if name.endswith(".py") and name != "concerns.py":
            with open(os.path.join(AGENT, name), encoding="utf-8") as handle:
                yield name, handle.read()


def test_no_module_outside_the_store_calls_its_private_writer() -> None:
    problems = []
    for name, text in _modules():
        # ⚠️ THE PARSED CALL, NOT THE SUBSTRING. The comment recording this
        # defect names `_write` on purpose, and a substring check would fail on
        # its own documentation — the "measure the claim, not the comment" trap.
        tree = ast.parse(text)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            if isinstance(fn, ast.Attribute) and fn.attr == "_write":
                problems.append(f"{name}:{node.lineno}")
    assert not problems, (
        "module(s) outside the store call `concerns._write` directly, so the "
        "store has two write paths again: " + ", ".join(problems))


def test_a_module_that_writes_concerns_does_not_format_their_stamps() -> None:
    """⚠️ SCOPED TO THE WRITERS, AND THE FIRST VERSION WAS NOT. It flagged every
    `strftime` beside the store and named seven sites, of which five were
    correct code: `%Y-%m` is a month key, `%Y-%m-%d` a date, and a module that
    owns its OWN store legitimately owns its own stamp helper. The defect is
    narrower and worse — formatting a stamp for a row you are writing into
    SOMEBODY ELSE'S store, which is how the concern store came to have two
    spellings of one format.

    So the rule follows the write: if a module edits concerns, the concern
    store stamps them.
    """
    iso = "%Y-%m-%dT%H:%M:%SZ"
    problems = []
    for name, text in _modules():
        tree = ast.parse(text)
        writes_concerns = any(
            isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr in ("edit", "transition", "acknowledge")
            and isinstance(n.func.value, ast.Name)
            and "concern" in n.func.value.id
            for n in ast.walk(tree))
        if not writes_concerns:
            continue
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "strftime"
                    and any(isinstance(a, ast.Constant) and a.value == iso
                            for a in node.args)):
                problems.append(f"{name}:{node.lineno}")
    assert not problems, (
        "module(s) that write into the concern store format its timestamps "
        "themselves instead of letting the store do it: " + ", ".join(problems))


def test_the_editing_verb_suppresses_a_no_op() -> None:
    """⚠️ A NO-OP EDIT USED TO COST A WHOLE-STORE READ-MODIFY-WRITE, and the
    suppression was hand-checked at one mutator out of nine."""
    assert concerns.edit("nope", lambda row: None) is False, (
        "editing a concern that does not exist reported a write")


def test_the_editing_verb_can_abandon_an_edit() -> None:
    """Returning False from the mutator writes nothing — the escape a caller
    needs when it discovers mid-edit that the row is not what it expected."""
    calls = []
    assert concerns.edit("nope", lambda row: calls.append(row) or False) is False
