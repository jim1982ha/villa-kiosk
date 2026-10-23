"""An alert card's own words in the language each chat reads: translated by the AI once per sentence PATTERN, then
from memory.

    Test lock has been "unavailable" for over 10 s.          ← the villa's automation wrote it (English, its template)
    {1} has been {2} for over {3} s.                         ← its skeleton: every value a numbered slot (`mask`)
    {1} est {2} depuis plus de {3} s.                        ← translated ONCE per (skeleton, language), kept (State)
    Test lock est "unavailable" depuis plus de 10 s.         ← filled with the card's own values, never translated

⚠️ NEVER BLOCK, ALWAYS FALL BACK (owner, 2026-10-23: "translated on the fly by the AI", with the card going out as
today). A card goes out — or is taken over — in English at once; a chat whose language has no translation of one of
its lines yet gets it later (a referenced background task, bounded by `translate_seconds`) and its copy is edited
quietly. Any failure — the AI's error, its time limit, no credit, an answer that drops a slot, an edit Telegram
refuses — leaves the English on the card. Nothing about delivery, the chase, the buttons or the Kiosk waits on this.

⚠️ ONE TRANSLATION PER PATTERN (owner, 2026-10-23: "replace every variable part by slots and translate only the
skeleton, cached"): 'Main Power Device Power has been "unavailable" for over 10 min.' and '… for over 20 min.' share
one cached translation; after the first time a card arrives already translated, with no AI call. The slots are
universal — numbers with their units, a duration's numbers (its unit stays in the skeleton, translated once), times,
dates, quoted values, bracketed codes, incident tags — plus the names of the incident's own devices and rooms
(`incident_names`), longest first. Values are never translated. What is kept, asked again or forgotten is
phrases.Phrases' rule (an echo is not kept, a failure rests, the instructions' fingerprint).

⚠️ INSIDE THE CHAT ANSWERS, NOT A JOB (owner, 2026-10-23: "I shall not see a dedicated Job for this, since it shall be
fully integrated in the existing alert-desk skill, 'inside' the `Chat answers` setting"): a run has the Chat answers'
brain and limit per reply (policy.yaml settings.profile, settings.reply_limit_usd — turn.translation_terms, the same
reading as a chat's turn), always set, so a chat that reads another language always gets it; the skill's skill.yaml
`translate:` gives only the instructions (skills before code). 0.12.334–335 ran it with the alert desk's own
settings.skill_ai pair, listed with the AI jobs and not run until "Add them" set it: a villa's pair from then is never
read (left in policy.yaml, harmless). One run is one prompt holding every missing line of a card for one language, a
strict JSON answer, no tool; its Costs row is "Chat replies › alert translation" (agent_records.TRANSLATION).

What each chat's copy shows is kept in its record as `tr` ({lang, body}: layout.render draws it on a copy headed in
that language); a redraw (IncidentThread.sync, a reminder, a close) draws it again from the cache, so the English
never comes back on a translated chat's copy.
"""
from __future__ import annotations

import asyncio
import functools
import json
import logging
import re
from typing import Callable

from vesta_shared.limits import limit

from . import layout, runner
from .phrases import SLOT, Phrases, fingerprint, wordy

log = logging.getLogger("vesta.translation")
#: What a masked span is replaced with while the next patterns look (the same length: positions stay; no pattern
#: matches it — a private-use character is neither a word character nor a digit).
_HIDDEN = ""

_MONTHS = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?"
_DAYS = r"(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*\.?"
#: A number as the automations write one: a sign or "about" mark, thousands separators, decimals.
_NUM = r"[+\-−~≈±]?(?:\d{1,3}(?:[,  ]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)"
#: A measurement's units: part of the value's slot ("1310 W"), the same in every language. ⚠️ NEVER A DURATION'S
#: (s, min, h, d): those stay in the skeleton ("Held {1} h {2} min"), translated once — "1 h 30 min" masks both numbers.
_UNIT = (r"(?:%|‰|°[CF]?|[kMG]?Wh?|[kM]?VA|[kM]?var|mV|V|mA|A|k?Hz|lux|lx|ppm|ppb|dBm?|mm|cm|km|m²|m³|m3|m|ml|mL|L|l"
         r"|kg|g|m?bar|hPa|kPa|Pa|psi|µg/m³|ug/m3|rpm|[lL]/min|m³/h|kWh/d)")


