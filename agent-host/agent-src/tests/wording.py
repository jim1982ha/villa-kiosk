"""THE list of wording rules every text a person reads keeps — one line each (owner's rules, 2026-10-15 to 10-22).

⚠️ EACH RULE WAS A HAND SWEEP (architecture review, 2026-10-22): "never Home Assistant", "no ' — '", "an automation,
never a rule" each took a pass over some forty files, and each pass missed some. A new wording rule is now one line in
BANNED: tests/test_wording.py reads it over every shipped text a person reads, and tests/conftest.py over every message
the Telegram fake shows in the whole suite (and every button and toast).

Text meant only for the AI (its instructions, a skill's body, the lines a script hands the AI) is not read here; a
person-read file that carries some is exempt only by name, in test_wording.FOR_THE_AI, with its reason.
"""
from __future__ import annotations

import re

#: what is banned → the pattern. "rule" is the agent's own (its Rules tab, "the agent's rules", "Agent rules"): a rule of
#: the villa's system is an "automation". A lowercase "rule" after "agent's (own)", "Agent" or "agent" is the agent's;
#: "rule out" is a verb.
BANNED = {
    "the platform's name (say \"the villa's system\")": re.compile(r"Home\s+Assistant|\bHA\b"),
    "a long dash (write a comma)": re.compile(r" — "),
    "an automation called a rule (say \"automation\")": re.compile(r"(?<!agent's )(?<!agent's own )(?<!Agent )(?<!agent )\brules?\b(?![.\w])(?! out)"),
}


def broken(text: str) -> list[str]:
    """The wording rules `text` breaks (their names), none when it keeps them all."""
    return [name for name, pattern in BANNED.items() if pattern.search(str(text or ""))]
