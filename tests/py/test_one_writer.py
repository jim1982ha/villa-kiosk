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


def test_no_module_outside_the_store_reaches_for_ANY_of_its_privates() -> None:
    """⚠️ BANNING ONE NAME MOVED THE LEAK INSTEAD OF CLOSING IT (2026-09-06).

    The first version of this test banned `concerns._write` specifically. The
    conversion closed that call — and `outbox` then reached for the store's
    OTHER private, `concerns._now_iso`, at two sites, because `_record_send`
    made the caller produce the stamp. This test passed throughout: it was
    watching a name, not a rule. An architecture review found it a week later.

    The rule is the underscore, not the identifier. A module that needs the
    store's clock or the store's writer needs a VERB on the store — which is
    what `record_delivery` and `record_escalation` are.
    """
    problems = []
    for name, text in _modules():
        for node in ast.walk(ast.parse(text)):
            if not isinstance(node, ast.Attribute):
                continue
            if not node.attr.startswith("_") or node.attr.startswith("__"):
                continue
            base = node.value
            if isinstance(base, ast.Name) and "concern" in base.id.lower():
                problems.append(f"{name}:{node.lineno} → concerns.{node.attr}")
    assert not problems, (
        "module(s) outside the store reach for one of its private names, so "
        "the store has a second entrance again: " + ", ".join(problems)
        + "\n\nAdd a verb to `concerns` instead — a caller that never needs a "
          "clock cannot reach for the wrong one.")


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


def test_every_mutator_routes_through_the_verb() -> None:
    """⚠️ THE CLAIM SHIPPED AND THE WORK DID NOT (found 2026-09-06, a week
    late, by an architecture review rather than by anything automated).

    `edit`'s docstring said the hand-written write loop had been replaced "at
    every mutator in this module". Six of them were still writing directly, so
    the rules `edit` exists to hold — the `updated_at` stamp, the bound, the
    no-op suppression, one write per edit — were applied at whichever mutator
    somebody had got to. A docstring asserting a finished migration is worse
    than the migration being unfinished, because it stops the next reader
    checking.

    ⚠️ `raise_concern` IS EXEMPT AND THAT IS NOT A LOOPHOLE. It APPENDS a row;
    `edit` finds one by id and changes it. A verb that cannot express "create"
    should not pretend to.
    """
    import ast as _ast

    src = open(os.path.join(AGENT, "concerns.py"), encoding="utf-8").read()
    direct = []
    for node in _ast.parse(src).body:
        if not isinstance(node, _ast.FunctionDef) or node.name.startswith("_"):
            continue
        if node.name in ("edit", "raise_concern"):
            continue
        body = _ast.get_source_segment(src, node) or ""
        if "_write(" in body:
            direct.append(node.name)
    assert not direct, (
        "mutator(s) in the concern store still write directly instead of "
        "through `edit`, so every invariant it holds is applied unevenly: "
        + ", ".join(direct))
