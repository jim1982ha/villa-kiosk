"""A device's run-hours check: on or off, and why, in plain words. The night check (preventive-maintenance nightly.py)
judges by it and says it in its notes, and records each device's verdict of the night (record) for the VESTA Agent page
(Knowledge › Device links), which groups its devices by it (vesta_agent/ui/links.py).

⚠️ ONE VERDICT, NEVER A COPY (architecture review 20, card 2): the page filed a device under "Schedule linked" whenever
a schedule was linked, while the night check had turned its run-hours check off (a lighting or a meter kind, a schedule
with no time blocks, one used only by switched-off automations), each place with its own rule. Both ask `verdict`.
⚠️ A HELPER GONE FROM THE VILLA IS SAID (architecture review 20, card 3): a schedule deleted or renamed in the villa's
system stopped the check without a word; it is now a reason of its own, in the night's notes and on the page.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from .asset_kinds import KINDS

#: Where the night's verdicts are kept in the agent's store (Store.cache_put): {"at": when judged, "devices": {slug:
#: {on, code, why, schedule, kind}}}: the schedule and the kind judged, so the page knows a verdict a later link or kind
#: choice has made out of date.
KEY = "pm-run-hours"

#: Kinds the night check never judges: read by the energy figures only (asset_kinds.KINDS says so to the owner).
NOT_JUDGED = ("lighting", "meter")

#: The reasons the night's notes say: a link that cannot work as set, which the owner can fix. The others (no schedule,
#: a lighting kind) are how most devices are and would be a note per device every night.
NOTED = ("gone", "no_blocks", "unused")


@dataclass(frozen=True)
class Verdict:
    on: bool
    code: str           # on, no_reading, kind, no_schedule, gone, no_blocks, unused
    why: str            # the reason in words, for the page and the night's notes

    def note(self, device: str) -> str | None:
        """The night's note for `device` (its name), or None when this verdict is not worth one (NOTED)."""
        return f"{device}: run-hours check off. {self.why}" if self.code in NOTED else None


def verdict(asset: dict, found: bool | None, blocks: bool | None = None, unused: list[str] | None = None,
            name: str | None = None) -> Verdict:
    """The run-hours check of `asset` (a pack's asset dict: its entities, kind and schedule link). `found`: whether
    its schedule is among the villa's helpers (None: not known). `blocks`: whether that schedule has time blocks (None:
    not known, judged as having some). `unused`: the switched-off automations that alone use it (nightly.schedule_unused;
    None: not judged, or used). `name`: the schedule's name, else its id."""
    ents = asset.get("entities") or {}
    if not ents.get("power") and not ents.get("energy"):
        return Verdict(False, "no_reading", "It measures neither power nor energy.")
    kind = asset.get("kind", "appliance")
    if kind in NOT_JUDGED:
        return Verdict(False, "kind", f"Its kind is {KINDS[kind][0]}: its run hours are never judged (Device kinds).")
    schedule = asset.get("schedule")
    if not schedule:
        return Verdict(False, "no_schedule", "No schedule linked.")
    said = name or schedule
    if found is False:
        return Verdict(False, "gone", f"{said} is no longer in the villa's system.")
    if blocks is False:
        return Verdict(False, "no_blocks", f"{said} has no time blocks.")
    if unused:
        return Verdict(False, "unused", f"{said} is used only by {', '.join(unused)}, switched off.")
    return Verdict(True, "on", f"Judged against {said}.")


def entry(asset: dict, v: Verdict) -> dict:
    """What the night keeps of one device's verdict (KEY's "devices")."""
    return {**asdict(v), "schedule": asset.get("schedule"), "kind": asset.get("kind", "appliance")}


def record(store, at: str, devices: dict[str, dict]) -> None:
    """The night's verdicts, judged at `at`, kept for the page (KEY)."""
    store.cache_put(KEY, {"at": at, "devices": devices})


def recorded(store) -> dict:
    """The last night's verdicts as record kept them ({"at": None, "devices": {}} before the first)."""
    got = store.cache_get(KEY) if store is not None else None
    return got if isinstance(got, dict) and isinstance(got.get("devices"), dict) else {"at": None, "devices": {}}
