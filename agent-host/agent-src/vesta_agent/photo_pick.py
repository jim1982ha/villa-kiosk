"""One photo out of a step's burst: the frame that shows the most (owner, 2026-11-15).

⚠️ THE PERSON NOT IN VIEW YET (owner, 2026-11-15, two real visits): the villa's photo was taken the instant the motion
began, and the cameras' frames lag about 4 s behind the motion, so the photos showed an empty scene. The Presence
Guard's "Burst, best picked" takes up to 3 photos of a step about 1.5 s apart while its sensor is still on; VESTA keeps
one (visit.Visits.kept), chosen here as the villa set it ("Picked by"):

- a model (its alias, haiku / sonnet / opus): ONE call with the frames, asking which shows a person, a vehicle or an
  animal best — what it looks for is the skill's words (skill.yaml `photo_pick`), the answer's shape the engine's;
  recorded with the AI costs (agent_records.PHOTO_PICK), bounded by `visit.photo_pick_timeout_s`;
- with a model, and the skill naming a `frame` colour: the model also says where in the photo it chose what it saw is,
  and a rectangle of that colour is drawn around it on the photo kept, the saved file itself, so Telegram and the
  tablet show it (owner, 2026-11-16, a sample with a green box around the gardener); an answer with no place, or one
  that is not a place in the photo, keeps the photo as taken;
- `diff`, or a model that did not answer (failed, timed out, no skill declares it, or it saw none of them): change
  detection — the frame most different from the first (downscaled grey), the first never chosen while there are
  others. It never needs the AI.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re

from vesta_shared import agent_records
from vesta_shared.limits import limit

from . import runner, sheet

log = logging.getLogger("vesta.photo_pick")

DIFF = "diff"
#: The size each frame is compared at: enough to see a person come into view, small enough to be instant
_GREY = (96, 54)


def timeout_s() -> int:
    # 45 s, not 15 (owner, 2026-11-16: half the runs cut at 15 s, no frame chosen, no rectangle): the message never
    # waits for it (visit.pick_wait_s), a choice that comes later replaces the photo shown
    return limit("visit.photo_pick_timeout_s", 45, unit="seconds", group="run", lo=3, hi=120,
                 says="How long the AI may take to choose the best of a step's burst of photos.",
                 reached="The photo most different from the first is kept instead (no AI).", told="")


def changed_most(paths: list[str]) -> int:
    """The index of the frame most different from the first (mean difference of the downscaled grey pictures); 0 only
    when there is one frame, or none of the others can be read."""
    if len(paths) < 2:
        return 0
    from PIL import Image, ImageChops, ImageStat

    def grey(p):
        try:
            with Image.open(p) as im:
                return im.convert("L").resize(_GREY)
        except Exception as e:  # noqa: BLE001 — a broken frame is never chosen
            log.info("A burst frame could not be read (%s)", type(e).__name__)
            return None
    first = grey(paths[0])
    best, score = 0, -1.0
    for i, p in enumerate(paths[1:], start=1):
        g = grey(p)
        if g is None:
            continue
        d = ImageStat.Stat(ImageChops.difference(first, g)).mean[0] if first is not None else 0.0
        if d > score:
            best, score = i, d
    return best


def answered(text: str, n: int) -> int | None:
    """The frame (0-based) the model's answer names ("2", "Photo 2", "2 0.1 0.2 0.3 0.4"), None when it names none of
    the `n` (its "0": it saw no person, vehicle or animal). The number of an answer as asked first (its place after
    it), else the first number."""
    full = _ANSWER.findall(text or "")
    m = re.search(r"\d+", text or "")
    k = int(full[-1][0]) if full else int(m.group()) if m else 0
    return k - 1 if 1 <= k <= n else None


def asked(n: int, where: bool = False) -> str:
    """The engine's part of the question: the frames' numbering and the answer's shape (`where`: and its place)."""
    if not where:
        return (f"The {n} photos above are numbered 1 to {n}, in the order the camera took them. Answer with the number "
                "of the photo you choose, and nothing else; answer 0 when none of them shows what you look for.")
    return (f"The {n} photos above are numbered 1 to {n}, in the order the camera took them. Answer with the number of "
            "the photo you choose, then where what you saw is in that photo: four numbers between 0 and 1, its left, "
            "top, right and bottom edges as fractions of the photo's width and height, the box holding all of it. "
            "Your whole answer is that one line, for example: 2 0.08 0.31 0.30 0.72 — no words, no explanation. "
            "Answer 0 when none of them shows what you look for.")


#: A place smaller than this share of the photo is a mis-read, larger is no place at all
_BOX_AREA = (0.002, 0.9)


#: The answer's one line: the frame's number then its place, four fractions (asked)
_ANSWER = re.compile(r"(?<![\d.])(\d+)\s+(0?\.\d+|[01](?:\.\d+)?)\s+(0?\.\d+|[01](?:\.\d+)?)\s+"
                     r"(0?\.\d+|[01](?:\.\d+)?)\s+(0?\.\d+|[01](?:\.\d+)?)(?![\d.])")


