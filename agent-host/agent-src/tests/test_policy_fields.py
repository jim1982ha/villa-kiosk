"""policy.FIELDS: the one table of policy.yaml's settings — sections, words, what the forms edit, what a setup carries."""
from __future__ import annotations

import os
import re

import yaml

from helpers import ROOT, page_js
from vesta_agent import history, policy
from vesta_agent.ui import policy_doc, setup_copy


def test_every_section_the_starter_file_and_the_forms_know_is_in_the_table():
    example = yaml.safe_load(open(os.path.join(ROOT, "starter", "config", "policy.example.yaml")))
    assert set(example) <= policy.SECTIONS
    assert set(policy_doc.to_form("")) == set(policy_doc.FORM_KEYS) <= policy.SECTIONS


def test_the_page_writes_none_of_the_settings_names_itself():
    # architecture review, 2026-10-07: the history said "Limit per reply (US$)" and "An Approve button works for"
    # where the page said "(USD)" and "Approve buttons work for" — each kept its own copy
    js = page_js()
    rendered = ("act_enabled", "approval_ttl_minutes", "settings.reply_limit_usd", "settings.conversation_reset",
                "owner_only_entities", "excluded_entities", "siren_entity", "siren_auto_off_min")
    for path in rendered:
        assert f'"{policy.WORDS[path]}"' not in js, path
    assert "Every day at 04:00" not in js and policy.form_schema()["resets"] == policy.reset_words()


def test_the_history_and_the_setup_copy_read_the_same_table():
    assert history.WORDS is policy.WORDS
    assert history.policy_change("settings: {reply_limit_usd: 1}", "settings: {reply_limit_usd: 2}") == \
        f"{policy.WORDS['settings.reply_limit_usd']}: 1 → 2"
    assert set(setup_copy.TOOL_SECTIONS) | set(setup_copy.ACTION_SECTIONS) | {"settings"} <= policy.SECTIONS
    assert {f"settings.{k}" for k in setup_copy.AI_SETTINGS} == set(policy.setup_fields("ai"))


def test_a_new_villa_turns_a_tv_on_and_off_at_once_for_a_registered_person():
    # owner, 2026-10-18: "a default service that shall be available as baseline" — no Approve button for a TV
    from vesta_agent.policy import Policy
    example = yaml.safe_load(open(os.path.join(ROOT, "starter", "config", "policy.example.yaml")))
    pol = Policy({**example, "act_enabled": True})
    for service in ("turn_on", "turn_off"):
        d = pol.check_service("media_player", service, "media_player.example_tv", {})
        assert d.allowed and d.direct, (service, d)


def test_page_changes_say_what_changed_in_a_person_never_a_count():
    # owner, 2026-10-24: "People: 3 items → 3 items" said nothing of what changed
    before = ("people:\n  - {telegram_id: 1, name: Luc, role: fm, language: fr}\n"
              "  - {telegram_id: 2, name: Ana, role: owner, language: en}\n")
    after = ("people:\n  - {telegram_id: 1, name: Luc, role: fm, language: en}\n"
             "  - {telegram_id: 2, name: Ana, role: owner, language: en}\n"
             "  - {telegram_id: 3, name: Wayan, role: fm, language: id}\n")
    people = policy.WORDS["people"]
    assert history.policy_change(before, after) == f"{people} › Luc: language French → English; {people}: + Wayan"
    assert history.policy_change(after, before) == f"{people} › Luc: language English → French; {people}: − Wayan"
    swapped = "people:\n  - {telegram_id: 2, name: Ana, role: owner, language: en}\n" \
              "  - {telegram_id: 1, name: Luc, role: fm, language: fr}\n"
    assert history.policy_change(before, swapped) == f"{people}: order changed"


def test_a_change_recorded_as_a_count_is_said_again_from_its_texts(tmp_path):
    # the two 23:25 lines the owner saw were recorded before the fix: Page changes says them again from what was saved
    h = history.History(str(tmp_path / "h.sqlite"))
    before = "people:\n  - {telegram_id: 1, name: Luc, role: fm, language: fr}\n"
    after = "people:\n  - {telegram_id: 1, name: Luc, role: fm, language: en}\n"
    h.record("Rules", "People: 1 item → 1 item", {"kind": "policy"}, before, after)
    assert h.rows()[0]["what"] == f"{policy.WORDS['people']} › Luc: language French → English"
