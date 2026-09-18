"""A shipped comment may not cite a symbol that does not exist.

⚠️ THE THIRD APPLICATION OF ONE RULE, AND EACH TIME I ROLLED IT OUT BY THE CALL
SITES IN FRONT OF ME. `test_playbook_pointers` was written in 2.987.0 after a
rule in `constitution.md` pointed at prose a later release had deleted — the
model obeyed the dangling pointer and told the owner their property had no main
meter. It guarded the PLAYBOOKS, because playbooks were what had failed. In
2.993.0 the same defect arrived through the chat SYSTEM PROMPT, which no test
read. This is the third door: ordinary code comments.

⚠️ AND IT FOUND ONE THAT HAD ALREADY MISLED A READER — ME, WITHIN MINUTES.
`config.py` justified halving the reasoning tier's turn cap by citing
`registry.LAST_TURN_NOTE`. No such symbol exists; the mechanism is real and is
called `LAST_TURN_NOTICE`. Reading the miss, I concluded out loud that a cap had
been cut on the strength of a safety net nobody built. It was built, it is wired
into the shared loop, and it covers every tier. A one-word-stale citation cost a
wrong conclusion about a deliberate decision — which is exactly what these
guards are for, and exactly the mistake they cannot stop me making unless they
run.

⚠️ WHY A FROZEN SET RATHER THAN A CLEAN SWEEP. Twenty-three citations are still
dangling and triaging each one is a separate job: some are renames, some name a
module that moved, and at least one may be a real claim about behaviour that no
longer holds. Freezing them stops the bleeding tonight without pretending they
were read — the same shape as `test_hard_rules`, which freezes the entity ids in
tracked source and fails on any NEW one. A name may leave this set; nothing may
join it.
"""

import importlib
import inspect
import os
import re
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TREE = os.path.join(REPO, "rootfs", "usr", "bin", "vesta")

#: A citation as this codebase writes one: `module.symbol`, backticked.
#: ⚠️ BACKTICKS ARE THE WHOLE FILTER. Prose about "the pool.pump" or a sentence
#: ending "…see config.py" is not a claim about a symbol; this house style
#: quotes real names and nothing else.
CITE = re.compile(r"`([a-z_][a-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)`")

#: Known dangling citations, frozen. ⚠️ THIS LIST MAY ONLY SHRINK.
KNOWN: frozenset = frozenset({
    "adapters/collect.py: registry.gate",
    "adapters/discovery.py: registry.gate",
    "brief/narrate/base.py: ledger.reconcile",
    "brief/pipeline.py: collect.events_since",
    "shared/analysis/base.py: registry.gate",
    "shared/analysis/modules/level_anomaly.py: registry.gate",
    "shared/analysis/modules/rule_calibration.py: registry.gate",
    "shared/analysis/modules/sensor_health.py: registry.gate",
    "shared/analysis/modules/standby_creep.py: registry.gate",
    "shared/text.py: analysis.registry",
    "supervise/agent/actions.py: outbox.escalate",
    "supervise/agent/actions.py: policy.sender_role",
    "supervise/agent/concerns.py: outbox._record_send",
    "supervise/agent/reason.py: registry.max_output_tokens",
    "supervise/agent/refs.py: contracts.PAYLOAD_ALLOWED_FIELDS",
    "supervise/agent/registry.py: redact.wrap",
    "supervise/agent/sources.py: contracts.PAYLOAD_ALLOWED_FIELDS",
    "supervise/agent/sources.py: discovery.area_count",
    "supervise/agent/tools/analysis.py: registry.gate",
    "supervise/api.py: contracts.concern_errors",
    "supervise/observe/heartbeat.py: salience.WINDOW_DAYS",
    "supervise/observe/journal.py: collect.online_since",
    "supervise/observe/journal.py: salience.WINDOW_DAYS",
})


