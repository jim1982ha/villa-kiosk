"""Which of this villa's devices a Subject names.

⚠️ THE JOIN BETWEEN A MODEL'S PHRASING AND THE VILLA'S OWN LABELS, and it has
nothing to do with Triage's economics, its prompt or its cost argument.
`triage.py` opens by declaring its own narrowness — "IT ANSWERS ONE THING: is
anything here worth a closer look?" — and 124 of its 461 lines were this
matcher.

⚠️ ITS INTERFACE WAS NOT ITS TEST SURFACE, AND THE MODULE HAD SAID SO. From
`triage._unidentified_note`: "`_identify` only ever sees `refs.known()`, so the
second is entirely possible and is invisible to every test of the matcher —
those hand it the labels directly, which is `feedback_pin-the-caller` in its
usual disguise." That note existed to recover, at runtime and through a log
line, a distinction the shape of `_identify` made untestable: *the matcher
failed* versus *there was nothing to match against*.

The old entry point was private, took `refs: Any` (so `--strict` checked
nothing at the one place a wrong shape silently identifies nothing), returned
`None`, mutated the `Escalation` objects in place, and duck-typed three methods
through `getattr(refs, "known", lambda: ())()`. This one takes a mapping and
returns a tuple. The empty-candidate case is `not labels`, which a caller can
tell apart without a diagnostic string.

⚠️ THE TWO DIRECTIONS AND THEIR OPPOSITE TIE-BREAKS ARE UNCHANGED, deliberately.
They are the part that was reasoned about, and the comments explaining why they
differ travel with them.
"""

from __future__ import annotations

from typing import Dict, List, Mapping, Tuple

#: How much of a device's own name a subject span must be before it may claim
#: that device, when the span sits INSIDE the label (the model shortening).
#: ⚠️ DIMENSIONLESS, and it is what stops the word "pump" naming a pump: on the
#: reference villa five labels end in "Pump Power", so a bare "pump" is inside
#: all of them and the shortest-label rule would attach one at random.
REVERSE_MIN_SHARE: float = 0.5


