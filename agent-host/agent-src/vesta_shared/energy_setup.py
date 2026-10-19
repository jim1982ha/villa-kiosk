"""The villa's electricity as its own Energy settings lay it out: the Kiosk's Energy window rule, in Python.

⚠️ ONE RULE WITH THE KIOSK (architecture review round 2, 2026-10-16). The VESTA Kiosk's Energy window
(src/config/energyModel.ts, oracle tests/oracles/energy_model.mjs on dev2) reads the grid, the solar and the
devices — and which device sits INSIDE which (`included_in_stat`, the "upstream device") — from the villa system's
Energy settings. roi-energy picked a "main meter" by its name instead and took every other meter away from it: a
light configured inside a phase meter was subtracted twice, and the Agent's "not metered" disagreed with the Kiosk's
"untracked" for the same week. tests/test_energy_setup.py replays the Kiosk oracle's cases with its numbers.

Nothing here is configured in VESTA: the setup is read (`read`, mode "get" only — read_guard.READ_ACTIONS), the kWh
are each statistic's own. PURE apart from `read`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .ha_client import error_short_chars


@dataclass
class Node:
    """A device of the Energy settings; its children are the devices whose upstream device it is."""
    id: str
    name: str
    rate_id: str | None = None
    children: list["Node"] = field(default_factory=list)


@dataclass
class Setup:
    grid_in: list[str]
    grid_out: list[str]
    solar: list[str]
    roots: list[Node]                 # devices with no upstream device: the top level
    devices: list[Node]               # every device, flat, in the settings' order

    @property
    def sources(self) -> list[str]:
        """The statistics a total is made of."""
        return self.grid_in + self.grid_out + self.solar

    def parent_of(self) -> dict[str, Node]:
        return {c.id: n for n in self.devices for c in n.children}


def setup(prefs: dict, name_of: Callable[[str], str] = lambda s: s) -> Setup:
    """The hierarchy from the settings (energyModel.energySetup). A device whose upstream is not itself a configured
    device, or that sits in a loop (a inside b, b inside a: a misconfiguration), is top level — never lost."""
    def pick(kind: str, key: str) -> list[str]:
        return [s[key] for s in prefs.get("energy_sources") or [] if s.get("type") == kind and s.get(key)]
    nodes: dict[str, Node] = {}
    entries = [d for d in prefs.get("device_consumption") or [] if d.get("stat_consumption")]
    for d in entries:
        sid = d["stat_consumption"]
        if sid not in nodes:
            nodes[sid] = Node(sid, (d.get("name") or "").strip() or name_of(sid), d.get("stat_rate") or None)
    parent: dict[str, str] = {}
    for d in entries:
        p = d.get("included_in_stat")
        if p and p != d["stat_consumption"] and p in nodes:
            parent[d["stat_consumption"]] = p

    def in_loop(sid: str) -> bool:
        seen, c = set(), sid
        while c:
            if c in seen:
                return True
            seen.add(c)
            c = parent.get(c)
        return False
    roots = []
    for n in nodes.values():
        p = parent.get(n.id)
        if p and not in_loop(n.id):
            nodes[p].children.append(n)
        else:
            roots.append(n)
    return Setup(pick("grid", "stat_energy_from"), pick("grid", "stat_energy_to"), pick("solar", "stat_energy_from"),
                 roots, list(nodes.values()))


@dataclass
class NodeUse:
    node: Node
    kwh: float
    children: list["NodeUse"]
    untracked: float                  # the node's own kWh its children leave (never negative)


@dataclass
class Split:
    used: float                       # grid in + solar − grid out: what the villa's system calls consumption
    grid_in: float
    grid_out: float
    solar: float
    roots: list[NodeUse]              # top-level devices, largest first
    untracked: float                  # used minus the top-level devices; never negative
    overlap: float                    # how much the top-level devices exceed `used`: devices set up BESIDE the meter
                                      # they are part of, not inside it — counted twice, never a negative remainder


def used(grid_in: float, grid_out: float, solar: float) -> float:
    """The villa's consumption from its sources (never below 0)."""
    return max(0.0, grid_in + solar - grid_out)


def split(s: Setup, kwh: Callable[[str], float | None]) -> Split:
    """A period's split from each statistic's kWh in it (None: no reading) — energyModel.energySplit."""
    def total(ids):
        return sum(kwh(i) or 0.0 for i in ids)
    g_in, g_out, sol = total(s.grid_in), total(s.grid_out), total(s.solar)

    def walk(n: Node) -> NodeUse:
        kids = sorted((walk(c) for c in n.children), key=lambda u: -u.kwh)
        own = kwh(n.id) or 0.0
        return NodeUse(n, own, kids, max(0.0, own - sum(c.kwh for c in kids)))
    roots = sorted((walk(n) for n in s.roots), key=lambda u: -u.kwh)
    tracked = sum(r.kwh for r in roots)
    u = used(g_in, g_out, sol)
    return Split(u, g_in, g_out, sol, roots, max(0.0, u - tracked), max(0.0, tracked - u))


def ranking(sp: Split) -> list[NodeUse]:
    """Every device's use, flat (nested ones included), largest first — energyModel.deviceRanking."""
    out: list[NodeUse] = []

    def add(u: NodeUse):
        out.append(u)
        for c in u.children:
            add(c)
    for r in sp.roots:
        add(r)
    return sorted(out, key=lambda u: -u.kwh)


def read(client) -> tuple[dict | None, str | None]:
    """(the Energy settings, None) — or (None, why) when they cannot be read. A client that cannot read them at all
    says so with None and no reason."""
    try:
        return client.energy_prefs(), None
    except Exception as e:  # noqa: BLE001 — unreadable settings fall back, they never stop a report
        return None, f"{type(e).__name__}: {str(e)[:error_short_chars()]}"


def usable(prefs: dict | None) -> bool:
    """Settings that give a total: at least one grid import or solar source."""
    if not prefs:
        return False
    s = setup(prefs)
    return bool(s.grid_in or s.solar)
