#!/usr/bin/env python3
"""villa-concierge: a voice message's audio, made ready, and the villa's plan for writing it out.

  voice.py prepare --audio voice.ogg --language fr [--stt stt.x] [--whisper host:port|off] [--fixture-dir DIR]
  voice.py speak --text answer.txt --language en_US --voice en_US-lessac-medium

(prepare --language: the person's saved language. speak --language/--voice: the villa's voice settings' own.)

`speak` (ticket 24 of "One inbox", VESTA answers aloud; owner 2026-10-29: "I spoke in French and Piper responded in
English despite the response being written in French"): the voice an answer is said in. VESTA answers in the language
it was asked in, and the villa's voice settings name ONE voice: the answer's language is told from its common short
words (WORDS, and villa.voice.yaml `words:` for more), then
  {"language": "en_US", "voice": "en_US-lessac-medium"}   the settings' own voice, when it is their language
  {"language": "fr_FR", "voice": "fr_FR-siwis-medium"}    villa.voice.yaml `voices: {fr: …}`, else Piper's (PIPER_VOICES)
  {"say": "This answer could not be spoken in French: …"} no voice for that language: never read in another one

Telegram sends a voice message as Ogg/Opus; Whisper and the villa system's
speech-to-text take 16 kHz, 16-bit mono audio. This script decodes the audio
(libopus, the system library) — or reads the WAV a question spoken on the
villa's wall tablet already is (16 kHz, 16-bit, mono) — writes it as a WAV
beside it, and answers the
PLAN the engine runs in order, stopping at the first words, all within the one
time a voice message has (voice.timeout_s):

  {"wav": "/…/voice.wav", "seconds": 3.2,
   "attempts": [{"whisper": "core-whisper:10300"},
                {"stt": "stt.…", "language": "auto"},
                {"stt": "stt.…", "language": "fr"}],
   "down": "…",                              (what the person reads when every way failed: a service down)
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
  voices:                      a voice for each language an answer may be in, beside the voice settings' own, over
    fr: fr_FR-siwis-medium     PIPER_VOICES (the text-to-speech's own voice name; its language is the name's start)
  words:                       more common words telling a language (beside WORDS)
    id: [yang, dan, di, ini]
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


def read_wav(data: bytes) -> bytes:
    """The PCM of a WAV already in the shape Whisper takes (16 kHz, 16-bit, mono): a question spoken on the villa's
    wall tablet arrives so (owner, 2026-10-29: hold to talk). Any other WAV is refused, never converted."""
    if data[8:12] != b"WAVE":
        raise ValueError("not a WAV recording")
    at, fmt = 12, None
    while at + 8 <= len(data):
        name, size = data[at:at + 4], struct.unpack_from("<I", data, at + 4)[0]
        if name == b"fmt " and size >= 16:
            fmt = struct.unpack_from("<HHIIHH", data, at + 8)
        elif name == b"data":
            if not fmt or fmt[0] != 1 or fmt[1] != 1 or fmt[2] != RATE or fmt[5] != 16:
                raise ValueError(f"a recording that is not {RATE} Hz, 16-bit, mono")
            return data[at + 8:at + 8 + size]
        at += 8 + size + (size & 1)
    raise ValueError("a WAV with no sound")


def read_audio(data: bytes) -> bytes:
    """16 kHz mono 16-bit PCM of a voice message: a Telegram voice note (Ogg/Opus) or the tablet's WAV."""
    return read_wav(data) if data[:4] == b"RIFF" else decode_opus(data)


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


# what the person reads when every way of writing the message out failed or was refused (Whisper out of reach, the
# villa's speech-to-text answering errors): the service is down, not the person unclear (review, 2026-10-23: each
# note was told "could not make out, try again")
DOWN = "Voice messages can't be written out right now. Please write it."


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
        pcm = read_audio(open(audio, "rb").read())
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
            "attempts": attempts(fixed, language, direct, entity), "down": DOWN,
            **({} if entity else {"no_stt": NO_STT})}


# ------------------------------------------------------------------ the voice an answer is said in
#: Common short words of each language, the ones nearly every sentence holds: an answer's language is the one whose words
#: it holds most. A word in two lists ("la": French, Spanish, Italian) counts for each: the others decide.
WORDS = {
    "en": "the and is are you your it this that to of in on for with be was have not what which there".split(),
    "fr": "le la les et est sont vous votre je de du des un une dans pour avec pas ce cette qui que il elle".split(),
    "de": "der die das und ist sind sie ich nicht ein eine mit für auf den dem zu im ihr".split(),
    "es": "el la los las y es son usted su de del un una en para con no que esta este".split(),
    "it": "il lo la gli le e è sono lei suo di del un una in per con non che questo questa".split(),
    "nl": "de het een en is zijn u uw ik niet van in op voor met dat deze die".split(),
    "id": "yang dan di ini itu dengan untuk tidak dari ke ada adalah saya anda akan sudah bisa".split(),
}
#: ⚠️ A VOICE FOR EVERY LANGUAGE OF THE PAGE, SHIPPED (owner, 2026-10-30: "make sure this is delivered with the baseline
#: skills"): Piper's voice for each, used when the villa's own voice is a Piper one (PIPER_NAME: its name's shape) and
#: villa.voice.yaml names none for that language. Each checked on 2026-10-30 in the Piper app's own list
#: (wyoming_piper/voices.json); Japanese has none there, so a Japanese answer stays in words.
PIPER_VOICES = {"fr": "fr_FR-siwis-medium", "de": "de_DE-thorsten-medium", "es": "es_ES-davefx-medium",
                "it": "it_IT-paola-medium", "nl": "nl_NL-mls-medium", "id": "id_ID-news_tts-medium",
                "zh": "zh_CN-huayan-medium", "ko": "ko_KR-kss-medium"}
