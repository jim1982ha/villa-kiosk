"""Whisper asked directly: the Wyoming protocol (wyoming 1.x framing) over a plain socket, no new dependency.

⚠️ WHY DIRECT (owner, 2026-10-22, "the Agent asks Whisper directly"): Home Assistant's speech-to-text refuses
"auto" (415: it takes only the languages Whisper lists), so through it a French voice note was forced to English
and Whisper TRANSLATED it. Asked over Wyoming with no language, the Whisper app's own setting ("auto") finds the
one spoken. No token is involved: the Whisper app listens on the apps' internal network.

Moved here from villa-concierge's voice.py (architecture review, 2026-10-23): the skill says WHICH Whisper and in
which order (its plan); the engine runs every attempt (transcriber.py), so one clock and one record cover them all.
Blocking code: transcriber.py runs it in a thread, every wait bounded by the deadline it is given.
"""
from __future__ import annotations

import json
import re
import socket
import threading
import time

# host:port as a plan names it: the shape only (a hostname or an address, a port)
ADDRESS = re.compile(r"^(?P<host>[A-Za-z0-9._\-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\]):(?P<port>[0-9]{1,5})$")
CHUNK_SECONDS = 1               # one second of audio per audio-chunk, as the Whisper app's own clients send


class WyomingError(Exception):
    """Whisper answered something that is not a Wyoming event, or closed before its transcript."""


def address(text) -> tuple[str, int]:
    """(host, port) of "host:port"; ValueError for anything else."""
    m = ADDRESS.match(str(text or ""))
    if not m or not 0 < int(m["port"]) < 65536:
        raise ValueError("not host:port")
    return m["host"].strip("[]"), int(m["port"])


def event(kind: str, data: dict | None = None, payload: bytes = b"") -> bytes:
    """One Wyoming event as wyoming 1.x writes it: a JSON header line, then its data (data_length bytes of JSON),
    then its payload (payload_length bytes)."""
    body = json.dumps(data).encode() if data else b""
    head = {"type": kind, "version": "1.0.0"}
    if body:
        head["data_length"] = len(body)
    if payload:
        head["payload_length"] = len(payload)
    return json.dumps(head).encode() + b"\n" + body + payload


def read_event(f) -> dict | None:
    """The next event from a Wyoming stream (a binary file), its data merged in; None at the end of the stream."""
    line = f.readline()
    if not line:
        return None
    try:
        head = json.loads(line)
        data = dict(head.get("data") or {})
        n, m = int(head.get("data_length") or 0), int(head.get("payload_length") or 0)
    except (ValueError, TypeError, AttributeError) as e:
        raise WyomingError(f"not a Wyoming event ({type(e).__name__})") from None
    if n:
        extra = f.read(n)
        if len(extra) != n:
            raise WyomingError("the stream ended inside an event")
        try:
            data.update(json.loads(extra))
        except (ValueError, TypeError) as e:
            raise WyomingError(f"not a Wyoming event ({type(e).__name__})") from None
    if m and len(f.read(m)) != m:
        raise WyomingError("the stream ended inside an event")
    return {"type": head.get("type"), "data": data}


def _resolve(host: str, port: int, timeout: float) -> list[tuple]:
    """Every address of the name, IPv4 first, looked up within `timeout`: a name that no server answers for must not
    hold the message.

    ⚠️ EVERY ADDRESS, NOT THE FIRST (owner's villa, 2026-10-23: "Whisper directly: ConnectionRefusedError"). The
    apps' internal network gives a name an IPv6 address too, and Whisper listens on IPv4 only: the first address
    found was refused while the villa's system, trying each in turn, reached it."""
    found: list = []

    def look():
        try:
            found.append(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
        except OSError as e:
            found.append(e)
    t = threading.Thread(target=look, daemon=True)
    t.start()
    t.join(timeout)
    if not found:
        raise TimeoutError("the name was not resolved in time")
    if isinstance(found[0], Exception):
        raise found[0]
    infos = sorted(found[0], key=lambda i: i[0] != socket.AF_INET)
    return [(i[0], i[4]) for i in infos]


def _connect(host: str, port: int, timeout: float) -> socket.socket:
    """The first of the name's addresses that accepts; the last refusal when none does."""
    last: OSError | None = None
    for family, addr in _resolve(host, port, timeout):
        sock = socket.socket(family, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect(addr)
            return sock
        except OSError as e:
            sock.close()
            last = e
    raise last or OSError("the name has no address")


def transcribe(where: tuple[str, int], pcm: bytes, fmt: dict, deadline: float, connect_s: float,
               language: str | None = None) -> dict:
    """{"text": …, "language"?: …} from Whisper over Wyoming, before `deadline` (time.monotonic()). `fmt`: the
    audio's {"rate", "width", "channels"}. No language sent: Whisper's own setting applies (configured "auto": it
    finds the one spoken). Raises OSError (no route, refused, timeout) or WyomingError (not Wyoming, no words).

    The `transcript` event of the villa's Whisper carries NO language (measured 2026-10-23: its log said "Detected
    language 'fr'", its answer did not); one that does is passed on."""
    def left() -> float:
        rest = deadline - time.monotonic()
        if rest <= 0:
            raise TimeoutError("Whisper did not answer in time")
        return rest
    host, port = where
    sock = _connect(host, port, min(connect_s, left()))
    try:
        sock.settimeout(left())
        step = fmt["rate"] * fmt["width"] * fmt["channels"] * CHUNK_SECONDS
        out = [event("transcribe", {"language": language} if language else None), event("audio-start", fmt)]
        out += [event("audio-chunk", fmt, pcm[i:i + step]) for i in range(0, len(pcm), step)]
        out.append(event("audio-stop"))
        sock.sendall(b"".join(out))
        f = sock.makefile("rb")
        while True:
            sock.settimeout(left())
            ev = read_event(f)
            if ev is None:
                raise WyomingError("Whisper closed before its transcript")
            if ev["type"] == "transcript":      # transcript-start, -chunk, info…: not the answer
                text = str(ev["data"].get("text") or "").strip()
                if not text:
                    raise WyomingError("Whisper heard no words")
                said = ev["data"].get("language")
                return {"text": text, **({"language": str(said)} if said else {})}
    finally:
        sock.close()
