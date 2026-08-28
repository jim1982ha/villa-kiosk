"""The playbook review queue. §12.1, TASK-094.

⚠️ A PLAYBOOK THE AGENT WROTE AND APPROVED BY ITSELF IS HOW A WRONG ASSUMPTION
BECOMES PERMANENT. Everything else the agent produces is read once and closed;
a playbook is consulted on every future investigation of its class, so an error
in one compounds silently and looks like expertise. That asymmetry — not
caution in general — is why this one output needs a person in the loop.

⚠️ THE QUEUE IS A DIFFERENT DIRECTORY, NOT A FLAG. `approved: false` in front
matter would put a draft one edit away from being live and would rely on every
reader checking the field; `playbooks.body()` searches two roots and this is
neither of them, so an unapproved draft is unreachable BY CONSTRUCTION rather
than by filtering. Approval MOVES the file.

⚠️ AND A DRAFT IS PROPOSED FROM AN INVESTIGATION, NEVER FROM A TOOL RESULT —
the same boundary `memory.py` states, for the same reason. What the agent
proposes here it derived; what a device name says about itself is not a
procedure this villa should adopt.

⚠️ A DISCARD IS RECORDED, NOT DELETED. "We considered writing this down and
decided not to" is the answer to the same draft arriving again next quarter,
and a queue that forgets its refusals re-proposes them forever.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, List, Mapping, Optional

from agent import content
from vesta.adapters import store as store_mod
from vesta.adapters.log import log, swallow

QUEUE_ROOT: str = "/data/vesta/review-queue"

#: Where an APPROVED draft lands. ⚠️ THE LEARNED TREE, NEVER THE SHIPPED ONE.
#: A villa-specific procedure is correct here and would be a hard-rule breach
#: in `rootfs/usr/share/vesta/playbooks/` — that asymmetry is the whole reason
#: the two trees exist, and approval must not be able to cross it.
LIVE_ROOT: str = "/data/vesta/local"

#: Discards, kept as a record. See the module docstring's fourth rule.
DISCARD_ROOT: str = "/data/vesta/review-discarded"

#: ⚠️ THE TRIGGER FOR PROPOSING ONE AT ALL. An investigation that took one or
#: two tool calls was a lookup, and a "procedure" for a lookup is noise that
#: costs a person a review. Three is where a repeatable sequence starts to
#: exist.
MIN_TOOL_CALLS: int = 3

#: How many drafts may wait at once. ⚠️ A QUEUE NOBODY CAN FINISH IS A QUEUE
#: NOBODY OPENS, and an agent that proposes faster than a person reviews turns
#: this feature into a second inbox. Over the cap, it stops proposing.
MAX_PENDING: int = 5


@dataclass
class Draft:
    """One proposed procedure, waiting on a person."""

    slug: str
    title: str = ""
    domain: str = ""
    description: str = ""
    source: str = ""
    proposed_at: str = ""
    body: str = ""


def _day(at: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(
        at if at is not None else time.time()))


def _slug_ok(slug: str) -> str:
    """⚠️ A MODEL NAMES THIS FILE. Lowercase, digits and hyphens only — not a
    sanitiser that strips separators, but a shape test that refuses anything
    which is not already a name. `..` and every separator fail it by not being
    in the alphabet, which is the same argument `memory._path` makes.

    ⚠️ IT REFUSES UPPERCASE RATHER THAN LOWERCASING IT, and the first version
    did the latter. `playbooks.body()` resolves a name by exact filename and
    does NOT lowercase, so normalising here would store `Thing` as `thing.md`
    and leave the approved procedure permanently unfetchable by the name it was
    proposed under. A sanitiser that silently renames its input is how a handle
    and the thing it names come apart."""
    safe = str(slug or "").strip()
    if not safe or len(safe) > 60:
        return ""
    allowed = "abcdefghijklmnopqrstuvwxyz0123456789-"
    if any(c not in allowed for c in safe) or safe.startswith("-"):
        return ""
    return safe


def _read_draft(path: str, slug: str) -> Optional[Draft]:
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read()
    except OSError:
        return None
    front = content.front_matter(raw)
    return Draft(slug=slug,
                 title=str(front.get("name") or slug),
                 domain=str(front.get("domain") or ""),
                 description=str(front.get("description") or ""),
                 source=str(front.get("source") or ""),
                 proposed_at=str(front.get("proposed_at") or ""),
                 body=content.strip_front_matter(raw))


def pending(root: Optional[str] = None) -> List[Draft]:
    """Every draft awaiting a decision. Never raises."""
    base = root or QUEUE_ROOT
    out: List[Draft] = []
    try:
        names = sorted(n for n in os.listdir(base) if n.endswith(".md"))
    except OSError:
        return out
    for name in names:
        got = _read_draft(os.path.join(base, name), name[:-3])
        if got is not None:
            out.append(got)
    return out


def propose(slug: str, *, domain: str, description: str, body: str,
            source: str, tool_calls: int = 0,
            root: Optional[str] = None,
            now: Optional[float] = None) -> bool:
    """Draft a procedure for review. Returns whether it was queued.

    ⚠️ EVERY REFUSAL HERE IS SILENT AND RETURNS FALSE. This is called at the
    end of an investigation that has already produced its answer, and a queue
    that could fail a run would trade a delivered finding for a proposed
    document. The refusals are also the common case: most investigations should
    not propose anything.
    """
    base = root or QUEUE_ROOT
    safe = _slug_ok(slug)
    if not safe or not str(body).strip() or not str(source).strip():
        return False
    if int(tool_calls) < MIN_TOOL_CALLS:
        return False
    if len(pending(base)) >= MAX_PENDING:
        log("review queue is full; not proposing another playbook")
        return False
    if os.path.isfile(os.path.join(base, f"{safe}.md")):
        return False

    front = {
        # ⚠️ NO `kind: playbook` UNTIL IT IS APPROVED. `descriptions()` keys on
        # that field, so a draft that carried it would be offered to the model
        # from the learned tree the moment anything walked this directory —
        # approval by filesystem accident. It is stamped in by `approve`.
        "kind": "draft",
        "name": safe,
        "domain": str(domain).strip(),
        "description": str(description).strip()[:200],
        "source": str(source).strip(),
        "proposed_at": _day(now),
        "version": "1",
    }
    return _save(os.path.join(base, f"{safe}.md"), front, str(body).strip(),
                 f"playbook {safe} proposed for review")


def approve(slug: str, *, by: str, edited_body: str = "",
            root: Optional[str] = None, live_root: Optional[str] = None,
            now: Optional[float] = None) -> bool:
    """A person accepting a draft into the villa's own playbook set.

    ⚠️ `by` IS REQUIRED AND IS RECORDED IN THE FILE. A live procedure that
    nobody's name is on is one nobody owns, and the question asked of it a year
    later — "who decided this?" — has to have an answer.

    ⚠️ AN EDIT IS PART OF APPROVING, NOT A SEPARATE STEP. The realistic case is
    a reviewer who agrees with most of a draft and wants one paragraph changed;
    forcing that through a second mechanism is how they approve it unchanged
    instead.
    """
    base = root or QUEUE_ROOT
    safe = _slug_ok(slug)
    if not safe or not str(by).strip():
        return False
    draft = _read_draft(os.path.join(base, f"{safe}.md"), safe)
    if draft is None:
        return False

    front = {
        "kind": "playbook",
        "name": safe,
        "domain": draft.domain,
        "description": draft.description,
        "source": draft.source,
        "approved_by": str(by).strip(),
        "last_confirmed": _day(now),
        "version": "1",
    }
    body = str(edited_body).strip() or draft.body
    target = os.path.join(live_root or LIVE_ROOT, f"{safe}.md")
    if not _save(target, front, body, f"playbook {safe} approved by {by}"):
        return False
    # ⚠️ REMOVED ONLY AFTER THE LIVE COPY IS ON DISK. The other order loses the
    # draft entirely if the second write fails, and a reviewer's edit is not
    # recoverable from anywhere.
    _remove(os.path.join(base, f"{safe}.md"))
    return True


def discard(slug: str, *, by: str, reason: str = "",
            root: Optional[str] = None, discard_root: Optional[str] = None,
            now: Optional[float] = None) -> bool:
    """A person refusing a draft. Recorded, never deleted — see rule 4."""
    base = root or QUEUE_ROOT
    safe = _slug_ok(slug)
    if not safe or not str(by).strip():
        return False
    draft = _read_draft(os.path.join(base, f"{safe}.md"), safe)
    if draft is None:
        return False
    front = {
        "kind": "discarded",
        "name": safe,
        "domain": draft.domain,
        "description": draft.description,
        "source": draft.source,
        "discarded_by": str(by).strip(),
        "discarded_at": _day(now),
        "reason": str(reason).strip()[:300],
    }
    target = os.path.join(discard_root or DISCARD_ROOT, f"{safe}.md")
    if not _save(target, front, draft.body, f"playbook {safe} discarded by {by}"):
        return False
    _remove(os.path.join(base, f"{safe}.md"))
    return True


def _remove(path: str) -> None:
    try:
        os.unlink(path)
    except OSError as err:  # noqa: BLE001
        swallow("could not clear a reviewed draft", err)


def _save(path: str, front: Mapping[str, Any], body: str, note: str) -> bool:
    """⚠️ ATOMIC, and never raises. Same mechanism as every other store here —
    see `store.write_text`."""
    try:
        store_mod.write_text(path, content.render(front, body))
    except OSError as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not write a review-queue file", err)
        return False
    if note:
        log(note)
    return True
