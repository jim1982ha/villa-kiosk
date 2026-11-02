"""Who gets the villa's messages, by role: the villa's own two lists, read by the agent and kept beside the knowledge
pack, so its alerts, chases and reports go where the villa's own alerts go.

⚠️ ONE PLACE FOR "WHICH CHAT IS WHOSE" (owner, 2026-11-03: "a single file on the villa, which VESTA also reads, so
there's one place for both and alerts still work without VESTA"). The villa holds two lists of its notify entities,
input_text.vesta_owner_targets and input_text.vesta_fm_targets (agent-src/homeassistant/packages/vesta_message.yaml),
set from the VESTA Kiosk (Settings, Villa, Who gets the messages). Every VESTA blueprint sends to them by priority (P1
both, P2 the facility manager) without the agent; the agent reads the same lists (`read`) and sends to the Telegram
chats among them (a phone app is the villa's to reach). The People list stays the source of RIGHTS (who may approve,
who is a member, each chat's language): a chat the villa lists and People does not name is sent to, in English, and
can approve nothing.

A list that cannot be read keeps what was kept; a role whose list names no Telegram chat (empty, phone apps only, an
entity since deleted) is no override: its People rows are used (policy.chats_for) — an alert always has somewhere to
go.

The villa's Telegram notify entity is registered as "<bot id>_<chat id>" (its registry unique_id); its state and
attributes carry no chat id.
"""
from __future__ import annotations

import json
import os
import re

from .message_format import ROLES

#: role → the villa's list of it (an input_text of notify entity ids, apart by ",")
HELPERS: dict[str, str] = {role: f"input_text.vesta_{role}_targets" for role in ROLES}
FILE = "villa_recipients.json"
_CHAT = re.compile(r"^\d+_(-?\d+)$")


def entities(text) -> list[str]:
    """The notify entity ids a list's text names, once each, in its order."""
    if not isinstance(text, str):
        return []
    return list(dict.fromkeys(e.strip().lower() for e in text.split(",") if e.strip().lower().startswith("notify.")))


def chat_of(entry: dict) -> int | None:
    """The Telegram chat a registry row of the villa's notify entity sends to; None for any other kind of entity."""
    if not isinstance(entry, dict) or entry.get("platform") != "telegram_bot":
        return None
    m = _CHAT.match(str(entry.get("unique_id") or ""))
    return int(m.group(1)) if m else None


def read(ha) -> dict[str, list[int]] | None:
    """{role: its Telegram chats} as the villa's lists name them now (a role's [] when its list names none); None when
    the lists cannot be read (the villa's system unreachable, the helpers not there)."""
    try:
        st = ha.states(list(HELPERS.values()))
    except Exception:  # noqa: BLE001 — unreachable: what was kept stays
        return None
    if not all(isinstance(st.get(h), dict) for h in HELPERS.values()):
        return None
    named = {role: entities(st[h].get("state")) for role, h in HELPERS.items()}
    ids = list(dict.fromkeys(e for es in named.values() for e in es))
    try:
        rows = {r.get("entity_id"): r for r in ha.entity_entries(ids)} if ids else {}
    except Exception:  # noqa: BLE001
        return None
    out = {}
    for role, es in named.items():
        chats = [chat_of(rows.get(e) or {}) for e in es]
        out[role] = list(dict.fromkeys(c for c in chats if c is not None))
    return out


def path(pack_path: str | None = None) -> str | None:
    """Where the lists are kept: beside the knowledge pack at `pack_path` (else VESTA_PACK, a skill's environment, as
    kiosk_told's settings); None when there is no pack to sit beside."""
    pack_path = pack_path if pack_path is not None else os.environ.get("VESTA_PACK", "")
    return os.path.join(os.path.dirname(pack_path), FILE) if pack_path else None


def get(pack_path: str | None = None) -> dict[str, list[int]]:
    """{role: chats} as last read; {} when never read or the file cannot be read."""
    try:
        with open(path(pack_path) or "", encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError, TypeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {r: [int(c) for c in raw[r] if isinstance(c, int) and not isinstance(c, bool)]
            for r in ROLES if isinstance(raw.get(r), list)}


def save(pack_path: str | None, value: dict[str, list[int]]) -> bool:
    """Keep `value` beside the pack; True when it changed."""
    p = path(pack_path)
    if p is None or (os.path.exists(p) and get(pack_path) == value):
        return False
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, p)
    return True


def says(value: dict[str, list[int]]) -> str:
    """The app log's words for a new reading."""
    return "The villa's lists of who gets the messages: " + "; ".join(
        f"{role} {len(value.get(role) or [])} Telegram chat(s)" for role in ROLES)
