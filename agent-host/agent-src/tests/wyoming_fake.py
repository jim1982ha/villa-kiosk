"""A stand-in for the Whisper app's Wyoming server (wyoming 1.x framing), on a local port, in its own thread.

It reads what a client sends with its OWN parser (a JSON header line, `data_length` bytes of JSON data, then
`payload_length` bytes of payload), so a client that frames an event wrong is caught here rather than by the
client's own reader. `answer` decides what it says after `audio-stop`:
  {"text": …, "language"?: …}   transcript-start, an info event, then the transcript (its data after the header)
  "close"                       closes without a transcript
  "silent"                      never answers (the client's timeout)
`delay`: seconds it thinks before answering (a slow Whisper).

⚠️ LIKE THE VILLA'S WHISPER, ITS TRANSCRIPT CARRIES NO LANGUAGE unless a test gives one (measured 2026-10-23: the
Whisper app's log said "Detected language 'fr'", its `transcript` event did not): FRENCH is that answer.
"""
from __future__ import annotations

import asyncio
import json
import threading

FRENCH = {"text": "allume la lumière de la cuisine"}           # what the villa's Whisper answers: words, no language
FRENCH_SAID = {**FRENCH, "language": "fr"}                    # a Whisper that says the language it heard


def event(kind: str, data: dict | None = None, payload: bytes = b"", inline: bool = False) -> bytes:
    """An event as a server writes it: data after the header (data_length), or inline in it."""
    head: dict = {"type": kind}
    body = b""
    if data is not None and inline:
        head["data"] = data
    elif data is not None:
        body = json.dumps(data).encode()
        head["data_length"] = len(body)
    if payload:
        head["payload_length"] = len(payload)
    return json.dumps(head).encode() + b"\n" + body + payload


class FakeWhisper:
    def __init__(self, answer=None, delay: float = 0):
        self.answer = FRENCH if answer is None else answer
        self.delay = delay
        self.received: list[dict] = []      # {"type", "data", "payload": bytes}
        self.connections = 0
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
            # a "silent" client still waits: ended here, inside the loop, never left for a closed loop to collect
            for t in asyncio.all_tasks():
                if t is not asyncio.current_task():
                    t.cancel()
            await asyncio.sleep(0)
            self.loop.stop()
        asyncio.run_coroutine_threadsafe(stop(), self.loop)
        self._thread.join(5)

    @property
    def address(self) -> str:
        return f"127.0.0.1:{self.port}"

    def _run(self):
        asyncio.set_event_loop(self.loop)
        server = self.loop.run_until_complete(asyncio.start_server(self._client, "127.0.0.1", 0))
        self.port = server.sockets[0].getsockname()[1]
        self._ready.set()
        self.loop.run_forever()
        server.close()
        self.loop.run_until_complete(server.wait_closed())
        self.loop.close()

    async def _client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.connections += 1
        try:
            while True:
                line = await reader.readline()
                if not line:
                    return
                head = json.loads(line)
                data = dict(head.get("data") or {})
                if head.get("data_length"):
                    data.update(json.loads(await reader.readexactly(head["data_length"])))
                payload = await reader.readexactly(head["payload_length"]) if head.get("payload_length") else b""
                self.received.append({"type": head["type"], "data": data, "payload": payload})
                if head["type"] != "audio-stop":
                    continue
                if self.delay:
                    await asyncio.sleep(self.delay)
                if self.answer == "silent":
                    await asyncio.sleep(30)
                    return
                if self.answer == "close":
                    return
                writer.write(event("transcript-start", {}) + event("info", {"asr": []}, inline=True) +
                             event("transcript", self.answer))
                await writer.drain()
                return
        except (asyncio.IncompleteReadError, ConnectionError, ValueError):
            return
        finally:
            writer.close()

    def of(self, kind: str) -> list[dict]:
        return [e for e in self.received if e["type"] == kind]
