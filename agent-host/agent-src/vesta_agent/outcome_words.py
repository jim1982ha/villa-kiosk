"""A record's words for a person: no rule code, no leading emoji. Shared by outcome.py and tickets.py."""
from __future__ import annotations

import re

from vesta_shared.messaging import no_code


def ticket_title(s: str) -> str:
    """A Facility record's title: no rule code (messaging.no_code, the one copy), and no leading emoji or symbol (the 🚨
    of an alert)."""
    s = (s or "").strip().splitlines()[0] if (s or "").strip() else ""
    s = re.sub(r"^[^\w(\"'\[]+", "", s)          # 🚨 before the rule code, or alone
    return re.sub(r"^[^\w(\"']+", "", no_code(s)).strip()