def _named(names) -> list[re.Pattern]:
    """The incident's device and room names as patterns, longest first ("Living Room AC" before "Living Room"), each a
    whole word or words.

    ⚠️ ANY CAPITALS, BUT A ONE-WORD NAME AS WRITTEN (review, 2026-10-23): matched as written, "Test Lock" in the
    automation's text missed the pack's "Test lock" and went to the AI as words — translated on the card ("Test
    serrure"), and a pattern of its own per device. A name of two words or more is matched in any capitals. A one-word
    name ("Office", "Pool", "Garage") is also an everyday word: in any capitals it would take "the pool" out of a
    sentence and leave it English on a French card, so it is matched with its own capitals only."""
    seen: dict[str, str] = {}
    for n in names or ():
        n = " ".join(n.split()) if isinstance(n, str) else ""
        if len(n) >= 3:
            seen.setdefault(n.casefold() if " " in n else n, n)
    out = []
    for n in sorted(seen.values(), key=len, reverse=True):
        words = r"\s+".join(re.escape(w) for w in n.split(" "))
        out.append(re.compile(rf"(?<!\w){words}(?!\w)", re.IGNORECASE if " " in n else 0))
    return out


def _patterns(names) -> list[tuple[re.Pattern, int]]:
    """The variable parts of a line, in the order they are looked for (an earlier one's span is not looked at again):
    (pattern, the group that is the slot)."""
    return [
        (re.compile(r"\{[^{}\n]*\}"), 0),                                     # a brace in the text itself
        (re.compile(r"(?<![\w#])#\d+(?:-P\d+)?(?!\w)"), 0),                   # an incident: #78, #78-P2
        (re.compile(r"\[[^\[\]\n]{1,40}\]"), 0),                              # a code: [PM-01], [ROI-03]
        (re.compile(r'"[^"\n]{1,80}"|“[^”\n]{1,80}”|«[^»\n]{1,80}»'), 0),     # a quoted value: "unavailable"
        *[(pat, 0) for pat in _named(names)],                                # the incident's devices and rooms
        (re.compile(rf"(?<!\w)(?:{_DAYS},?\s+)?\d{{1,2}}\s+{_MONTHS}(?:\s+\d{{4}})?(?!\w)"), 0),   # Fri 23 Oct
        (re.compile(rf"(?<!\w)(?:{_DAYS},?\s+)?{_MONTHS}\s+\d{{1,2}}(?:,?\s+\d{{4}})?(?!\w)"), 0),  # Oct 23, 2026
        (re.compile(r"(?<![\w/.-])(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})"
                    r"(?![\w/.-]?\d)"), 0),                                    # 2026-10-23, 23/10/2026
        (re.compile(r"(?<![\w:])\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?(?![\w:])"), 0),        # 18:30, 15:19:31
        (re.compile(r"(?<![\w.])\d+(?:\.\d+){2,}(?![\w.]?\d)"), 0),          # a version, an address: 1.2.3
        (re.compile(r"(?<![\w.])\d+(?:st|nd|rd|th)(?!\w)"), 0),               # 2nd
        (re.compile(rf"(?<![\w.,]){_NUM}(?:\s?{_UNIT}(?!\w))?(?!\d)"), 0),    # 1310 W, +2367 %, 3.55; "10" of "10 min"
    ]


