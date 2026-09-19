"""The two halves of the layer's settings, pinned to each other.

⚠️ THE SEAM MOVED, AND THE DEFECT DID NOT. These settings used to be add-on
options and this file compared them to `villa-kiosk/config.yaml`. They are
written by the kiosk's own proxy now and read by the layer, so the two halves
are `supervisor-proxy.py`'s AI_SETTINGS_FIELDS and `agent/options.py`'s
`Options` — one writes the file, the other reads it, and nothing type-checks
across that boundary.

⚠️ AND IT IS WORSE THAN BEFORE IF IT DRIFTS. A field the proxy writes that the
layer does not read is a setting the operator fills in that does nothing; a
field the layer reads that the proxy never writes silently takes its default
forever. Both look right in review, neither fails a type-check, and this
repository has produced that defect in both directions thirteen times.
"""
import json
import re
from pathlib import Path

from agent.options import OPTION_NAMES, Options, load_options

ROOT = Path(__file__).resolve().parents[2]
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"
CONFIG = ROOT / "villa-kiosk" / "config.yaml"

#: The kiosk's own options, which the AI work must never disturb.
KIOSK_OPTIONS = ("guest_pin", "owner_pin", "ops_pin", "superadmin_pin",
                 "public_model_access", "evidence_retention_days",
                 "session_days", "telemetry_max_events", "pin_lockout_minutes")


def proxy_fields() -> dict[str, str]:
    """AI_SETTINGS_FIELDS as {name: raw default}, read from the shipped file."""
    src = PROXY.read_text()
    m = re.search(r"^AI_SETTINGS_FIELDS = \{(.*?)^\}", src, re.S | re.M)
    assert m, "no AI_SETTINGS_FIELDS in the proxy — this test is stale"
    return dict(re.findall(r'"(\w+)":\s*("[^"]*"|[\d.]+)', m.group(1)))


def proxy_secrets() -> tuple[str, ...]:
    src = PROXY.read_text()
    m = re.search(r"^AI_SECRET_FIELDS = \((.*?)\)", src, re.S | re.M)
    assert m, "no AI_SECRET_FIELDS in the proxy"
    return tuple(re.findall(r'"(\w+)"', m.group(1)))


def test_the_parser_found_something_or_this_file_proves_nothing():
    assert len(proxy_fields()) >= 10


def test_the_proxy_writes_exactly_what_the_layer_reads():
    assert sorted(proxy_fields()) == sorted(OPTION_NAMES)


def test_the_defaults_agree_on_both_sides():
    """⚠️ A DIVERGENT DEFAULT IS INVISIBLE. The proxy writes its default into
    the file on the first save, so the layer's own default is only ever seen
    before anyone opens the screen — which is exactly when nobody is looking."""
    code = Options()
    for name, raw in proxy_fields().items():
        expected = getattr(code, name)
        if isinstance(expected, float):
            assert float(raw) == expected, name
        else:
            assert raw.strip('"') == str(expected), name


def test_both_secrets_are_declared_secret_on_the_proxy_side():
    """The two that must never travel back to a browser."""
    assert sorted(proxy_secrets()) == ["anthropic_api_key", "ha_mcp_secret"]


def test_the_layer_reads_what_the_proxy_would_actually_write(tmp_path):
    """The round trip, through a real file rather than two declarations."""
    written = {k: v.strip('"') for k, v in proxy_fields().items()}
    written["daily_usd_limit"] = float(written["daily_usd_limit"])
    p = tmp_path / "ai-settings.json"
    p.write_text(json.dumps(written))
    assert load_options(p) == Options()


def test_a_saved_setting_actually_reaches_the_layer(tmp_path):
    """The whole point of the screen: what an operator types is what it uses."""
    p = tmp_path / "ai-settings.json"
    p.write_text(json.dumps({"ha_mcp_url": "http://gateway:9583",
                             "anthropic_api_key": "sk-ant-typed-in-the-ui",
                             "daily_usd_limit": 2.5}))
    o = load_options(p)
    assert o.gateway_url == "http://gateway:9583"
    assert o.anthropic_api_key == "sk-ant-typed-in-the-ui"
    assert o.daily_usd_limit == 2.5
    assert o.missing() == []


def test_an_install_configured_BEFORE_the_screen_existed_still_works(tmp_path):
    """⚠️ THE MIGRATION, WHICH IS A REAL INSTALL AND NOT A HYPOTHETICAL. The
    owner set these on the add-on page when that was the only way; a release
    that quietly reverted them to empty would look like the screen broke."""
    legacy = tmp_path / "options.json"
    legacy.write_text(json.dumps({"ha_mcp_url": "http://old:9583"}))
    # An EXPLICIT path never falls back — a caller that named a file meant it.
    assert load_options(tmp_path / "does-not-exist.json", legacy=legacy).gateway_url == ""
    # The default path does, which is the one the running add-on uses.
    import agent.options as opts
    before = opts.SETTINGS_PATH
    try:
        opts.SETTINGS_PATH = tmp_path / "absent.json"
        assert load_options(legacy=legacy).gateway_url == "http://old:9583"
    finally:
        opts.SETTINGS_PATH = before


# ── what the kiosk's own manifest must still be ────────────────────────────

def block(key: str) -> set[str]:
    """The `key:` mapping's immediate children in the kiosk's manifest.

    ⚠️ PER BLOCK, NOT OVER THE WHOLE FILE. The first cut matched a bare
    two-space-indented key anywhere, so `options:` and `schema:` were indistinguishable — deleting a
    passcode from one left its twin in the other and the check still passed.
    The mutation sweep found that; reading the file did not.
    """
    m = re.search(rf"^{key}:\s*$\n((?:(?:[ \t].*)?\n)*)", CONFIG.read_text(), re.M)
    assert m, f"no `{key}:` block in the kiosk manifest"
    return set(re.findall(r"^  (\w+):", m.group(1), re.M))


def test_the_KIOSK_options_are_untouched_by_any_of_this():
    """⚠️ THE HALF THIS CHANGE COULD HAVE BROKEN. Removing ten fields from the
    manifest by pattern could take a passcode with it."""
    options, schema = block("options"), block("schema")
    for name in KIOSK_OPTIONS:
        assert name in options, f"the kiosk lost option `{name}`"
        assert name in schema, f"the kiosk lost schema entry `{name}`"


def test_the_AI_settings_are_NOT_add_on_options_any_more():
    """One place, not two: whichever an operator changed, the other disagreed."""
    declared = block("options") | block("schema")
    for name in OPTION_NAMES:
        assert name not in declared, (
            f"`{name}` is editable in two places again — the add-on page and "
            f"the kiosk UI cannot both own it")


def test_the_manifest_gives_the_owner_a_folder_they_can_edit():
    text = CONFIG.read_text()
    assert re.search(r"^map:\s*$", text, re.M), "no `map:` block — no Skills folder"
    assert re.search(r"^\s+- addon_config:rw\s*$", text, re.M)


def test_the_manifest_still_grants_NO_supervisor_privilege():
    """⚠️ THE ESCALATION THE AI WORK MUST NEVER COST — and the reason the
    settings live in /data rather than in Supervisor's own options."""
    keys = set(re.findall(r"^([a-z_]+):", CONFIG.read_text(), re.M))
    for forbidden in ("hassio_api", "hassio_role"):
        assert forbidden not in keys, f"`{forbidden}` must not be in this manifest"
    assert "homeassistant_api" in keys
