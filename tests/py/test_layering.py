"""The dependency layers, enforced. TASK-115, ARCH-003/011.

⚠️ THE FOLDERS ARE THE LEGIBILITY; THIS FILE IS THE BOUNDARY. The tree is being
restructured so that two future operations become stated lists instead of
archaeology — the owner's words for each (2026-08-28):

  DELETE — "in the future we may completely scratch and remove all the files
  that were previously handling the legacy way of monitoring the villa."
  → delete `brief`, keep everything else.

  EXPORT — "the future possibility for us to export the Agent and deploy all
  of it in an external resource... this should remain a capability."
  → ship `shared` + `supervise`, swap `adapters`, nothing else changes.

Neither list survives a fortnight as a convention; every boundary in this repo
that was only prose has eroded and been paid for. So the layers are checked on
every test run, from a PATH MAP over the tree as it stands — which is what lets
this pin exist BEFORE the folders move and keep working unchanged after: moving
a module is editing one line of the map, not this file's logic.

⚠️ THE MODEL (refdata/architecture.py::LAYERS is the spec; this is the pin):

  shared     → nothing            pure; ships with any deployment
  adapters   → shared             the environment; ONE implementation each
  brief      → shared, adapters   the deterministic briefing (deletable)
  supervise  → shared, adapters   the agent + observation (exportable)
  host       → everything         wires them; the proxy

⚠️ `supervise` NEVER IMPORTS `brief`, and that inversion is not new — the host
registers `set_concerns_source` / `set_fallback_composer` / `set_brief_composer`
on the pipeline at boot, which is exactly why ARCH-003 has held. This file
REPLACES `test_module_conventions.test_reports_never_imports_agent` as the
boundary's owner (that test guarded one edge of this lattice; the lattice now
guards all of them — the old test stays until the move lands, then retires).

⚠️ ONE KNOWN DEBT, ALLOWED EXPLICITLY UNTIL ITS TASK: `agent/tools/analysis.py`
reaches `reports.pipeline._statistics_fetcher` — supervise → brief, a private of
a deletable module. TASK-115 extracts the fetcher into `adapters`; the allowance
below names the exact edge so anything ELSE crossing that boundary still fails,
and removing the allowance is part of the extraction's definition of done.
"""

from __future__ import annotations

import ast
import os
from typing import Dict, List, Set, Tuple

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BIN = os.path.join(REPO, "rootfs", "usr", "bin")

#: module path (relative to rootfs/usr/bin, no .py) → layer.
#: ⚠️ FIRST MATCH WINS AND ORDER CARRIES MEANING: specific files before the
#: package prefixes that contain them. This is the ONE hand-maintained artefact;
#: everything else is derived. When the folders move, these keys change and the
#: assertions do not.
LAYER_OF: Tuple[Tuple[str, str], ...] = (
    # ⚠️ PACKAGE FACADES CARRY THE LAYER OF WHAT THEY RE-EXPORT, and both are
    # named here explicitly because the corrected relative-import resolution
    # surfaced them: `analysis/__init__` re-exports `registry` (brief) beside
    # `base` (shared), so importing the FACADE is importing brief — it is
    # layered brief, and a shared or adapters module that wants `base` must
    # import `reports.analysis.base` directly, never the package.
    # ── shared: pure, exportable — MOVED to vesta/shared in the 3a release ──
    # ⚠️ materiality was RECLASSIFIED shared during the pin's first red run:
    # the plan put it in brief because agent/ never imports it directly, but
    # level_anomaly (shared) does, and "shared" is defined by what the
    # exportable set NEEDS, not by who calls it today.
    ("vesta/shared/", "shared"),
    # ── brief: the deletable half ───────────────────────────────────────────
    # ── adapters: the environment — MOVED to vesta/adapters in the 3b release
    # (stats came with them: it wraps HA's recorder through HassClient and
    # discovery imports it — the plan's table had it in brief, the import
    # graph corrected it, same as materiality in reverse).
    ("vesta/adapters/", "adapters"),
    # ── brief: the deletable half — MOVED to vesta/brief in the 3c release.
    # reports/ NO LONGER EXISTS; the delete-later operation is now literally
    # `rm -rf vesta/brief` plus the host's wiring lines.
    ("vesta/brief/", "brief"),
    # ── supervise: the exportable half — MOVED in the 3d release ────────────
    ("vesta/supervise/", "supervise"),
    # ── host ────────────────────────────────────────────────────────────────
    ("supervisor-proxy", "host"),
)

