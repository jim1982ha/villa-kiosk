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

from vesta_shared import visit_state
from vesta_shared.timeutil import clock

from . import sheet

log = logging.getLogger("vesta.visit")

#: The story line a visit's siren request is told on (notice.Notices.observe)
SIREN_LINE = "siren"
#: The most photos one Telegram album holds (sendMediaGroup)
ALBUM = 10


def photos(state, iid) -> list[dict]:
    """Every photo of visit `iid` (the desk's last sheet and the cameras its siren snapped), in the visit's one order
    (visit_state.ordered: the strongest step's first, then the rest oldest first): Telegram's "All photos" and the
    tablet's card read this one list.

    ⚠️ TELEGRAM AND THE TABLET SHOW THE SAME PHOTOS (owner, 2026-11-08, #154 at 08:47): the siren's snapshots of Garden
    and Terrace and both patios were in Telegram's picture, and the tablet's card showed the villa's photos only."""
    return visit_state.ordered(list(state.visit_photos(iid).get("photos") or []) + state.visit_snaps(iid))


class Visits:
    def __init__(self, *, state, thread, notices, photo: Callable[[str], Awaitable], out_dir: str, timezone_name: str,
                 tell: Callable[[str, dict], Awaitable[bool]] | None = None,
                 keyboard: Callable[[int, int], dict | None] | None = None, name: Callable[[str], str] = str,
                 withdraw: Callable[[str], Awaitable[bool]] | None = None,
                 album: Callable[[int, list, int | None], Awaitable[list[int]]] | None = None):
        """`photo(camera)`: what a camera shows now ((base64, mime) or None, outcome.camera_photo); `tell(script, data)`:
        the villa's script run with `data` (actions.Actions.tell_villa), None: the villa is never told; `keyboard(iid,
        chat)`: the buttons a copy keeps (alert_buttons.AlertButtons); `name(camera)`: its name as the villa gives it."""
        self.name = name
        self._album = album               # delivery.Delivery.album: photos as Telegram albums, a reply to a message
        self._withdraw = withdraw         # approvals.Approvals.withdraw: a waiting request withdrawn, every copy told
        self.state, self.thread, self.notices = state, thread, notices
        self.photo, self.out_dir, self.tz, self._tell, self.keyboard = photo, out_dir, timezone_name, tell, keyboard
        self._locks: dict[int, asyncio.Lock] = {}

    # ------------------------------------------------------------------ the sheet
    async def jpeg(self, iid: int, photos: list[dict], shown: int) -> bytes | None:
        """The visit's sheet: `photos` (the desk's, the strongest first) and the cameras its siren snapped; None when
        none can be read."""
        both = visit_state.ordered(list(photos) + self.state.visit_snaps(iid), shown)
        return await asyncio.to_thread(sheet.build, both, shown, self.tz, os.path.join(self.out_dir, "visits"))

    async def picture(self, iid: int, photos: list[dict], shown: int, jpeg: bytes | None = None) -> int:
        """The visit's sheet (`jpeg`, else made now) on every copy of incident `iid` that does not carry it yet (a copy
        this result just sent with it does). How many copies show it now."""
        jpeg = jpeg or await self.jpeg(iid, photos, shown)
        if not jpeg:
            return 0
        return await self.thread.picture(iid, jpeg, (lambda c: self.keyboard(iid, c)) if self.keyboard else None)

    # ------------------------------------------------------------------ every photo, on ask
    def every_photo(self, iid: int) -> list[dict]:
        """Every photo of visit `iid`, in the visit's one order (photos)."""
        return photos(self.state, iid)

    async def album(self, p) -> None:
        """"All photos" pressed (`p`, press.Press: button_data.PHOTOS) under a visit's card: every photo of the visit,
        whole, each captioned with its camera and its time ("Parking · 11:57"), oldest first, as replies to the card
        pressed in the chat pressed alone — Telegram albums of up to 10 (sendMediaGroup's most). Pressed again, the
        visit's photos as they are then: nothing is remembered of the first press."""
        iid = p.parts[0]
        if not iid.isdigit() or p.place != "telegram" or self._album is None:
            return await p.toast("Unknown button.")
        own = os.path.join(self.out_dir, "visits")
        got = []
        for ph in self.every_photo(int(iid)):
            path = sheet._inside(ph.get("path"), (sheet.MEDIA, own))
            if not path or os.path.getsize(path) > sheet.photo_bytes():
                continue
            with open(path, "rb") as f:
                jpeg = f.read()
            try:
                when = clock(datetime.fromisoformat(str(ph.get("at"))), self.tz, days=False)
            except (TypeError, ValueError):
                when = ""
            got.append((jpeg, " · ".join(t for t in (str(ph.get("label") or ""), when) if t)))
        if not got:
            return await p.toast("No photo of this visit can be read now.")
        await p.toast(f"{len(got)} photos: sending." if len(got) > 1 else "1 photo: sending.")
        for i in range(0, len(got), ALBUM):
            try:
                await self._album(p.chat, got[i:i + ALBUM], p.mid)
            except Exception as e:  # noqa: BLE001 — the photos already sent stay; the card is untouched
                log.warning("Incident #%s: its photos could not be sent (%s)", iid, type(e).__name__)
                return

    # ------------------------------------------------------------------ the villa told
    async def tell(self, iid: int, script: str, fields: dict, name: str = "") -> bool:
        """The villa's `script` run with `fields`, the cards each chat shows of incident `iid` now (`messages`) and the
        alert's name (`name`, "#125-P1"). `fields["drop"]`: the villa's replies ([chat, message id]) VESTA removes now it
        holds the visit — its one card tells it all (owner, 2026-11-06, #129: "Deleted message" and the villa's "TEST:
        Test door opened at 22:55." stayed under VESTA's card); the villa is told which went (`dropped`). False when
        there is no way to tell it or it refused (the villa then takes the visit back itself after its own wait: never
        in the critical path).

        ⚠️ ONE TELL AT A TIME PER VISIT, ITS CARDS READ WHEN IT GOES (owner's drill #127, 22:42:02): the lock's and the
        relock's results told the villa within the same second, each with the cards it had read earlier — the relock's
        step was taken back by the older one, the villa thought VESTA silent and took the visit back a minute later."""
        if self._tell is None or not str(script).startswith("script."):
            return False
        fields = dict(fields)
        drop = fields.pop("drop", None) or []
        async with self._locks.setdefault(int(iid), asyncio.Lock()):
            dropped = []
            for pair in drop:
                try:
                    chat, mid = int(pair[0]), int(pair[1])
                except (TypeError, ValueError, IndexError):
                    continue
                if self.thread.delete is not None and await self.thread.delete(chat, mid):
                    dropped.append(mid)
            cards = [{"chat_id": int(c), "message_id": int(r["mid"]), "role": "card"}
                     for c, r in self.state.incident_chats(iid) if r.get("mid")]
            data = {**{k: v for k, v in fields.items() if v is not None}, "messages": cards,
                    **({"name": name} if name else {}), **({"dropped": dropped} if dropped else {})}
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
        """What each of `cameras` shows now, kept as a photo of the visit (its sheet carries it, the tablet's card too):
        how many."""
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
