"""Who the villa knows, and how to reach them. ONE table, two directions.

⚠️ THIS REPLACES TWO SEPARATE FACTS THAT WERE ALWAYS THE SAME FACT. Until now
`allowed_senders` mapped a Telegram id to a role (INBOUND: may this person talk
to the villa) while every briefing schedule carried its own `audience` beside
its own delivery target (OUTBOUND: how should this be written, and where does it
go). So one person was configured twice, in two screens, in two vocabularies —
and the owner reported the second as redundant, correctly: choosing to send a
brief to somebody already determines whose voice it is written in.

⚠️ THE TWO DIRECTIONS ARE STILL NOT SYMMETRIC, AND THE TABLE MUST NOT PRETEND
THEY ARE. A Companion-app notify entity can only RECEIVE; it can never send, so
listing one grants no inbound privilege whatsoever. Only `telegram` on a row is
an authentication fact. A person with a device and no Telegram chat is
delivery-only, which is a completely normal row and is why the field is
optional.

⚠️ INBOUND STILL FAILS CLOSED AND THE SEED IS STILL EMPTY. A row with no
`telegram` grants nothing, an empty table grants nothing, and an unknown sender
gets silence rather than a refusal — an error reply confirms the bot is live to
whoever is probing it. Merging the tables must not become a way to widen the
allow-list by accident, so `role_for_sender` reads ONLY the telegram field and
never a delivery target.

⚠️ AND THE LEGACY MAP IS STILL HONOURED, BECAUSE THE ALTERNATIVE IS A SILENT
LOCK-OUT. A villa that configured `allowed_senders` before this existed must not
have its bot go deaf on upgrade — the symptom would be "the villa stopped
answering me" with nothing in the config visibly wrong. `people()` synthesises
rows from it when the new table is empty, so an existing install keeps working
and an owner who edits the new panel writes the new shape.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

from reports import store as store_mod

#: Where the villa's own agent settings live. ⚠️ READ DIRECTLY RATHER THAN
#: THROUGH `agent.config`, and this module sits in `reports/` for the same
#: reason `usage.py` does: BOTH layers need this fact — the agent to answer
#: "may this person speak", the briefing pipeline to answer "whose voice is
#: this written in" — and `reports/__init__.py` says layering is strictly
#: downward, so the pipeline may not reach up into `agent`. Putting it here
#: makes both imports point the same way. (The first version of this file lived
#: in `agent/` and `test_reports_never_imports_agent` caught the pipeline
#: reaching up for it, one release after that same rule was cited out loud.)
#:
#: ⚠️ THE ENVELOPE KEY IS WIRE-ONLY. The proxy wraps the document in `config` on
#: the way out; the file on disk holds the bare document.
CONFIG_PATH: str = "/data/vesta/agent-config.json"

#: A SENDER's profile -> the audience whose voice they are answered in.
#: ⚠️ IMPORTED FROM `agent.playbooks` UNTIL 2.651.0 AND NOW DUPLICATED HERE ON
#: PURPOSE — the import was upward. It is three entries and both copies are
#: pinned equal by `test_agent_people`, which is the honest way to hold a fact
#: two layers need when the dependency may only point one way.
AUDIENCE_OF_ROLE: Dict[str, str] = {"owner": "owner", "ops": "facility",
                                    "guest": "owner"}

#: The channel an inbound id belongs to. ⚠️ KEPT AS A PREFIX RATHER THAN A BARE
#: ID for the reason `allowed_senders` did: a Telegram user id and a future
#: WhatsApp id are integers from different namespaces and would collide.
INBOUND_CHANNEL: str = "telegram"


def _row(raw: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """One validated person, or `None`.

    ⚠️ A ROW WITH NO ROLE IS DROPPED, NOT DEFAULTED. The role decides both
    whether somebody may talk to the villa and which voice they are written in —
    one of which withholds entity ids and one of which requires them. A default
    here would be a privilege decision made by a typo.
    """
    role = str(raw.get("role") or "").strip().lower()
    if role not in AUDIENCE_OF_ROLE:
        return None
    targets = raw.get("targets")
    targets = [str(t).strip() for t in targets
               if str(t).strip()] if isinstance(targets, Sequence) \
        and not isinstance(targets, str) else []
    return {
        "name": str(raw.get("name") or "").strip(),
        "telegram": str(raw.get("telegram") or "").strip(),
        "targets": targets,
        "role": role,
    }


def read_config() -> Dict[str, Any]:
    """The stored agent settings, or `{}`. Never raises."""
    try:
        raw = store_mod.read_json(CONFIG_PATH, {})
        return dict(raw) if isinstance(raw, Mapping) else {}
    except Exception:  # noqa: BLE001 - degrade, never fail
        return {}


def people(config: Optional[Mapping[str, Any]] = None) -> List[Dict[str, Any]]:
    """Every person, from the new table or synthesised from the legacy map.

    ⚠️ `None` MEANS READ THE STORE, not "no people". A caller that has the
    config passes it; the pipeline does not, and defaulting to empty would make
    every briefing fall back to the owner voice silently.
    """
    cfg = dict(config) if isinstance(config, Mapping) else read_config()
    raw = cfg.get("people")
    rows: List[Dict[str, Any]] = []
    if isinstance(raw, Sequence) and not isinstance(raw, str):
        for entry in raw:
            if isinstance(entry, Mapping):
                got = _row(entry)
                if got is not None:
                    rows.append(got)
    if rows:
        return rows

    # ⚠️ THE MIGRATION, AND IT IS READ-ONLY. Nothing writes the new table here:
    # a config rewrite on READ is how a store silently loses a key it did not
    # understand, and this path runs on every message. The owner's first edit in
    # the new panel is what persists the new shape.
    legacy = cfg.get("allowed_senders")
    if not isinstance(legacy, Mapping):
        return []
    for key, role in sorted(legacy.items()):
        if not isinstance(role, str):
            continue
        channel, _, sender = str(key).partition(":")
        if channel.strip().lower() != INBOUND_CHANNEL or not sender:
            continue
        got = _row({"name": sender, "telegram": sender, "role": role})
        if got is not None:
            rows.append(got)
    return rows


def role_for_sender(config: Optional[Mapping[str, Any]], *, channel: str,
                    sender_id: Any) -> str:
    """Who is this? `""` means nobody — no run and no reply.

    ⚠️ IT READS `telegram` AND NOTHING ELSE. A delivery target on the same row
    is a place to send to, not an identity to trust; treating one as inbound
    proof would let anyone who can name a notify entity assume that person's
    role. That is the one way merging these two tables could have gone wrong,
    and it is closed here rather than in the caller.
    """
    if str(channel).strip().lower() != INBOUND_CHANNEL:
        return ""
    wanted = str(sender_id).strip()
    if not wanted:
        return ""
    for person in people(config):
        if person["telegram"] and person["telegram"] == wanted:
            return str(person["role"])
    return ""


def person_for_target(config: Optional[Mapping[str, Any]],
                      target: str) -> Optional[Dict[str, Any]]:
    """Whoever a delivery target belongs to, or `None` if nobody claims it."""
    wanted = str(target or "").strip()
    if not wanted:
        return None
    for person in people(config):
        if wanted in person["targets"]:
            return person
    return None


def audience_for_target(config: Optional[Mapping[str, Any]],
                        target: str) -> str:
    """How a brief to this destination should be written, or `""`.

    ⚠️ `""` MEANS "NOBODY HAS SAID", AND THE CALLER MUST NOT READ IT AS A
    DEFAULT. The two voices are deliberately contradictory — one requires the
    entity id, the other forbids it — so guessing sends a document written for
    the wrong reader. The UI refuses to save a schedule in this state; the
    backend degrades to the owner voice, which is the half that withholds
    identifiers, and that asymmetry is the whole reason a default is unsafe.
    """
    person = person_for_target(config, target)
    return AUDIENCE_OF_ROLE.get(person["role"], "owner") if person else ""


def unclaimed(config: Optional[Mapping[str, Any]],
              targets: Sequence[str]) -> List[str]:
    """Which of these destinations nobody has been given a profile for.

    The list the schedule editor needs in order to say WHICH target is the
    problem — "cannot save" without naming the destination is a dead end for
    whoever has to fix it.
    """
    return [t for t in (str(x).strip() for x in targets)
            if t and person_for_target(config, t) is None]
