"""Every HTML page the agent sends carries the VESTA mark (favicon.py), inside it.

A report opened on a phone showed the browser's blank tab icon (owner, 2026-10-02).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import subprocess
from urllib.parse import unquote

import pytest

from vesta_agent import favicon
from vesta_agent.favicon import document_bytes, favicon_links, with_favicon
from vesta_agent.telegram import Telegram

from test_reports import COMPOSE, _facts, _run, _villa

ICONS = re.compile(r'<link rel="icon"[^>]*>')


def kiosk_file(path: str) -> bytes:
    """The Kiosk's own file, from ITS branch in git — the way agent-host/tests/test_kiosk_contract.py
    reads the contract. Never this branch's working tree: agent-dev's public/ is main's, as old as the
    fork, so a Kiosk icon changed on dev2 would pass unseen. Never skipped: a check that cannot read
    what it compares fails."""
    for ref in [os.environ.get("KIOSK_REF"), os.environ.get("KIOSK_CONTRACT_REF"), "origin/dev2", "dev2"]:
        if not ref:
            continue
        r = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=os.path.dirname(__file__), capture_output=True)
        if r.returncode == 0:
            return r.stdout
    raise AssertionError(f"the Kiosk's {path} could not be read from git (fetch dev2)")


def test_the_mark_is_the_vesta_kiosks_own():
    # The agent's image has no Kiosk in it, so the icons are copies: this is what keeps them the same.
    assert favicon.FAVICON_SVG.encode() == kiosk_file("public/favicon.svg")
    assert favicon.FAVICON_DARK_SVG.encode() == kiosk_file("public/favicon-dark.svg")
    assert base64.b64decode(favicon.FAVICON_PNG_32_B64) == kiosk_file("public/icons/favicon-32x32.png")


def test_the_links_are_well_formed_and_carry_the_icon_itself():
    links = ICONS.findall(favicon_links())
    assert len(links) == 3
    for link in links:
        # every attribute closes where it should: a raw quote in the data would end href early
        assert re.fullmatch(r'<link( [a-z-]+="[^"]*")+>', link), link
    light, dark, png = (re.search(r'href="([^"]*)"', link).group(1) for link in links)
    assert unquote(light.split(",", 1)[1]) == " ".join(favicon.FAVICON_SVG.split())
    assert unquote(dark.split(",", 1)[1]) == " ".join(favicon.FAVICON_DARK_SVG.split())
    assert png == "data:image/png;base64," + favicon.FAVICON_PNG_32_B64
    assert "http" not in favicon_links().replace("http://www.w3.org/2000/svg", "")   # nothing to fetch: works offline


def test_the_reports_page_gets_the_mark_at_the_top_of_its_head(tmp_path):
    fx = _villa(tmp_path)
    _facts(tmp_path, fx)
    r = _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--out", str(tmp_path / "page.html"))
    assert r.returncode == 0, r.stderr
    page = (tmp_path / "page.html").read_text()
    assert not ICONS.search(page)                                   # the skill's page has none of its own
    sent = document_bytes(str(tmp_path / "page.html")).decode()
    head = sent[sent.index("<head>"):sent.index("</head>")]
    assert len(ICONS.findall(head)) == 3 and head.startswith("<head>" + favicon_links())
    assert sent.replace(favicon_links(), "", 1) == page               # nothing else in the page changed


@pytest.mark.parametrize("page, where", [
    ("<!doctype html><html lang=en><head><title>t</title></head><body>x</body></html>", "<head>"),
    ("<!DOCTYPE html><HTML><HEAD prefix='x'><TITLE>t</TITLE></HEAD></HTML>", "<HEAD prefix='x'>"),
    ("<!doctype html><html lang=en><body>no head</body></html>", "<html lang=en>"),
    ("<!doctype html><p>a fragment</p>", "<!doctype html>"),
    ("<p>no tags at all</p>", ""),
])
def test_any_page_shape_gets_the_mark_once_where_a_browser_reads_it(page, where):
    out = with_favicon(page)
    after = out.index(where) + len(where) if where else 0
    assert out.count(favicon_links()) == 1 and out[after:].startswith(favicon_links()), out[:200]
    assert with_favicon(out) == out                                 # sent twice, still one mark


def test_a_page_with_its_own_icon_keeps_it():
    page = '<html><head><link rel="shortcut icon" href="data:image/png;base64,AAAA"></head></html>'
    assert with_favicon(page) == page


def test_only_html_is_touched(tmp_path):
    (tmp_path / "data.json").write_text(json.dumps({"<head>": 1}))
    (tmp_path / "latin1.html").write_bytes("<html><head></head>é</html>".encode("latin-1"))
    assert document_bytes(str(tmp_path / "data.json")) == (tmp_path / "data.json").read_bytes()
    assert document_bytes(str(tmp_path / "latin1.html")) == (tmp_path / "latin1.html").read_bytes()
    (tmp_path / "PAGE.HTM").write_text("<html><head></head></html>")
    assert favicon_links().encode() in document_bytes(str(tmp_path / "PAGE.HTM"))


class _Http:
    """Telegram's sendDocument as the agent calls it: records the file it was given."""
    def __init__(self):
        self.sent = None

    def post(self, url, data=None, json=None):
        http = self

        class _Resp:
            async def __aenter__(self):
                fields = {f[0]["name"]: f[2] for f in data._fields}
                http.sent = (url.rsplit("/", 1)[1], fields["document"])
                return self

            async def __aexit__(self, *a):
                return False

            async def json(self, content_type=None):
                return {"ok": True, "result": {"message_id": 7}}
        return _Resp()


def test_a_report_sent_on_telegram_carries_the_mark(tmp_path):
    (tmp_path / "page.html").write_text("<!doctype html><html><head><title>Week</title></head></html>")
    tg = Telegram("t0k3n")
    tg.http = _Http()
    assert asyncio.run(tg.send(1, "This week's report", document=str(tmp_path / "page.html"))) == 7
    method, body = tg.http.sent
    assert method == "sendDocument" and favicon_links().encode() in body
