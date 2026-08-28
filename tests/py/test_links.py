"""A link into the kiosk must be safe before it is convenient.

Asked for as "add links to VESTA KIOSK (NEVER link to Home assistant directly)"
and then "while making sure this would respect the cybersecurity good practice".
Each test below is one of `links.py`'s six rules, and every one of them FAILS
CLOSED: the refusal path produces no link, never a degraded one.
"""

from __future__ import annotations

import ast
import os
import re
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import links  # noqa: E402

ENTRY = "/api/hassio_ingress/AbC123token"
EXTERNAL = {"external_url": "https://villa.example.org",
            "internal_url": "http://192.168.1.40:8123"}


# ── rule 1: the LAN address never travels ───────────────────────────────────

def test_an_internal_url_is_never_offered_as_a_substitute() -> None:
    """⚠️ THE ONE THAT MATTERS MOST. `internal_url` is a private network address.
    In a message bound for Telegram it tells a third-party server the shape of
    the villa's LAN — permanently, in someone's message history — for a link
    that would not resolve for the reader anyway. There is no fallback to it.
    """
    only_internal = {"internal_url": "http://192.168.1.40:8123"}
    assert links.footer(only_internal, ENTRY) == ""
    assert links.kiosk_url("cockpit", only_internal, ENTRY) == ""

    # ⚠️ AND WITH AN **HTTPS** INTERNAL URL, WHICH IS THE CASE THAT ISOLATES
    # THIS RULE. The first version of this test used an http:// internal URL, so
    # a mutation that added `or internal_url` as a fallback still PASSED — rule
    # 2 (https only) was silently doing rule 1's job, and rule 1 was never
    # exercised at all. A villa with a local certificate has exactly this shape.
    https_internal = {"internal_url": "https://192.168.1.40:8123"}
    assert links.footer(https_internal, ENTRY) == "", (
        "an https LAN address is still a LAN address — it must not travel")
    assert links.kiosk_url("cockpit", https_internal, ENTRY) == ""
    assert links.footer({"internal_url": "https://homeassistant.local:8123"},
                        ENTRY) == ""

    # And it never appears even when an external one is also present.
    assert "192.168" not in links.footer(EXTERNAL, ENTRY)


# ── rule 2: https only ──────────────────────────────────────────────────────

def test_a_plaintext_external_url_produces_no_link() -> None:
    """A brief that hands someone an http:// login link teaches the wrong habit
    at the moment they are most likely to tap without looking."""
    assert links.footer({"external_url": "http://villa.example.org"}, ENTRY) == ""


# ── rule 3: no villa data reaches a URL ─────────────────────────────────────

def test_the_page_table_is_a_closed_set_with_no_interpolation() -> None:
    """⚠️ NO PATH TRAVERSAL, NO OPEN REDIRECT, NO QUERY INJECTION — because
    there is no user input in the construction at all. Asserted on the AST so a
    future "link to this device" feature cannot quietly start interpolating an
    entity id: every value in PAGES must be a literal string.
    """
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "links.py"), encoding="utf-8").read()
    tree = ast.parse(source)
    table = next(n for n in ast.walk(tree)
                 if isinstance(n, ast.AnnAssign)
                 and isinstance(n.target, ast.Name) and n.target.id == "PAGES")
    assert isinstance(table.value, ast.Dict)
    for key, value in zip(table.value.keys, table.value.values):
        assert isinstance(key, ast.Constant) and isinstance(key.value, str)
        assert isinstance(value, ast.Constant) and isinstance(value.value, str), (
            "a PAGES value is computed — a path built from data is the open "
            "redirect this table exists to make impossible")
    assert links.kiosk_url("../../etc/passwd", EXTERNAL, ENTRY) == ""
    assert links.kiosk_url("cockpit\n<script>", EXTERNAL, ENTRY) == ""


# ── rule 4: no secret in the URL ────────────────────────────────────────────

def test_the_link_carries_no_credential() -> None:
    """⚠️ A SELF-AUTHENTICATING LINK IS A BEARER TOKEN IN A CHAT LOG. Home
    Assistant authenticates whoever follows this; that check belongs there and
    only there. The ingress entry is a path, not a credential."""
    url = links.kiosk_url("cockpit", EXTERNAL, ENTRY)
    assert url and "?" not in url, "no query string at all, so no token in one"
    for word in ("token=", "auth", "signature", "key=", "password", "secret"):
        assert word not in url.lower()


# ── rule 5: it is appended after inert(), never exempted from it ────────────

