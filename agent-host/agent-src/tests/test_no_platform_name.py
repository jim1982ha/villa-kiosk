"""What a person reads from the VESTA Agent never names the platform underneath (owner, 2026-10-15: "never mention
Home Assistant" — the Kiosk's screens first, then Telegram). Every string literal of the files whose words reach a
person — Telegram messages, the Kiosk's fault notes, report pages, answers to a press or a request, the model's own
rules to speak by — is read with the code's docstrings and its log lines left out; "Home Assistant" or "HA" in one
fails, naming file and line. A rule FOR the model about Home Assistant (its data, its tools) is not text a person reads:
the instructions are checked only on what they tell the model to SAY."""
from __future__ import annotations

import ast
import os
import re

import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPOKEN = [
    "starter/skills/alert-desk/scripts/desk.py", "starter/skills/preventive-maintenance/scripts/recheck.py",
    "starter/skills/villa-concierge/scripts/voice.py", "starter/skills/investigate/scripts/investigation_facts.py",
    "starter/skills/roi-energy/scripts/proposals.py", "starter/skills/roi-energy/scripts/energy_period.py",
    "vesta_agent/actions.py", "vesta_agent/api_errors.py",
    "vesta_shared/kiosk_words.py", "vesta_shared/result.py", "vesta_agent/notice.py", "vesta_agent/layout.py",
]
NAMED = re.compile(r"Home\s+Assistant|\bHA\b")
LOGS = {"log", "logger", "debug", "info", "warning", "error", "exception", "critical"}


def _spoken_strings(path: str):
    tree = ast.parse(open(os.path.join(ROOT, path), encoding="utf-8").read())
    skip = set()
    for node in ast.walk(tree):
        # docstrings
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body \
                and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant):
            skip.add(id(node.body[0].value))
        # log lines: log.info("…"), state.log("…")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in LOGS:
            for sub in ast.walk(node):
                skip.add(id(sub))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip:
            yield node.lineno, node.value


def test_no_text_a_person_reads_names_home_assistant():
    hits = [f"{p}:{line}: {text[:60]!r}" for p in SPOKEN for line, text in _spoken_strings(p) if NAMED.search(text)]
    assert hits == [], hits


def test_the_sent_yaml_texts_and_the_models_speaking_rule():
    rules = yaml.safe_load(open(os.path.join(ROOT, "starter/skills/alert-desk/rules.yaml"), encoding="utf-8"))
    checks = [r.get("check") or "" for r in rules["routes"]]
    words = yaml.safe_load(open(os.path.join(ROOT, "starter/skills/reports/reports.yaml"), encoding="utf-8"))
    said = checks + [str(v) for v in (words.get("incident_words") or {}).values()]
    assert not [s for s in said if NAMED.search(s)]
    rules_text = open(os.path.join(ROOT, "starter/config/instructions.md"), encoding="utf-8").read()
    assert 'Never name Home Assistant (or HA) to a person: say "the villa\'s system".' in rules_text
    assert "say which Home Assistant helper" not in rules_text
