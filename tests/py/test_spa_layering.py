"""The SPA's layers, enforced — the mirror of `test_layering.py`.

⚠️ 2026-08-29, owner: "you should align with how you have split the codebase few
prompts ago, as per the segregations we have done earlier". The BACKEND lattice
has been pinned since TASK-115. The SPA was given the same three folders —
`src/vesta/{shared,brief,supervise}` — and nothing checked them, so it had
already eroded in both directions while the Python half stayed clean.

The model is the backend's, one layer shorter (the browser has no adapters):

    shared     → nothing under vesta/    vocabulary both halves speak
    brief      → shared                  the deterministic briefing (deletable)
    supervise  → shared                  the agent (exportable)

⚠️ THE TWO HALVES ARE SIBLINGS. Neither may import the other, and the direction
that matters most is `supervise → brief`: the owner's stated reason for the
split is that the agent must remain deployable on its own — "the future
possibility for us to export the Agent and deploy all of it in an external
resource". An import from `brief` puts a deletable module inside the exportable
set, which is the one thing the segregation exists to prevent.

⚠️ THE FOLDERS ARE THE LEGIBILITY; THIS FILE IS THE BOUNDARY — the sentence
`test_layering.py` opens with, and the reason it applies here too: every
boundary in this repo that was only a folder name has eroded and been paid for.
"""
from __future__ import annotations

import os
import re
from typing import Dict, List, Set, Tuple

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VESTA = os.path.join(REPO_ROOT, "src", "vesta")

#: layer → what it may import from, under `@/vesta/`.
MAY_IMPORT: Dict[str, Set[str]] = {
    "shared": set(),
    "brief": {"shared"},
    "supervise": {"shared"},
}

#: ⚠️ A DEBT WITH A NAME, NOT AN EXCEPTION — the shape `test_layering.py` uses.
#: Each entry names ONE importing file and ONE imported layer, so anything else
#: crossing the same boundary still fails. Removing an entry is the definition
#: of done for the move that fixes it; adding one is a decision to be argued in
#: review, not a way to make this file quiet.
ALLOWED_DEBT: Set[Tuple[str, str]] = {
    # ⚠️ 1-3 · supervise → brief, the direction that breaks EXPORT. All three
    # are the agent dialog reading `/reports-diagnostics`, whose client and type
    # live in `brief/reportsApi.ts`. The endpoint itself is neither half's — the
    # HOST serves it and both halves consume it — so the fix is to lift the
    # diagnostics slice into `shared`, not to duplicate the parser. Left as debt
    # rather than done inline: it is a real refactor of a large module and this
    # release is a rename.
    ("supervise/components/AgentModal.tsx", "brief"),
    ("supervise/components/ReflexObserve.tsx", "brief"),
    # ApiKeyPanel edits the narration provider key, which the briefing uses to
    # phrase a report and the agent uses to think. Genuinely shared; it sits in
    # `brief` because narration was written first.
    ("supervise/components/AgentAdvancedModal.tsx", "brief"),
    # ⚠️ 4 · brief → supervise. The schedule picks a delivery target by ROLE,
    # and people/roles are read through `supervise/agentApi`. People are not the
    # agent's — `adapters/people.py` is in ADAPTERS on the backend, one layer
    # below both halves — so the SPA accessor belongs in `shared` for the same
    # reason.
    ("brief/components/ScheduleTab.tsx", "supervise"),
}

_IMPORT = re.compile(r"""from\s+["']@/vesta/([a-z]+)/""")


def _sources() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for dirpath, _dirs, files in os.walk(VESTA):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as handle:
                out[os.path.relpath(path, VESTA).replace(os.sep, "/")] = handle.read()
    return out


def _layer_of(rel: str) -> str:
    return rel.split("/", 1)[0]


def test_no_import_crosses_between_the_two_halves() -> None:
    sources = _sources()

    # ⚠️ VACUOUS-PASS GUARDS. A renamed folder or a moved tree would otherwise
    # compare empty sets and report health for ever.
    assert len(sources) >= 15, f"only {len(sources)} SPA modules found under {VESTA}"
    layers = {_layer_of(rel) for rel in sources}
    assert layers >= {"shared", "brief", "supervise"}, (
        f"the three folders are not all present: {sorted(layers)}")

    offenders: List[str] = []
    edges = 0
    for rel, source in sources.items():
        layer = _layer_of(rel)
        allowed = MAY_IMPORT.get(layer)
        if allowed is None:
            continue
        for imported in set(_IMPORT.findall(source)):
            if imported == layer:
                continue
            edges += 1
            if imported in allowed or (rel, imported) in ALLOWED_DEBT:
                continue
            offenders.append(f"{rel} → {imported}")

    assert edges, "no cross-layer imports parsed at all — the regex has rotted"
    assert not offenders, (
        "these imports cross the segregation. `supervise → brief` puts a "
        "deletable module inside the exportable set; `brief → supervise` makes "
        "the briefing undeletable. Move the shared thing to `shared/`, or add a "
        f"named entry to ALLOWED_DEBT with the reason: {offenders}")


def test_the_shared_layer_depends_on_neither_half() -> None:
    """⚠️ THE PROPERTY THAT MAKES `shared` WORTH HAVING. It is the vocabulary
    both halves speak, so one import of either turns it into a bridge — and a
    bridge is how `supervise → brief` comes back through the back door."""
    sources = _sources()
    shared = {rel: src for rel, src in sources.items() if _layer_of(rel) == "shared"}
    assert shared, "no modules under src/vesta/shared — this test is measuring nothing"

    offenders = [f"{rel} → {imported}"
                 for rel, src in shared.items()
                 for imported in set(_IMPORT.findall(src))
                 if imported != "shared"]
    assert not offenders, f"shared/ reaches into a half: {offenders}"


def test_the_debt_list_holds_only_live_edges() -> None:
    """⚠️ AN ALLOWANCE THAT NO LONGER DESCRIBES AN IMPORT IS WORSE THAN NONE: it
    silently permits the edge coming back. Same rule the backend pin carries."""
    sources = _sources()
    live = {(rel, imported)
            for rel, src in sources.items()
            for imported in set(_IMPORT.findall(src))
            if imported != _layer_of(rel)}
    stale = sorted(entry for entry in ALLOWED_DEBT if entry not in live)
    assert not stale, (
        f"these allowances name imports that no longer exist — delete them, the "
        f"move that fixed them is done: {stale}")
