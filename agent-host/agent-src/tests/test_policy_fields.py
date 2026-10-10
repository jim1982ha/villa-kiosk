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
    assert "Every day at 04:00" not in js and policy.form_schema()["resets"] == policy.RESET_WORDS


def test_the_history_and_the_setup_copy_read_the_same_table():
    assert history.WORDS is policy.WORDS
    assert history.policy_change("settings: {reply_limit_usd: 1}", "settings: {reply_limit_usd: 2}") == \
        f"{policy.WORDS['settings.reply_limit_usd']}: 1 → 2"
    assert set(setup_copy.TOOL_SECTIONS) | set(setup_copy.ACTION_SECTIONS) | {"settings"} <= policy.SECTIONS
    assert {f"settings.{k}" for k in setup_copy.AI_SETTINGS} == set(policy.setup_fields("ai"))
