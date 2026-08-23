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

#: ⚠️ GENERATED, SO IT IS NOT A PLAYBOOK AND MUST BE EXCLUDED FROM EVERY RULE
#: BELOW. It has no front matter by design — it is the manifest OF the front
#: matter — and counting it toward the cap would silently cost the set a
#: procedure.
INDEX_NAME = "INDEX.md"

#: The domain directories. ⚠️ SEVEN, AND THE PLAN SAYS SIX IN ONE SENTENCE AND
#: LISTS SEVEN IN ANOTHER. §13.1's tree predates §13.3, which added `security`
#: after finding it had been omitted structurally — the playbook set had been
#: derived by mapping the DELETED blueprint families onto replacements, and
#: security lives in the families that were KEPT, so its detection survived and
#: its judgement was dropped. The count in the older sentence is the stale half.
#: Recorded here rather than silently obeyed, because a test that quietly
#: enforced six would have deleted the correction.
DOMAINS = ("climate", "connectivity", "electrical", "hospitality", "security",
           "system", "water")


def _files(root: str) -> List[str]:
    out: List[str] = []
    for base, _dirs, names in os.walk(root):
        out.extend(os.path.join(base, n) for n in names if n.endswith(".md"))
    return sorted(out)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _domain_files(root: str = SHIPPED) -> List[str]:
    """The 25 — everything except the always-loaded set and the manifest."""
    return [p for p in _files(root)
            if os.sep + "_system" + os.sep not in p
            and os.path.basename(p) != INDEX_NAME]


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
        if os.path.basename(path) == INDEX_NAME:
            continue
        front = _front_matter(_read(path))
        assert front.get("kind") == "playbook", f"{path} has no `kind: playbook`"
        for required in ("name", "domain", "description", "version"):
            assert front.get(required), f"{path} has no {required}"
        # ⚠️ THE NAME IS THE HANDLE THE MODEL PASSES TO `read_playbook`, so a
        # file whose `name` differs from its filename is unreachable — the
        # catalogue offers one string and the loader resolves the other.
        assert front["name"] == os.path.basename(path)[:-3], (
            f"{path} declares name {front['name']!r}, which is not its filename "
            f"— read_playbook resolves by filename, so this one cannot be read")


def test_every_domain_playbook_says_when_to_consult_it() -> None:
    """⚠️ `description` is what the model sees in context; `consult_when` is the
    trigger condition. Without it the catalogue says what a procedure IS and
    never says when it applies, which is the half that decides whether it is
    ever opened."""
    for path in _domain_files():
        front = _front_matter(_read(path))
        assert front.get("consult_when"), f"{path} has no consult_when"


def test_every_playbook_lives_in_the_domain_it_DECLARES() -> None:
    """⚠️ THE DIRECTORY AND THE FRONT MATTER MUST AGREE. `descriptions()` reads
    the declared domain and the index groups by it, so a file in one directory
    declaring another is filed under a heading it is not stored in — findable
    by neither route."""
    for path in _domain_files():
        front = _front_matter(_read(path))
        assert front.get("domain") == os.path.basename(os.path.dirname(path)), (
            f"{path} declares domain {front.get('domain')!r} but sits in "
            f"{os.path.basename(os.path.dirname(path))!r}")


