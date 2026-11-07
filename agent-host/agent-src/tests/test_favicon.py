"""The reports' page carries the VESTA mark, inside it: the Kiosk's own icons.

A report opened on a phone showed the browser's blank tab icon (owner, 2026-10-02). Since 0.6.42 the mark
is written in the reports skill's page (templates/report.html), the one page the agent sends — the engine
no longer rewrites every HTML file on its way out.
"""
from __future__ import annotations

import asyncio

from vesta_agent.telegram import Telegram


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
