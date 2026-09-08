"""Running a scene asks first, on every surface. ADR-0003.

⚠️ THE ORACLE BESIDE THIS ONE TESTS THE SENTENCE; THIS TESTS THAT ANYBODY IS
ASKED AT ALL. `scene_confirm_test.ts` can be green while a new screen fires a
scene straight from a tap, because it only ever sees the message function. The
invariant that actually protects the villa is about CALL SITES, and it is
checked here for the same reason `test_review_surface` exists: the backend half
of a feature can be perfect while nothing on a screen reaches it, or reaches
past it.

⚠️ AND THE RULE IS "ONE WAY IN", NOT "THESE TWO FILES ARE FINE". Naming the two
known surfaces would pass for ever while a third shipped beside them. Requiring
that `scene`.`turn_on` appears in exactly one module means a new surface has to
either use the hook or break this test.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")
HOOK = os.path.join("src", "hooks", "useSceneConfirm.tsx")

#: The service call that runs a scene, in the shape the code writes it.
TURN_ON = re.compile(r'callService\(\s*"scene"\s*,\s*"turn_on"')


def _sources():
    out = {}
    for folder, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(folder, name)
            rel = os.path.relpath(path, REPO_ROOT)
            with open(path, encoding="utf-8") as fh:
                out[rel] = fh.read()
    return out


def test_a_scene_is_run_from_exactly_ONE_module() -> None:
    """⚠️ THE WHOLE GUARANTEE, IN ONE ASSERTION. Two call sites means two
    answers to "does this ask first", and the second one is the one nobody
    tests."""
    callers = sorted(rel for rel, code in _sources().items() if TURN_ON.search(code))
    assert callers == [HOOK], (
        f"`scene`.`turn_on` is called from {callers}, not only from {HOOK}. Every "
        f"scene shortcut must go through `useSceneConfirm`, or that surface "
        f"runs a scene — several rooms at once, with no undo — on a single tap.")


def test_the_one_module_actually_ASKS() -> None:
    """⚠️ A HOOK NAMED `useSceneConfirm` THAT DOES NOT CONFIRM WOULD PASS THE
    TEST ABOVE. It would also pass a typecheck, and every surface would be
    correctly wired to nothing."""
    code = _sources()[HOOK]
    assert "AskDialog" in code, (
        "the scene hook does not open the app's confirm dialog, so every "
        "surface is wired to a confirmation that never appears")
    order = (code.index("AskDialog"), code.index('"scene", "turn_on"'))
    assert order[0] < order[1] or "onConfirm" in code, (
        "the scene call is not behind the dialog's confirm")


def test_BOTH_known_surfaces_use_it() -> None:
    """⚠️ THE TEST ABOVE PROVES NOBODY BYPASSES THE HOOK; THIS PROVES THE TWO
    SURFACES STILL EXIST. A refactor that deleted the room panel's scene row
    would satisfy "exactly one caller" by having no callers at all, and the
    villa would quietly lose a shortcut rather than gain a confirmation."""
    sources = _sources()
    surfaces = sorted(rel for rel, code in sources.items()
                      if "useSceneConfirm" in code and rel != HOOK)
    assert len(surfaces) >= 2, (
        f"only {surfaces} reach the scene hook. The summary bar's scene menu "
        f"and the room panel's 'Scenes for this room' row are both scene "
        f"shortcuts and both must ask.")
    for rel in surfaces:
        assert "askScene" in sources[rel] or "ask(" in sources[rel], (
            f"{rel} imports the hook without ever asking anything")
        # ⚠️ THE RENDER, NOT THE NAME. A first version of this asserted
        # `"sceneDialog" in code`, which the DESTRUCTURING alone satisfies —
        # `const { dialog: sceneDialog } = useSceneConfirm()` contains the
        # string. Deleting the `{sceneDialog}` from the JSX left this green
        # while that surface could ask a question nobody could answer, which is
        # the "wired to nothing" shape the hook exists to prevent. Caught by
        # mutating the surface rather than by reading the assertion.
        assert "{sceneDialog}" in sources[rel], (
            f"{rel} asks but never RENDERS the dialog, so the confirm cannot "
            f"appear on that surface and the scene is never run")
