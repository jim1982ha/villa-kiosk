"""A shipped instruction may not point at something that does not exist.

⚠️ THE DEFECT, AND I CAUSED IT TWICE IN THREE RELEASES. 2.983.0 taught the villa
document to name the property's top-level meters, and changed the constitution
to say "the Villa Document names this property's top-level meters… say you
cannot total only when the document names none". 2.984.0 then DELETED those
document sentences — correctly, they were domain-specific prose — and left the
constitution pointing at them.

So the document named none, and the rule therefore INSTRUCTED the model to
refuse. It obeyed exactly: "the metering system of this property does not have a
main meter with accessible statistical history", about a property whose recorder
returns that figure in milliseconds. Every test passed. The prose and the code
were each internally consistent and disagreed with each other.

⚠️ WHY A TEST AND NOT CARE. The playbooks are instructions to a model, so a
sentence pointing at a deleted thing does not raise, does not log, and does not
fail a build — it silently redirects behaviour. That is exactly the failure mode
a machine can check and a reader cannot.
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PLAYBOOKS = os.path.join(REPO, "rootfs", "usr", "share", "vesta", "playbooks")

#: A tool name as the playbooks write it — backticked, so ordinary prose about
#: "reading the state" is not mistaken for a claim about a tool.
TOOL = re.compile(r"`(read_[a-z_]+|call_[a-z_]+|raise_[a-z_]+|act_[a-z_]+)`")


def _shipped_text():
    for root, _dirs, files in os.walk(PLAYBOOKS):
        for name in sorted(files):
            if name.endswith(".md"):
                path = os.path.join(root, name)
                with open(path, encoding="utf-8") as fh:
                    yield os.path.relpath(path, PLAYBOOKS), fh.read()


def _known_tool_names():
    from vesta.supervise.agent.tools import ha, logs, ledger, playbook, read
    from vesta.supervise.agent import actions  # noqa: F401
    names = set()
    for module in (ha, logs, ledger, playbook, read):
        for value in vars(module).values():
            name = getattr(value, "name", None)
            if isinstance(name, str) and name:
                names.add(name)
    # Per-run tools the registry adds rather than holding: see build_tools.
    names |= {"raise_concern", "act_service", "reply"}
    return names


def test_every_tool_a_playbook_names_actually_exists():
    """⚠️ THE GUARD FOR WHAT BIT THE VILLA. An instruction naming a tool that
    was renamed or deleted sends the model somewhere that is not there, and
    nothing else in this repo would notice."""
    known = _known_tool_names()
    missing = []
    for path, text in _shipped_text():
        for name in set(TOOL.findall(text)):
            if name not in known:
                missing.append(f"{path}: `{name}`")
    assert not missing, (
        "shipped instructions name tools that do not exist: " + ", ".join(missing))


def test_no_instruction_makes_a_refusal_depend_on_the_villa_document():
    """⚠️ THE EXACT SHAPE THAT FAILED, PINNED BY ITS SHAPE RATHER THAN ITS
    WORDS. "Say you cannot X when the document does not name Y" turns any
    change to the document into a change in what the villa REFUSES — and the
    document is assembled from live data, so it can legitimately name nothing.
    A refusal must hang off a tool the model can call, never off prose that may
    or may not be there."""
    offenders = []
    for path, text in _shipped_text():
        flat = " ".join(text.lower().split())
        if "villa document" not in flat:
            continue
        for phrase in ("say you cannot", "you cannot total",
                       "then say it cannot", "report that you cannot"):
            if phrase in flat:
                offenders.append(f"{path}: {phrase!r} beside 'villa document'")
    assert not offenders, (
        "a refusal is conditioned on the villa document's contents: "
        + ", ".join(offenders))


# ── the same rule, applied to the OTHER shipped instruction ─────────────────
#: A tool name as an instruction writes it. `read_*` and `ha_*` cannot be
#: ordinary English; anything else must be backticked to count, so prose about
#: "measuring the tank" is not mistaken for a claim about the `measure` tool.
_IN_PROSE = re.compile(r"\b(read_[a-z_]+|ha_[a-z_]+)\b|`([a-z][a-z0-9_]*)`")


def _named_in(text):
    found = set()
    for bare, quoted in _IN_PROSE.findall(text):
        name = bare or quoted
        if name:
            found.add(name)
    return found


def test_the_chat_prompt_names_only_tools_chat_can_actually_reach():
    """⚠️ THE SAME DEFECT AS THE CONSTITUTION'S, THROUGH THE OTHER DOOR — AND
    IT SHIPPED. 2.987.0 fixed a rule in `constitution.md` that pointed at prose
    a later release had deleted, and this file was written to stop that class.
    It guarded the PLAYBOOKS, because playbooks were what had failed.

    The chat tier's system prompt is a shipped instruction too, and nothing
    here read it. When `ha_get_history` was withdrawn from `CHAT_UPSTREAM` in
    2.993.0 the prompt still spent a paragraph telling the model to call it —
    and worse, to "sum them", which is the arithmetic that produced every wrong
    figure. Rolled out by the call sites in front of me instead of by
    everything the rule applies to, one more time.

    ⚠️ IT CHECKS THE TOOLS CHAT IS PUBLISHED, not every tool that exists: an
    instruction naming a tool the reasoning tier has and chat does not sends
    the model somewhere it cannot go, which is the same failure wearing a
    tidier disguise.
    """
    from vesta.supervise.agent import chat as chat_mod
    from vesta.supervise.agent import registry as registry_mod

    reachable = {cls.name for cls in registry_mod.ALL_TOOLS
                 if getattr(cls, "name", "")}
    reachable |= set(registry_mod.CHAT_UPSTREAM)
    # Per-run tools the registry adds rather than holding: see build_tools.
    reachable |= {"raise_concern", "act_service", "reply"}

    named = _named_in(chat_mod.SYSTEM)
    # Only judge names that LOOK like this system's tools; the prompt also
    # backticks ordinary words and Home Assistant commands.
    candidates = {n for n in named
                  if n.startswith(("read_", "ha_")) or n in reachable
                  or n in {"measure"}}
    missing = sorted(n for n in candidates
                     if n not in reachable and "/" not in n)
    assert not missing, (
        "the chat system prompt names tools chat cannot reach: "
        + ", ".join(missing))
