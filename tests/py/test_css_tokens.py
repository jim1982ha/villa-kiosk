"""A `var()` must name a declaration or carry a fallback.

⚠️ THE INSTANCE THIS PAYS FOR (2026-09-06): `--radius-md` was referenced at
eight sites and declared NOWHERE. It rendered correctly for its whole life
because every one of those sites carried a `, 8px` fallback — so the defect was
invisible to review, invisible to `tsc`, and one careless copy-paste (a ninth
site without the fallback) away from an INVALID value that silently drops the
whole declaration.

⚠️ THE FILE ALREADY DOCUMENTED THIS FAILURE AND STILL HAD IT. A comment in
`styles.css` records a block that used `--surface-3`, `--shadow-2`, `--border`,
`--radius-sm`, `--text` and `--text-muted` — "not one exists" — and names the
mechanism exactly: "silent, and invisible to tsc and to review". Prose noticed
it once; nothing was watching the second time.

⚠️ IT IS THE OTHER HALF OF `test_css_classes`. That proves a class named in
markup resolves to a rule. This proves a token named in a rule resolves to a
declaration. Same technique, same cost, opposite direction.

⚠️ A TOKEN MAY BE DECLARED FROM TYPESCRIPT, AND THE FIRST VERSION OF THIS FILE
DID NOT KNOW THAT — it reported twelve false positives on its first run
(`--device-fill`, `--tick`, `--icon-dark` …), every one of them set as an
inline custom property, e.g. `["--device-fill" as string]: deviceTint.fill` in
`BasePanel.tsx`. A per-element token set from the component that owns it is the
correct pattern here, not a defect. So the declaration set is the union of both
sources, and a probe that scanned only the stylesheet would have trained a
reader to ignore it — which is worse than not having it.
"""

from __future__ import annotations

import os
import re
from typing import Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSS = os.path.join(REPO_ROOT, "src", "styles.css")
SRC = os.path.join(REPO_ROOT, "src")

#: `--name:` at the start of a declaration.
_DECLARED = re.compile(r"(?:^|[;{]|\*/)\s*(--[a-z0-9-]+)\s*:", re.M)
#: `var(--name` — the capture stops before any `,` fallback.
_USED = re.compile(r"var\(\s*(--[a-z0-9-]+)\s*([,)])")


def _css() -> str:
    with open(CSS, encoding="utf-8") as handle:
        return handle.read()


#: `["--name" as string]:` or `"--name":` in a TSX style object.
_SET_FROM_TS = re.compile(r"[\"\']((?:--[a-z0-9-]+))[\"\']")


def _declared_in_ts() -> Set[str]:
    """Tokens a component sets on an element it owns. ⚠️ NOT a fallback for a
    missing declaration — it is a different, legitimate home for one."""
    found: Set[str] = set()
    for root, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            with open(os.path.join(root, name), encoding="utf-8") as handle:
                found.update(_SET_FROM_TS.findall(handle.read()))
    return found


def _declared(text: str) -> Set[str]:
    return set(_DECLARED.findall(text)) | _declared_in_ts()


def test_every_bare_var_names_a_token_that_is_declared() -> None:
    """A `var(--x)` with no fallback and no declaration is an invalid value:
    the browser drops the whole declaration, so the element renders as though
    the rule was never written."""
    text = _css()
    declared = _declared(text)
    problems = sorted({
        name for name, closer in _USED.findall(text)
        if closer == ")" and name not in declared})
    assert not problems, (
        "styles.css uses tokens that are declared nowhere and carry no "
        "fallback — each is an INVALID value that drops its declaration:\n  "
        + "\n  ".join(problems))


def test_a_token_with_a_fallback_is_still_declared() -> None:
    """⚠️ THE FALLBACK IS A SAFETY NET, NOT A DECLARATION. `--radius-md` passed
    the check above for its whole life on eight `, 8px` fallbacks while being
    declared nowhere — so the value lived in eight places and the token that
    was supposed to own it lived in none. A fallback may exist; it may not be
    the only definition."""
    text = _css()
    declared = _declared(text)
    problems = sorted({
        name for name, closer in _USED.findall(text)
        if closer == "," and name not in declared})
    assert not problems, (
        "styles.css names tokens that exist ONLY as var() fallbacks — declare "
        "them in :root so the value has one home:\n  " + "\n  ".join(problems))


def test_this_check_can_actually_fail() -> None:
    """⚠️ MUTATION-PROOFING, IN THE FILE. Both assertions above pass on an
    empty parse — a regex that stopped matching would report health forever,
    which is the failure mode this whole file exists to catch."""
    text = _css()
    assert len(_declared(text)) >= 20, (
        f"only {len(_declared(text))} token declarations found — the "
        "declaration regex has stopped matching")
    assert len(_USED.findall(text)) >= 100, (
        f"only {len(_USED.findall(text))} var() uses found — the usage regex "
        "has stopped matching")
    assert len(_declared_in_ts()) >= 5, (
        f"only {len(_declared_in_ts())} token(s) found set from TS — that "
        "regex has stopped matching, and every per-element token would now "
        "read as undeclared")
    assert "--radius-md" in _declared(text), (
        "--radius-md is undeclared again; it is the token this file was "
        "written for")
