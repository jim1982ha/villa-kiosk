"""Loading the content layer. §13.5, TASK-048.

⚠️ THE `_system` FILES ARE ALWAYS IN CONTEXT AND THE REST ARE NOT. That split is
the whole economics: ~3,500 tokens of constitution, severity, evidence, voice
and escalation sit above the cache breakpoint and cost a tenth after the first
call of the day, while twenty-five domain playbooks contribute only their
one-line descriptions until the agent asks for a body.

⚠️ SHIPPED AND LEARNED ARE TWO TREES AND ONLY ONE MAY CONTAIN A VILLA FACT.
`rootfs/usr/share/vesta/playbooks/` goes to every install and is subject to
CLAUDE.md's first hard rule — `test_playbooks.py` enforces it. `/data/vesta/` is
per-property, never redistributed, and entity ids there are CORRECT because that
is what a learned file is for. The asymmetry is why the CI rule is path-scoped
rather than global.

⚠️ AND THE VOICE FILES ARE ALTERNATIVES, NOT ADDITIONS. Loading both would tell
the model to include the entity id and to never include it, in the same breath —
the two are deliberately contradictory because a work order and a pushed alert
are different documents for different people.
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agent import content
from vesta.adapters import store as store_mod
from vesta.adapters.log import swallow

SHIPPED_ROOT: str = "/usr/share/vesta/playbooks"

#: ⚠️ `/data/vesta/local`, NOT `/data/vesta`, AND THE DIFFERENCE IS A PRIVILEGE
#: BOUNDARY (2.650.0). `body()` resolves a name by walking this root, so the
#: parent directory would have made every sibling store readable as a playbook:
#: `/data/vesta/review-queue/` holds drafts NO PERSON HAS APPROVED, and the
#: review queue's whole guarantee is that an unapproved draft is unreachable by
#: construction rather than by a filter somebody has to remember. It also put
#: `/data/vesta/memory/<hash>.md` one guessed name away from being served as a
#: procedure. Found while writing `review.py` — the module whose docstring
#: claimed the property this constant was quietly denying.
LEARNED_ROOT: str = "/data/vesta/local"

#: Where `note_read` records what was consulted. ⚠️ NOT IN THE PROMPT AND NOT
#: IN A PLAYBOOK. It is a DATE, and a date above the cache breakpoint ends
#: caching for every call — the same reason `last_confirmed` is front matter
#: rather than prose. It lives in a store nobody sends.
READS_PATH: str = "/data/vesta/playbook-reads.json"

#: How long a playbook may go unread before the quarterly review is told about
#: it. ⚠️ A PROMPT FOR A DECISION, NEVER A DELETION. The current blueprint pack
#: has no such signal at all, which is how an installed rule with no instance
#: sits there for a year; but "unread" can also mean "the villa has no pool",
#: so this surfaces and a person decides.
UNUSED_AFTER_DAYS: int = 90

#: Loaded on every run, in this order. ⚠️ A LIST, NOT A DIRECTORY WALK, because
#: order is part of the prompt and a filesystem's order is not: the constitution
#: must be read before the rules it frames.
SYSTEM_ORDER: Tuple[str, ...] = ("constitution", "severity", "evidence",
                                 "escalation")

#: Chosen by audience, never both. See the module docstring.
VOICE_OF: Dict[str, str] = {"owner": "voice-owner", "facility": "voice-facility"}

#: A SENDER's profile -> the audience whose voice they should be answered in.
#: ⚠️ `ops` IS THE FACILITY MANAGER and reads the facility voice — the one that
#: WANTS the entity id. A guest gets the owner voice: non-technical, no
#: identifiers, which is the safer of the two to give somebody whose role the
#: villa cannot fully vouch for.
AUDIENCE_OF_ROLE: Dict[str, str] = {"owner": "owner", "ops": "facility",
                                    "guest": "owner"}


def _read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return ""


#: ⚠️ RE-EXPORTED, NOT REIMPLEMENTED. `content.py` owns the syntax for every
#: store that speaks it — see its docstring for why the villa memory store
#: sharing this parser matters. The name stays here because every caller in the
#: prompt path already reaches for `playbooks.strip_front_matter`.
strip_front_matter = content.strip_front_matter


def system_prompt(audience: str = "owner", *,
                  root: Optional[str] = None,
                  memory_root: Optional[str] = None) -> str:
    """The always-in-context half, assembled in a fixed order.

    ⚠️ RETURNS `""` WHEN NOTHING IS INSTALLED RATHER THAN RAISING. A deployment
    whose playbooks are missing must still answer — degraded, with the caller's
    own instructions only — because the alternative is an agent that cannot
    speak because a documentation file is absent.

    ⚠️ THE CATALOGUE IS PART OF IT, AND ONLY THE CATALOGUE. Descriptions are
    what let the model know a procedure EXISTS; bodies are what it fetches when
    it judges one relevant. Assembling both here is what keeps "no playbook is
    loaded eagerly" true at the one place the prompt is built, rather than
    depending on every caller remembering which half is cheap.

    ⚠️ AND THE LEARNED HALF IS ASSEMBLED HERE TOO, THOUGH IT LIVES IN THE OTHER
    TREE. §13.5's always-in-context block is shipped constitution PLUS villa
    memory, and giving each tree its own assembly point is exactly how the
    shipped half came to be written, gated and loaded by nobody. One function
    builds the prompt; a caller cannot forget half of it.
    """
    base = os.path.join(root or SHIPPED_ROOT, "_system")
    names = list(SYSTEM_ORDER)
    voice = VOICE_OF.get(str(audience))
    if voice:
        names.append(voice)
    parts = [strip_front_matter(_read(os.path.join(base, f"{n}.md")))
             for n in names]
    parts.append(catalogue(root))
    parts.append(_memory_index(memory_root))
    return "\n\n".join(p for p in parts if p)


def _memory_index(root: Optional[str]) -> str:
    """⚠️ IMPORTED INSIDE THE FUNCTION AND DEGRADING TO `""`. A villa with no
    learned claims — every fresh install, and every test of the shipped half —
    must build the same prompt minus one block, never fail to build one."""
    try:
        from agent import memory as memory_mod
        return memory_mod.index(root)
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not load villa memory", err)
        return ""


def catalogue(root: Optional[str] = None) -> str:
    """The one-line-per-playbook manifest that sits in context.

    ⚠️ ~35 TOKENS EACH, AND THAT RATIO IS THE WHOLE ECONOMICS. Twenty-five
    bodies would be ~30k tokens on every one of ~96 triage calls a day; the
    descriptions are under a thousand and sit above the cache breakpoint, so
    after the first call of the day they cost a tenth of that.

    ⚠️ SORTED, BECAUSE THE PROMPT PREFIX MUST BE BYTE-STABLE. `os.walk` returns
    whatever order the filesystem gives, and a manifest that reshuffles between
    runs is a prefix that changes — which silently ends prompt caching with the
    bill as the only symptom, exactly as an interpolated date would.
    """
    rows = descriptions(root)
    if not rows:
        return ""
    lines = [f"- {r['name']} ({r['domain']}): {r['description']}"
             for r in sorted(rows, key=lambda r: (r["domain"], r["name"]))]
    return ("## Procedures available to you\n\n"
            "Call `read_playbook` with a name below when one is relevant to "
            "what you are looking at. Do not guess a body from its "
            "description, and do not read one that is not relevant.\n\n"
            + "\n".join(lines))


def descriptions(root: Optional[str] = None) -> List[Dict[str, str]]:
    """`{name, domain, description}` for every domain playbook.

    ⚠️ DESCRIPTIONS ONLY — ~35 tokens each. The body is fetched by
    `read_playbook` when the agent judges it relevant, which is what keeps
    twenty-five procedures affordable at a fifteen-minute cadence.
    """
    out: List[Dict[str, str]] = []
    base = root or SHIPPED_ROOT
    try:
        for folder, _dirs, files in os.walk(base):
            if os.path.basename(folder) == "_system":
                continue
            for name in sorted(files):
                if not name.endswith(".md") or name == "INDEX.md":
                    continue
                front = _front_matter(_read(os.path.join(folder, name)))
                if front.get("kind") == "playbook" and front.get("description"):
                    out.append({"name": front.get("name", name[:-3]),
                                "domain": front.get("domain", ""),
                                "description": front["description"]})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not list playbooks", err)
    return out


def _front_matter(text: str) -> Dict[str, str]:
    """See `content.front_matter` — one parser for every store in this format."""
    return content.front_matter(text)


def body(name: str, *, roots: Optional[Sequence[str]] = None) -> str:
    """One playbook's prose, by name, or `""`.

    ⚠️ THE LEARNED TREE IS SEARCHED FIRST. A villa-specific procedure written
    for this property beats the shipped generic one of the same name — that is
    what "learned" means — and the shipped copy remains the fallback rather than
    being shadowed permanently.

    ⚠️ THE NAME IS NOT A PATH. `..` and separators are refused rather than
    normalised: this reads files chosen by a MODEL, and a name that can traverse
    is a model that can read `/data/reports-secrets.json`.
    """
    safe = str(name).strip()
    if not safe or "/" in safe or "\\" in safe or ".." in safe:
        return ""
    for base in roots or (LEARNED_ROOT, SHIPPED_ROOT):
        for folder, _dirs, files in os.walk(base):
            if f"{safe}.md" in files:
                return strip_front_matter(_read(os.path.join(folder, f"{safe}.md")))
    return ""


def note_read(name: str, *, path: Optional[str] = None,
              now: Optional[float] = None) -> None:
    """Record that a playbook was CONSULTED. §13.6 rule 4.

    ⚠️ CALLED BY THE TOOL, NOT BY `body()`, AND THE DIFFERENCE IS THE WHOLE
    POINT. `body()` is also how CI reads a file, how the index is rendered and
    how a test asserts content — counting those would make every playbook look
    freshly consulted forever, which is a usage signal that can only ever say
    "all in use". Only the agent reaching for one is a read.

    ⚠️ NEVER RAISES. A store that cannot be written must not be able to fail an
    investigation; the cost of losing the signal is a review that is one entry
    less informed, and the cost of raising is an answer nobody gets.
    """
    try:
        rows = store_mod.read_json(path or READS_PATH, {})
        rows = dict(rows) if isinstance(rows, Mapping) else {}
        rows[str(name)] = float(now if now is not None else time.time())
        store_mod.write_json(path or READS_PATH, rows)
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not record a playbook read", err)


def unused(*, root: Optional[str] = None, path: Optional[str] = None,
           days: int = UNUSED_AFTER_DAYS,
           now: Optional[float] = None) -> List[str]:
    """Names not consulted within `days`, for the quarterly review.

    ⚠️ NEVER READ AND READ LONG AGO ARE THE SAME ANSWER HERE, deliberately. A
    playbook that has never been opened is the strongest case for deletion, and
    treating "absent from the store" as "no data, skip it" would hide exactly
    the files this signal exists to find — the fifth shape of instrument that
    lies, and this project has shipped four of them.
    """
    try:
        rows = store_mod.read_json(path or READS_PATH, {})
        rows = dict(rows) if isinstance(rows, Mapping) else {}
    except Exception as err:  # noqa: BLE001
        swallow("could not read playbook reads", err)
        rows = {}
    cutoff = (now if now is not None else time.time()) - float(days) * 86400.0
    out = []
    for row in descriptions(root):
        seen = rows.get(row["name"])
        if not isinstance(seen, (int, float)) or float(seen) < cutoff:
            out.append(row["name"])
    return sorted(out)


def render_index(root: Optional[str] = None) -> str:
    """`INDEX.md`'s exact content, derived from the tree.

    ⚠️ GENERATED, LIKE EVERY OTHER MANIFEST IN THIS PROJECT, and the CI gate
    compares the file on disk against this function rather than eyeballing it.
    A playbook that exists but is not offered is invisible to the model — it
    fails as "the agent chose not to use it", which is indistinguishable from
    working, and is the same silent shape `ALL_TOOLS` is pinned against.
    """
    rows = sorted(descriptions(root), key=lambda r: (r["domain"], r["name"]))
    lines = ["# Playbook index",
             "",
             "GENERATED by `agent.playbooks.render_index` — do not hand-edit.",
             "Add a playbook to its domain directory and regenerate.",
             ""]
    domain = ""
    for row in rows:
        if row["domain"] != domain:
            domain = row["domain"]
            if lines and lines[-1] != "":
                lines.append("")
            lines += [f"## {domain}", ""]
        lines.append(f"- **{row['name']}** — {row['description']}")
    lines.append("")
    return "\n".join(lines)


#: ⚠️ THE PREFIX HAS A STABLE HALF AND A VOLATILE HALF, AND UNTIL 2.714.0 THEY
#: SHARED ONE CACHE BREAKPOINT — SO THE VOLATILE HALF INVALIDATED THE STABLE
#: ONE ON EVERY CHANGE. `_cached` marks the LAST system block, and the last
#: block is the villa document, which is rebuilt from the journal. The journal
#: gains rows every few minutes ("observed 1256 entities, 126 changed"), so the
#: document differed between two conversations ninety seconds apart and the
#: whole prefix — every upstream tool schema included — was re-written at 1.25x.
#: Measured on the reference villa: a single chat request billed $0.2586 to
#: produce 157 output tokens, and 13 such writes were 38% of one morning's bill.
#:
#: ⚠️ SO THE BOUNDARY IS MARKED WHERE THE CONTENT ACTUALLY CHANGES. A cache
#: breakpoint covers everything BEFORE it, so one after the instructions holds
#: the tool schemas and both prompts across a document change; the document then
#: gets its own breakpoint from `_cached` and is the only part re-written.
#:
#: ⚠️ AND THE ORDER IS THE CONTRACT: stable first, volatile last. Putting the
#: document earlier would make every block after it uncacheable, which is the
#: same bug with the halves swapped.
def system_blocks(audience: str = "owner", *, instructions: str = "",
                  document: str = "",
                  root: Optional[str] = None) -> List[Dict[str, Any]]:
    """The three system blocks every tier sends, with the cache boundary marked.

    ⚠️ ONE BUILDER FOR THE THREE CALLERS. `chat`, `reason` and `triage` each
    built this list themselves in the identical shape, so the boundary would
    have had to be remembered three times — and the one that forgot would
    silently cost money rather than fail, which is the failure mode this
    repository keeps paying for.
    """
    blocks: List[Dict[str, Any]] = [
        # ⚠️ `root` IS PASSED THROUGH SO A TEST CAN POINT AT THE SHIPPED TREE.
        # Without it `system_prompt` returns "" wherever the playbooks are not
        # installed, and a test asserting "the constitution is in here" passes
        # vacuously — which is exactly how a mutation deleting this line
        # survived.
        {"type": "text", "text": system_prompt(audience, root=root)},
        # ⚠️ THE BREAKPOINT RIDES THE LAST STABLE BLOCK. `_cached` is additive
        # and leaves a block that already carries `cache_control` alone, so
        # this one survives and it adds the second one after the document.
        {"type": "text", "text": str(instructions),
         "cache_control": {"type": "ephemeral"}},
    ]
    if document:
        blocks.append({"type": "text", "text": str(document)})
    return blocks
