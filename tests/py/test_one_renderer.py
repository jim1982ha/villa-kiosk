"""There is exactly ONE thing in this codebase that turns a fact into a sentence.

⚠️ THIS FILE EXISTS BECAUSE "D12: two report generators over overlapping facts"
WAS ASSERTED IN CLAUDE.md FOR MONTHS AND WAS NEVER TRUE. It was carried forward
release after release as the last open item of the divergence inventory, and
acted on: I proposed a redesign of the report composer on the strength of it,
scoped it as a session's work, and only measured afterwards. What the tree
actually contains, on 2026-08-26:

  * `narrate/deterministic.py` — 114 f-strings, 44 BULLET uses, 60 heading
    calls. Table-dispatched (`{"critical": self._critical_recap, ...}`), every
    section reachable.
  * `reports/aggregate.py` — 975 lines, 15 f-strings, and ZERO rendering
    vocabulary: no BULLET, no SECTION_MARK, no heading(), no title_mark. It
    emits `Item`, `Group` and `Finding`, and `to_findings` already converts to
    the very type the analysis modules produce.
  * `severity_rank`, `readable_label`, `name_of` — one definition each.

So the renderer reads three SHAPES, and that is not duplication: a blueprint
incident carries money, duration, room and an open/closed lifecycle; a
statistical finding carries a baseline; a Concern carries an investigation.
Collapsing them onto one shape would delete the fields several sections render,
which is accuracy lost to tidiness.

⚠️ WHAT WAS ACTUALLY WORTH DOING IS THIS FILE. The claim was prose, so nothing
could tell anyone it was false, and nothing stops the boundary eroding either —
one `f"• {name} ..."` in `aggregate.py` and the property quietly becomes untrue
with no test to notice. A checked boundary is the durable version of the
sentence D12 was trying to be.
"""

from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
REPORTS = os.path.join(ROOT, "rootfs", "usr", "bin", "vesta", "brief")
VESTA = os.path.join(ROOT, "rootfs", "usr", "bin", "vesta")

#: Files that decide WHAT to say. None of them may decide HOW it reads.
#: ⚠️ DERIVED, NOT LISTED — every module in the package except the renderer's
#: own directory and the two files whose job IS wording. A new synthesis module
#: is covered on the day it is written.
def _synthesis_files():
    for walk_root in (REPORTS, VESTA):
      for base, dirs, files in os.walk(walk_root):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", "narrate")]
        for name in sorted(files):
            # ⚠️ `style.py` IS a wording file and always was — it lived under
            # `narrate/`, which the dirs-prune above excluded WHOLESALE, so its
            # membership in the renderer set was an accident of its address.
            # TASK-115 moved it to vesta/shared (the agent's chat/digest need
            # `inert`, so it is shared by dependency) and the prune no longer
            # covers it; it is excluded by NAME now, which is what the original
            # exclusion actually meant.
            if not name.endswith(".py") or name in ("text.py", "standing.py",
                                                    "style.py"):
                continue
            yield os.path.join(base, name)


def _code(path: str) -> str:
    """Source with comments and docstrings stripped.

    ⚠️ BLOCKS AS BLOCKS. A line filter keyed on the first character passes the
    opening line of a docstring and then flags its continuation lines, which
    start with ordinary words — the trap that has produced a false pin three
    times in this repo already, twice in one session.
    """
    with open(path, "r", encoding="utf-8") as handle:
        body = handle.read()
    body = re.sub(r'"""[\s\S]*?"""', "", body)
    return "\n".join(l for l in body.splitlines()
                     if not l.lstrip().startswith("#"))


def test_only_the_RENDERER_owns_the_rendering_vocabulary() -> None:
    """⚠️ THE BOUNDARY, CHECKED RATHER THAN ASSERTED IN A COMMENT. A bullet, a
    section mark or a heading anywhere in the synthesis layer means a second
    place has started writing prose — which is what D12 claimed had already
    happened, and what this stops actually happening."""
    offenders = []
    for path in _synthesis_files():
        code = _code(path)
        for token in ("BULLET", "SECTION_MARK", "add_heading(", "title_mark("):
            if token in code:
                offenders.append(f"{os.path.relpath(path, ROOT)} uses {token}")
    assert not offenders, (
        "the synthesis layer has started rendering:\n  " + "\n  ".join(offenders))


def test_the_renderer_IS_where_the_prose_lives() -> None:
    """⚠️ THE VACUOUS-PASS GUARD, AND IT IS NOT OPTIONAL HERE. The test above
    passes trivially if the renderer's own vocabulary is renamed or the walk
    stops finding files — a boundary test that cannot see either side reports
    a clean boundary forever.

    ⚠️ THE RENDERER MOVED (TASK-073): `agent/fallback.py` writes every brief
    and every rung now. Its vocabulary is plainer — list dashes and f-strings
    rather than BULLET/heading calls — so the guard anchors on the seams that
    define it: the composer, the rungs, and the inert() discipline."""
    renderer = _code(os.path.join(ROOT, "rootfs", "usr", "bin", "agent",
                                  "fallback.py"))
    assert renderer.count("inert(") > 10, (
        "the renderer no longer routes its strings through inert(), so the "
        "boundary test above is measuring nothing")
    assert "def brief(" in renderer and "def compose(" in renderer
    assert len(list(_synthesis_files())) >= 8, (
        "the synthesis walk found almost nothing; the boundary test above is "
        "passing because it looked at an empty set")


def test_the_shared_JUDGEMENTS_have_one_definition_each() -> None:
    """⚠️ THE OTHER HALF OF "ONE RENDERER". Two layers can share a renderer and
    still disagree, if each decides for itself what "worse" means or what a
    device is called. These are the three that both layers ask."""
    package = {}
    for walk_root in (REPORTS, VESTA):
      for base, dirs, files in os.walk(walk_root):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in sorted(files):
            if name.endswith(".py"):
                path = os.path.join(base, name)
                package[os.path.relpath(path, ROOT)] = _code(path)
    for helper in ("severity_rank", "readable_label", "name_of"):
        homes = [rel for rel, src in package.items()
                 if re.search(rf"^def {helper}\(", src, re.M)]
        assert len(homes) == 1, (
            f"{helper} is defined in {len(homes)} places {homes} — the two "
            "layers can now disagree about it without either being wrong")


# ⚠️ test_the_blueprint_layer_already_speaks_the_analysis_layer_s_TYPE LEFT
# WITH TASK-071: `aggregate.to_findings` was the bridge it pinned, and the
# whole blueprint-event layer it bridged FROM is gone — no producer, no Items,
# no Groups. The one-renderer property this file exists for is unchanged and
# is checked above against the renderer's new home.
