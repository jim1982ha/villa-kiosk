"""What every skill script starts from: its Home Assistant client, the knowledge pack, the store, the villa's
settings, its time zone and its day — one way, one rule each.

⚠️ ONE SET-UP (architecture review 7, 2026-10-07). Each script built these itself: five rules for the time zone
(the pack's first, the argument's first, an environment variable, one script ignoring the --zone it was given),
the "--store" default copied five times, the alert desk reaching Home Assistant past the test seam (so it had test
flags of its own), and three scripts reading the villa's settings past live_params — the one way the settings are
read, kept ten minutes. Here, for every script:

    ap = argparse.ArgumentParser(); script.arguments(ap, pack=True)       # --pack --store --zone --fixture-dir --now
    ctx = script.Context(ap.parse_args(argv))                              # tests: Context(args, client=FixtureClient)
    ctx.client · ctx.pack · ctx.store · ctx.params · ctx.zone · ctx.day(...) · ctx.now
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone
from functools import cached_property
from zoneinfo import ZoneInfo

STORE_DEFAULT = "vesta_store.sqlite"


def arguments(ap, *, pack: bool = False, pack_required: bool = False, store: bool | str = True) -> None:
    """The arguments every script shares (the engine injects --pack, --store and --zone: skill.yaml `inject`).
    `store`: True — the skill store, by default VESTA_STORE's; "optional" — only when given (a cache it can do
    without); False — the script keeps nothing. No store is ever made where none was asked for."""
    if pack:
        ap.add_argument("--pack", required=pack_required)
    if store:
        ap.add_argument("--store", default=os.environ.get("VESTA_STORE", STORE_DEFAULT) if store is True else None)
    ap.add_argument("--zone")
    ap.add_argument("--fixture-dir", help="the agent's tests: Home Assistant read from a folder")
    ap.add_argument("--now", help="the agent's tests: the time it is (ISO)")


class Context:
    @staticmethod
    def of(args_or_ctx, **k) -> "Context":
        """A Context from parsed arguments (or the Context itself): a script's run() takes either."""
        return args_or_ctx if isinstance(args_or_ctx, Context) else Context(args_or_ctx, **k)

    def __init__(self, args, client=None, skill: str | None = None, settings_file: str = "settings.yaml"):
        """`skill`: the skill's folder (its settings file `settings_file`, the villa's on top: skill_settings)."""
        self.args = args
        self.skill_dir, self.settings_file = skill, settings_file
        if client is not None:
            self.__dict__["client"] = client                 # a test's own client: the one seam

    @cached_property
    def client(self):
        from .ha_client import client_from_args
        return client_from_args(self.args)

    @cached_property
    def live_client(self):
        """The client when Home Assistant can be read here (a test's folder, or HA MCP configured); None where it
        cannot (a script run with no Home Assistant at all answers from the pack alone)."""
        if getattr(self.args, "fixture_dir", None) or os.environ.get("VESTA_HA_MCP_URL"):
            return self.client
        return None

    @cached_property
    def pack(self):
        from .knowledge_pack import KnowledgePack
        path = getattr(self.args, "pack", None)
        return KnowledgePack.load(path) if path else None

    @cached_property
    def store(self):
        """The skill store the script was given; None for a script that keeps nothing (no store is ever made
        for it: one would land in the out folder as a stray file)."""
        from .store import Store
        path = getattr(self.args, "store", None)
        return Store(path) if path else None

    @cached_property
    def settings(self) -> dict:
        """The skill's settings file with the villa's own on top ({} without a skill)."""
        from .skill_settings import load
        return load(self.skill_dir, self.settings_file) if self.skill_dir else {}

    @cached_property
    def params(self):
        """The villa's settings: through live_params (kept ten minutes in the store) when the script has a store;
        read now from Home Assistant when it has none; the defaults when neither can be read."""
        from .params import VillaParams, live_params
        from .skill_settings import behaviour
        defaults = behaviour(self.settings)                  # the skill's own thresholds, never a shared table
        if self.store is not None:
            return live_params(lambda: self.client, self.store, defaults=defaults)
        try:
            helpers, states = self.client.helpers()
            return VillaParams(helpers, states, defaults)
        except Exception:  # noqa: BLE001 — Home Assistant unreachable: the defaults, never a guess
            return VillaParams(defaults=defaults)

    @cached_property
    def zone(self) -> str:
        """THE rule: the --zone the engine gives (Home Assistant's), else the knowledge pack's, else the engine's
        VILLA_TZ, else UTC."""
        pack_zone = self.pack.time_zone if getattr(self.args, "pack", None) and self.pack else None
        return getattr(self.args, "zone", None) or pack_zone or os.environ.get("VILLA_TZ") or "UTC"

    @property
    def Z(self) -> ZoneInfo:
        return ZoneInfo(self.zone)

    @cached_property
    def now(self) -> datetime:
        given = getattr(self.args, "now", None)
        if given:
            t = datetime.fromisoformat(given)
            return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc)

    def day(self, named: str | None = None, last_finished: bool = False) -> date:
        """The day a script works on (timeutil.villa_day): the one named, else today at the villa — or the last
        finished one, for a check that judges a whole day."""
        from .timeutil import villa_day
        if named:
            return villa_day(self.Z, named)
        if getattr(self.args, "now", None):
            today = self.now.astimezone(self.Z).date()
            from datetime import timedelta
            return today - timedelta(days=1) if last_finished else today
        return villa_day(self.Z, None, last_finished=last_finished)