#: What each layer may import. The lattice, not a list of forbidden pairs — a
#: new layer added to LAYER_OF without an entry here fails, closed.
MAY_IMPORT: Dict[str, Set[str]] = {
    "shared": set(),
    "adapters": {"shared"},
    "brief": {"shared", "adapters"},
    "supervise": {"shared", "adapters"},
    "host": {"shared", "adapters", "brief", "supervise"},
}

#: Edges allowed by name, each carrying the task that removes it. ⚠️ AN
#: ALLOWANCE IS A DEBT WITH A NUMBER, not an exception: it names ONE importing
#: module and ONE imported module, so anything else crossing the same boundary
#: still fails.
ALLOWED_DEBT: Set[Tuple[str, str]] = {
    # TASK-115 step 8: extract _statistics_fetcher into adapters, then delete.
    ("vesta/supervise/agent/tools/analysis", "vesta/brief/pipeline"),
}


def _modules() -> Dict[str, str]:
    """path (as in LAYER_OF keys) → source, for every backend module."""
    out: Dict[str, str] = {}
    for base, dirs, files in os.walk(BIN):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in files:
            if not name.endswith(".py"):
                continue
            full = os.path.join(base, name)
            rel = os.path.relpath(full, BIN)[:-3].replace(os.sep, "/")
            with open(full, encoding="utf-8") as handle:
                out[rel] = handle.read()
    return out


def _layer(rel: str) -> str:
    for prefix, layer in LAYER_OF:
        # ⚠️ A PACKAGE MATCHES ITS OWN TRAILING-SLASH PREFIX. `reports/analysis/
        # modules` (the package, as an import target) must resolve to the same
        # layer as `reports/analysis/modules/level_anomaly` — without the
        # rstrip it fell through to the `reports/` catch-all and the modules'
        # own `__init__` reported importing "adapters".
        if rel == prefix or rel == prefix.rstrip("/") or rel.startswith(prefix):
            return layer
    return ""


def _imports(source: str, path: str) -> List[Tuple[str, int]]:
    """In-tree modules this source imports, as (module-path, lineno).

    ⚠️ ast, NOT REGEX. A hand-list of this tree's imports was wrong ONCE
    ALREADY during this task's own planning — multi-line `import (...)` fooled
    a grep and mislabelled six modules. The parser cannot be fooled by layout,
    and it is the same approach `test_reports_never_imports_agent` used.
    """
    found: List[Tuple[str, int]] = []
    tree = ast.parse(source)
    for node in ast.walk(tree):
        names: List[str] = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            # ⚠️ RELATIVE IMPORTS RESOLVE AGAINST THE IMPORTER'S OWN PACKAGE,
            # AND THE FIRST VERSION OF THIS DROPPED THEM — `from ..registry
            # import register` produced the bare name `registry`, which failed
            # the top-package check and vanished. The hole was found because the
            # tree it hid was REAL: the three statistical modules self-register
            # into the brief registry through exactly that import, a
            # shared→brief edge this file shipped green over while claiming
            # mutation coverage. Every mutation had used an absolute import.
            if node.level:
                pkg = path.split("/")
                base = pkg[:len(pkg) - node.level]
                if node.module:
                    base = base + node.module.split(".")
                if not base:
                    continue
                mod = "/".join(base).replace("/", ".")
            elif node.module:
                mod = node.module
            else:
                continue
            names = [mod] + [f"{mod}.{a.name}" for a in node.names]
        for name in names:
            top = name.split(".")[0]
            if top not in ("reports", "observe", "agent", "vesta"):
                continue
            found.append((name.replace(".", "/"), node.lineno))
    return found


def test_every_module_has_a_layer() -> None:
    """⚠️ CLOSED, NOT OPEN: a new module lands in a layer on the day it is
    written, because the package prefixes catch it — and a module OUTSIDE every
    prefix fails here rather than silently escaping the lattice."""
    mods = _modules()
    assert len(mods) >= 40, (
        f"only {len(mods)} modules found under {BIN} — the walk is broken and "
        f"every assertion below would be vacuous")
    unlayered = [m for m in mods if not _layer(m) and "__init__" not in m]
    assert not unlayered, (
        f"modules outside every layer prefix: {unlayered}. Add them to "
        f"LAYER_OF — deliberately, to the layer they belong to.")
    layers = {_layer(m) for m in mods if _layer(m)}
    assert len(layers) >= 4, (
        f"only layers {layers} are populated — the map has gone stale against "
        f"the tree and this file is checking a lattice that no longer exists")


