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
from vesta_shared import visit_state
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


def cells(n: int) -> tuple[tuple[int, int], list[tuple[int, int, int]]]:
    """The layout of `n` tiles on a grid of 16:9 cells: the canvas (columns, rows) and each tile's (column, row, span).
    The strongest spans 2x2 at the top left; up to 6, the next two stack in the right column and the rest go along rows
    of 3 below; 7 to 9 are 4 columns wide: two columns of 2 at its right, then a row of 4 below.

    ⚠️ NEVER TALLER THAN WIDE (owner's cards #131, #133, 2026-11-07): the sheet was two tiles wide and grew downwards
    (960x1440), and Telegram on Android crops a tall photo in its chat bubble: the top and the last row's labels were
    cut off. Up to the nine visit.sheet_tiles allows it is 3 cells by 3, or 4 by 3, at most."""
    if n <= 1:
        return (2, 2), [(0, 0, 2)][:n]
    if n >= 7:
        right = [(c, r, 1) for r in range(2) for c in (2, 3)]
        return (4, 3), ([(0, 0, 2)] + right + [(c, 2, 1) for c in range(4)])[:n]
    out = [(0, 0, 2)] + [(2, r, 1) for r in range(min(n - 1, 2))]
    out += [(i % 3, 2 + i // 3, 1) for i in range(max(0, n - 3))]
    return (3, 2 + -(-max(0, n - 3) // 3)), out


def build(photos: list[dict], shown: int, zone: str, own: str | None = None) -> bytes | None:
    """The sheet of `photos` ([{path, label, at}], the strongest first) as a JPEG, each tile labelled with its camera and
    its time ("Parking 18:34") written on the photo itself; None when none of them can be read. `own`: the agent's own
    folder of the cameras it snapped for the visit (visit.Visits.snap), the one place besides MEDIA a photo is read
    from."""
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    w = tile_px()
    h = w * 9 // 16                                   # the cameras' own shape: a 16:9 photo fills its tile
    tiles = []
    # the tiles the visit's one order marks for the picture (visit_state.ordered: the lead, then the latest)
    for p in [p for p in visit_state.ordered(photos, shown) if p.get("onSheet")]:
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
    (cols, rows), places = cells(len(tiles))
    sheet = Image.new("RGB", (cols * w, rows * h), "black")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(max(12, w // 20))
    pad = max(4, w // 80)
    for (im, p), (c, r, span) in zip(tiles, places):
        x, y, size = c * w, r * h, (span * w, span * h)
        # ⚠️ EACH PHOTO WHOLE (owner, 2026-11-07): cropped to fill its tile, a photo lost the camera's own date, time and
        # name written in its corners; it is shrunk to fit, dark bands round a photo of another shape
        fit = ImageOps.contain(im, size)
        x, y = x + (size[0] - fit.width) // 2, y + (size[1] - fit.height) // 2
        sheet.paste(fit, (x, y))
        size = fit.size                               # the label goes on the photo itself, at its bottom left
        try:
            when = clock(datetime.fromisoformat(str(p.get("at"))), zone, days=False)
        except (TypeError, ValueError):
            when = ""
        label = " ".join(t for t in (str(p.get("label") or ""), when) if t)
        if label:
            # on the photo, inset from its corner: a margin under it is what a crop takes first
            box = draw.textbbox((0, 0), label, font=font)
            bottom = y + size[1] - 2 * pad
            top = bottom - (box[3] - box[1]) - 2 * pad
            draw.rectangle((x + 2 * pad, top, min(x + size[0] - 1, x + 4 * pad + box[2] - box[0]), bottom), fill="black")
            draw.text((x + 3 * pad, top + pad - box[1]), label, fill="white", font=font)
    out = io.BytesIO()
    sheet.save(out, "JPEG", quality=85)
    return out.getvalue()
