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
CONFIG = ROOT / "villa-kiosk" / "config.yaml"


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


#: The kiosk's own options, which the AI layer must never disturb.
KIOSK_OPTIONS = ("guest_pin", "owner_pin", "ops_pin", "superadmin_pin",
                 "public_model_access", "evidence_retention_days",
                 "session_days", "telemetry_max_events", "pin_lockout_minutes")


def test_every_option_the_code_reads_is_declared_in_the_manifest():
    """A SUBSET, not the whole set: the kiosk owns the other half of this page."""
    missing = set(OPTION_NAMES) - set(block("options"))
    assert not missing, f"the code reads options nobody can set: {sorted(missing)}"


def test_the_schema_declares_every_one_of_them_too():
    missing = set(OPTION_NAMES) - set(block("schema"))
    assert not missing, f"no schema entry, so Supervisor will not persist: {sorted(missing)}"


def test_the_KIOSK_options_are_untouched_by_any_of_this():
    """⚠️ THE HALF THIS CHANGE COULD HAVE BROKEN. Merging the layer into the
    kiosk's manifest put ten new fields next to the passcodes; losing one of
    those would take the profile PINs with it."""
    declared = set(block("options"))
    for name in KIOSK_OPTIONS:
        assert name in declared, f"the kiosk lost `{name}`"
    assert set(block("schema")) >= set(KIOSK_OPTIONS)


def test_nothing_in_the_manifest_is_read_by_NOBODY():
    """The other direction: an option neither half reads is a setting that does
    nothing, which is the defect this file exists for."""
    unread = set(block("options")) - set(OPTION_NAMES) - set(KIOSK_OPTIONS)
    assert not unread, f"declared but read by nothing: {sorted(unread)}"


def test_the_parser_found_something_or_this_file_proves_nothing():
    assert len(block("options")) >= 19


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
    # Only the layer's own half — the kiosk's defaults are the kiosk's business.
    for name, raw in ((k, v) for k, v in declared.items() if k in OPTION_NAMES):
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
    declared = {k: v.strip('"') for k, v in block("options").items()
                if k in OPTION_NAMES}
    declared["daily_usd_limit"] = float(declared["daily_usd_limit"])
    p = tmp_path / "options.json"
    p.write_text(json.dumps(declared))
    assert load_options(p) == Options()


def test_the_manifest_gives_the_owner_a_folder_they_can_edit():
    """⚠️ TICKET 27 TELLS OWNERS TO PUT SKILLS IN 'the add-on's own config
    folder, which appears in the file editor the owner already has' — and the
    first manifest mapped no folder at all, so that folder did not exist. The
    owner found it before any test did."""
    text = CONFIG.read_text()
    assert re.search(r"^map:\s*$", text, re.M), "no `map:` block — the owner gets no folder"
    assert re.search(r"^\s+- addon_config:rw\s*$", text, re.M), \
        "the folder must be addon_config, and writable, or it does not appear in the file editor"


def test_the_manifest_still_grants_NO_supervisor_privilege():
    """⚠️ THE ESCALATION THE AI LAYER MUST NEVER COST. The kiosk legitimately
    has ingress and a port; what it must not gain by carrying the layer is
    `hassio_api` or a `hassio_role`, which would let a suggest-only component
    start, stop and install add-ons.

    Top-level keys, not a substring search: the first cut grepped raw text and
    tripped on the word INGRESS inside a comment explaining it.
    """
    keys = set(re.findall(r"^([a-z_]+):", CONFIG.read_text(), re.M))
    for forbidden in ("hassio_api", "hassio_role"):
        assert forbidden not in keys, f"`{forbidden}` must not be in this manifest"
    assert "homeassistant_api" in keys