def test_the_footer_would_be_destroyed_by_inert_which_is_why_it_is_appended() -> None:
    """⚠️ THE REASON THE WIRING IS WHAT IT IS, PINNED SO IT CANNOT BE "TIDIED".

    `inert()` strips `_` from the whole message, and an ingress path contains
    `hassio_ingress`. Writing the link into the body gives the reader a dead
    URL. The tempting fix — teach `inert` to skip URLs — turns "remove every
    markup-active character" into "…unless the surrounding text looks like a
    URL", and the villa's own device names live in that text. So the body is
    sanitised in full and this line is added afterwards.

    This test asserts the DAMAGE, so if someone ever routes the footer through
    `inert` it fails with the reason written down.
    """
    from vesta.shared.style import _MARKUP_ACTIVE, inert
    url = links.kiosk_url("cockpit", EXTERNAL, ENTRY)

    # ⚠️ THE INVARIANT GOT STRONGER AFTER A DELIVERED BRIEF PROVED THE OLD ONE
    # INSUFFICIENT. Appending after the sanitiser protects the URL from OURS and
    # thereby hands it, unsanitised, to the DESTINATION'S parser — which ate the
    # underscore and produced `/api/hassioingress/…`, a link that 404s. (It was
    # not `inert`: that maps `_` to a SPACE and would have left "hassio ingress",
    # which is how the cause was identified.) So the URL now carries no
    # markup-active character at all, and is safe from every parser including ours.
    surviving = [c for c in url if c in _MARKUP_ACTIVE]
    assert not surviving, (
        f"the URL still carries {surviving} — a platform that parses markdown "
        f"will consume them and deliver a dead link")
    assert inert(url) == url, "an encoded URL must pass through untouched"
    assert "%5F" in url, "the ingress path's underscore must be encoded"

    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "pipeline.py"), encoding="utf-8").read()
    inert_at = source.index("style_mod.inert(body)")
    link_at = source.index("links_mod.footer(")
    assert link_at > inert_at, (
        "the footer is built BEFORE the message is sanitised, so inert() will "
        "eat the underscores in the ingress path and deliver a dead link")


# ── rule 6: it never reaches a narration provider ───────────────────────────

def test_no_url_can_enter_the_provider_payload() -> None:
    """⚠️ THE PRIVACY BOUNDARY. `PAYLOAD_ALLOWED_FIELDS` is an allow-list built
    by looping over permitted names, so a URL cannot appear without being added
    there. It must not be: the provider writes prose about numbers, and a URL
    would hand an external service the address of the owner's home instance for
    no benefit whatsoever."""
    from vesta.shared.contracts import PAYLOAD_ALLOWED_FIELDS
    for field in PAYLOAD_ALLOWED_FIELDS:
        assert "url" not in field.lower() and "link" not in field.lower()


# ── fail-closed, everywhere ─────────────────────────────────────────────────

def test_every_missing_input_yields_no_link_rather_than_a_broken_one() -> None:
    """A brief with no link is exactly as correct as it was before links
    existed. A brief with a wrong one teaches the reader the kiosk is broken."""
    for config, entry in (
        (None, ENTRY), ({}, ENTRY), (EXTERNAL, ""), (EXTERNAL, "no-slash"),
        ({"external_url": "https://"}, ENTRY),
        ({"external_url": "not a url"}, ENTRY),
        ("a string, not a dict", ENTRY),
    ):
        assert links.footer(config, entry) == "", f"{config!r} / {entry!r}"


def test_the_happy_path_points_at_the_kiosk_and_not_at_home_assistant() -> None:
    """"NEVER link to Home assistant directly" — the path is the add-on's own
    ingress entry, so the reader lands in VESTA, not on an HA dashboard."""
    url = links.kiosk_url("cockpit", EXTERNAL, ENTRY)
    # Percent-encoding is URL-legal and decoded by the server before routing, so
    # this is the same address — just one no markdown parser can chew on.
    from urllib.parse import unquote, urlsplit
    assert unquote(urlsplit(url).path) == ENTRY
    assert url.startswith("https://villa.example.org/")
    assert "/lovelace" not in url and "/config" not in url
    assert links.footer(EXTERNAL, ENTRY).endswith(url)


# ── the join, which is where this feature actually broke ────────────────────

def test_links_reads_the_keys_discovery_actually_writes() -> None:
    """⚠️ THE FEATURE SHIPPED DEAD AND EVERY TEST WAS GREEN.

    `discovery` stored `{"external": …, "internal": …}` and `links` read
    `external_url` / `internal_url`, so every link was withheld — silently,
    because withholding is this module's correct behaviour and looks identical
    whether the reason is policy or a typo. The owner ran the release, got no
    link, and asked where it was.

    The unit tests could not see it: they pass Home Assistant's raw shape
    straight to `links`, testing the reader against its own assumption. This is
    `test_store_envelope`'s shape one layer out — two files, a string literal in
    each, nothing between them — so it is checked the same way: derive the keys
    from the WRITER and assert the READER accepts them.
    """
    source = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                               "discovery.py"), encoding="utf-8").read()
    block = source[source.index('inventory["urls"] = {'):]
    block = block[:block.index("}") + 1]
    written = set(re.findall(r'"(\w+)":', block))
    assert written, "the urls block moved — this test is blind"

    # Every key the writer emits must be one the reader looks for, proved by
    # building a config from the WRITER's names and getting a real link back.
    config: Dict[str, Any] = {k: "https://villa.example.org" for k in written}
    assert links.kiosk_url("cockpit", config, ENTRY), (
        f"discovery writes {sorted(written)} and links reads neither — the "
        f"link is withheld for a reason nobody can see")
    assert links.footer(config, ENTRY)
