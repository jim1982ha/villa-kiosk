"""policy.FIELDS: the one table of policy.yaml's settings — sections, words, what the forms edit, what a setup carries."""
from __future__ import annotations

import os

import yaml

from helpers import ROOT


def test_a_new_villa_turns_a_tv_on_and_off_at_once_for_a_registered_person():
    # owner, 2026-10-18: "a default service that shall be available as baseline" — no Approve button for a TV
    from vesta_agent.policy import Policy
    example = yaml.safe_load(open(os.path.join(ROOT, "starter", "config", "policy.example.yaml")))
    pol = Policy({**example, "act_enabled": True})
    for service in ("turn_on", "turn_off"):
        d = pol.check_service("media_player", service, "media_player.example_tv", {})
        assert d.allowed and d.direct, (service, d)


