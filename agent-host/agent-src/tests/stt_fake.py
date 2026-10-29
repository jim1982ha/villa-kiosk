"""The one stand-in for the villa system's speech-to-text (POST /api/stt/<entity>), a real HTTP server on a local
port, in its own thread, so the header the villa's system reads is the one checked.

⚠️ ONE STAND-IN (architecture review, 2026-10-23): test_voice_language.py and test_voice_whisper.py each wrote one.

    with FakeSTT([415, 200]) as stt:      # answers in turn; the last one repeats
        v.s.ha_url = stt.url
`answers`: a status (200: "words in <language>"), ("slow", seconds) — 200 after that wait, or ("json", body) — 200
with that body (an empty text, an error result).
`asked`: (entity, language) of each request, in order; `contents`: each X-Speech-Content header.

The villa's TEXT-to-speech too (ticket 24 of "One inbox", VESTA answers aloud), on the same address as the villa's
system serves both: POST /api/tts_get_url answers the sound's path (and an outside `url`, never to be fetched), GET
that path answers `speech` (audio/mpeg). `tts`: its answers in turn, as `answers` (a status, or ("slow", seconds)). `spoken`: each request's body;
`fetched`: each path read.
"""
from __future__ import annotations

import asyncio
import threading

from aiohttp import web


def language_of(header: str) -> str:
    return dict(p.strip().split("=", 1) for p in header.split(";"))["language"]


class FakeSTT:
    def __init__(self, answers=(200,), speech: bytes = b"", tts=(200,)):
        self.answers = list(answers)
        self.speech, self.tts = speech, list(tts)
        self.spoken: list[dict] = []
        self.fetched: list[str] = []
        self.asked: list[tuple[str, str]] = []
        self.contents: list[str] = []
        self.tokens: list[str] = []
        self.loop = asyncio.new_event_loop()
        self.port = None
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def __enter__(self):
        self._thread.start()
        self._ready.wait(5)
        return self

    def __exit__(self, *exc):
        async def stop():
            for t in asyncio.all_tasks():
                if t is not asyncio.current_task():
                    t.cancel()
            await asyncio.sleep(0)
            self.loop.stop()
        asyncio.run_coroutine_threadsafe(stop(), self.loop)
        self._thread.join(5)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def languages(self) -> list[str]:
        return [lang for _, lang in self.asked]

    def _run(self):
        asyncio.set_event_loop(self.loop)
        app = web.Application()
        app.router.add_post("/api/stt/{entity}", self._stt)
        app.router.add_post("/api/tts_get_url", self._tts_url)
        app.router.add_get("/api/tts_proxy/{name}", self._tts_sound)
        runner = web.AppRunner(app)
        self.loop.run_until_complete(runner.setup())
        site = web.TCPSite(runner, "127.0.0.1", 0)
        self.loop.run_until_complete(site.start())
        self.port = site._server.sockets[0].getsockname()[1]
        self._ready.set()
        self.loop.run_forever()
        self.loop.run_until_complete(runner.cleanup())
        self.loop.close()

    async def _stt(self, request: web.Request):
        header = request.headers.get("X-Speech-Content", "")
        self.contents.append(header)
        self.tokens.append(request.headers.get("Authorization", ""))
        lang = language_of(header)
        self.asked.append((request.match_info["entity"], lang))
        await request.read()
        answer = self.answers[min(len(self.asked), len(self.answers)) - 1]
        if isinstance(answer, tuple) and answer[0] == "json":
            return web.json_response(answer[1])
        if isinstance(answer, tuple) and answer[0] == "slow":
            await asyncio.sleep(answer[1])
            answer = 200
        if answer != 200:
            return web.Response(status=answer)
        return web.json_response({"result": "success", "text": f"words in {lang}"})

    async def _tts_url(self, request: web.Request):
        self.spoken.append(await request.json())
        answer = self.tts[min(len(self.spoken), len(self.tts)) - 1]
        if isinstance(answer, tuple) and answer[0] == "slow":
            await asyncio.sleep(answer[1])
            answer = 200
        if answer != 200:
            return web.Response(status=answer)
        return web.json_response({"url": "https://outside.invalid/api/tts_proxy/answer.mp3",
                                  "path": "/api/tts_proxy/answer.mp3"})

    async def _tts_sound(self, request: web.Request):
        self.fetched.append(request.path)
        return web.Response(body=self.speech, content_type="audio/mpeg")
