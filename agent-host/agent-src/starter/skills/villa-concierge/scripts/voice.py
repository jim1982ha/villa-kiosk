#!/usr/bin/env python3
"""villa-concierge: a voice message, written out by Whisper, or made ready for Home Assistant's speech-to-text.

  voice.py prepare --audio voice.ogg --language fr [--stt stt.x] [--whisper host:port|off] [--fixture-dir DIR]

(--language: the person's saved language.)

Telegram sends a voice message as Ogg/Opus; Whisper and Home Assistant's
speech-to-text take 16 kHz, 16-bit mono audio. This script decodes the audio
(libopus, the system library), then:

1. With the language "auto" (the default), it asks the Whisper app ITSELF, over
   Wyoming (no token involved), with no language: Whisper finds the one spoken.
   ⚠️ WHY DIRECT (owner, 2026-10-22, "the Agent asks Whisper directly"): Home
   Assistant's speech-to-text refuses "auto" (415: it takes only the languages
   Whisper lists), so through it a French voice note was forced to English and
   Whisper TRANSLATED it. The answer:
     {"text": "…", "language": "fr", "via": "whisper", "seconds": 3.2}
2. When Whisper cannot be reached or answers nothing (or `whisper: off`, or a
   fixed language), it writes the WAV beside the audio and says which
   speech-to-text and which language the engine asks Home Assistant for:
     {"stt": {"entity": "stt.…", "language": "auto", "fallback": "fr", "wav": "/…/voice.wav", "seconds": 3.2,
              "whisper": "ConnectionRefusedError"}}     (why Whisper was not used: a kind, never the words)
   The engine sends that WAV (it holds the token; a script never does); when the
   villa's system refuses "auto", it tries once more in `fallback`.
  {"error": "plain words for the person"}

Every choice is the villa's, in ../villa.voice.yaml (optional, kept by updates):
  whisper: core-whisper:10300  the default: the Whisper app's own hostname on Home Assistant OS
  whisper: off                 never directly: Home Assistant's speech-to-text only
  stt: stt.faster_whisper      the speech-to-text, when Home Assistant has several
  language: fr                 always this language, through Home Assistant: no "auto", no fallback, no direct Whisper
  language: auto               the default: the language spoken, else the person's saved one
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import json
import os
import socket
import struct
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))

RATE = 16000                    # what Home Assistant's Wyoming speech-to-text takes
MAX_FRAME = 5760                # 120 ms at 48 kHz: Opus's longest frame, a safe buffer at any rate
WHISPER = "core-whisper:10300"  # the Whisper app's hostname and Wyoming port on every Home Assistant OS: a default
CHUNK = RATE * 2                # one second of 16-bit mono per audio-chunk


def villa_settings() -> dict:
    path = os.path.join(HERE, "..", "villa.voice.yaml")
    if not os.path.exists(path):
        return {}
    import yaml
    return yaml.safe_load(open(path, encoding="utf-8")) or {}


# ------------------------------------------------------------------ Ogg/Opus → PCM
def ogg_packets(data: bytes) -> list[bytes]:
    """The logical packets of a single-stream Ogg file (RFC 3533): pages, then lacing."""
    packets, cur, pos = [], b"", 0
    while pos + 27 <= len(data):
        if data[pos:pos + 4] != b"OggS":
            raise ValueError("not an Ogg file")
        nseg = data[pos + 26]
        table = data[pos + 27:pos + 27 + nseg]
        body = pos + 27 + nseg
        for lace in table:
            cur += data[body:body + lace]
            body += lace
            if lace < 255:              # a lace under 255 ends the packet; 255 continues it (even on the next page)
                packets.append(cur)
                cur = b""
        pos = body
    return packets


def decode_opus(data: bytes) -> bytes:
    """16 kHz mono 16-bit PCM of an Ogg/Opus file (RFC 7845)."""
    packets = ogg_packets(data)
    if len(packets) < 2 or not packets[0].startswith(b"OpusHead"):
        raise ValueError("not an Opus voice message")
    pre_skip = struct.unpack_from("<H", packets[0], 10)[0]      # in 48 kHz samples
    lib = ctypes.CDLL(ctypes.util.find_library("opus") or "libopus.so.0")
    lib.opus_decoder_create.restype = ctypes.c_void_p
    lib.opus_decode.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int32,
                                ctypes.POINTER(ctypes.c_int16), ctypes.c_int, ctypes.c_int]
    lib.opus_decoder_destroy.argtypes = [ctypes.c_void_p]
    err = ctypes.c_int()
    # Opus decodes at any of its rates and downmixes a stereo stream to the one channel asked for.
    dec = lib.opus_decoder_create(RATE, 1, ctypes.byref(err))
    if err.value != 0 or not dec:
        raise RuntimeError(f"opus decoder: error {err.value}")
    out = bytearray()
    buf = (ctypes.c_int16 * MAX_FRAME)()
    try:
        for pkt in packets[2:]:                                  # [0] OpusHead, [1] OpusTags
            n = lib.opus_decode(dec, pkt, len(pkt), buf, MAX_FRAME, 0)
            if n < 0:
                raise RuntimeError(f"opus decode: error {n}")
            out += bytes(ctypes.string_at(buf, n * 2))
    finally:
        lib.opus_decoder_destroy(dec)
    skip = pre_skip * RATE // 48000 * 2
    return bytes(out[skip:])


def wav(pcm: bytes) -> bytes:
    return (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " +
            struct.pack("<IHHIIHH", 16, 1, 1, RATE, RATE * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm)


# ------------------------------------------------------------------ Whisper, asked directly (Wyoming)
class WyomingError(Exception):
    """Whisper answered something that is not a Wyoming event, or closed before its transcript."""


def wyoming_event(kind: str, data: dict | None = None, payload: bytes = b"") -> bytes:
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


def whisper_address(setting) -> tuple[str, int] | None:
    """villa.voice.yaml's `whisper:` as (host, port), the default when it names none; None when it is off (YAML
    reads a bare `off` as false)."""
    if setting is False or str(setting).strip().lower() in ("off", "false", "no"):
        return None
    host, _, port = str(setting or WHISPER).strip().rpartition(":")
    if not host or not port.isdigit():
        raise ValueError(f"whisper: {setting!r} is not host:port")
    return host, int(port)


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


def whisper(address: tuple[str, int], pcm: bytes, language: str | None = None,
            connect_s: float | None = None, total_s: float | None = None) -> dict:
    """{"text": …, "language"?: …} from Whisper over Wyoming. No language sent: Whisper's own setting applies
    (configured "auto": it finds the one spoken). Raises on anything else (no route, refused, timeout, no words)."""
    from vesta_shared.limits import limit
    connect_s = connect_s or limit(
        "voice.whisper_connect_s", 3, unit="seconds", group="run", lo=1, hi=30,
        says="How long the Agent waits to reach Whisper directly with a voice message.",
        reached="The voice message goes through the villa's speech-to-text instead.", told="")
    total_s = total_s or limit(
        "voice.whisper_timeout_s", 60, unit="seconds", group="run", lo=5, hi=110,
        says="How long Whisper, asked directly, may take to write a voice message out (keep it under the time a "
             "skill may take to prepare one).",
        reached="The voice message goes through the villa's speech-to-text instead.", told="")
    deadline = time.monotonic() + total_s
    host, port = address
    sock = _connect(host, port, connect_s)
    try:
        sock.settimeout(max(0.1, deadline - time.monotonic()))
        fmt = {"rate": RATE, "width": 2, "channels": 1}
        out = [wyoming_event("transcribe", {"language": language} if language else None),
               wyoming_event("audio-start", fmt)]
        out += [wyoming_event("audio-chunk", fmt, pcm[i:i + CHUNK]) for i in range(0, len(pcm), CHUNK)]
        out.append(wyoming_event("audio-stop"))
        sock.sendall(b"".join(out))
        f = sock.makefile("rb")
        while True:
            sock.settimeout(max(0.1, deadline - time.monotonic()))
            ev = read_event(f)
            if ev is None:
                raise WyomingError("Whisper closed before its transcript")
            if ev["type"] == "transcript":      # transcript-start, -chunk, info…: not the answer
                text = str(ev["data"].get("text") or "").strip()
                if not text:
                    raise WyomingError("Whisper heard no words")
                said = ev["data"].get("language")
                return {"text": text, **({"language": str(said)} if said else {})}
            if time.monotonic() > deadline:
                raise TimeoutError("Whisper did not answer in time")
    finally:
        sock.close()


# ------------------------------------------------------------------ which speech-to-text
def speech_to_text(cli, wanted: str | None) -> tuple[str | None, str | None]:
    """(entity, None) or (None, why not). Several in Home Assistant and none named: not guessed."""
    if wanted:
        return wanted, None
    ids = cli.all_entity_ids() if hasattr(cli, "all_entity_ids") else list(cli.states())
    found = sorted(e for e in ids if e.startswith("stt."))
    if len(found) == 1:
        return found[0], None
    if not found:
        return None, "Voice messages need a speech-to-text service in the villa's system (Whisper, for example)."
    return None, ("The villa's system has several speech-to-text services: name the one for voice messages "
                  "(stt: in the villa-concierge skill's villa.voice.yaml).")


def which_language(fixed: str | None, saved: str | None) -> dict:
    """The language to ask for: the villa's fixed one, or "auto" with the person's saved one behind it."""
    chosen = str(fixed or "auto")
    return {"language": chosen, "fallback": str(saved or "en")} if chosen == "auto" else {"language": chosen}


def prepare(audio: str, language: str | None, cli, stt: str | None = None, whisper_at=None) -> dict:
    """`whisper_at`: host:port or "off", over villa.voice.yaml's `whisper:`."""
    cfg = villa_settings()
    try:
        pcm = decode_opus(open(audio, "rb").read())
    except (ValueError, RuntimeError, OSError) as e:
        return {"error": f"This voice message could not be read ({e})."}
    if not pcm:
        return {"error": "This voice message is empty."}
    seconds = round(len(pcm) / 2 / RATE, 1)
    chosen = which_language(cfg.get("language"), language)
    direct = None
    if chosen["language"] == "auto":
        # only "auto" goes directly: a fixed language is what the villa's speech-to-text already takes
        try:
            address = whisper_address(whisper_at if whisper_at is not None else cfg.get("whisper", WHISPER))
            if address:
                return {**whisper(address, pcm), "via": "whisper", "seconds": seconds}
            direct = "off"
        except (OSError, WyomingError, ValueError) as e:
            direct = type(e).__name__       # a kind of failure, never an address or the words
    entity, why = speech_to_text(cli, stt or cfg.get("stt"))
    if not entity:
        return {"error": why}
    out = os.path.splitext(audio)[0] + ".wav"
    with open(out, "wb") as f:
        f.write(wav(pcm))
    return {"stt": {**chosen, "entity": entity, "wav": out, "seconds": seconds,
                    **({"whisper": direct} if direct else {})}}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prepare"])
    ap.add_argument("--audio", required=True)
    ap.add_argument("--language")
    ap.add_argument("--stt")
    ap.add_argument("--whisper", help="host:port, or off (over villa.voice.yaml's whisper:)")
    from vesta_shared import script
    script.arguments(ap, store="optional")   # the engine gives every hook the store; this one does not need it
    a = ap.parse_args(argv)
    res = prepare(a.audio, a.language, script.Context(a).client, a.stt, a.whisper)
    print(json.dumps(res))
    return 0 if "stt" in res or "text" in res else 2


if __name__ == "__main__":
    sys.exit(main())
