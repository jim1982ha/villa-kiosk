"""The agent's HTTP surface takes a config SOURCE, not a file path.

⚠️ THE HOST USED TO GIVE ITS TWO HALVES DIFFERENT THINGS. In one `main()`,
`service.start` received `_agent_config_now` — a CALLABLE, with a docstring
explaining that passing its result instead froze every kill switch at boot —
while `api.bind` received `read_json_store` plus `agent_config_file`, and six
handlers each reassembled the config from that pair. Two applied
`agent_config.view()` and four handed the raw sparse overlay downstream.

`view()` is idempotent (`reason.auto` re-applies it itself), so the split was
defence-in-depth rather than a live bug — but it was an ordering rule a caller
had to know, and four of six did not follow it.
"""

import io
import os

from conftest import REPO_ROOT, strip_prose

API = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "supervise", "api.py")
PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")


def _code(path):
    return strip_prose(io.open(path, encoding="utf-8").read())


def test_the_export_seam_names_no_filesystem():
    """⚠️ THE POINT OF THE CHANGE. Naming a path in `_Deps` made the seam demand
    that an external deployment store its agent config as a JSON document at a
    path — a filesystem invariant no handler needs to know."""
    code = _code(API)
    assert "agent_config_file" not in code
    assert "read_json_store" not in code


def test_every_handler_reads_the_config_through_one_call():
    code = _code(API)
    assert code.count("deps.config_now()") >= 6, (
        "expected the six handlers to share one config source; found %d"
        % code.count("deps.config_now()"))


def test_the_host_binds_the_same_callable_the_loops_get():
    """Not its RESULT — that is the bug the callable exists to prevent."""
    code = _code(PROXY)
    assert "config_now=_agent_config_now," in code, (
        "the routes must receive the function, not its result")
    assert "config_now=_agent_config_now()," not in code


def test_view_is_idempotent_so_one_source_can_serve_both_shapes():
    """The load-bearing fact that made a single source safe.

    Two handlers wanted `view(stored)` and four wanted `stored`. Collapsing
    them onto one viewed source is only correct because a second `view()` over
    an already-viewed config is a no-op.
    """
    from vesta.supervise.agent import config as agent_config

    raw = {"mode": "observe", "triggers": {"chat": False}}
    once = agent_config.view(raw)
    twice = agent_config.view(once)
    assert once == twice


def test_a_viewed_config_still_answers_the_mode_question_the_same_way():
    from vesta.supervise.agent import config as agent_config
    from vesta.supervise.agent import reason as agent_reason

    for raw in ({"mode": "live"}, {"mode": "observe"}, {"mode": "shadow"}, {}):
        assert agent_reason.auto(raw) == agent_reason.auto(agent_config.view(raw)), raw
