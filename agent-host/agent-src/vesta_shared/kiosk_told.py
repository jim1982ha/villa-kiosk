"""What the VESTA Kiosk last told the agent in its answer to a heartbeat (agent-contract.json `heartbeat.answer`): the
villa's settings the Kiosk owns, each kept in its own file beside the knowledge pack, read there by every check.

⚠️ THE KIOSK OWNS THEM (owner, 2026-10-21 and 2026-10-29: the Kiosk is always installed, the agent may not be): its
devices unavailable by design (vesta_shared.asleep), its maintenance switch (vesta_shared.maintenance) and its pick of
the villa's "empty" sensor (vesta_shared.occupancy). An answer that leaves a key out (an older Kiosk, one that cannot
read its settings) leaves what was kept as it is; never told, or the file cannot be read: the setting's `unset`.

⚠️ ONE TABLE, NOT THREE COPIES (architecture review round 10, card 2): each setting had been added on its own day by
copying the previous one's told / save / read and its block in app.kiosk_answered. The next one is one row here, as it
is one row of the Kiosk's own table (supervisor-proxy.py VILLA_SETTINGS). The files keep the names and shapes those
copies wrote ({"ids": [...]}, {"on": true}, {"entity_id": "..."}): nothing on disk changes.
"""
from __future__ import annotations

import json
import os
from typing import Any, Callable, NamedTuple


class Setting(NamedTuple):
    """One villa setting the Kiosk hands over: `file` beside the knowledge pack, holding {`field`: value}; `parse` a
    value as told or as kept → the value, None when it is not one (an answer without it keeps what was kept, a file
    without it reads `unset`); `says` the app log's words when it changed."""
    file: str
    field: str
    parse: Callable[[Any], Any]
    unset: Any
    says: Callable[[Any], str]


def _ids(v) -> list[str] | None:
    return sorted({str(e).strip().lower() for e in v if isinstance(e, str) and "." in e}) if isinstance(v, list) else None


def _entity_id(v) -> str | None:
    """An entity id, "" for none (no pick, or not an entity id); None when it is no text at all."""
    if not isinstance(v, str):
        return None
    v = v.strip().lower()
    return v if "." in v and " " not in v else ""


#: heartbeat answer key → the setting (agent-contract.json `heartbeat.answer`)
SETTINGS: dict[str, Setting] = {
    "unavailableByDesign": Setting(
        "unavailable_by_design.json", "ids", _ids, [],
        lambda ids: "The VESTA Kiosk's devices unavailable by design: " + (", ".join(ids) or "none")),
    "maintenance": Setting(
        "maintenance_mode.json", "on", lambda v: v if isinstance(v, bool) else None, False,
        lambda on: "The VESTA Kiosk's maintenance mode: " + ("on, only P1 alerts are taken up" if on else "off")),
    "villaEmptySensor": Setting(
        "villa_empty_sensor.json", "entity_id", _entity_id, "",
        lambda eid: "The VESTA Kiosk's villa empty sensor: "
                    + (eid or "none picked, whether the villa is empty cannot be told")),
}


def path(name: str, pack_path: str | None = None) -> str | None:
    """Where setting `name` is kept: beside the knowledge pack at `pack_path` (else VESTA_PACK, the skills'
    environment); None when there is no pack to sit beside."""
    pack_path = pack_path if pack_path is not None else os.environ.get("VESTA_PACK", "")
    return os.path.join(os.path.dirname(pack_path), SETTINGS[name].file) if pack_path else None


def get(name: str, pack_path: str | None = None):
    """Setting `name` as the Kiosk last told it; its `unset` when it never did or the file cannot be read."""
    row = SETTINGS[name]
    try:
        with open(path(name, pack_path) or "", encoding="utf-8") as f:
            v = row.parse((json.load(f) or {}).get(row.field))
    except (OSError, ValueError, AttributeError):
        return row.unset
    return row.unset if v is None else v


def told(answer: dict) -> dict:
    """{name: value} of every setting the heartbeat `answer` says; a key it leaves out (or says as no value) is absent."""
    answer = answer if isinstance(answer, dict) else {}
    out = {}
    for name, row in SETTINGS.items():
        v = row.parse(answer.get(name))
        if v is not None:
            out[name] = v
    return out


def save(pack_path: str, name: str, value) -> bool:
    """Keep `value` as setting `name` (beside the pack at `pack_path`); True when it changed."""
    p = path(name, pack_path)
    if p is None or (os.path.exists(p) and get(name, pack_path) == value):
        return False
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({SETTINGS[name].field: value}, f)
    os.replace(tmp, p)
    return True


def keep(pack_path: str, answer: dict) -> list[str]:
    """Keep every setting the heartbeat `answer` says (app.kiosk_answered); the log's words of each one that changed."""
    return [SETTINGS[n].says(v) for n, v in told(answer).items() if save(pack_path, n, v)]
