"""The one isolation fixture, and what it exists to end.

⚠️ TWENTY-ONE FILES HAND-ROLLED `_isolated`, AND THEY ISOLATED DIFFERENT
SUBSETS. `test_agent_escalation_wiring` repoints seven constants;
`test_agent_outbox` repoints ONE — so `audit.AUDIT_FILE` and `usage.USAGE_PATH`
stayed at their `/data/vesta/...` defaults while that file exercised the Chase
sweep and the delivery path. "Which stores must be repointed before this module
writes" is part of the interface, and it had 21 conflicting statements and no
home.

The fixture derives the set the way `store._repoint` does, so a store added
tomorrow is isolated everywhere the day it is added.
"""

import os

from conftest import REPO_ROOT


def test_it_isolates_every_store_a_module_might_write(isolated_stores):
    from vesta.adapters import usage
    from vesta.supervise.agent import audit, budget, concerns, flagtypes
    from vesta.supervise.observe import journal

    for path in (concerns.CONCERNS_FILE, audit.AUDIT_FILE, budget.BUDGET_FILE,
                 usage.USAGE_PATH, flagtypes.FLAG_TYPES_FILE,
                 journal.JOURNAL_FILE):
        assert str(isolated_stores) in path, (
            "%s still points into the real /data" % path)


def test_nothing_it_repointed_still_names_the_real_root(isolated_stores):
    """⚠️ THE WHOLE POINT. A subset that looks isolated is worse than none: the
    test passes locally and writes to the operator's own villa on a machine
    where /data exists."""
    import sys

    from vesta.adapters import store as store_mod

    leaked = []
    for name, module in list(sys.modules.items()):
        if not (name == "vesta" or name.startswith("vesta.")) or module is None:
            continue
        for attr, value in list(vars(module).items()):
            if attr.endswith(store_mod._PATH_SUFFIXES) and isinstance(value, str) \
                    and value.startswith("/data"):
                leaked.append("%s.%s" % (name, attr))
    assert not leaked, "these stores were not isolated: %s" % sorted(leaked)


def test_it_is_derived_rather_than_listed():
    """A hand-kept list is what produced 21 different answers."""
    import conftest

    from conftest import code_of

    code = code_of(conftest.isolated_stores)
    assert "_PATH_SUFFIXES" in code, (
        "the fixture enumerates stores again instead of deriving them")
    assert "CONCERNS_FILE" not in code, (
        "the fixture names a specific store, so a new one will be missed")
