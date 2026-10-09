"""The reports' page carries the VESTA mark, inside it: the Kiosk's own icons.

A report opened on a phone showed the browser's blank tab icon (owner, 2026-10-02). Since 0.6.42 the mark
is written in the reports skill's page (templates/report.html), the one page the agent sends — the engine
no longer rewrites every HTML file on its way out.
"""
from __future__ import annotations

import asyncio
import base64
import os
import re
import subprocess
from urllib.parse import unquote

from vesta_agent.telegram import Telegram

from helpers import STARTER_SKILLS
from test_reports import COMPOSE, _facts, _run, _villa

ICONS = re.compile(r'<link rel="icon"[^>]*>')
TEMPLATE = os.path.join(STARTER_SKILLS, "reports", "templates", "report.html")


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


def _links() -> list[str]:
    with open(TEMPLATE, encoding="utf-8") as f:
        return ICONS.findall(f.read())


def test_the_mark_is_the_vesta_kiosks_own():
    # The agent's image has no Kiosk in it, so the icons are copies: this is what keeps them the same.
    light, dark, png = (re.search(r'href="([^"]*)"', link).group(1) for link in _links())
    assert unquote(light.split(",", 1)[1]) == " ".join(kiosk_file("public/favicon.svg").decode().split())
    assert unquote(dark.split(",", 1)[1]) == " ".join(kiosk_file("public/favicon-dark.svg").decode().split())
    assert base64.b64decode(png.split(",", 1)[1]) == kiosk_file("public/icons/favicon-32x32.png")


def test_the_links_are_well_formed_and_fetch_nothing():
    links = _links()
    assert len(links) == 3
    for link in links:
        # every attribute closes where it should: a raw quote in the data would end href early
        assert re.fullmatch(r'<link( [a-z-]+="[^"]*")+>', link), link
    assert "http" not in "".join(links).replace("http://www.w3.org/2000/svg", "")   # works offline


def test_the_reports_page_has_the_mark_in_its_head(tmp_path):
    fx = _villa(tmp_path)
    _facts(tmp_path, fx)
    r = _run(COMPOSE, "fm-weekly", "--facts", str(tmp_path / "facts.json"), "--out", str(tmp_path / "page.html"))
    assert r.returncode == 0, r.stderr
    page = (tmp_path / "page.html").read_text()
    head = page[page.index("<head>"):page.index("</head>")]
    assert ICONS.findall(head) == _links()


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


def test_a_file_is_sent_on_telegram_exactly_as_written(tmp_path):
    page = "<!doctype html><html><head><title>Week</title></head></html>"
    (tmp_path / "page.html").write_text(page)
    tg = Telegram("t0k3n")
    tg.http = _Http()
    assert asyncio.run(tg.send(1, "This week's report", document=str(tmp_path / "page.html"))) == [7]
    assert tg.http.sent == ("sendDocument", page.encode())
