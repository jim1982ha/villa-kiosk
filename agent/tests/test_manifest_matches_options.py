"""The manifest an operator fills in and the dataclass the code reads.

⚠️ THE DEFECT THIS REPOSITORY HAS PRODUCED THIRTEEN TIMES, IN BOTH DIRECTIONS.
Two halves, each correct on its own: an option declared in `config.yaml` that
nothing reads is a setting that does nothing, and a field in `Options` that the
manifest never declares is a setting nobody can reach. Neither half fails a
type-check, neither shows up in a log, and both look right in review. So they
are pinned to each other here.

`tests/addon-manifest.py` holds config.yaml, its schema and its help text in
step; this is the fourth corner of that square — the code.
"""
import re
from pathlib import Path

from agent.options import OPTION_NAMES, Options, load_options

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "vesta-ai" / "config.yaml"


def block(key: str) -> dict[str, str]:
    """The `key:` mapping's immediate children. Same small parser as the gate —
    the base image's python has no PyYAML and these blocks are flat."""
    text = CONFIG.read_text()
    m = re.search(rf"^{key}:\s*$\n((?:(?:[ \t].*)?\n)*)", text, re.M)
    assert m, f"no `{key}:` block in vesta-ai/config.yaml"
    out = {}
    for line in m.group(1).splitlines():
        child = re.match(r"^  (\w+):(.*)$", line)
        if child:
            out[child.group(1)] = child.group(2).strip()
    return out


def test_the_manifest_declares_exactly_what_the_code_reads():
    assert sorted(block("options")) == sorted(OPTION_NAMES)


def test_the_schema_declares_exactly_the_same_set():
    assert sorted(block("schema")) == sorted(OPTION_NAMES)


def test_the_parser_found_something_or_this_file_proves_nothing():
    assert len(block("options")) >= 10


def test_the_two_secrets_are_declared_as_passwords():
    """A key rendered as a plain text field is one shoulder-surfed off a wall."""
    schema = block("schema")
    assert schema["anthropic_api_key"].startswith("password")
    assert schema["ha_mcp_secret"].startswith("password")


def test_every_default_in_the_manifest_matches_the_default_in_the_code():
    """⚠️ A DIVERGENT DEFAULT IS INVISIBLE. Supervisor writes its own default
    into options.json, so the code's default is only ever seen on the very first
    start — which is exactly when nobody is watching."""
    declared = block("options")
    code = Options()
    for name, raw in declared.items():
        expected = getattr(code, name)
        if isinstance(expected, float):
            assert float(raw) == expected, name
        else:
            assert raw.strip('"') == str(expected), name


def test_the_manifest_ships_no_seeded_value_for_a_target_or_an_address():
    """The hard rule, as a test: nothing here may name one property."""
    declared = block("options")
    for name in ("owner_target", "fm_target", "ha_mcp_url", "ha_mcp_secret",
                 "anthropic_api_key", "timezone"):
        assert declared[name] in ('""', "''", ""), f"{name} ships a seeded value"


def test_loading_the_manifests_own_defaults_yields_the_code_defaults(tmp_path):
    """The round trip an operator who changes nothing actually takes."""
    import json
    declared = {k: v.strip('"') for k, v in block("options").items()}
    declared["daily_usd_limit"] = float(declared["daily_usd_limit"])
    p = tmp_path / "options.json"
    p.write_text(json.dumps(declared))
    assert load_options(p) == Options()
