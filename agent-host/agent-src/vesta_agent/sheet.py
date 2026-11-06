"""A visit's photos as ONE picture for its Telegram card: labelled tiles, the strongest step's largest and first.

⚠️ EVERY PHOTO OF THE VISIT IN THE ONE NOTIFICATION (owner, 2026-11-06): the villa sent a new photo message per camera,
and the siren's request six more. Telegram's albums carry no buttons and cannot be edited as one, so the card's picture
is a sheet of them all, replaced in place (editMessageMedia) at each step: its buttons and Status stay. Above
`visit.sheet_tiles` photos it holds the strongest and the latest; the tablet's card holds every one (the villa's own
announcement, which VESTA's card takes).

The photos are the villa's own files, read where the app's read-only `media` folder shows them (MEDIA): a path outside
it is never opened. Pillow draws the sheet (the image has no other picture library; measured 2026-11-06: about 6 MB of
wheels for aarch64 and amd64, Python 3.13).
"""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime

from vesta_shared.limits import limit
from vesta_shared.timeutil import clock

log = logging.getLogger("vesta.sheet")

#: Where the Supervisor shows the villa's media folder inside the app (vesta-agent/config.yaml `map: media`).
MEDIA = "/media"


def tile_px() -> int:
    return limit("visit.sheet_tile_px", 480, unit="pixels", group="text", lo=160, hi=1280,
                 says="How wide one photo of a visit's Telegram picture is (the strongest step's is twice as wide).",
                 reached="Each photo is shrunk to it.", told="")


def photo_bytes() -> int:
    return limit("visit.photo_bytes", 3000000, unit="bytes", group="read", lo=100000, hi=20000000,
                 says="The largest photo file of a visit that is put in its Telegram picture.",
                 reached="That photo is left out of the picture; the tablet still shows it.", told="")


def _inside(path: str, roots) -> str | None:
    """`path` when it is a file inside one of `roots` (its real place: no link leads out), else None."""
    real = os.path.realpath(str(path or ""))
    ok = any(real.startswith(os.path.realpath(r) + os.sep) for r in roots if r)
    return real if ok and os.path.isfile(real) else None


def chosen(photos: list[dict], shown: int) -> list[dict]:
    """The photos a sheet of at most `shown` tiles holds: the strongest step's first (photos come strongest first), then
    the latest of the rest, in the order they were taken."""
    if len(photos) <= shown:
        return list(photos)
    first, rest = photos[0], sorted(photos[1:], key=lambda p: str(p.get("at")))
    return [first, *rest[-(shown - 1):]] if shown > 1 else [first]


def build(photos: list[dict], shown: int, zone: str, own: str | None = None) -> bytes | None:
    """The sheet of `photos` ([{path, label, at}], the strongest first) as a JPEG, each tile labelled with its camera and
    its time ("Parking 18:34"); None when none of them can be read. `own`: the agent's own folder of the cameras it
    snapped for the visit (visit.Visits.snap), the one place besides MEDIA a photo is read from."""
    from PIL import Image, ImageDraw, ImageFont
    w = tile_px()
    h = w * 3 // 4
    tiles = []
    for p in chosen(photos, shown):
        path = _inside(p.get("path"), (MEDIA, own))
        if not path or os.path.getsize(path) > photo_bytes():
            log.info("A visit photo was left out of its sheet: %s", "too large" if path else "not in the media folder")
            continue
        try:
            with Image.open(path) as im:
                tiles.append((im.convert("RGB"), p))
        except Exception as e:  # noqa: BLE001 — a broken file leaves its tile out, never the sheet
            log.info("A visit photo could not be read (%s)", type(e).__name__)
    if not tiles:
        return None
    big, rest = tiles[0], tiles[1:]
    rows = (len(rest) + 1) // 2
    sheet = Image.new("RGB", (2 * w, 2 * h + rows * h), "black")
    font = ImageFont.load_default(max(12, w // 20))
    for i, (im, p) in enumerate([big, *rest]):
        size = (2 * w, 2 * h) if i == 0 else (w, h)
        at = (0, 0) if i == 0 else (((i - 1) % 2) * w, 2 * h + ((i - 1) // 2) * h)
        tile = im.copy()
        tile.thumbnail(size)
        x, y = at[0] + (size[0] - tile.width) // 2, at[1] + (size[1] - tile.height) // 2
        sheet.paste(tile, (x, y))
        try:
            when = clock(datetime.fromisoformat(str(p.get("at"))), zone, days=False)
        except (TypeError, ValueError):
            when = ""
        label = " ".join(x for x in (str(p.get("label") or ""), when) if x)
        if label:
            draw = ImageDraw.Draw(sheet)
            box = draw.textbbox((0, 0), label, font=font)
            pad = max(4, w // 80)
            top = at[1] + size[1] - (box[3] - box[1]) - 3 * pad
            draw.rectangle((at[0], top, at[0] + (box[2] - box[0]) + 2 * pad, at[1] + size[1]), fill="black")
            draw.text((at[0] + pad, top + pad - box[1]), label, fill="white", font=font)
    out = io.BytesIO()
    sheet.save(out, "JPEG", quality=85)
    return out.getvalue()