def _resolves(target, symbol: str) -> bool:
    """⚠️ A CITATION MAY NAME A CLASS'S FIELD, NOT A MODULE ATTRIBUTE.
    `policy.max_turns` means `RunPolicy.max_turns`, and checking only the module
    reported 27 dangling where there are 24 — an instrument that cries wolf gets
    switched off, which is worse than not having it."""
    if hasattr(target, symbol):
        return True
    for value in vars(target).values():
        if inspect.isclass(value):
            if hasattr(value, symbol) or symbol in getattr(
                    value, "__annotations__", {}):
                return True
    return False


def _module_for(citing_package: str, name: str):
    """⚠️ THE CITING FILE'S OWN PACKAGE FIRST. Four packages in this tree hold a
    `registry` and three hold a `collect`; resolving globally attributes a
    citation to the wrong module and invents failures."""
    parts = citing_package.split(".")
    tries = [f"{citing_package}.{name}"]
    tries += [".".join(parts[:i]) + f".{name}" for i in range(len(parts), 0, -1)]
    tries += [f"vesta.shared.{name}", f"vesta.adapters.{name}",
              f"vesta.reports.{name}", f"vesta.supervise.agent.{name}"]
    for dotted in tries:
        try:
            return importlib.import_module(dotted)
        except Exception:  # noqa: BLE001 - not every guess is a module
            continue
    return None


def _dangling():
    found = set()
    for base, _dirs, files in os.walk(TREE):
        if "__pycache__" in base or "mypy_cache" in base:
            continue
        for name in sorted(f for f in files if f.endswith(".py")):
            path = os.path.join(base, name)
            rel = os.path.relpath(path, os.path.join(REPO, "rootfs", "usr", "bin"))
            package = rel[:-3].replace(os.sep, ".").rsplit(".", 1)[0]
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
            for mod, sym in set(CITE.findall(text)):
                if sym == "py":                 # `something.py` is a filename
                    continue
                target = _module_for(package, mod)
                if target is None:
                    continue                    # not a module here; not a claim
                if not _resolves(target, sym):
                    short = os.path.relpath(path, os.path.join(
                        REPO, "rootfs", "usr", "bin", "vesta"))
                    found.add(f"{short}: {mod}.{sym}")
    return found


def test_no_NEW_comment_cites_a_symbol_that_does_not_exist():
    """⚠️ THE GUARD. A comment is how the next reader decides what the code
    does; one naming something that is not there sends them somewhere it is
    not, and nothing in a build notices."""
    new = sorted(_dangling() - KNOWN)
    assert not new, (
        "a shipped comment cites a symbol that does not exist: "
        + "; ".join(new))


def test_the_frozen_set_only_shrinks():
    """⚠️ OR THE LIST BECOMES A PLACE TO PUT NEW MISTAKES. Anything repaired
    must leave `KNOWN`, and a stale entry left behind would quietly widen the
    allowance — the same reason `test_hard_rules` refuses a pin for an id that
    is no longer in the tree."""
    stale = sorted(KNOWN - _dangling())
    assert not stale, (
        "these citations now resolve and must be deleted from KNOWN: "
        + "; ".join(stale))


def test_the_scan_actually_reads_something():
    """⚠️ A SWEEP THAT MATCHES NOTHING PASSES PERFECTLY. If the house style ever
    stops backticking names, every assertion above goes green while measuring
    an empty set."""
    assert len(KNOWN) >= 20, "the frozen set has collapsed; is the scan working?"


def test_the_citation_that_misled_me_now_resolves():
    """⚠️ NAMED, BECAUSE IT IS THE WHOLE ARGUMENT FOR THIS FILE. `config.py`
    justifies the reasoning tier's turn cap by pointing at the mechanism that
    makes a truncated run degrade instead of vanish. The pointer was one word
    stale and I read the miss as the mechanism being absent."""
    from vesta.supervise.agent import config as config_mod
    from vesta.supervise.agent import registry as registry_mod
    from conftest import code_of
    assert hasattr(registry_mod, "LAST_TURN_NOTICE")
    assert "registry.LAST_TURN_NOTICE" in open(
        config_mod.__file__, encoding="utf-8").read()
