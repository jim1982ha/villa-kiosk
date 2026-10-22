#!/usr/bin/env python3
"""villa-concierge: a voice message's audio, made ready, and the villa's plan for writing it out.

  voice.py prepare --audio voice.ogg --language fr [--stt stt.x] [--whisper host:port|off] [--fixture-dir DIR]

(--language: the person's saved language.)

Telegram sends a voice message as Ogg/Opus; Whisper and the villa system's
speech-to-text take 16 kHz, 16-bit mono audio. This script decodes the audio
(libopus, the system library), writes it as a WAV beside it, and answers the
PLAN the engine runs in order, stopping at the first words, all within the one
time a voice message has (voice.timeout_s):

  {"wav": "/…/voice.wav", "seconds": 3.2,
   "attempts": [{"whisper": "core-whisper:10300"},
                {"stt": "stt.…", "language": "auto"},
                {"stt": "stt.…", "language": "fr"}],
   "no_stt": {"none": "…", "several": "…"}}   (only when villa.voice.yaml names no speech-to-text)
  {"error": "plain words for the person"}

`"stt": null` (villa.voice.yaml names none): the villa's ONLY speech-to-text, which the engine looks up when that
attempt is reached. ⚠️ NOT LOOKED UP HERE (review, 2026-10-23): this script read the villa's whole device list
before Whisper was tried, and when that read failed the voice message ended unread although Whisper, which needs no
device list, would have answered. `no_stt` is what the person reads when the villa has none, or several and none
named, and nothing else gave words.

⚠️ WHISPER FIRST (owner, 2026-10-22, "the Agent asks Whisper directly"): the
villa system's speech-to-text refuses "auto" (415: it takes only the languages
Whisper lists), so through it a French voice note was forced to English and
Whisper TRANSLATED it. The Whisper app asked itself, over Wyoming with no
language (no token involved), finds the one spoken. Behind it, the villa's
speech-to-text in "auto" (the engine skips it once refused) and then in the
person's saved language.

Every choice is the villa's, in ../villa.voice.yaml (optional, kept by updates):
  whisper: core-whisper:10300  the default: the Whisper app's own hostname on Home Assistant OS
  whisper: off                 never directly: the villa system's speech-to-text only
  stt: stt.faster_whisper      the speech-to-text, when the villa's system has several
  language: fr                 always this language, through the villa's system only: no "auto", no direct Whisper
  language: auto               the default: the language spoken, else the person's saved one
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

RATE = 16000                    # what Home Assistant's Wyoming speech-to-text takes
MAX_FRAME = 5760                # 120 ms at 48 kHz: Opus's longest frame, a safe buffer at any rate
WHISPER = "core-whisper:10300"  # the Whisper app's hostname and Wyoming port on every Home Assistant OS: a default


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


# ------------------------------------------------------------------ which Whisper, which speech-to-text, in which order
def whisper_address(setting) -> str | None:
    """villa.voice.yaml's `whisper:`: "host:port" as written (the engine checks its shape), the default when it names
    none; None when it is off (YAML reads a bare `off` as false)."""
    if setting is False or str(setting).strip().lower() in ("off", "false", "no"):
        return None
    return str(setting or WHISPER).strip()


# what the person reads when villa.voice.yaml names no speech-to-text, nothing gave words, and the villa's system has
# none / several (the engine says which)
NO_STT = {"none": "Voice messages need a speech-to-text service in the villa's system (Whisper, for example).",
          "several": "The villa's system has several speech-to-text services: name the one for voice messages "
                     "(stt: in the villa-concierge skill's villa.voice.yaml)."}


def attempts(fixed: str | None, saved: str | None, whisper_at: str | None, entity: str | None) -> list[dict]:
    """The ways to write the message out, in order (the engine stops at the first words). `entity` None: the
    villa's only speech-to-text (the engine finds it).

    A fixed language: the villa's speech-to-text in it, only. Otherwise ("auto", the default): Whisper directly
    (it finds the language spoken), then the villa's speech-to-text in "auto" (the engine skips it once the villa's
    system has refused it), then in the person's saved language."""
    chosen = str(fixed or "auto")
    if chosen != "auto":
        return [{"stt": entity, "language": chosen}]
    out: list[dict] = [{"whisper": whisper_at}] if whisper_at else []
    out.append({"stt": entity, "language": "auto"})
    if str(saved or "en") != "auto":
        out.append({"stt": entity, "language": str(saved or "en")})
    return out


def prepare(audio: str, language: str | None, stt: str | None = None, whisper_at=None) -> dict:
    """`whisper_at`: host:port or "off", over villa.voice.yaml's `whisper:`."""
    cfg = villa_settings()
    try:
        pcm = decode_opus(open(audio, "rb").read())
    except (ValueError, RuntimeError, OSError) as e:
        return {"error": f"This voice message could not be read ({e})."}
    if not pcm:
        return {"error": "This voice message is empty."}
    fixed = cfg.get("language")
    # only "auto" goes directly: a fixed language is what the villa's speech-to-text already takes
    direct = whisper_address(whisper_at if whisper_at is not None else cfg.get("whisper", WHISPER)) \
        if str(fixed or "auto") == "auto" else None
    entity = str(stt or cfg.get("stt") or "").strip() or None
    out = os.path.splitext(audio)[0] + ".wav"
    with open(out, "wb") as f:
        f.write(wav(pcm))
    return {"wav": out, "seconds": round(len(pcm) / 2 / RATE, 1),
            "attempts": attempts(fixed, language, direct, entity), **({} if entity else {"no_stt": NO_STT})}


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
    res = prepare(a.audio, a.language, a.stt, a.whisper)
    print(json.dumps(res))
    return 0 if "attempts" in res else 2


if __name__ == "__main__":
    sys.exit(main())
