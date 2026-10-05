#!/usr/bin/env python3
"""villa-concierge: a voice message, made ready for Home Assistant's speech-to-text.

  voice.py prepare --audio voice.ogg --language fr [--stt stt.x] [--fixture-dir DIR]

Telegram sends a voice message as Ogg/Opus; Home Assistant's speech-to-text
(Whisper over Wyoming, and the others) takes 16 kHz, 16-bit mono WAV. This
script decodes the audio (libopus, the system library), writes the WAV beside
it, and says which speech-to-text and which language to use:

  {"stt": {"entity": "stt.…", "language": "fr", "wav": "/…/voice.wav", "seconds": 3.2}}
  {"error": "plain words for the person"}

The engine then sends the WAV to Home Assistant (it holds the token; a script
never does) and treats the text as the message.

Every choice is the villa's, in ../villa.voice.yaml (optional, kept by updates):
  stt: stt.faster_whisper      the speech-to-text, when Home Assistant has several
  language: fr                 always this language, instead of the person's saved one
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
sys.path.insert(0, os.path.join(HERE, "..", "..", "_shared"))

RATE = 16000                    # what Home Assistant's Wyoming speech-to-text takes
MAX_FRAME = 5760                # 120 ms at 48 kHz: Opus's longest frame, a safe buffer at any rate


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
        return None, "Voice messages need a speech-to-text in Home Assistant (Whisper, for example)."
    return None, ("Home Assistant has several speech-to-text services: name the one for voice messages "
                  "(stt: in the villa-concierge skill's villa.voice.yaml).")


def prepare(audio: str, language: str | None, cli, stt: str | None = None) -> dict:
    cfg = villa_settings()
    entity, why = speech_to_text(cli, stt or cfg.get("stt"))
    if not entity:
        return {"error": why}
    try:
        pcm = decode_opus(open(audio, "rb").read())
    except (ValueError, RuntimeError, OSError) as e:
        return {"error": f"This voice message could not be read ({e})."}
    if not pcm:
        return {"error": "This voice message is empty."}
    out = os.path.splitext(audio)[0] + ".wav"
    with open(out, "wb") as f:
        f.write(wav(pcm))
    return {"stt": {"entity": entity, "language": str(cfg.get("language") or language or "en"), "wav": out,
                    "seconds": round(len(pcm) / 2 / RATE, 1)}}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prepare"])
    ap.add_argument("--audio", required=True)
    ap.add_argument("--language")
    ap.add_argument("--stt")
    ap.add_argument("--fixture-dir"); ap.add_argument("--zone")
    ap.add_argument("--store")      # the engine gives every hook the store; this one does not need it
    a = ap.parse_args(argv)
    from vesta_shared.ha_client import client_from_args
    res = prepare(a.audio, a.language, client_from_args(a), a.stt)
    print(json.dumps(res))
    return 0 if "stt" in res else 2


if __name__ == "__main__":
    sys.exit(main())
