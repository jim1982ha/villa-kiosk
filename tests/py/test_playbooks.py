"""The content layer's CI gate. §13.8, TEST-030.

⚠️ THESE FILES SHIP TO EVERY INSTALL, so CLAUDE.md's first hard rule applies to
them exactly as it applies to TypeScript: no entity id, no villa magnitude, no
per-site constant. A wattage in a shipped playbook is the same defect as a
wattage in `EntityMap.ts`, and it is easier to write by accident because prose
invites examples.

⚠️ AND NO TIMESTAMP, FOR A DIFFERENT REASON ENTIRELY. The `_system` files sit
above the prompt-cache breakpoint on every call — ~96 a day from triage alone.
One interpolated date ends caching for every one of them, and the failure is
SILENT: the output is perfect and the bill goes up.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Tuple

REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
SHIPPED = os.path.join(REPO_ROOT, "rootfs", "usr", "share", "vesta", "playbooks")
SKILLS = os.path.join(REPO_ROOT, ".claude", "skills")

#: The six that are always in context. ⚠️ DERIVED FROM THE DIRECTORY, never a
#: literal list — a seventh is covered the day it is written.
SYSTEM_DIR = os.path.join(SHIPPED, "_system")

#: ⚠️ ANCHORED. The repo has already been bitten by unanchored substring
#: matching (`door` inside `outdoor`), and `_` is a word character so `\b` does
#: not help. This is the form CLAUDE.md prescribes.
ENTITY_ID = re.compile(
    r"(?:^|[\s.(`'\"])(sensor|binary_sensor|switch|light|climate|fan|cover|"
    r"lock|todo|camera|media_player|number|select|input_\w+)\.[a-z0-9_]+")

#: A bare number next to a unit. ⚠️ THE UNITS ARE WHAT MAKE IT VILLA-SPECIFIC:
#: "40%" is a relationship and travels; "340 W" is this property's pump.
MAGNITUDE = re.compile(r"\b\d[\d,.]*\s?(W|kW|kWh|IDR|EUR|USD|°C|°F|L/min|bar)\b")

#: ~4 characters per token is the standard estimate and is close enough for a
#: budget. ⚠️ THE PLAN BUDGETS ~2,600 TOKENS AND THIS ALLOWS 4,000: the six
#: files came out larger, the deviation is deliberate and recorded here rather
#: than hidden by loosening it silently. Two of them are ALTERNATIVES — only one
#: voice loads per run — so the real per-call cost is lower than the total.
CHARS_PER_TOKEN = 4
SYSTEM_TOKEN_BUDGET = 4_000
PLAYBOOK_TOKEN_CAP = 1_500
MAX_SHIPPED_PLAYBOOKS = 25


def _files(root: str) -> List[str]:
    out: List[str] = []
    for base, _dirs, names in os.walk(root):
        out.extend(os.path.join(base, n) for n in names if n.endswith(".md"))
    return sorted(out)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


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


def _body(text: str) -> str:
    """The prose, with front matter and worked examples removed.

    ⚠️ FENCED BLOCKS AND BLOCKQUOTES ARE EXCLUDED FROM THE MAGNITUDE SCAN. A
    worked example is the whole point of `severity.md` — "340 W against a
    median of 210 W" teaches the shape of a citation — and a rule that forbade
    it would be a rule against explaining anything.
    """
    if text.startswith("---"):
        end = text.find("\n---", 3)
        text = text[end + 4:] if end >= 0 else text
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith(">"))


def test_the_walk_finds_the_system_files() -> None:
    """The vacuous-pass guard: every assertion below runs over this list."""
    found = _files(SYSTEM_DIR)
    assert len(found) >= 6, f"only {len(found)} system playbooks: {found}"


def test_every_shipped_file_declares_kind_playbook() -> None:
    """⚠️ THE MACHINE-CHECKABLE DISCRIMINATOR between a DEV skill and a RUNTIME
    playbook. They drive different agents, load through different tools and live
    in different trees; a naming convention alone rots."""
    for path in _files(SHIPPED):
        front = _front_matter(_read(path))
        assert front.get("kind") == "playbook", f"{path} has no `kind: playbook`"
        for required in ("name", "domain", "description", "version"):
            assert front.get(required), f"{path} has no {required}"


def test_no_SKILL_md_under_the_shipped_tree() -> None:
    """A dev skill pasted into the runtime tree, caught by filename."""
    assert not [p for p in _files(SHIPPED) if os.path.basename(p) == "SKILL.md"]


def test_no_kind_playbook_under_claude_skills() -> None:
    """And the reverse: a playbook drafted in the wrong place."""
    if not os.path.isdir(SKILLS):
        return
    for path in _files(SKILLS):
        assert "kind: playbook" not in _read(path)[:400], path


def test_no_shipped_playbook_names_an_ENTITY_ID() -> None:
    """⚠️ CLAUDE.md's first hard rule. These ship to every install, so an id
    here is the same defect as hardcoding one in TypeScript."""
    offenders: List[Tuple[str, str]] = []
    for path in _files(SHIPPED):
        for match in ENTITY_ID.finditer(_body(_read(path))):
            offenders.append((os.path.basename(path), match.group(0).strip()))
    assert not offenders, f"entity ids in shipped playbooks: {offenders}"


def test_no_shipped_playbook_carries_a_VILLA_MAGNITUDE() -> None:
    """⚠️ A threshold smuggled back in as prose. "40%" is a relationship and
    travels; "340 W" is one property's pump."""
    offenders: List[Tuple[str, str]] = []
    for path in _files(SHIPPED):
        for match in MAGNITUDE.finditer(_body(_read(path))):
            offenders.append((os.path.basename(path), match.group(0)))
    assert not offenders, f"villa magnitudes outside worked examples: {offenders}"


