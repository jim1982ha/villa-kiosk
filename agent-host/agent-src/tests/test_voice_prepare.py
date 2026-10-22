"""villa-concierge's voice.py: a Telegram voice message made ready, and the villa's plan for writing it out.

The fixture is a 1 s, 440 Hz tone encoded as Telegram encodes a voice note (Ogg/Opus, 48 kHz mono): decoding must
give 1 s of 16 kHz mono that is still a 440 Hz tone — a decoder that returns noise, the wrong rate or nothing fails
here, not on the villa. The plan is the skill's (skills before code): which Whisper, whether at all, a fixed
language, the order; the engine runs it (test_transcriber.py)."""
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


def audio(tmp_path):
    a = tmp_path / "v.ogg"
    shutil.copy(TONE, a)
    return str(a)


def test_the_tone_decodes_to_one_second_of_16khz_mono_at_440hz():
    pcm = voice.decode_opus(open(TONE, "rb").read())
    samples = struct.unpack(f"<{len(pcm) // 2}h", pcm)
    assert abs(len(samples) / voice.RATE - 1.0) < 0.05
    rms = math.sqrt(sum(s * s for s in samples) / len(samples))
    assert rms > 1000                                   # a tone, not silence
    crossings = sum(1 for a, b in zip(samples, samples[1:]) if (a < 0) != (b < 0))
    assert abs(crossings / 2 - 440) < 15                # still 440 Hz: the rate is right


def test_prepare_writes_a_wav_and_the_plan(tmp_path):
    res = voice.prepare(audio(tmp_path), "fr", Ids(["light.x", "stt.whisper"]), whisper_at="whisper.lan:10301")
    # Whisper first (it finds the language), then the villa's speech-to-text in "auto", then the person's language
    assert res["attempts"] == [{"whisper": "whisper.lan:10301"}, {"stt": "stt.whisper", "language": "auto"},
                               {"stt": "stt.whisper", "language": "fr"}]
    assert abs(res["seconds"] - 1.0) < 0.1 and "otherwise" not in res
    head = open(res["wav"], "rb").read(44)
    assert head[:4] == b"RIFF" and head[8:16] == b"WAVEfmt "
    _, fmt, ch, rate, _, _, bits = struct.unpack_from("<IHHIIHH", head, 16)
    assert (fmt, ch, rate, bits) == (1, 1, 16000, 16)


def test_the_plan_follows_the_villas_choices():
    assert voice.attempts(None, "fr", "w:1", "stt.a") == [{"whisper": "w:1"}, {"stt": "stt.a", "language": "auto"},
                                                          {"stt": "stt.a", "language": "fr"}]
    assert voice.attempts("auto", None, None, "stt.a") == [{"stt": "stt.a", "language": "auto"},
                                                           {"stt": "stt.a", "language": "en"}]   # Whisper off
    assert voice.attempts("de", "fr", "w:1", "stt.a") == [{"stt": "stt.a", "language": "de"}]   # fixed: that only
    assert voice.attempts(None, "fr", "w:1", None) == [{"whisper": "w:1"}]      # no speech-to-text chosen
    assert voice.attempts("de", "fr", "w:1", None) == []
    assert voice.attempts(None, "auto", None, "stt.a") == [{"stt": "stt.a", "language": "auto"}]   # never twice


def test_the_whisper_setting():
    assert voice.whisper_address(None) == "core-whisper:10300" == voice.whisper_address("")
    assert voice.whisper_address(" whisper.lan:10301 ") == "whisper.lan:10301"
    for off in ("off", "OFF", False, "false", "no"):
        assert voice.whisper_address(off) is None, off


def test_a_fixed_language_never_names_whisper(tmp_path, monkeypatch):
    monkeypatch.setattr(voice, "villa_settings", lambda: {"language": "de"})
    res = voice.prepare(audio(tmp_path), "fr", Ids(["stt.a"]), whisper_at="w:1")
    assert res["attempts"] == [{"stt": "stt.a", "language": "de"}]


def test_the_speech_to_text_is_never_guessed(tmp_path):
    assert voice.speech_to_text(Ids(["stt.a"]), None) == ("stt.a", None)
    assert voice.speech_to_text(Ids(["stt.a", "stt.b"]), None)[0] is None
    assert voice.speech_to_text(Ids([]), None)[0] is None
    assert voice.speech_to_text(Ids(["stt.a", "stt.b"]), "stt.b") == ("stt.b", None)
    # several and none named: Whisper alone, and the person told why if it gives no words; Whisper off too: refused
    res = voice.prepare(audio(tmp_path), "fr", Ids(["stt.a", "stt.b"]), whisper_at="w:1")
    assert res["attempts"] == [{"whisper": "w:1"}] and "several speech-to-text" in res["otherwise"]
    res = voice.prepare(audio(tmp_path), "fr", Ids(["stt.a", "stt.b"]), whisper_at="off")
    assert "several speech-to-text" in res["error"] and "attempts" not in res


def test_not_audio_is_said_plainly(tmp_path):
    bad = tmp_path / "v.ogg"
    bad.write_bytes(b"not an ogg file at all, just text")
    assert "could not be read" in voice.prepare(str(bad), "en", Ids(["stt.a"]), whisper_at="off")["error"]
