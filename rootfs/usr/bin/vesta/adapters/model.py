"""Which entities the 3D model has geometry for, read from the GLB itself.

⚠️ THE SERVER HAS TO ANSWER THIS OR IT CANNOT AGREE WITH THE TABLET. The kiosk's
device list is the union of the entity map and the model's own mesh names
(`selectableDeviceIds`), so a device that exists ONLY as a mesh — a light the
model names but nobody has mapped — is on screen and would be missing from every
briefing. That is not a rounding error: the mesh name IS the pipeline's primary
binding convention (README, "Configuring interactive assets").

⚠️ READ FROM THE FILE, NOT PUBLISHED BY THE BROWSER. The obvious alternative is
for the kiosk to write its derived list into the shared store. It was rejected:
a briefing would then depend on somebody having opened the tablet recently, and
would go BLIND rather than sparse on a villa nobody visits and on a fresh
install — the two cases this whole exercise is about.

⚠️ NO DEPENDENCY. A GLB is a 12-byte header followed by length-prefixed chunks,
the first of which is the glTF JSON. Node names live in that JSON. Parsing it is
forty lines of `struct`; adding a glTF library to the add-on image to read a list
of strings would be the larger change, and this runs on a Pi.

⚠️ NAMES ONLY, NEVER GEOMETRY. The binary chunk is not read and not seeked past
in memory — the JSON chunk is bounded by its own length and the rest of a file
that can be tens of megabytes is never touched.
"""

from __future__ import annotations

import json
import os
import struct
from typing import List, Set

from .log import warn

#: Where `supervisor-proxy.py` lands an uploaded model (MANAGED_PATH["glb"]).
MODEL_FILE = "/data/www/villa.glb"

_GLB_MAGIC = 0x46546C67   # "glTF"
_CHUNK_JSON = 0x4E4F534A  # "JSON"

#: A mesh may carry a pose-variant suffix — `cover.x__open`, `lock.y__locked` —
#: marking one of several appearances of the SAME entity. The entity is the part
#: before it. An unsuffixed name is never a pose; see EntityMap's own docstring.
_VARIANT = "__"


def _entity_id_of(name: str) -> str:
    """A mesh name → the entity_id it binds, or "" if it is not one.

    Deliberately strict: `domain.object_id`, lower-case, one dot. A model is
    full of structural meshes (`Structure_L1_primitive3`, `Wall_2_2`) and a
    loose rule would turn the villa's walls into devices.
    """
    stem = name.split(_VARIANT, 1)[0].strip()
    if stem.count(".") != 1:
        return ""
    domain, _, object_id = stem.partition(".")
    if not domain or not object_id:
        return ""
    if not domain.replace("_", "").isalnum() or not domain.islower():
        return ""
    return stem


def mesh_entity_ids(path: str = MODEL_FILE) -> List[str]:
    """Entity ids the model has geometry for. Empty when there is no model.

    ⚠️ AN EMPTY LIST IS A REAL ANSWER on a fresh install and must not be read as
    a failure — `selectable_device_ids` then falls back to the entity map alone,
    which is exactly what the kiosk does when no model has been uploaded.
    """
    try:
        with open(path, "rb") as handle:
            header = handle.read(12)
            if len(header) < 12:
                return []
            magic, _version, _length = struct.unpack("<III", header)
            if magic != _GLB_MAGIC:
                warn(f"{path} is not a GLB; no mesh names read")
                return []
            chunk_header = handle.read(8)
            if len(chunk_header) < 8:
                return []
            chunk_len, chunk_type = struct.unpack("<II", chunk_header)
            if chunk_type != _CHUNK_JSON:
                warn(f"{path}: first chunk is not JSON; no mesh names read")
                return []
            gltf = json.loads(handle.read(chunk_len).decode("utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError, struct.error) as err:
        warn(f"could not read mesh names from {path}: {err}")
        return []

    found: Set[str] = set()
    # ⚠️ NODES AND MESHES BOTH. Babylon names a rendered object from its NODE,
    # and the pipeline stamps the entity id there — but a mesh carrying it
    # directly is also valid glTF, and reading only one of the two would make
    # the answer depend on which exporter produced the file.
    for key in ("nodes", "meshes"):
        for item in gltf.get(key) or []:
            if not isinstance(item, dict):
                continue
            entity_id = _entity_id_of(str(item.get("name") or ""))
            if entity_id:
                found.add(entity_id)
    return sorted(found)


def model_present(path: str = MODEL_FILE) -> bool:
    """Whether a model has been uploaded at all — so "no devices on the map" and
    "no map" stay distinguishable, which is the same three-kinds-of-empty rule
    the rest of this subsystem is built on."""
    return os.path.exists(path)
