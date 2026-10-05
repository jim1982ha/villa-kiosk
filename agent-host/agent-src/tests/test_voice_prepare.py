"""villa-concierge's voice.py: a Telegram voice message, made ready for Home Assistant's speech-to-text.

The fixture is a 1 s, 440 Hz tone encoded as Telegram encodes a voice note (Ogg/Opus, 48 kHz mono):
decoding must give 1 s of 16 kHz mono that is still a 440 Hz tone — a decoder that returns noise, the
wrong rate or nothing fails here, not on the villa.
"""
import math
import os
import shutil
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "starter", "skills", "villa-concierge", "scripts"))
import voice  # noqa: E402

TONE = os.path.join(ROOT, "tests", "fixtures", "voice_440hz.ogg")


class Ids:
    def __init__(self, ids):
        self.ids = ids

    def all_entity_ids(self):
        return self.ids


def test_the_tone_decodes_to_one_second_of_16khz_mono_at_440hz():
    pcm = voice.decode_opus(open(TONE, "rb").read())
    samples = struct.unpack(f"<{len(pcm) // 2}h", pcm)
    assert abs(len(samples) / voice.RATE - 1.0) < 0.05
    rms = math.sqrt(sum(s * s for s in samples) / len(samples))
    assert rms > 1000                                   # a tone, not silence
    crossings = sum(1 for a, b in zip(samples, samples[1:]) if (a < 0) != (b < 0))
    assert abs(crossings / 2 - 440) < 15                # still 440 Hz: the rate is right


def test_prepare_writes_a_wav_home_assistant_takes(tmp_path):
    audio = tmp_path / "v.ogg"
    shutil.copy(TONE, audio)
    res = voice.prepare(str(audio), "fr", Ids(["light.x", "stt.whisper"]))
    st = res["stt"]
    assert st["entity"] == "stt.whisper" and st["language"] == "fr" and abs(st["seconds"] - 1.0) < 0.1
    head = open(st["wav"], "rb").read(44)
    assert head[:4] == b"RIFF" and head[8:16] == b"WAVEfmt "
    _, fmt, ch, rate, _, _, bits = struct.unpack_from("<IHHIIHH", head, 16)
    assert (fmt, ch, rate, bits) == (1, 1, 16000, 16)


def test_the_speech_to_text_is_never_guessed():
    assert voice.speech_to_text(Ids(["stt.a"]), None) == ("stt.a", None)
    assert voice.speech_to_text(Ids(["stt.a", "stt.b"]), None)[0] is None
    assert voice.speech_to_text(Ids([]), None)[0] is None
    assert voice.speech_to_text(Ids(["stt.a", "stt.b"]), "stt.b") == ("stt.b", None)


def test_not_audio_is_said_plainly(tmp_path):
    bad = tmp_path / "v.ogg"
    bad.write_bytes(b"not an ogg file at all, just text")
    assert "could not be read" in voice.prepare(str(bad), "en", Ids(["stt.a"]))["error"]
