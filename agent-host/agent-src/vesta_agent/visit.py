"""A visit of the villa's presence automation, on the engine's side: its photo sheet on every card, the villa told what
VESTA did with it, and its siren request told as a line of its story.

⚠️ ONE VISIT, ONE STORY (owner, 2026-11-06, #125-P1 and #126-P1). The alert desk tells a visit as one alert
(desk.py visit_intake); what only the engine can do is here, each from what the desk's result says:

- the SHEET (result.sheet): one picture of the visit's photos (sheet.build), put in place of every copy's picture with
  its caption and buttons (editMessageMedia: an edit, no sound) — a copy that is a text message is sent again as a
  photo, once (Telegram cannot give a text message a picture);
- the TELL (result.tell_villa): the villa's own script, named by the villa's event, told the cards each chat shows now
  — never a script named here, never asked by the AI (rules/agent-code.md "The engine delivers what must be seen");
- the SIREN of a visit (siren.Request): its question a reply to the visit's card in the owner's chats, the cameras
  that showed nothing lately snapped into the sheet instead of a message each, and "Siren offered to the Owner 18:35,
  expired on 18:50: nothing was done" a line of the visit's story (owner, 2026-11-06: six "Camera snapshot" messages and
  a separate request came beside the alert at 18:35).
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from datetime import datetime, timezone
from typing import Awaitable, Callable

from vesta_shared.timeutil import clock

from . import sheet

log = logging.getLogger("vesta.visit")

#: The story line a visit's siren request is told on (notice.Notices.observe)
SIREN_LINE = "siren"


class Visits:
    def __init__(self, *, state, thread, notices, photo: Callable[[str], Awaitable], out_dir: str, timezone_name: str,
                 tell: Callable[[str, dict], Awaitable[bool]] | None = None,
                 keyboard: Callable[[int, int], dict | None] | None = None, name: Callable[[str], str] = str,
                 withdraw: Callable[[str], Awaitable[bool]] | None = None):
        """`photo(camera)`: what a camera shows now ((base64, mime) or None, outcome.camera_photo); `tell(script, data)`:
        the villa's script run with `data` (actions.Actions.tell_villa), None: the villa is never told; `keyboard(iid,
        chat)`: the buttons a copy keeps (alert_buttons.AlertButtons); `name(camera)`: its name as the villa gives it."""
        self.name = name
        self._withdraw = withdraw         # approvals.Approvals.withdraw: a waiting request withdrawn, every copy told
        self.state, self.thread, self.notices = state, thread, notices
        self.photo, self.out_dir, self.tz, self._tell, self.keyboard = photo, out_dir, timezone_name, tell, keyboard

    # ------------------------------------------------------------------ the sheet
    async def jpeg(self, iid: int, photos: list[dict], shown: int) -> bytes | None:
        """The visit's sheet: `photos` (the desk's, the strongest first) and the cameras its siren snapped; None when
        none can be read."""
        snaps = self.state.visit_snaps(iid)
        both = photos[:1] + sorted(photos[1:] + snaps, key=lambda p: str(p.get("at"))) if photos else snaps
        return await asyncio.to_thread(sheet.build, both, shown, self.tz, os.path.join(self.out_dir, "visits"))

    async def picture(self, iid: int, photos: list[dict], shown: int, jpeg: bytes | None = None) -> int:
        """The visit's sheet (`jpeg`, else made now) on every copy of incident `iid` that does not carry it yet (a copy
        this result just sent with it does). How many copies show it now."""
        jpeg = jpeg or await self.jpeg(iid, photos, shown)
        if not jpeg:
            return 0
        return await self.thread.picture(iid, jpeg, (lambda c: self.keyboard(iid, c)) if self.keyboard else None)

    # ------------------------------------------------------------------ the villa told
    async def tell(self, iid: int, script: str, fields: dict, name: str = "") -> bool:
        """The villa's `script` run with `fields`, the cards each chat shows of incident `iid` now (`messages`) and the
        alert's name (`name`, "#125-P1"). False when there is no way to tell it or it refused (the villa then takes the
        visit back itself after its own wait: never in the critical path)."""
        if self._tell is None or not str(script).startswith("script."):
            return False
        cards = [{"chat_id": int(c), "message_id": int(r["mid"]), "role": "card"}
                 for c, r in self.state.incident_chats(iid) if r.get("mid")]
        data = {**{k: v for k, v in fields.items() if v is not None}, "messages": cards, **({"name": name} if name else {})}
        try:
            return bool(await self._tell(script, data))
        except Exception as e:  # noqa: BLE001 — the villa keeps the visit itself
            log.warning("Incident #%s: the villa could not be told of its visit (%s)", iid, type(e).__name__)
            return False

    # ------------------------------------------------------------------ the siren of a visit
    def card(self, iid: int, chat: int) -> int | None:
        """The message id of the visit's card in `chat` (its question is a reply to it), None when it has none there."""
        rec = self.state.incident_message(iid, chat)
        return int(rec["mid"]) if rec and rec.get("mid") else None

    async def snap(self, iid: int, cameras) -> int:
        """What each of `cameras` shows now, kept as a photo of the visit (its sheet carries it): how many."""
        kept = self.state.visit_snaps(iid)
        n = 0
        for cam in cameras or []:
            try:
                got = await self.photo(cam)
            except Exception as e:  # noqa: BLE001 — that camera gives no tile
                log.info("Camera %s gave no picture (%s)", cam, type(e).__name__)
                continue
            if not got:
                continue
            folder = os.path.join(self.out_dir, "visits", str(iid))
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f"{cam.split('.', 1)[-1]}.jpg")
            with open(path, "wb") as f:
                f.write(base64.b64decode(got[0]))
            at = datetime.now(timezone.utc).isoformat()
            kept = [k for k in kept if k.get("camera") != cam] + [{"path": path, "label": self.name(cam), "at": at, "camera": cam,
                                                                  "own": True}]
            n += 1
        self.state.set_visit_snaps(iid, kept)
        return n

    async def offered(self, iid: int, aid: str, said: str, said_in: dict | None = None) -> None:
        """Approval request `aid` (the siren's) asked within visit `iid`: "Siren offered to the Owner 18:35" a line of
        its story, told again once the request is decided (decided)."""
        hm = clock(datetime.now(timezone.utc), self.tz, days=False)
        said, said_in = said.replace("{time}", hm), {k: t.replace("{time}", hm) for k, t in (said_in or {}).items()}
        self.state.set_visit_siren(aid, {"incident": int(iid), "said": said, "said_in": said_in})
        await self._line(iid, said, said_in, "")

    async def decided(self, aid: str, ap: dict | None) -> None:
        """Approval request `aid` decided, expired or withdrawn (`ap`, its record): its visit's siren line says how
        ("…, expired on 18:50: nothing was done")."""
        v = self.state.visit_siren(aid)
        if not v or not ap or ap.get("status") == "pending":
            return
        from .approvals import note
        at = datetime.fromisoformat(ap["decided_at"]) if ap.get("decided_at") else datetime.now(timezone.utc)
        how = note(ap["status"], ap.get("decided_name") or "", time=clock(at, self.tz, days=False))
        if not how:
            return
        await self._line(int(v["incident"]), v["said"], v.get("said_in") or {}, how[:1].lower() + how[1:])
        if ap["status"] not in ("approved", "moving"):
            self.state.set_visit_siren(aid, None)

    async def withdraw(self, iid: int) -> int:
        """The siren's question of visit `iid`, still waiting, withdrawn (a resident came home): how many."""
        n = 0
        for ap in self.state.approvals_in("pending"):
            v = self.state.visit_siren(ap["id"])
            if v and int(v.get("incident") or 0) == int(iid) and self._withdraw is not None and await self._withdraw(ap["id"]):
                n += 1
        return n

    async def _line(self, iid: int, said: str, said_in: dict, how: str) -> None:
        tail = f", {how}" if how else ""
        heads = self.notices.observe(iid, [{"key": SIREN_LINE, "note": said + tail,
                                            "note_in": {k: t + tail for k, t in said_in.items()}}])
        await self.thread.reheaded(iid, heads)
