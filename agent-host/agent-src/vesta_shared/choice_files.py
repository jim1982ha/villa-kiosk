"""The owner's choice files of the VESTA Agent page's Knowledge tab (Device kinds: asset_kinds.yaml; Device links:
asset_links.yaml), in one table.

⚠️ WIRED BY HAND IN SIX PLACES (architecture review round 6, 2026-10-30): each file had its own path property in the
settings, its own branch in the page's writer (where it is, how it is checked), its own Undo kind, its own parameter of
KnowledgePack.load, and its module repeated where the file is and how it is read. A file added to the tab and missed in
one of them was written unchecked, or saved and never read, or not undoable. Every one of those places now iterates
this table: a new choice file is one module (FILE, problems, parse, text_of) and one row here.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from types import ModuleType

from . import asset_kinds, asset_links


@dataclass(frozen=True)
class ChoiceFile:
    kind: str           # its Page changes target ({"kind": kind}): what the page's writer checks and Undo writes back
    module: ModuleType  # its FILE, problems(text), parse(text), text_of(choices)
    apply: str          # the KnowledgePack method that applies its choices to the pack

    def path(self, config_dir: str | None = None) -> str:
        """The file in the agent's config folder `config_dir` (the engine's and the page's); without one, beside
        policy.yaml (VESTA_POLICY, the scripts' environment), else in VESTA_AGENT_CONFIG_DIR — limits.yaml's own rule
        (vesta_shared.limits.path)."""
        if config_dir:
            return os.path.join(config_dir, self.module.FILE)
        if os.environ.get("VESTA_POLICY"):
            return os.path.join(os.path.dirname(os.environ["VESTA_POLICY"]), self.module.FILE)
        return os.path.join(os.environ.get("VESTA_AGENT_CONFIG_DIR") or "/config/agent", self.module.FILE)

    def chosen(self, config_dir: str | None = None):
        """The owner's choices in the file (its module's parse); empty when the file is not there or cannot be read."""
        try:
            with open(self.path(config_dir), encoding="utf-8") as f:
                return self.module.parse(f.read())
        except OSError:
            return self.module.parse(None)

    def problems(self, text: str) -> list[str]:
        """What is wrong with a text of the file, in words ([] when nothing): what the page's writer refuses."""
        return self.module.problems(text)


#: In the order KnowledgePack.load applies them: the links BEFORE the kinds, as a linked schedule marks a motor in the
#: kind guess (knowledge_pack.guessed_kind)
CHOICES: tuple[ChoiceFile, ...] = (
    ChoiceFile("links", asset_links, "links_are"),
    ChoiceFile("kinds", asset_kinds, "kinds_are"),
)
BY_KIND: dict[str, ChoiceFile] = {c.kind: c for c in CHOICES}
