"""The devices offline now — ONE reading, three callers: the night check and recheck.py (their PM-UNAVAILABLE
findings), the reports' monitoring table, and the concierge's status in a chat.

⚠️ THREE WALKS OF ONE QUESTION (architecture review round 3, 2026-10-19): facts.Ctx.offline grouped by device_of and
dropped a nameless device; nightly.offline_findings grouped by device_key, read how long, merged an integration down
and left out the devices an alert follows; concierge.status walked a third list and grouped a third way. The same
villa could read three different answers to "what is offline". Here: one walk, one grouping (pack.device_key: the
physical device, else integration + asset, else the entity), one name (the device's own, device_label; else the
asset's, else the entity's), "a device the villa's system knows nothing about is not the villa's" applied once.

Nothing here holds a threshold or a list: the families are the caller's (each skill names its own), as are the
minimum (`min_minutes`: the night's settings; the page and the chat ask for everything), the devices an alert already
follows (`alerted`) and from how many devices an integration counts as down (`integration_min`).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .device_state import OFFLINE_NOW
from .timeutil import villa_time


@dataclass
class Group:
    """One physical device offline (or one integration down: `integration`), through every entity of it read."""
    key: str                          # pack.device_key: the physical device, else integration:asset, else the entity
    label: str | None                 # the device's name as the villa's system gives it; None when it names none
    asset: str                        # the first entity's asset slug (a measurement is named by its asset)
    asset_name: str                   # that asset's name, else the first entity's
    family: str                       # the first entity's family
    platform: str                     # its integration ("x" when the pack does not say)
    state: str | None                 # the first entity's state (every one of them is offline)
    since: datetime | None            # when the first of them went (the earliest last_changed, UTC); None: not said
    hours: float | None               # how long, at `now`; None when `since` is
    critical: bool                    # one of its entities is on the villa's critical list (pack.is_critical)
    names: list[str] = field(default_factory=list)       # the entities' names, in the families' order
    entity_ids: list[str] = field(default_factory=list)  # the entities, the same order (an integration: one per device)
    integration: str | None = None    # an integration down: its platform; its devices' first entities in entity_ids

    @property
    def entity_id(self) -> str:
        """The entity the group stands under (the first read)."""
        return self.entity_ids[0]

    @property
    def name(self) -> str:
        """What a page or a chat calls it: the device's own name, else its asset's, else its first entity's."""
        return self.label or self.asset_name


def _hours(since: datetime | None, now: datetime) -> float | None:
    return None if since is None else (now - since).total_seconds() / 3600


def devices_offline(pack, states: dict, now: datetime, families, *, min_minutes: float = 0,
                    alerted=frozenset(), integration_min: float | None = None) -> list[Group]:
    """The devices offline now among `families`' entities, one Group per physical device, in the order first read.
    `states`: {entity_id: {"state", "last_changed"}} as the villa's system gives them; `now`: aware. `min_minutes`: only
    those offline this long (0: every one, a device whose time is not known included); `alerted`: physical device ids
    (else entity ids) an open alert already follows — left out before an integration is counted; `integration_min`:
    this many devices of one integration offline together are one Group, `integration` set (None: never merged)."""
    groups: dict[str, Group] = {}
    for fam in families:
        for row in pack.entities(fam):
            eid = row.get("entity_id")
            st = states.get(eid) or {}
            # ⚠️ "unknown" IS NOT OFFLINE (villa, 2026-10-04): a sensor with no value to give while its device reports;
            # nor is "unavailable" from a device asleep between its reports (vesta_shared.asleep) — the pack's standing
            if not eid or pack.standing(eid, st.get("state")) != OFFLINE_NOW:
                continue
            label = pack.device_label(pack.physical_device_of(eid))
            if label == "":
                continue            # a device the villa's system knows nothing about (a phone on the Wi-Fi): not the villa's
            key = pack.device_key(eid, row)
            since = villa_time(st.get("last_changed"), "UTC")
            crit = pack.is_critical(eid)
            g = groups.get(key)
            if g is None:
                asset = row.get("asset") or eid
                groups[key] = g = Group(
                    key=key, label=label or None, asset=asset,
                    asset_name=(pack.assets.get(asset) or {}).get("name") or row.get("name") or eid,
                    family=fam, platform=row.get("platform") or "x", state=st.get("state"), since=since,
                    hours=_hours(since, now), critical=crit)
            g.names.append(row.get("name") or eid)
            g.entity_ids.append(eid)
            g.critical = g.critical or crit
            if since is not None and (g.since is None or since < g.since):
                g.since, g.hours = since, _hours(since, now)
    # a device an open alert already follows is that alert's: left out before the integration is counted, so the
    # others of its integration stay what they are
    if alerted:
        groups = {k: g for k, g in groups.items() if (pack.physical_device_of(g.entity_id) or g.entity_id) not in alerted}
    out = merged_integrations(groups, integration_min, now) if integration_min is not None else list(groups.values())
    if min_minutes:
        out = [g for g in out if g.hours is not None and g.hours * 60 >= min_minutes]
    return out


def merged_integrations(groups: dict[str, Group], min_devices: float, now: datetime) -> list[Group]:
    """`min_devices` or more devices of one integration offline together are one Group — the integration is down —
    standing for every one of them (`entity_ids`: each device's first entity; `names`: their names); the others
    unchanged, in their order. Critical only when one of its devices is (owner, 2026-10-18: one list), never for being
    a group."""
    by_platform: dict[str, list[str]] = {}
    for key, g in groups.items():
        by_platform.setdefault(g.platform or key.split(":")[0], []).append(key)
    out: dict[str, Group] = dict(groups)
    for plat, keys in by_platform.items():
        if plat in ("x", "None") or len(keys) < min_devices:
            continue
        devs = [groups[k] for k in keys]
        since = min((g.since for g in devs if g.since is not None), default=None)
        for k in keys:
            out.pop(k)
        out[plat] = Group(key=plat, label=None, asset=f"integration_{plat}", asset_name=plat, family=devs[0].family,
                          platform=plat, state=devs[0].state, since=since, hours=_hours(since, now),
                          critical=any(g.critical for g in devs), names=[g.names[0] for g in devs],
                          entity_ids=[g.entity_id for g in devs], integration=plat)
    return list(out.values())