def devices_named(subject: str, labels: Mapping[str, str]) -> Tuple[str, ...]:
    """The entity ids this Subject names, in the order it names them.

    `labels` maps a COMPARABLE label (see `triage._comparable`) to an entity id.
    The caller builds it, because the handle table it comes from dies with the
    run.

    ⚠️ NO MATCH IS A NORMAL OUTCOME, NOT A FAILURE. "Coverage incomplete" and
    "the monitoring journal" are real subjects with no device behind them.
    """
    known = dict(labels)
    if not subject or not known:
        return ()
    # ⚠️ CONTAINMENT ONLY, AND THE EXACT-MATCH FAST PATH BESIDE IT WAS
    # DELETED RATHER THAN KEPT (2.752.0). A model writes "the pool pump
    # circuit" for a device labelled "Pool pump", so containment is the
    # rule that has to work; and `label in subject` is TRUE whenever they
    # are equal, so a preceding dict lookup could never change an answer.
    # Mutation testing proved it: replacing the fast path with `None` left
    # every assertion green, which is the definition of a line that is not
    # doing anything. Longest label first, so a specific one beats a
    # substring of it.
    #
    # ⚠️ EVERY NON-OVERLAPPING MATCH IS KEPT, NOT ONLY THE FIRST
    # (2026-08-30). "Pool Pump and Massage Jet Pump" names two devices, and
    # keeping one meant the other's flag was never stamped by the
    # investigation that covered it — the delivered brief then showed the
    # same pump "noticed, not investigated" beside "investigated". Longest
    # label first still decides SPECIFICITY: a label whose span sits inside
    # an already-claimed span is the general name of equipment a more
    # specific label already matched ("Massage Jet Pump" inside "Massage
    # Jet Pump Power Factor"), and claiming it too would attach a second
    # device to one mention. Devices are ordered by where the subject
    # names them, so the primary is the one the model led with.
    claimed: List[Tuple[int, int]] = []   # char spans already matched
    found_at: Dict[str, int] = {}         # entity -> first position

    def free(start: int, end: int) -> bool:
        return all(end <= s or start >= e for s, e in claimed)

    for label in sorted(known, key=len, reverse=True):
        start = subject.find(label)
        while start >= 0:
            end = start + len(label)
            if free(start, end):
                claimed.append((start, end))
                found_at.setdefault(known[label], start)
                break
            start = subject.find(label, start + 1)

    # ⚠️ THE REVERSE DIRECTION MUST WORK PER-SPAN TOO, AND SHIPPING IT
    # WHOLE-SUBJECT-ONLY LEFT THE REPORTED BUG OPEN (2026-08-30). Measured
    # against the villa's own labels: they carry a "Power" suffix the model
    # drops ("Pool Pump Power" vs "Pool Pump"), so the FORWARD pass above
    # matches nothing at all and every single-device subject is identified
    # by this fallback. Testing only the whole subject therefore worked for
    # "Pool Pump" and could never work for "Pool Pump and Massage Jet
    # Pump", which is not wholly inside any label — so the compound kept a
    # `topic:` key, could not merge with either pump's own flag, and the
    # brief showed one pump twice with opposite verdicts. The first fix
    # generalised the direction that was NOT doing the work.
    #
    # ⚠️ LONGEST SPAN FIRST, and the two directions keep DIFFERENT
    # tie-breaks because they mean opposite things: a label found inside
    # the subject is the model padding, so the LONGEST label is the most
    # specific device meant; a subject span found inside a label is the
    # model shortening, so the SHORTEST label is the most general name of
    # the equipment. Collapsing them re-opens whichever case is not tested.
    starts = []
    at = 0
    for word in subject.split():
        starts.append((at, at + len(word)))
        at += len(word) + 1
    for length in range(len(starts), 0, -1):
        for first in range(0, len(starts) - length + 1):
            begin, finish = starts[first][0], starts[first + length - 1][1]
            if not free(begin, finish):
                continue
            span = subject[begin:finish]
            inside = [l for l in known if span in l]
            if not inside:
                continue
            best = min(inside, key=lambda l: (len(l), l))
            # ⚠️ THE SPAN MUST BE MOST OF THE NAME IT CLAIMS. "pump" sits
            # inside every pump label on this property, and without this a
            # one-word span would attach whichever device sorted first —
            # inventing a device the model never named. Dimensionless, so
            # it carries no assumption about how anyone names equipment.
            if len(span) < REVERSE_MIN_SHARE * len(best):
                continue
            claimed.append((begin, finish))
            found_at.setdefault(known[best], begin)
    # ⚠️ THE WHOLE-SUBJECT REVERSE FALLBACK THAT USED TO SIT HERE IS GONE,
    # AND ITS REASONING LIVES IN THE SPAN LOOP ABOVE (2026-08-30). It was
    # added on 2026-08-28 for two live passes logging `0/5 identified` —
    # triage writing "Jacuzzi Pump" for a device labelled "Jacuzzi Pump
    # Power" — and the span loop is that same rule with the subject's own
    # spans instead of only the whole string, so the maximal span it tries
    # FIRST is exactly the case this block used to answer.
    #
    # ⚠️ DELETING IT IS PART OF THE FIX, NOT A TIDY-UP. It carried no
    # share guard, so it happily matched a subject of "pump" against
    # whichever of this villa's five "… Pump Power" labels sorted shortest
    # — inventing a device the model never named. Measured: with the span
    # loop in place and this block still present, `"pump"` resolved to the
    # pool pump. With it removed, `"pump"` correctly resolves to nothing.
    # Two rules answering one question, and the weaker one won.
    return tuple(sorted(found_at, key=lambda entity: found_at[entity]))