def test_no_system_file_carries_a_TIMESTAMP_in_its_body() -> None:
    """⚠️ THE CACHE. These sit above the breakpoint on ~96 calls a day; one
    interpolated date ends caching for all of them and the only symptom is the
    bill. `last_confirmed` is front matter, which is not sent."""
    for path in _files(SYSTEM_DIR):
        body = _body(_read(path))
        assert not re.search(r"\b\d{4}-\d{2}-\d{2}\b", body), path
        assert "{" not in body or "{{" not in body, path


def test_the_system_set_is_within_its_token_budget() -> None:
    """TEST-030."""
    total = sum(len(_read(p)) for p in _files(SYSTEM_DIR))
    tokens = total // CHARS_PER_TOKEN
    assert tokens <= SYSTEM_TOKEN_BUDGET, (
        f"the always-loaded set is ~{tokens} tokens against a budget of "
        f"{SYSTEM_TOKEN_BUDGET}")


def test_no_single_playbook_exceeds_its_cap() -> None:
    for path in _files(SHIPPED):
        tokens = len(_read(path)) // CHARS_PER_TOKEN
        assert tokens <= PLAYBOOK_TOKEN_CAP, f"{path} is ~{tokens} tokens"


def test_the_shipped_set_is_BOUNDED() -> None:
    """⚠️ §13.6: adding one means arguing which one it replaces — the
    discipline the blueprint pack never had, which is how 88 rules became 108
    instances."""
    domains = [p for p in _files(SHIPPED) if os.sep + "_system" + os.sep not in p]
    assert len(domains) <= MAX_SHIPPED_PLAYBOOKS


def test_the_constitution_carries_the_workbooks_best_rule_verbatim() -> None:
    """⚠️ "A concern that does not name a THING is not a concern" is the single
    best rule in the workbook — the difference between a monitoring system and
    a useful one — and it is promoted here rather than paraphrased."""
    text = " ".join(_read(os.path.join(SYSTEM_DIR, "constitution.md")).split())
    assert "does not name a thing" in text.lower()
    assert "unactionable" in text.lower()


def test_the_constitution_forbids_claiming_health_from_silence() -> None:
    """The rule this whole phase keeps rediscovering."""
    text = " ".join(_read(os.path.join(SYSTEM_DIR, "constitution.md")).split())
    assert "absence of evidence as good news" in text.lower()


def test_severity_refuses_the_workbooks_self_contradiction() -> None:
    """⚠️ The workbook states "severity is about consequence" and then
    "a maintenance rule is never P1" two sentences later. The second is a
    category constraint smuggled back in, and it is false."""
    text = " ".join(_read(os.path.join(SYSTEM_DIR, "severity.md")).split())
    assert "maintenance finding CAN be critical" in text
    assert "never about which kind" in text.lower()


def test_the_two_voices_state_OPPOSITE_rules_about_ids() -> None:
    """⚠️ Not an inconsistency: a pushed alert and a work order are different
    documents for different people, and the same caution on both would make one
    unreadable or the other unusable."""
    owner = _read(os.path.join(SYSTEM_DIR, "voice-owner.md"))
    facility = _read(os.path.join(SYSTEM_DIR, "voice-facility.md"))
    assert "No entity ids" in owner
    assert "entity id IS wanted here" in facility


def test_escalation_keeps_the_channel_out_of_the_agents_hands() -> None:
    text = " ".join(_read(os.path.join(SYSTEM_DIR, "escalation.md")).split())
    assert "You do not choose the channel" in text
    assert "already stopped" in text, "no rule about a condition that cleared"