def mask(line: str, names=()) -> tuple[str, list[str]]:
    """A line as its skeleton and its values: every variable part a numbered slot, numbered left to right.

    >>> mask('Main Power Device Power has been "unavailable" for over 10 min.', ["Main Power Device Power"])
    ('{1} has been {2} for over {3} min.', ['Main Power Device Power', '"unavailable"', '10'])"""
    work, spans = line, []
    for pat, group in _patterns(names):
        for m in pat.finditer(work):
            s, e = m.span(group)
            value = line[s:e].rstrip()
            if not value.strip():
                continue
            e = s + len(value)
            spans.append((s, e))
            work = work[:s] + _HIDDEN * (e - s) + work[e:]
    spans.sort()
    out, values, at = [], [], 0
    for s, e in spans:
        out.append(line[at:s])
        values.append(line[s:e])
        out.append("{%d}" % len(values))
        at = e
    out.append(line[at:])
    return "".join(out), values


def fill(skeleton: str, values: list[str]) -> str:
    """A skeleton with its slots given back their values, as written."""
    return SLOT.sub(lambda m: values[int(m.group(1)) - 1] if 0 < int(m.group(1)) <= len(values) else m.group(0),
                    skeleton)


def incident_names(pack, entities, live: dict[str, str] | None = None) -> list[str]:
    """The names an incident's text may say of its own devices: first each entity's name as the villa's system gave it
    when the alert arrived (`live`: its friendly name, app.Vesta.on_critical), then its name, its device's, its
    reading's and its room's as the knowledge pack has them.

    ⚠️ THE ALERT'S OWN NAMES FIRST (review, 2026-10-23): from the pack alone, an alert before the first nightly build —
    or of a device added since — had no names: "Test lock" went to the AI as words, and each device made its own
    pattern and its own run."""
    out: list[str] = []
    for e in entities or ():
        names = [(live or {}).get(e)]
        if pack is not None:
            row = pack.row(e) or {}
            names += [pack.name_of(e), pack.device_name(e, None), pack.reading_name(e, None), row.get("area")]
        for n in names:
            if isinstance(n, str) and n.strip() and n not in out:
                out.append(n)
    return out


def alert_names(reader, entities) -> dict[str, str]:
    """The friendly names the villa's system gives `entities` now ({entity: name}), read through the app's reader (a
    blocking read: app.Vesta.on_critical runs it in a thread, within names_seconds())."""
    ids = [e for e in entities if isinstance(e, str) and "." in e]
    if not ids:
        return {}
    out = {}
    for eid, st in (reader.states(ids) or {}).items():
        name = ((st or {}).get("attributes") or {}).get("friendly_name")
        if isinstance(name, str) and name.strip():
            out[eid] = name.strip()
    return out


def names_seconds() -> int:
    # ⚠️ 1 s (owner, 2026-10-23: "make sure none of this is blocking"): the read sits before the alert desk; a slow
    # villa leaves the names already known, never a later alert
    return limit("alerts.names_read_seconds", 1, unit="seconds", group="read", lo=1, hi=60,
                 says="How long the agent waits, when an alert arrives, for the villa's system to name its devices.",
                 reached="The names the knowledge pack has are used: a device it does not know may be translated as "
                         "words on that card.", told="")


def translate_seconds() -> int:
    return limit("alerts.translate_seconds", 90, unit="seconds", group="ai", lo=10, hi=600,
                 says="How long the AI may take to put an alert card's own words in a chat's language.",
                 reached="The card stays in English; the AI is asked those words again once the wait after a "
                         "failed translation has passed.", told="")


@functools.cache
def rules() -> str:
    """The engine's slot rules as text — the patterns that make a skeleton and the contract the prompt states — for the
    kept translations' fingerprint (phrases.fingerprint): a release that changes either starts afresh."""
    return "\n".join([*(p.pattern for p, _ in _patterns(())), prompt("{language}", [])])


def prompt(language: str, skeletons: list[str]) -> str:
    """The one message of a translation run (the skill's own instructions are its system prompt): the engine's
    contract — the slots and the strict answer its reader checks (`answer`) — and the lines."""
    return (f"Translate each line of this JSON list from English into {language}. Every {{1}}, {{2}}… stands for a value "
            "(a name, a number, a time, a code) that is put back afterwards: keep each one exactly once, written the "
            "same, where it belongs in your sentence. Translate nothing else into it, add nothing, keep icons.\n"
            f"Answer with ONLY a JSON list of {len(skeletons)} strings, the translations in the same order.\n\n"
            + json.dumps(skeletons, ensure_ascii=False))


