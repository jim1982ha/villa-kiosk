"""Front matter, parsed and rendered in ONE place. §13.4.

⚠️ TWO CONTENT STORES SPEAK THIS FORMAT AND A THIRD WILL. Shipped playbooks
carry `kind`/`name`/`domain`/`description`; villa memories carry `subject_key`/
`source`/`review_after`/`state`. They are different vocabularies over the same
syntax, and writing the syntax twice is how the two would drift — one accepting
a trailing space the other rejects, on files a MODEL selects and a person edits.

⚠️ FRONT MATTER IS METADATA AND IS NEVER SENT. `last_confirmed` and
`review_after` are DATES, and a date above the prompt-cache breakpoint ends
caching for every call that day — silently, with the bill as the only symptom.
`strip_front_matter` is what every prompt path calls; parsing it is for CI, for
the expiry sweep and for the review queue.

⚠️ `tests/py/test_playbooks.py` DELIBERATELY CARRIES ITS OWN PARSER AND MUST
KEEP IT. A gate that parsed with the implementation it audits cannot catch the
parser being wrong — it would agree with itself on a malformed file forever.
That duplication is the exception /dry-audit is told to leave alone.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

MARKER = "---"


def front_matter(text: str) -> Dict[str, str]:
    """The block above the second `---`, as flat strings.

    ⚠️ FLAT AND STRINGY ON PURPOSE — no YAML, no nesting, no type inference.
    This parses files a model can write and a person can hand-edit, and a real
    YAML parser would let one of them express a structure the other half of the
    system has no rule for. Callers coerce what they need.
    """
    if not text.startswith(MARKER):
        return {}
    end = text.find("\n" + MARKER, len(MARKER))
    if end < 0:
        return {}
    out: Dict[str, str] = {}
    for line in text[len(MARKER):end].splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def strip_front_matter(text: str) -> str:
    """The prose a model should read, with the metadata removed."""
    if not text.startswith(MARKER):
        return text.strip()
    end = text.find("\n" + MARKER, len(MARKER))
    return text[end + len(MARKER) + 2:].strip() if end >= 0 else text.strip()


def render(front: Mapping[str, Any], body: str) -> str:
    """A file, from its metadata and its prose.

    ⚠️ KEY ORDER IS THE CALLER'S, NOT SORTED. These files are read by people,
    and `subject_key` above `claim` above `state` reads as a record; alphabetical
    order reads as a dump. `dict` preserves insertion order, so the caller's
    literal IS the layout.
    """
    lines = [MARKER]
    lines += [f"{k}: {v}" for k, v in front.items()]
    lines += [MARKER, ""]
    return "\n".join(lines) + str(body).strip() + "\n"
