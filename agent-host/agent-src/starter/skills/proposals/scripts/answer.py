#!/usr/bin/env python3
"""proposals: the owner's answer to a proposal ("VESTA suggests"), by its number.

  answer.py answer --number 3 --choice accept|later|ignore [--store S]

Prints JSON {"text": …}: what the AI says, word for word; a refusal goes to stderr, exit 1. The number is the store's
own (proposals.id), the one every report prints — never a place in a list. Who asks is the agent's to say
(VESTA_ASKER), never an argument the AI writes: "owner" records, "page" (the page's Offline Test) checks and records
nothing, anyone else is refused.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from vesta_shared import script

#: an answer and the state it leaves the proposal in — "later" keeps it open: on the next report again
STATUS = {"accept": "accepted", "later": "open", "ignore": "ignored"}
SAID = {"accept": "accepted.", "later": "kept for later: it is on the next report again.",
        "ignore": "ignored: it will not be suggested again."}
WOULD = {"accept": "accepted", "later": "kept for later", "ignore": "ignored"}
HOW = "Write /proposal accept 3, /proposal later 3 or /proposal ignore 3, with the number on the report."


def answer(store, number: str, choice: str, asker: str) -> tuple[bool, str]:
    """(answered, what to say). ⚠️ THE OWNER ONLY (owner, 2026-10-13); answering again changes the answer. A test from
    the page checks the same and records nothing (owner, 2026-10-13: a test must never answer a proposal)."""
    test = asker == "page"
    if asker != "owner" and not test:
        return False, "Only the owner answers proposals."
    if not str(number).isdigit():
        return False, f"Which proposal? {HOW}"
    p = next((p for p in store.proposals(None) if p["id"] == int(number)), None)
    if p is None:
        return False, f"There is no proposal {number}. {HOW}"
    before, now = p.get("status"), STATUS[choice]
    was = f" (it was {before})" if before != now and before in ("accepted", "ignored") else ""
    if test:
        return True, f"Test: Proposal {p['id']}, {p['title']}, would be {WOULD[choice]}{was}. Nothing was recorded."
    store.decide_proposal(p["id"], now)
    return True, f"Proposal {p['id']}, {p['title']}: {SAID[choice]}{was}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=("answer",))
    ap.add_argument("--number", default="")
    ap.add_argument("--choice", choices=tuple(STATUS), required=True)
    script.arguments(ap)
    a = ap.parse_args(argv)
    ok, text = answer(script.Context.of(a).store, a.number, a.choice, os.environ.get("VESTA_ASKER", ""))
    if not ok:
        print(text, file=sys.stderr)
        return 1
    print(json.dumps({"text": text}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