#: A Piper voice's name: language_REGION-name-quality ("en_US-lessac-medium").
PIPER_NAME = r"^[a-z]{2,3}_[A-Z]{2}-[A-Za-z0-9_]+-(x_low|low|medium|high)$"
#: What the person reads of a language (its English name), when no voice says it: the languages a person may be given
#: on the VESTA Agent page, and those an answer is told in.
NAMES = {"en": "English", "fr": "French", "id": "Indonesian", "de": "German", "es": "Spanish", "it": "Italian",
         "nl": "Dutch", "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "pt": "Portuguese"}
#: ⚠️ THE LANGUAGES WRITTEN WITHOUT SPACES ARE TOLD BY THEIR LETTERS (owner, 2026-10-29: every language of the page
#: prepared): Korean by its Hangul, Japanese by its kana (its text holds Chinese characters too), Chinese by its
#: characters alone. A share of the letters is enough (an answer quotes a device's Latin name now and then): a third, a
#: tenth for the kana (a Japanese sentence holds more Chinese characters than kana).
SCRIPTS = (("ko", ((0xAC00, 0xD7A3), (0x1100, 0x11FF), (0x3130, 0x318F)), 3),
           ("ja", ((0x3040, 0x30FF),), 10),
           ("zh", ((0x4E00, 0x9FFF), (0x3400, 0x4DBF)), 3))


def language_of(text: str, words: dict) -> str | None:
    """The language whose common words `text` holds most (a tie, or none at all: None); one written without spaces by
    its letters (SCRIPTS) first."""
    import re
    letters = [ord(c) for c in text if c.isalpha()]
    for lang, ranges, share in SCRIPTS:
        if letters and sum(any(a <= c <= b for a, b in ranges) for c in letters) * share >= len(letters):
            return lang
    seen = [w for w in re.split(r"[^\w]+", text.lower()) if w]
    score = {lang: sum(w in set(ws) for w in seen) for lang, ws in words.items()}
    best = sorted(score.items(), key=lambda kv: -kv[1])
    if not best or best[0][1] == 0 or (len(best) > 1 and best[1][1] == best[0][1]):
        return None
    return best[0][0]


def speak(text: str, language: str | None, voice: str | None) -> dict:
    """The language and voice `text` is said in, or what the person reads instead (module doc)."""
    cfg = villa_settings()
    words = {**WORDS, **{str(k): [str(w).lower() for w in v] for k, v in (cfg.get("words") or {}).items()
                         if isinstance(v, list)}}
    own = str(language or "").replace("-", "_").split("_")[0].lower() or None
    said = language_of(text, words) or own
    if said == own:
        return {"language": language, "voice": voice}
    import re
    shipped = PIPER_VOICES if re.match(PIPER_NAME, str(voice or "")) else {}
    named = str({**shipped, **(cfg.get("voices") or {})}.get(said) or "").strip()
    if named:
        return {"language": named.split("-")[0], "voice": named}
    name = NAMES.get(said, said)
    return {"say": f"This answer could not be spoken in {name}: the villa has no {name} voice "
                   "(the villa-concierge skill's villa.voice.yaml names one)."}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prepare", "speak"])
    ap.add_argument("--audio")
    ap.add_argument("--text", help="speak: a file holding the answer's words")
    ap.add_argument("--voice", help="speak: the villa's voice settings' own voice")
    ap.add_argument("--language")
    ap.add_argument("--stt")
    ap.add_argument("--whisper", help="host:port, or off (over villa.voice.yaml's whisper:)")
    from vesta_shared import script
    script.arguments(ap, store="optional")   # the engine gives every hook the store; this one does not need it
    a = ap.parse_args(argv)
    if a.cmd == "speak":
        print(json.dumps(speak(open(a.text, encoding="utf-8").read() if a.text else "", a.language, a.voice)))
        return 0
    if not a.audio:
        ap.error("prepare needs --audio")
    res = prepare(a.audio, a.language, a.stt, a.whisper)
    print(json.dumps(res))
    return 0 if "attempts" in res else 2


if __name__ == "__main__":
    sys.exit(main())
