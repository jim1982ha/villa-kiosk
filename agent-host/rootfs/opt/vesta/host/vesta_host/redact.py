"""Removes every secret value from every line the host prints (SPEC H8, 12).

⚠️ BY VALUE, NOT BY FIELD NAME. A secret reaches a log through the agent's own
output, an exception message or an echoed URL just as easily as through a
labelled field — so the filter knows the values and replaces them wherever they
appear, whoever wrote the line.
"""
from __future__ import annotations

import json
from pathlib import Path

MASK = "***"
#: Shorter values would mask ordinary words; no real key or token is this short.
MIN_LEN = 6


class Redactor:
    def __init__(self, secrets: list[str] | None = None) -> None:
        # Longest first, so a secret containing another is masked whole.
        uniq = {s for s in (secrets or []) if s and len(s) >= MIN_LEN}
        self._secrets = sorted(uniq, key=len, reverse=True)

    def __call__(self, text: str) -> str:
        for s in self._secrets:
            if s in text:
                text = text.replace(s, MASK)
        return text

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(mode=0o600, exist_ok=True)
        path.chmod(0o600)
        path.write_text(json.dumps(self._secrets))

    @classmethod
    def load(cls, path: Path) -> "Redactor":
        try:
            return cls(json.loads(path.read_text()))
        except (OSError, ValueError):
            return cls()