def answer(text: str, skeletons: list[str]) -> dict | None:
    """The run's answer read: {skeleton: what the AI wrote for it} (judged by phrases.Phrases.take); None for an answer
    that is not a JSON list of as many strings."""
    t = (text or "").strip()
    a, b = t.find("["), t.rfind("]")
    try:
        got = json.loads(t[a:b + 1]) if 0 <= a < b else None
    except ValueError:
        got = None
    if not isinstance(got, list) or len(got) != len(skeletons):
        return None
    return dict(zip(skeletons, got))


class Translations:
    """What each chat's copy of an alert card shows of the alert's own words, in its language (see the module)."""

    def __init__(self, state, *, skills, settings, names: Callable[[int], list[str]], thread):
        self.state, self.skills, self.s = state, skills, settings
        self.names = names              # incident → the names of its devices and rooms (incident_names)
        self.thread = thread            # incident_thread.IncidentThread: a copy edited once its translation is known
        self._tasks: set[asyncio.Task] = set()      # every translation running: kept, so none is collected mid-way
        self._running: dict[tuple, asyncio.Task] = {}
        self._waiting: dict[tuple, set[tuple[int, int]]] = {}
        # what is kept, what is asked again and when, what is forgotten: ONE rule (phrases.py)
        self.phrases = Phrases(state)

    # ------------------------------------------------------------------ what is agreed
    def terms(self):
        """(the skill that translates, its run's terms: the Chat answers' brain and limit, turn.translation_terms) —
        None when no skill declares it."""
        from .skills import translators
        from .turn import translation_terms
        sk = next(iter(translators(self.skills.all())), None)
        return None if sk is None else (sk, translation_terms(self.s, sk.name))

    @staticmethod
    def fingerprint(sk) -> str:
        """What the translations are kept under: the skill's translate instructions and the engine's slot rules."""
        return fingerprint(str(sk.translate.get("instructions") or ""), rules())

    # ------------------------------------------------------------------ at render time
    def apply(self, iid: int, chat: int, p: dict) -> tuple[dict, tuple | None]:
        """A copy's parts with its body as its chat reads it (`tr`, drawn by layout.render) when every line of it has a
        translation kept — a line resting after a failure (phrases.Phrases.resting) as written; otherwise the parts as
        English and what is still wanted — (language, skeletons), for `later` once the copy is recorded. Never raises:
        whatever fails, the copy is English."""
        p = {k: v for k, v in p.items() if k != "tr"}
        h = layout.head_of(p.get("head"))
        lang = (h or {}).get("lang") or "en"
        body = p.get("body") or ""
        if lang == "en" or not body.strip():
            return p, None
        try:
            agreed = self.terms()
            if agreed is None:
                return p, None
            fp = self.fingerprint(agreed[0])
            names = self.names(int(iid)) if self.names else []
            shown, wanted, translated = [], [], False
            for line in body.split("\n"):
                skel, values = mask(line, names)
                tr = self.phrases.kept(lang, skel, fp) if wordy(skel) else None
                if tr is not None:
                    shown.append(fill(tr, values))
                    translated = True
                    continue
                # ⚠️ A LINE THAT FAILED STAYS ENGLISH, THE OTHERS ARE SHOWN TRANSLATED (review, 2026-10-23): resting
                # (phrases.Phrases.resting) it is not asked, and one such line no longer keeps the whole card English
                if wordy(skel) and not self.phrases.resting(lang, skel, fp):
                    wanted.append(skel)
                shown.append(line)
            if wanted:
                return p, (lang, tuple(dict.fromkeys(wanted)))
            return ({**p, "tr": {"lang": lang, "body": "\n".join(shown)}} if translated else p), None
        except Exception:  # noqa: BLE001 — the card is English, never not at all
            log.exception("Incident #%s in chat %s: its words could not be drawn in the chat's language", iid, chat)
            return p, None

    def draw(self, iid: int, chat: int, p: dict, later: bool = True) -> dict:
        """`apply`, and what is still wanted asked for (`later`) — IncidentThread.sync's redraw of another chat's copy:
        it holds the incident's lock, so the edit that follows waits until this copy is recorded."""
        p, want = self.apply(iid, chat, p)
        if want and later:
            self.later(iid, chat, want)
        return p

    # ------------------------------------------------------------------ afterwards
    def later(self, iid: int, chat: int, want: tuple) -> None:
        """Copy `chat` of incident `iid` is recorded in English: its lines `want` ((language, skeletons)) are
        translated in the background — one run per card and language, a second copy waiting for the same — then the
        copy is drawn again. Called only once the copy is recorded (Poster.post, Outcome.adopt_ha, sync's lock)."""
        try:
            loop = asyncio.get_running_loop()
            self._waiting.setdefault(want, set()).add((int(iid), int(chat)))
            task = self._running.get(want)
            if task is None or task.done() or task.get_loop() is not loop:
                task = loop.create_task(self._translate(want))
                self._running[want] = task
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
        except Exception:  # noqa: BLE001 — the card stays English
            log.exception("Incident #%s: its translation could not be started", iid)

    async def _translate(self, want: tuple) -> None:
        lang, skeletons = want
        try:
            agreed = self.terms()
            if agreed is None:
                return
            fp = self.fingerprint(agreed[0])
            missing = self.phrases.to_ask(lang, skeletons, fp)
            if missing:
                # every way a run fails is remembered (phrases.Phrases.take): those lines are not asked again for a while
                try:
                    text, why = await asyncio.wait_for(self._ask(agreed, lang, missing), timeout=translate_seconds())
                except asyncio.TimeoutError:
                    text, why = None, f"took longer than {translate_seconds()} s"
                except Exception as e:  # noqa: BLE001 — the card stays English
                    log.exception("An alert card's %s translation failed: it stays English", lang)
                    text, why = None, f"failed: {type(e).__name__}"
                got = answer(text, missing) if text is not None else None
                self.phrases.take(lang, fp, missing, got, why if text is None else "not the list of lines asked for")
            # every copy waiting for these lines, those added while this ran included
            while waiting := self._waiting.pop(want, None):
                for iid, chat in sorted(waiting):
                    await self.thread.translated(iid, chat, lambda i, c, p: self.apply(i, c, p)[0])
        except Exception:  # noqa: BLE001 — the card stays English
            log.exception("An alert card's %s translation failed: it stays English", lang)
        finally:
            # ended (done, failed or cut): a copy still waiting stays English; a later copy starts a run of its own
            if self._running.get(want) is asyncio.current_task():
                self._running.pop(want, None)
                self._waiting.pop(want, None)

    async def _ask(self, agreed, lang: str, skeletons: list[str]) -> tuple[str | None, str | None]:
        """The AI's answer for `skeletons` into `lang` — one tiny run, no tool, the Chat answers' brain and limit: (its
        text, None), or (None, why it could not answer)."""
        sk, terms = agreed
        from claude_agent_sdk import create_sdk_mcp_server
        from . import __version__
        from .policy import Language
        from .tools import SERVER, Kit
        kit = Kit(create_sdk_mcp_server(name=SERVER, version=__version__, tools=[]), set(), [], None)
        instructions = str(sk.translate.get("instructions") or "")
        name = Language.of(lang).name
        res = await runner.run(self.s.in_folder("translations"), instructions, prompt(name, skeletons),
                               kit, terms, self.state, asked=f"Alert card in {name}: {len(skeletons)} line(s)")
        if res.problem or (res.error and not res.text):
            return None, f"the AI could not answer ({res.problem or 'error'})"
        return res.text, None

    async def idle(self) -> None:
        """Every translation of this loop finished (tests wait on it, never on a fixed time)."""
        loop = asyncio.get_running_loop()
        while mine := [t for t in self._tasks if t.get_loop() is loop and not t.done()]:
            await asyncio.gather(*mine, return_exceptions=True)