def test_no_import_points_up_the_lattice() -> None:
    """THE BOUNDARY. One assertion for every edge, derived from source."""
    mods = _modules()
    offenders: List[str] = []
    for rel, source in sorted(mods.items()):
        my_layer = _layer(rel)
        if not my_layer:
            continue
        allowed = MAY_IMPORT[my_layer] | {my_layer}
        for target, lineno in _imports(source, rel):
            # ⚠️ RESOLVE TO THE MODULE, NOT THE IMPORTED NAME. `from
            # reports.pipeline import _statistics_fetcher` arrives as
            # `reports/pipeline/_statistics_fetcher`; the debt list and the
            # error message must both speak in modules, so trim from the right
            # until a known module answers. The first run of this file reported
            # the full dotted path and the debt entry did not match — the pin
            # caught its own resolution bug before it caught anything else.
            target_mod, target_layer = target, _layer(target)
            while target_mod and not target_layer and "/" in target_mod:
                target_mod = target_mod.rsplit("/", 1)[0]
                target_layer = _layer(target_mod)
            if not target_layer or target_layer in allowed:
                continue
            # ⚠️ DEBT MATCHES ON THE MODULE BOUNDARY. `from reports.pipeline
            # import _statistics_fetcher` resolves its layer at the full path
            # (the prefix map answers before any trim), so the debt entry
            # `reports/pipeline` must also cover names UNDER it — exactly one
            # segment deeper, which is "a name inside that module", never a
            # whole sub-package smuggled through one allowance.
            if any(rel == imp and (target_mod == tgt
                                   or (target_mod.startswith(tgt + "/")
                                       and "/" not in target_mod[len(tgt) + 1:]))
                   for imp, tgt in ALLOWED_DEBT):
                continue
            offenders.append(
                f"{rel}:{lineno} [{my_layer}] imports {target_mod} "
                f"[{target_layer}]")
    assert not offenders, (
        "imports pointing up the lattice:\n  " + "\n  ".join(offenders)
        + "\nshared imports nothing; adapters only shared; brief and supervise "
          "never each other. If this edge is a new, deliberate debt it goes in "
          "ALLOWED_DEBT with the task that will remove it.")


def test_the_SHARED_layer_is_pure() -> None:
    """⚠️ PURITY IS WHAT MAKES THE EXPORTABLE SET EXPORTABLE. A `shared` module
    that opens a file or a socket carries the add-on's environment with it, and
    the export becomes a port of that environment instead of a deployment.
    Checked as tokens over comment-stripped source: crude, but `open(` in code
    is exactly what must not be there, however it got in."""
    import re
    mods = _modules()
    shared = {m: s for m, s in mods.items() if _layer(m) == "shared"}
    assert len(shared) >= 6, (
        f"only {len(shared)} shared modules — the map or the walk is broken")
    banned = ("open(", "HassClient", "ClientSession", "DATA_DIR",
              "os.environ", "aiohttp", "socket.")
    offenders = []
    for rel, source in sorted(shared.items()):
        body = re.sub(r'"""[\s\S]*?"""|#[^\n]*', "", source)
        for token in banned:
            if token in body:
                offenders.append(f"{rel}: {token}")
    assert not offenders, (
        "the shared layer touches the environment:\n  "
        + "\n  ".join(offenders)
        + "\nEither the module belongs in adapters/, or the I/O belongs "
          "behind one.")


def test_the_DEBT_list_holds_only_live_edges() -> None:
    """⚠️ AN ALLOWANCE THAT OUTLIVES ITS EDGE IS A HOLE. If the extraction
    lands and the import goes, the entry must go with it — otherwise the next
    supervise → brief import from that file passes silently, which is the
    exact silence this file exists to end."""
    mods = _modules()
    for importer, imported in sorted(ALLOWED_DEBT):
        source = mods.get(importer)
        assert source is not None, (
            f"ALLOWED_DEBT names {importer}, which no longer exists")
        hits = [t for t, _ in _imports(source, importer)
                if t == imported or t.startswith(imported + "/")]
        assert hits, (
            f"ALLOWED_DEBT allows {importer} → {imported} but that import is "
            f"gone — delete the entry, its debt is paid")
