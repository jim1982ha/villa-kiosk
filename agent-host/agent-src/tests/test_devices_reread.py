"""The villa's devices read again when its registries change (owner, 2026-10-21: an entity unhidden at 02:00 stayed out
of the Rules pickers, and a deleted TV kept its fault, until the 01:30 rebuild of the next night)."""
from __future__ import annotations

import asyncio

from vesta_agent.app import Vesta
from vesta_agent.ha_events import EVENT_TYPES, REGISTRY_EVENTS


class _Agent:
    """Vesta's own methods for this, around a counted reading of the devices."""
    devices_changed = Vesta.devices_changed
    _devices_when_still = Vesta._devices_when_still
    _safe = Vesta._safe
    on_ha_event = Vesta.on_ha_event

    def __init__(self):
        self._devices_due = None
        self._devices_task = None
        self.built = 0

    def build_pack(self):
        self.built += 1
        return {}


def test_a_registry_change_is_listened_to_and_a_burst_of_them_is_one_reading():
    assert set(REGISTRY_EVENTS) <= set(EVENT_TYPES)

    async def run():
        a = _Agent()
        for _ in range(5):                                     # ten entities renamed: one reading, once still
            await a.on_ha_event("entity_registry_updated", {"action": "update"})
        a.devices_changed(0.05)
        await a._devices_task
        assert a.built == 1
        await a.on_ha_event("device_registry_updated", {"action": "remove"})
        a.devices_changed(0)
        await a._devices_task
        assert a.built == 2
    asyncio.run(run())
