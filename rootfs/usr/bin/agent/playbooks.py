"""Loading the content layer. §13.5, TASK-048.

⚠️ THE `_system` FILES ARE ALWAYS IN CONTEXT AND THE REST ARE NOT. That split is
the whole economics: ~3,500 tokens of constitution, severity, evidence, voice
and escalation sit above the cache breakpoint and cost a tenth after the first
call of the day, while twenty-five domain playbooks contribute only their
one-line descriptions until the agent asks for a body.

⚠️ SHIPPED AND LEARNED ARE TWO TREES AND ONLY ONE MAY CONTAIN A VILLA FACT.
`rootfs/usr/share/vesta/playbooks/` goes to every install and is subject to
CLAUDE.md's first hard rule — `test_playbooks.py` enforces it. `/data/vesta/` is
per-property, never redistributed, and entity ids there are CORRECT because that
is what a learned file is for. The asymmetry is why the CI rule is path-scoped
rather than global.

⚠️ AND THE VOICE FILES ARE ALTERNATIVES, NOT ADDITIONS. Loading both would tell
the model to include the entity id and to never include it, in the same breath —
the two are deliberately contradictory because a work order and a pushed alert
are different documents for different people.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional, Sequence, Tuple

from reports.log import swallow

SHIPPED_ROOT: str = "/usr/share/vesta/playbooks"
LEARNED_ROOT: str = "/data/vesta"

#: Loaded on every run, in this order. ⚠️ A LIST, NOT A DIRECTORY WALK, because
#: order is part of the prompt and a filesystem's order is not: the constitution
#: must be read before the rules it frames.
SYSTEM_ORDER: Tuple[str, ...] = ("constitution", "severity", "evidence",
                                 "escalation")

#: Chosen by audience, never both. See the module docstring.
VOICE_OF: Dict[str, str] = {"owner": "voice-owner", "facility": "voice-facility"}


def _read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return ""


def strip_front_matter(text: str) -> str:
    """The prose a model should read.

    ⚠️ FRONT MATTER IS NOT SENT. `last_confirmed` is a DATE, and a date above
    the cache breakpoint ends prompt caching for every call — silently, with the
    bill as the only symptom. It is metadata for CI and for the quarterly
    review, not for the model.
    """
    if not text.startswith("---"):
        return text.strip()
    end = text.find("\n---", 3)
    return text[end + 4:].strip() if end >= 0 else text.strip()


def system_prompt(audience: str = "owner", *,
                  root: Optional[str] = None) -> str:
    """The always-in-context half, assembled in a fixed order.

    ⚠️ RETURNS `""` WHEN NOTHING IS INSTALLED RATHER THAN RAISING. A deployment
    whose playbooks are missing must still answer — degraded, with the caller's
    own instructions only — because the alternative is an agent that cannot
    speak because a documentation file is absent.
    """
    base = os.path.join(root or SHIPPED_ROOT, "_system")
    names = list(SYSTEM_ORDER)
    voice = VOICE_OF.get(str(audience))
    if voice:
        names.append(voice)
    parts = [strip_front_matter(_read(os.path.join(base, f"{n}.md")))
             for n in names]
    return "\n\n".join(p for p in parts if p)


def descriptions(root: Optional[str] = None) -> List[Dict[str, str]]:
    """`{name, domain, description}` for every domain playbook.

    ⚠️ DESCRIPTIONS ONLY — ~35 tokens each. The body is fetched by
    `read_playbook` when the agent judges it relevant, which is what keeps
    twenty-five procedures affordable at a fifteen-minute cadence.
    """
    out: List[Dict[str, str]] = []
    base = root or SHIPPED_ROOT
    try:
        for folder, _dirs, files in os.walk(base):
            if os.path.basename(folder) == "_system":
                continue
            for name in sorted(files):
                if not name.endswith(".md") or name == "INDEX.md":
                    continue
                front = _front_matter(_read(os.path.join(folder, name)))
                if front.get("kind") == "playbook" and front.get("description"):
                    out.append({"name": front.get("name", name[:-3]),
                                "domain": front.get("domain", ""),
                                "description": front["description"]})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not list playbooks", err)
    return out


def _front_matter(text: str) -> Dict[str, str]:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    out: Dict[str, str] = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def body(name: str, *, roots: Optional[Sequence[str]] = None) -> str:
    """One playbook's prose, by name, or `""`.

    ⚠️ THE LEARNED TREE IS SEARCHED FIRST. A villa-specific procedure written
    for this property beats the shipped generic one of the same name — that is
    what "learned" means — and the shipped copy remains the fallback rather than
    being shadowed permanently.

    ⚠️ THE NAME IS NOT A PATH. `..` and separators are refused rather than
    normalised: this reads files chosen by a MODEL, and a name that can traverse
    is a model that can read `/data/reports-secrets.json`.
    """
    safe = str(name).strip()
    if not safe or "/" in safe or "\\" in safe or ".." in safe:
        return ""
    for base in roots or (LEARNED_ROOT, SHIPPED_ROOT):
        for folder, _dirs, files in os.walk(base):
            if f"{safe}.md" in files:
                return strip_front_matter(_read(os.path.join(folder, f"{safe}.md")))
    return ""
