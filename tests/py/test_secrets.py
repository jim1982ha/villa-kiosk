"""A credential is not configuration, and this file is the difference.

⚠️ THE REPORTS CONFIG STORE IS READABLE BY ANY AUTHORIZED SESSION — a guest's
phone included; that is `_json_store_handlers`' stated contract, GET open and
PUT owner-only. An API key stored in there would be readable by everyone in the
villa. So it lives in its own file that no handler serves, at 0600, and the only
question anything else may ask about it is "is there one".

⚠️ AND THE LIKELIEST LEAK PATH IS NOT OUR CODE. Debugging in this project is
done by the owner pasting add-on logs into a chat — CLAUDE.md records three
ceiling bugs diagnosed exactly that way — and an HTTP client that fails
mid-request routinely echoes the request, headers included, into the exception
that `swallow()` is designed to write down. `redact` is what stands between an
add-on log and a credential in an add-on log someone forwards.
"""

from __future__ import annotations

import json
import os
import stat
from typing import Any

from vesta.adapters import secrets


def _at(tmp_path: Any, monkeypatch: Any) -> str:
    path = str(tmp_path / "reports-secrets.json")
    monkeypatch.setattr(secrets, "SECRETS_FILE", path)
    return path


# ── the value, and who may have it ──────────────────────────────────────────

def test_a_stored_credential_comes_back(tmp_path: Any, monkeypatch: Any) -> None:
    _at(tmp_path, monkeypatch)
    assert secrets.put("anthropic", "sk-test-abcdef123456")
    assert secrets.get("anthropic") == "sk-test-abcdef123456"


def test_configured_answers_without_producing_the_value(tmp_path: Any,
                                                        monkeypatch: Any) -> None:
    """⚠️ TWO FUNCTIONS SO THE COMMON CASE IS THE SAFE ONE. Every caller that
    wants to say "a provider is set up" wants a boolean, and reaching for
    `get()` to test it puts the credential on the stack of whatever is asking,
    where a traceback, a repr or a debugger can pick it up."""
    _at(tmp_path, monkeypatch)
    assert secrets.configured("anthropic") is False
    secrets.put("anthropic", "sk-test-abcdef123456")
    assert secrets.configured("anthropic") is True
    assert isinstance(secrets.configured("anthropic"), bool)


def test_an_empty_value_deletes_rather_than_storing_blank(tmp_path: Any,
                                                          monkeypatch: Any) -> None:
    """The only way to turn a provider off completely. Clearing `narration.mode`
    stops it being USED and leaves the key on disk — a credential that outlives
    its purpose is one nobody is watching."""
    path = _at(tmp_path, monkeypatch)
    secrets.put("anthropic", "sk-test-abcdef123456")
    secrets.put("anthropic", "")
    assert secrets.get("anthropic") is None
    assert "anthropic" not in json.load(open(path, encoding="utf-8"))


# ── the mode, which is the whole point of the module ────────────────────────

def test_the_file_is_owner_only(tmp_path: Any, monkeypatch: Any) -> None:
    path = _at(tmp_path, monkeypatch)
    secrets.put("anthropic", "sk-test-abcdef123456")
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


def test_the_mode_is_reapplied_on_every_write_not_only_on_creation(
        tmp_path: Any, monkeypatch: Any) -> None:
    """⚠️ THE SILENT HALF. A file created before this module existed, or
    restored from a backup that flattened permissions, keeps whatever mode it
    arrived with — and a too-permissive file reads back perfectly, so nothing
    ever surfaces it."""
    path = _at(tmp_path, monkeypatch)
    secrets.put("anthropic", "sk-test-abcdef123456")
    os.chmod(path, 0o644)
    secrets.put("anthropic", "sk-test-another-key99")
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


# ── every way of reading it that must not raise ─────────────────────────────

def test_a_missing_file_is_simply_no_credentials(tmp_path: Any,
                                                 monkeypatch: Any) -> None:
    _at(tmp_path, monkeypatch)
    assert secrets.get("anthropic") is None
    assert secrets.configured("anthropic") is False


def test_a_corrupt_file_degrades_and_never_quotes_its_content(
        tmp_path: Any, monkeypatch: Any, capsys: Any) -> None:
    """⚠️ A JSON PARSE ERROR FROM THE STDLIB CAN QUOTE THE OFFENDING LINE, and
    the offending line of THIS file is a credential. The warning names the error
    class and nothing else."""
    path = _at(tmp_path, monkeypatch)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write('{"anthropic": "sk-live-REALKEY123456", oops')
    assert secrets.get("anthropic") is None
    printed = capsys.readouterr().out
    assert "could not read" in printed
    assert "REALKEY" not in printed


def test_a_wrong_shaped_file_is_ignored(tmp_path: Any, monkeypatch: Any) -> None:
    path = _at(tmp_path, monkeypatch)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(["not", "a", "mapping"], handle)
    assert secrets.get("anthropic") is None


# ── redaction ───────────────────────────────────────────────────────────────

def test_redact_removes_a_stored_credential_from_arbitrary_text(
        tmp_path: Any, monkeypatch: Any) -> None:
    _at(tmp_path, monkeypatch)
    secrets.put("anthropic", "sk-test-abcdef123456")
    leaky = ("ClientError: 401 for POST https://api.example/v1/messages "
             "headers={'x-api-key': 'sk-test-abcdef123456'}")
    out = secrets.redact(leaky)
    assert "sk-test-abcdef123456" not in out
    assert "***" in out
    # The rest of the message survives — the point is a usable log, not a blank.
    assert "401" in out


def test_redact_leaves_text_alone_when_nothing_is_configured(
        tmp_path: Any, monkeypatch: Any) -> None:
    _at(tmp_path, monkeypatch)
    assert secrets.redact("ConnectionError: no route to host") == \
        "ConnectionError: no route to host"


def test_redact_ignores_implausibly_short_secrets(tmp_path: Any,
                                                  monkeypatch: Any) -> None:
    """⚠️ A GUARD AGAINST THE REDACTOR ITSELF. A stored value of `"a"` would
    replace every letter `a` in every message passed through here, destroying
    the logs this project diagnoses from. Nothing under 8 characters is a real
    API key."""
    _at(tmp_path, monkeypatch)
    secrets.put("anthropic", "abc")
    assert secrets.redact("a message about abc") == "a message about abc"


def test_log_redact_never_prints_the_value() -> None:
    """The other redactor — `log.redact` renders a value that MAY be a
    credential, for a diagnostic line. Length is kept because "configured but
    wrong length" and "not configured" are different faults; the prefix is not,
    because four characters of an API key is still four characters of one."""
    from vesta.adapters.log import redact
    out = redact("sk-test-abcdef123456")
    assert "sk-test" not in out and "abcdef" not in out
    assert "len=20" in out
    assert redact(None) == "<unset>" and redact("") == "<empty>"