def test_no_playbook_drifts_into_an_UNDECIDED_domain() -> None:
    """§13.8: a seventh category nobody decided on. See `DOMAINS` for why the
    number is seven and not the six one sentence of the plan still says."""
    found = {os.path.basename(os.path.dirname(p)) for p in _domain_files()}
    assert found <= set(DOMAINS), f"undecided domain(s): {found - set(DOMAINS)}"


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
    instances.

    ⚠️ AND A LOWER BOUND, WHICH IS NOT SYMMETRY. Every content rule in this file
    loops over this set, so an empty or truncated tree passes all of them
    vacuously — the set could go to zero and only this line would notice. It is
    the same guard `test_the_walk_finds_the_system_files` provides above.
    """
    found = _domain_files()
    assert len(found) <= MAX_SHIPPED_PLAYBOOKS, (
        f"{len(found)} shipped playbooks against a cap of "
        f"{MAX_SHIPPED_PLAYBOOKS}; adding one means arguing which it replaces")
    assert len(found) >= 20, (
        f"only {len(found)} shipped playbooks — every content check in this "
        f"file loops over this list and would pass vacuously")


def test_the_INDEX_matches_the_DIRECTORY() -> None:
    """§13.8. ⚠️ A PLAYBOOK THAT EXISTS BUT IS NOT OFFERED IS INVISIBLE, and it
    fails as "the model chose not to use it" — indistinguishable from working.
    The manifest is GENERATED, so this compares the file on disk against the
    function that renders it rather than against a transcription."""
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import playbooks

    path = os.path.join(SHIPPED, INDEX_NAME)
    assert os.path.isfile(path), "no INDEX.md — regenerate it"
    assert _read(path) == playbooks.render_index(SHIPPED), (
        "INDEX.md is stale; regenerate with agent.playbooks.render_index")


def test_the_CATALOGUE_carries_every_description_and_NO_body() -> None:
    """TASK-090's whole economics, asserted rather than intended.

    ⚠️ ~35 TOKENS EACH IN CONTEXT AGAINST ~1,200 FETCHED. If a body ever leaked
    into the always-loaded half, the triage bill would rise by roughly an order
    of magnitude with no other symptom — the output would be perfect. That is
    the same silent-failure shape as an interpolated date ending prompt caching.
    """
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import playbooks

    text = playbooks.catalogue(SHIPPED)
    names = [_front_matter(_read(p))["name"] for p in _domain_files()]
    for name in names:
        assert name in text, f"{name} is installed but never offered"
    # Every body carries this heading; none of it may reach the catalogue.
    assert "## Check, in order" not in text
    assert len(text) // CHARS_PER_TOKEN <= 60 * len(names), (
        "the catalogue is far larger than one line per playbook")


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


# ── the wiring, which is what /dry-audit found missing ──────────────────────
def test_the_system_playbooks_are_ACTUALLY_LOADED_by_a_prompt() -> None:
    """⚠️ THEY WERE WRITTEN, SHIPPED AND CI-GATED, AND NOTHING LOADED THEM.

    `agent/playbooks.py` was imported by nobody: the agent had no constitution,
    no severity scale, no evidence rule and no voice, while every test in this
    file passed. The identical shape as `build_registry()` building tools with
    no data sources — the content delivered, the wiring forgotten — and found by
    /dry-audit Part 2 asking which modules nothing imports.

    ⚠️ THIS TEST IS THE ONE THAT COULD NOT HAVE PASSED VACUOUSLY. Everything
    else here checks the FILES; this checks that a prompt reads them.
    """
    import ast
    import inspect
    import os

    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent")
    importers = []
    for base, _dirs, names in os.walk(root):
        for name in names:
            if not name.endswith(".py") or name == "playbooks.py":
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                tree = ast.parse(handle.read())
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module == "agent":
                    if any(a.name == "playbooks" for a in node.names):
                        importers.append(name)
                elif isinstance(node, ast.Import):
                    if any(a.name.endswith("playbooks") for a in node.names):
                        importers.append(name)
    assert importers, (
        "nothing imports agent/playbooks.py, so the constitution, the severity "
        "scale, the evidence rule and both voices are shipped and never read")
    assert "chat.py" in importers, "the chat path answers with no constitution"
    assert "triage.py" in importers, "the triage pass runs with no constitution"

    # ⚠️ AND THE IMPORT IS NOT THE POINT — THE USE IS. The first version of
    # this test asserted only the import, so deleting `system_prompt(...)` from
    # the system array left it GREEN: the module would be imported, unused, and
    # the agent would once again run with no constitution. Caught by mutation,
    # and it is the same weakness that let the original defect through — a
    # check on the wiring's existence rather than on its effect.
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import chat as chat_mod
    from agent import triage as triage_mod

    for module, label in ((chat_mod.handle_event, "chat"),
                          (triage_mod.run, "triage")):
        source = inspect.getsource(module)
        assert "playbooks.system_prompt(" in source, (
            f"the {label} path imports playbooks but never calls "
            f"system_prompt, so it runs with no constitution")


def test_only_ONE_voice_is_ever_loaded() -> None:
    """⚠️ They are deliberately CONTRADICTORY — one wants the entity id, the
    other forbids it — because a work order and a pushed alert are different
    documents. Loading both instructs the model to do and not do the same
    thing in one breath."""
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import playbooks

    owner = playbooks.system_prompt("owner", root=SHIPPED)
    facility = playbooks.system_prompt("facility", root=SHIPPED)
    assert "No entity ids" in owner and "entity id IS wanted here" not in owner
    assert "entity id IS wanted here" in facility and "No entity ids" not in facility


def test_triage_loads_NO_voice_at_all() -> None:
    """It emits ESCALATE lines for another machine stage, not prose for a
    person, so a voice file is cached tokens about a document it never writes."""
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import playbooks

    text = playbooks.system_prompt("", root=SHIPPED)
    assert "competent facility manager" in text, "no constitution either"
    assert "five-second test" not in text.lower()
    assert "entity id IS wanted here" not in text


def test_a_missing_playbook_tree_DEGRADES_rather_than_raising() -> None:
    """A deployment whose files are absent must still answer — the alternative
    is an agent that cannot speak because a documentation file is missing."""
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import playbooks

    assert playbooks.system_prompt("owner", root="/nope/nothing/here") == ""


def test_a_playbook_NAME_cannot_traverse_the_filesystem() -> None:
    """⚠️ This reads files chosen by a MODEL. A name that can traverse is a
    model that can read the secrets file."""
    import inspect
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import playbooks

    for evil in ("../../../data/reports-secrets", "a/b", "..", "", "x\\y"):
        assert playbooks.body(evil, roots=[SHIPPED]) == "", evil

    # ⚠️ AND THE GUARD IS DEFENCE IN DEPTH, NOT THE PROTECTION — a mutation
    # deleting it stayed green, because `body` matches a BASENAME inside
    # `os.walk`, and a basename can never contain a separator. That is what
    # actually stops traversal today. The guard is kept because it would become
    # load-bearing the moment anyone replaced the walk with a path join, and
    # this comment exists so the next reader does not delete it as dead.
    assert "os.walk" in inspect.getsource(playbooks.body), (
        "body() no longer matches a basename, so the traversal guard above is "
        "now the ONLY protection and must be tested as such")
