"""The AI layer's slice of the add-on's Configuration page.

⚠️ IT SHARES THAT PAGE WITH THE KIOSK NOW. The layer shipped first as a separate
add-on with a manifest of its own; the owner's ruling was one add-on — the
baseline kiosk plus this — so these fields live alongside the kiosk's passcodes
in `villa-kiosk/config.yaml`. `OPTION_NAMES` is therefore a SUBSET of what that
manifest declares, not the whole of it, and `ai_log_level` is named for the
half it configures.

⚠️ THE SPEC SAYS "NINE" AND TEN FIELDS SHIP, AND BOTH ARE RIGHT. Its list is
nine comma-separated items, one of which is the pair "model_fast /
model_writing". The NAMES are unambiguous and all ten are here; only the count
was a comma.

The manifest (`vesta-ai/config.yaml`) and the help text
(`vesta-ai/translations/en.yaml`) are the operator's half of this; the gate
`tests/addon-manifest.py` holds all three in step, so a field added here without
a label is a build that does not pass.

⚠️ EVERY DEFAULT IS EMPTY OR SAFE. The hard rule in CLAUDE.md is explicit that a
"helpful" seeded default is how one property's values end up baked into an
add-on meant for any of them — and a seed spread underneath stored config
resurrects entries an owner deleted. Nothing here names a villa, a target, or a
host.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, fields
from pathlib import Path

#: Where Supervisor writes the operator's answers inside the container.
OPTIONS_PATH = Path("/data/options.json")


class Secret(str):
    """A string that does not print itself.

    ⚠️ BECAUSE repr() IS WHAT AN EXCEPTION PRINTS. Any traceback with an
    `Options` in scope renders its repr into the add-on log, and add-on logs get
    pasted into bug reports. The value still compares and concatenates as the
    ordinary string it is; only its printed form is masked.
    """
    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - exercised via Options' repr
        return "'***'" if self else "''"


#: The two fields whose values must never reach a log line.
_SECRET_FIELDS = frozenset({"anthropic_api_key", "ha_mcp_secret"})


@dataclass(frozen=True)
class Options:
    # The model's credential. Empty means the layer cannot reason; it still runs
    # and still reports its own health, which is this ticket's whole subject.
    anthropic_api_key: Secret = Secret("")
    # ⚠️ PASTED, NOT DISCOVERED. Finding the ha-mcp add-on automatically needs a
    # Supervisor role that can also start, stop and install add-ons — an
    # escalation a suggest-only layer cannot justify (ADR-0012).
    ha_mcp_url: str = ""
    ha_mcp_secret: Secret = Secret("")
    # Notify targets. Empty by default: naming one here would be one property's
    # configuration shipped to every other.
    owner_target: str = ""
    fm_target: str = ""
    # Empty means "ask Home Assistant", which is always right and never stale.
    timezone: str = ""
    daily_usd_limit: float = 1.00
    model_fast: str = "claude-haiku-4-5"
    model_writing: str = "claude-opus-5"
    ai_log_level: str = "info"

    def __post_init__(self) -> None:
        """Wrap the secrets however this object was built.

        ⚠️ NOT ONLY ON THE `load_options` PATH. The first cut annotated these
        fields `Secret` and coerced them in the loader, so a plain
        `Options(anthropic_api_key="sk-...")` — every test, and any future
        caller building one by hand — carried an ordinary `str` that printed
        itself in full. An annotation is not an enforcement; this is.
        """
        for name in _SECRET_FIELDS:
            value = getattr(self, name)
            if not isinstance(value, Secret):
                object.__setattr__(self, name, Secret(str(value)))

    def __repr__(self) -> str:
        inner = ", ".join(f"{f.name}={getattr(self, f.name)!r}"
                          for f in fields(self))
        return f"Options({inner})"

    @property
    def gateway_url(self) -> str:
        """The ha-mcp base URL with the trailing slash an operator may paste."""
        return self.ha_mcp_url.strip().rstrip("/")

    def missing(self) -> list[str]:
        """The options that must be filled in before the layer can do its job."""
        required = ("ha_mcp_url", "anthropic_api_key")
        return [name for name in required if not str(getattr(self, name)).strip()]


#: The names the manifest must declare, derived from the dataclass so the two
#: can be compared by a test rather than by a maintainer's memory.
OPTION_NAMES: tuple[str, ...] = tuple(f.name for f in fields(Options))

def _coerce(name: str, raw: object, default: object) -> object:
    if name in _SECRET_FIELDS:
        return Secret(str(raw))
    if isinstance(default, float):
        try:
            return float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return default
    return str(raw)


def load_options(path: Path = OPTIONS_PATH) -> Options:
    """Read Supervisor's options.json, falling back to the safe defaults.

    A missing or unreadable file is not an error: the add-on starts before
    anyone has opened its Configuration page, and it must come up far enough to
    say so in its own health entity rather than crash-looping where nobody can
    see why.
    """
    try:
        raw = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return Options()
    if not isinstance(raw, dict):
        return Options()
    kwargs = {}
    for f in fields(Options):
        if f.name in raw and raw[f.name] is not None:
            kwargs[f.name] = _coerce(f.name, raw[f.name], f.default)
    return Options(**kwargs)  # type: ignore[arg-type]
