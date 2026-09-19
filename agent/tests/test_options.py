"""What an operator typed on the Configuration page, as the layer sees it."""
import json

import pytest

from agent.options import OPTION_NAMES, Options, load_options


def test_every_option_the_manifest_declares_is_read(tmp_path):
    p = tmp_path / "options.json"
    p.write_text(json.dumps({name: "x" for name in OPTION_NAMES
                             if name != "daily_usd_limit"} | {"daily_usd_limit": 2.5}))
    o = load_options(p)
    assert o.anthropic_api_key == "x"
    assert o.ha_mcp_url == "x"
    assert o.daily_usd_limit == 2.5


def test_a_missing_file_is_all_defaults_not_a_crash(tmp_path):
    """An add-on started before anyone opened the Configuration page."""
    o = load_options(tmp_path / "nothing.json")
    assert o == Options()
    assert o.anthropic_api_key == ""
    assert o.ha_mcp_url == ""


def test_the_secrets_never_reach_a_log_line():
    """⚠️ repr() IS WHAT AN EXCEPTION PRINTS. A dataclass repr carrying the API
    key puts it in the add-on log the moment anything raises with Options in
    scope, and add-on logs are pasted into issues."""
    o = Options(anthropic_api_key="sk-ant-SECRET", ha_mcp_secret="ALSO-SECRET")
    text = repr(o)
    assert "sk-ant-SECRET" not in text
    assert "ALSO-SECRET" not in text
    assert "***" in text
    # ...and the value is still readable by the code that needs it.
    assert o.anthropic_api_key == "sk-ant-SECRET"


def test_a_garbled_file_is_defaults_and_says_so(tmp_path):
    p = tmp_path / "options.json"
    p.write_text("{not json")
    o = load_options(p)
    assert o == Options()


def test_the_trailing_slash_on_the_gateway_url_is_the_operators_business_not_ours():
    assert Options(ha_mcp_url="http://x:9583/abc/").gateway_url == "http://x:9583/abc"
    assert Options(ha_mcp_url="  http://x:9583/abc  ").gateway_url == "http://x:9583/abc"
    assert Options(ha_mcp_url="").gateway_url == ""


def test_the_layer_can_say_what_it_is_missing():
    assert "ha_mcp_url" in Options().missing()
    assert "anthropic_api_key" in Options().missing()
    assert Options(ha_mcp_url="u", anthropic_api_key="k").missing() == []


def test_numbers_that_arrive_as_strings_are_still_numbers(tmp_path):
    """Supervisor writes what the schema says, but a hand-edited options.json
    is a thing that happens and a crash on start is a bad way to find out."""
    p = tmp_path / "options.json"
    p.write_text(json.dumps({"daily_usd_limit": "2.50"}))
    assert load_options(p).daily_usd_limit == pytest.approx(2.50)
    p.write_text(json.dumps({"daily_usd_limit": "not a number"}))
    assert load_options(p).daily_usd_limit == Options().daily_usd_limit