def placed(text: str) -> tuple[float, float, float, float] | None:
    """The place (left, top, right, bottom, fractions of the photo) in the model's answer, only as asked: the frame's
    number and four fractions in a row (the last such run). None when it gives none, or one that is not a place in
    the photo. ⚠️ NEVER NUMBERS GATHERED FROM WORDS: an answer that explains itself is full of them ("photo 1", the
    camera's clock), and they drew the rectangle on an empty patch of ground (owner, 2026-11-16)."""
    found = _ANSWER.findall(text or "")
    if not found:
        return None
    left, top, right, bottom = (float(v) for v in found[-1][1:5])
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        return None
    area = (right - left) * (bottom - top)
    return (left, top, right, bottom) if _BOX_AREA[0] <= area <= _BOX_AREA[1] else None


def framed(path: str, box: tuple[float, float, float, float], colour: str) -> bool:
    """A rectangle of `colour` drawn around `box` on the photo at `path`, saved in its place. False when it could not."""
    from PIL import Image, ImageDraw
    try:
        with Image.open(path) as im:
            img = im.convert("RGB")
        w, h = img.size
        line = max(3, round(min(w, h) / 120))
        left, top, right, bottom = box
        ImageDraw.Draw(img).rectangle([round(left * w), round(top * h), round(right * w), round(bottom * h)],
                                      outline=colour, width=line)
        img.save(path, "JPEG", quality=92)
        return True
    except Exception as e:  # noqa: BLE001 — the photo is kept as taken
        log.warning("The rectangle could not be drawn on a burst's photo (%s)", type(e).__name__)
        return False


class Picker:
    """`choose(paths, how)`: the index of the frame kept. Never raises."""

    def __init__(self, *, settings, state, skills):
        self.s, self.state, self.skills = settings, state, skills

    def _instructions(self) -> tuple[str, str, str | None] | None:
        """(the skill that says what is looked for, its words, its rectangle's colour or None), None when no skill
        declares `photo_pick`."""
        from .skills import photo_pickers
        sk = next(iter(photo_pickers(self.skills.all())), None)
        return None if sk is None else (sk.name, sk.photo_pick["instructions"], sk.photo_pick.get("frame"))

    async def choose(self, paths: list[str], how: str) -> int:
        if len(paths) < 2:
            return 0
        if how and how != DIFF:
            try:
                got = await asyncio.wait_for(self._ask(paths, how), timeout_s())
            except asyncio.TimeoutError:
                log.warning("The AI did not choose a burst's photo within %ss: change detection keeps one", timeout_s())
                got = None
            except Exception as e:  # noqa: BLE001 — change detection keeps one
                log.warning("The AI could not choose a burst's photo (%s): change detection keeps one", type(e).__name__)
                got = None
            if got is not None:
                return got
        return await asyncio.to_thread(changed_most, paths)

    async def _ask(self, paths: list[str], model: str) -> int | None:
        """ONE run of `model` with the frames: the frame it names, None when it named none or could not answer."""
        from .policy import PROFILES
        from .turn import Terms, chat_brain
        profile = next((p for p, (m, _e) in PROFILES.items() if m == model), None)
        said = self._instructions()
        if profile is None or said is None:
            log.info("No AI choice of a burst's photo (%s): change detection keeps one",
                     "unknown model" if profile is None else "no skill says what to look for")
            return None
        images = []
        for p in paths:
            small = await asyncio.to_thread(sheet.small, p)
            if not small:
                return None
            images.append((base64.b64encode(small).decode(), "image/jpeg"))
        from claude_agent_sdk import create_sdk_mcp_server
        from . import __version__
        from .tools import SERVER, Kit
        kit = Kit(create_sdk_mcp_server(name=SERVER, version=__version__, tools=[]), set(), [], None)
        skill, instructions, frame = said
        terms = Terms(frozenset(), profile, chat_brain(self.s)[1], agent_records.PHOTO_PICK, skill, think=False)
        res = await runner.run(self.s.in_folder("photo_pick"), instructions, asked(len(images), where=bool(frame)), kit,
                               terms, self.state, asked=f"Best of {len(images)} photos of one step", image=images)
        if res.problem or (res.error and not res.text):
            log.warning("The AI could not choose a burst's photo (%s): change detection keeps one", res.problem or "error")
            return None
        got = answered(res.text, len(images))
        box = placed(res.text) if frame and got is not None else None
        # what it said, for whoever checks a rectangle against the photo (owner, 2026-11-16)
        log.info("The AI chose photo %s of %d%s (it answered: %r)", None if got is None else got + 1, len(images),
                 f", what it saw at {box}" if box else ", no place", (res.text or "")[:160])
        if box is not None:
            await asyncio.to_thread(framed, paths[got], box, frame)
        return got
