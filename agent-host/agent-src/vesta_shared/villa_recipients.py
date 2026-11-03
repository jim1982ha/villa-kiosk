"""Who is who for the agent, by role: the villa's own two lists, read by the agent and kept beside the knowledge pack,
so its alerts, chases and reports go where the villa's own alerts go, and each chat listed acts with its role.

⚠️ ONE PLACE FOR "WHICH CHAT IS WHOSE" (owner, 2026-11-03: "a single file on the villa, which VESTA also reads, so
there's one place for both and alerts still work without VESTA"). The villa holds two lists of its notify entities,
input_text.vesta_owner_targets and input_text.vesta_fm_targets (agent-src/homeassistant/packages/vesta_message.yaml),
set from the VESTA Kiosk (WHERE). Every VESTA blueprint sends to them by
priority (P1 both, P2 the facility manager) without the agent; the agent reads the same lists (`read`) and sends to the
Telegram chats among them (a phone app is the villa's to reach).

⚠️ THE KIOSK'S LISTS ARE ALSO WHO MAY (owner, 2026-11-03: "isn't [the Agent's People table] redundant, since we are
already defining the same in KIOSK settings?", answered "Yes, Kiosk only"): being in a role's list gives that role's
messages AND its rights (approving, writing to the agent, a group's members acting with its role). The agent's People
card is a read-only copy of them; only each chat's language is the agent's (policy.yaml `languages:`).

A list that cannot be read keeps what was kept; never read (no file): nobody is listed, the agent answers nobody and
posts nowhere, and says so in its log (app.Vesta.start). A role whose list names no Telegram chat has none.

The villa's Telegram notify entity is registered as "<bot id>_<chat id>" (its registry unique_id); its state and
attributes carry no chat id. Its name is its state's friendly_name: the registry's name and original_name are null on
a real villa.
"""
from __future__ import annotations

import json
import os
import re

from . import agreement
from .message_format import ROLES

# ⚠️ THE LISTS AGREED IN WRITING (architecture review round 17, lead 2): which helpers hold them, how their text is read
# and where a person edits them are the agreement's `recipients` (agent-contract.json, the Kiosk's own file): the Kiosk
# edits them and this module reads them by the same rule, driven through the agreement's examples by both apps.
_AGREED = agreement.section("recipients")
#: role → the villa's list of it (an input_text of notify entity ids, apart by SEPARATOR); {} without the agreement
HELPERS: dict[str, str] = {r: str(h) for r, h in (_AGREED.get("lists") or {}).items() if r in ROLES}
SEPARATOR: str = str(_AGREED.get("separator") or ",")
DOMAIN: str = str(_AGREED.get("domain") or "notify")
#: what a list's helper holds at most (its `max` in homeassistant/packages/vesta_message.yaml)
MAX_CHARS: int = int(_AGREED.get("maxChars") or 255)
FILE = "villa_recipients.json"
#: Where a person sets the lists, in the words of the VESTA Kiosk's own page: every text that sends someone there (the
#: agent's log, its answers, its page) says it with these words
WHERE = f"the VESTA Kiosk ({_AGREED.get('where') or 'Settings'})"
_CHAT = re.compile(r"^\d+_(-?\d+)$")


def entities(text) -> list[str]:
    """The ids of DOMAIN a list's text names, once each, in its order: split on SEPARATOR, each part trimmed and
    lower-cased; anything else (another domain, a bare "notify.", an empty part) names nobody — the agreement's rule."""
    if not isinstance(text, str):
        return []
    parts = (e.strip().lower() for e in text.split(SEPARATOR))
    return list(dict.fromkeys(e for e in parts if e.startswith(f"{DOMAIN}.") and len(e) > len(DOMAIN) + 1))


def chat_of(entry: dict) -> int | None:
    """The Telegram chat a registry row of the villa's notify entity sends to; None for any other kind of entity."""
    if not isinstance(entry, dict) or entry.get("platform") != "telegram_bot":
        return None
    m = _CHAT.match(str(entry.get("unique_id") or ""))
    return int(m.group(1)) if m else None


def name_of(entity_id: str, state: dict | None) -> str:
    """A notify entity's name as the villa shows it: its friendly_name, else its id's object part ("tg_jm")."""
    attrs = (state or {}).get("attributes") if isinstance(state, dict) else None
    name = str((attrs or {}).get("friendly_name") or "").strip() if isinstance(attrs, dict) else ""
    return name or entity_id.split(".", 1)[-1]


def read(ha) -> dict[str, list[dict]] | None:
    """{role: its Telegram chats, each {"chat": id, "name": its notify entity's name}} as the villa's lists name them
    now (a role's [] when its list names none); None when the lists cannot be read (the villa's system unreachable, the
    helpers not there)."""
    if not HELPERS:
        return None                      # no agreement read: which helpers hold the lists is not known
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
        states = ha.states(ids) if ids else {}
    except Exception:  # noqa: BLE001
        return None
    out = {}
    for role, es in named.items():
        chats: dict[int, str] = {}
        for e in es:
            c = chat_of(rows.get(e) or {})
            if c is not None and c not in chats:
                chats[c] = name_of(e, states.get(e))
        out[role] = [{"chat": c, "name": n} for c, n in chats.items()]
    return out


def normal(raw) -> dict[str, list[dict]]:
    """{role: [{"chat", "name"}]} from what was kept, in either shape.

    ⚠️ AN OLDER FILE IS STILL READ (formats outlive their writer): 0.12.436 to 0.12.438 kept {role: [chat ids]}, with
    no names. Its chats are named "<role> chat" until the next reading (at the start, then every 5 minutes) writes
    the names."""
    from .message_format import ROLE_WORDS
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[dict]] = {}
    for r in ROLES:
        if not isinstance(raw.get(r), list):
            continue
        rows: dict[int, str] = {}
        for c in raw[r]:
            chat, name = (c.get("chat"), c.get("name")) if isinstance(c, dict) else (c, None)
            if isinstance(chat, int) and not isinstance(chat, bool) and chat not in rows:
                rows[chat] = str(name).strip() if isinstance(name, str) and name.strip() else f"{ROLE_WORDS[r]} chat"
        out[r] = [{"chat": c, "name": n} for c, n in rows.items()]
    return out


def path(pack_path: str | None = None) -> str | None:
    """Where the lists are kept: beside the knowledge pack at `pack_path` (else VESTA_PACK, a skill's environment, as
    kiosk_told's settings); None when there is no pack to sit beside."""
    pack_path = pack_path if pack_path is not None else os.environ.get("VESTA_PACK", "")
    return os.path.join(os.path.dirname(pack_path), FILE) if pack_path else None


def get(pack_path: str | None = None) -> dict[str, list[dict]]:
    """{role: [{"chat", "name"}]} as last read (`normal`: an older file's shape too); {} when never read or the file
    cannot be read."""
    try:
        with open(path(pack_path) or "", encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError, TypeError):
        return {}
    return normal(raw)


def save(pack_path: str | None, value: dict[str, list[dict]]) -> bool:
    """Keep `value` beside the pack; True when it changed (an older file's shape is rewritten in the new one)."""
    p = path(pack_path)
    if p is None:
        return False
    try:
        with open(p, encoding="utf-8") as f:
            if json.load(f) == value:
                return False
    except (OSError, ValueError):
        pass
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, p)
    return True


def says(value: dict[str, list[dict]]) -> str:
    """The app log's words for a new reading."""
    return "The villa's lists of who gets the messages: " + "; ".join(
        f"{role} {len(value.get(role) or [])} Telegram chat(s)" for role in ROLES)
