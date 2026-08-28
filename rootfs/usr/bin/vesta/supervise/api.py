"""The agent's own HTTP surface. TASK-115 step 6, REQ-063, ARCH-011.

⚠️ NINETEEN HANDLERS AND TWO HELPERS, MOVED FROM `supervisor-proxy.py`
VERBATIM — the diff to review is the deps seam, nothing else. They were the
agent's surface living inside a 3,800-line host file, indistinguishable from
the kiosk's own routes; an external deployment (the export the owner reserved)
serves `routes()` itself, and the add-on mounts the same table.

⚠️ AUTH IS THE HOST'S, INJECTED — NEVER IMPLEMENTED HERE. `deps.authorized` /
`deps.role_for` are the add-on's session-cookie machinery; an external host
supplies its own. What this file owns is what each role MAY DO once
identified, and `agent_actions.MAY_ACT` is that rule's one home. The security
suite (270 checks) runs against the mounted result, which is what makes this
move auditable: same requests, same refusals, same bytes.

⚠️ `bind()` BEFORE `routes()`, ONCE, AT STARTUP. Module state on purpose, same
shape as `adapters.hass.configure` — a handler table rebuilt per request would
re-bind auth per request, and the first forgotten bind should fail loudly at
mount time, not per-request at 3am. `routes()` raises if unbound.

⚠️ `/agent-mcp` KEEPS ITS DOCUMENTED EXCEPTION: no session check and no RBAC,
because its caller is another PROCESS holding a bearer token from the 0600
secrets file — the extraction seam itself. The rule that matters is downstream
and unchanged: `mcp_server` runs every call through the same `registry.invoke`
as the in-process agent, so arriving over the wire grants exactly nothing.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from aiohttp import web

from vesta.adapters import log as reports_log
from vesta.adapters import secrets as reports_secrets
from vesta.adapters import hass as hass_mod

from vesta.supervise.agent import actions as agent_actions
from vesta.supervise.agent import config as agent_config

#: The proxy's old name for the permitted-roles tuple, kept as the alias it
#: already was there — handlers moved verbatim reference it, and the one home
#: of the rule stays `actions.MAY_ACT`.
TASK_ACK_ROLES = agent_actions.MAY_ACT

#: The host's auth machinery and store paths, injected once via `bind()`.
deps: Any = None


def bind(*, authorized: Any, unauthorized: Any, forbidden: Any, role_for: Any,
         read_json_store: Any, agent_config_file: str,
         config_get: Any, config_put: Any, concerns_get: Any) -> None:
    """Give the handlers their host. Called once, at startup, by whoever
    mounts `routes()` — the proxy in the add-on, the entrypoint in an export."""
    global deps
    # ⚠️ THE TWO STORE HANDLERS ARE INJECTED, NOT MOVED. /agent-config and
    # /agent-concerns come from the host's `_json_store_handlers` factory —
    # revision/409 machinery shared with four other stores — and an export
    # serves its own stores. Moving the factory would drag device-config and
    # fm-data with it; injecting the two handlers keeps the TABLE complete
    # (one mount covers the agent's whole surface) without splitting the
    # factory's ownership.
    deps = SimpleNamespace(
        authorized=authorized, unauthorized=unauthorized, forbidden=forbidden,
        role_for=role_for, read_json_store=read_json_store,
        agent_config_file=agent_config_file,
        config_get=config_get, config_put=config_put,
        concerns_get=concerns_get)


def routes() -> List[Any]:
    """The agent's route table, ready for `app.add_routes`.

    ⚠️ DERIVED BY NOTHING, STATED ONCE: this list and the nginx allowlist are
    the two halves `test_nginx_routes` keeps honest, exactly as before the
    move — it derives the routes from whoever registers them.
    """
    if deps is None:
        raise RuntimeError("supervise.api.bind() must run before routes()")
    return [
        web.get("/agent-config", deps.config_get),
        web.get("/agent-concerns", deps.concerns_get),
        web.get("/agent-chats", agent_chats_handler),
        web.post("/agent-feedback", agent_feedback_handler),
        web.post("/agent-action", agent_action_handler),
        web.get("/agent-flag-types", agent_flag_types_get_handler),
        web.post("/agent-flag-types", agent_flag_types_post_handler),
        web.post("/agent-acknowledge", agent_acknowledge_handler),
        web.get("/agent-runs", agent_runs_handler),
        web.get("/agent-usage", agent_usage_handler),
        web.get("/agent-review", agent_review_get_handler),
        web.post("/agent-review", agent_review_decide_handler),
        web.get("/agent-audit", agent_audit_handler),
        web.get("/agent-proposals", agent_proposals_handler),
        web.post("/agent-confirm", agent_confirm_handler),
        web.post("/agent-run-now", agent_run_now_handler),
        web.get("/agent-queue", agent_queue_get_handler),
        web.post("/agent-queue", agent_queue_post_handler),
        web.get("/agent-memory", agent_memory_get_handler),
        web.post("/agent-memory", agent_memory_correct_handler),
        web.put("/agent-config", deps.config_put),
        web.post("/agent-mcp", agent_mcp_handler),
    ]


async def agent_feedback_handler(request: web.Request) -> web.Response:
    """Record a person's verdict on a concern. TASK-062.

    ⚠️ OWNER AND FACILITY MANAGER, THE SAME PAIR THAT MAY ACKNOWLEDGE A TASK.
    A guest may FILE a fault report and may not judge one — dismissing a concern
    suppresses a whole subject after three goes, which is a decision about what
    the villa stops watching.

    ⚠️ THE REASON IS OPTIONAL AND IS THE MORE VALUABLE HALF. "Not useful — the
    gym is closed for renovation" is a fact about the property that should stop
    the whole family of gym concerns; PH-7 turns it into a memory. It is stored
    verbatim rather than counted.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) not in TASK_ACK_ROLES:
        return deps.forbidden("Only an owner or facility manager may judge a "
                          "concern.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "expected an object"}, status=400)

    concern_id = str(body.get("id") or "").strip()
    if not concern_id:
        return web.json_response({"error": "no concern id"}, status=400)
    # ⚠️ EXPLICIT, NOT TRUTHY. A missing `useful` must not read as "not
    # useful" — that is the verdict that suppresses a subject, and defaulting
    # to it would let a malformed request silence the villa.
    if not isinstance(body.get("useful"), bool):
        return web.json_response({"error": "useful must be true or false"},
                                 status=400)

    # ⚠️ THE VERDICT, THE KIND IT TEACHES AND THE ACKNOWLEDGEMENT ARE ONE ACT,
    # AND IT LIVES IN `agent/actions.py` (2026-08-28). This handler used to
    # assemble the three itself, which was correct and was also the only copy —
    # so when the phone's buttons arrived they would have had to assemble them
    # again, and the owner's requirement is that the two surfaces cannot fall
    # out of step BY DESIGN. Every reason the order matters is recorded there,
    # beside the code, rather than here beside one of its callers.
    from vesta.supervise.agent import actions as agent_actions
    from vesta.supervise.agent import concerns as agent_concerns
    useful = bool(body["useful"])
    outcome = await agent_actions.apply(
        request.app.get("session"),
        "useful" if useful else "not_useful", concern_id,
        by=str(deps.role_for(request) or ""),
        config=agent_config.view(deps.read_json_store(deps.agent_config_file, {})),
        reason=str(body.get("reason") or "")[:500])
    if not outcome.ok:
        return web.json_response({"error": outcome.note}, status=400)

    taught = ""
    for row in agent_concerns.read():
        if str(row.get("id")) == concern_id:
            taught = str(row.get("flag_type") or "")
            break
    return web.json_response({
        "ok": True,
        "suppressed": agent_concerns.suppressed_subjects(),
        "flagType": taught,
        "note": outcome.note,
    })


async def agent_action_handler(request: web.Request) -> web.Response:
    """Any act on an alert, from the tablet. The phone's buttons call the same
    function through `agent/buttons.py`, which is the whole point of both.

    ⚠️ IT EXISTS BECAUSE "DONE" WAS TWO BROWSER CALLS WITH NOTHING JOINING THEM.
    `AgentTodo.finish` completed the to-do item over Home Assistant's websocket
    and then acknowledged the alert through this add-on; the first succeeding
    and the second failing leaves a ticked job beside an alert still being
    chased. One request, one server-side act, and the browser can no longer
    perform half of it.

    ⚠️ THE SAME GATE AS ITS NEIGHBOURS, AND FROM THE SAME TUPLE. `actions.MAY_ACT`
    is imported rather than restated so that widening it on one surface cannot
    widen it on only one surface.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    from vesta.supervise.agent import actions as agent_actions
    if deps.role_for(request) not in agent_actions.MAY_ACT:
        return deps.forbidden("Only an owner or facility manager may act on an "
                          "alert.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "expected an object"}, status=400)
    concern_id = str(body.get("id") or "").strip()
    action_id = str(body.get("action") or "").strip()
    if not concern_id or not action_id:
        return web.json_response({"error": "an id and an action are required"},
                                 status=400)

    outcome = await agent_actions.apply(
        request.app.get("session"), action_id, concern_id,
        by=str(deps.role_for(request) or ""),
        config=agent_config.view(deps.read_json_store(deps.agent_config_file, {})),
        reason=str(body.get("reason") or "")[:500])
    if not outcome.ok:
        return web.json_response({"error": outcome.note}, status=400)
    return web.json_response({"ok": True, "note": outcome.note})


async def agent_flag_types_get_handler(request: web.Request) -> web.Response:
    """The kinds a person has taught this villa, and how strongly. REQ-038.

    Open to any authorized session, like the other agent reads — it names no
    device and no room, only measurements and the owner's own weights.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    from vesta.supervise.agent import flagtypes as agent_flagtypes
    return web.json_response({
        "types": agent_flagtypes.listing(),
        # ⚠️ THE BOUNDS AND THE STEP COME FROM THE SERVER, so the
        # buttons cannot disagree with the store about what a press
        # is worth or where the dial stops.
        "min": agent_flagtypes.MIN_FACTOR,
        "max": agent_flagtypes.MAX_FACTOR,
        "step": agent_flagtypes.STEP})


async def agent_flag_types_post_handler(request: web.Request) -> web.Response:
    """Tune, forget, import or clear the taught kinds. Owner-only.

    ⚠️ ONE ROUTE, FOUR VERBS, BECAUSE THEY EDIT ONE DOCUMENT. A store with a
    handler per verb is four places for the permission to drift; `action` is
    read here and refused by exclusion, so a fifth verb is a 400 rather than a
    silent success.

    ⚠️ OWNER-ONLY, AND NOT `TASK_ACK_ROLES`. Acknowledging a concern is a
    facility manager's job; deciding what the villa may stop telling anybody
    about is the owner's, and an imported list can silence a whole class of
    finding on every future check.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only an owner may change what the villa "
                          "prioritises.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "expected an object"}, status=400)

    from vesta.supervise.agent import flagtypes as agent_flagtypes
    action = str(body.get("action") or "").strip().lower()
    key = str(body.get("key") or "").strip()
    if action == "nudge":
        # ⚠️ A DIRECTION, NEVER A COMPUTED NUMBER. The step lives in
        # `flagtypes.STEP` alone, so the button cannot disagree with the store
        # about what one press is worth.
        ok, reason = agent_flagtypes.nudge(
            key, 1 if str(body.get("direction") or "") == "up" else -1)
    elif action == "factor":
        ok, reason = agent_flagtypes.set_factor(key, body.get("factor"))
    elif action == "forget":
        ok, reason = agent_flagtypes.forget(key)
    elif action == "clear":
        ok, reason = agent_flagtypes.clear()
    elif action == "import":
        ok, reason = agent_flagtypes.replace(body.get("document"))
    else:
        return web.json_response(
            {"error": "action must be nudge, factor, forget, clear or import"},
            status=400)
    if not ok:
        return web.json_response({"error": reason}, status=400)
    return web.json_response({"ok": True,
                              "types": agent_flagtypes.listing()})


async def agent_acknowledge_handler(request: web.Request) -> web.Response:
    """"I have seen this." Stops escalation. TASK-112, REQ-033/034.

    ⚠️ ACKNOWLEDGING IS NOT JUDGING, AND IT IS NOT RESOLVING. `/agent-feedback`
    records whether a concern was WORTH raising — three dismissals suppress a
    whole subject — and closing one says the problem is dealt with. This says
    only that a person has it, which is the one fact `route.escalate` needs and
    the one nothing in this system could state until now. It is a lighter act
    than either neighbour and deliberately has the same gate, because the pair
    who receive an escalation are the pair who must be able to stop it.

    ⚠️ THE NAME COMES FROM THE SESSION, NEVER FROM THE BODY. "Who picked this
    up" is the content of an acknowledgement, and a client-supplied name would
    let anyone stop the villa escalating on somebody else's behalf.

    ⚠️ AND THIS IS THE PHONE PATH, NOT ONLY THE TABLET'S. An alert that can be
    acknowledged only by walking to the kiosk escalates while somebody is
    reading it — so this is a plain POST behind the same ingress session the
    Cockpit uses, which is what a phone browser already has.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) not in TASK_ACK_ROLES:
        return deps.forbidden("Only an owner or facility manager may acknowledge "
                          "a concern.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "expected an object"}, status=400)
    concern_id = str(body.get("id") or "").strip()
    if not concern_id:
        return web.json_response({"error": "no concern id"}, status=400)

    from vesta.supervise.agent import concerns as agent_concerns
    ok, reason = agent_concerns.acknowledge(
        concern_id, by=str(deps.role_for(request) or ""))
    if not ok:
        return web.json_response({"error": reason}, status=400)
    # ⚠️ `reason` IS RETURNED ON SUCCESS TOO. A second acknowledgement is not an
    # error — escalation has already stopped — and it carries the only thing the
    # caller did not know: who got there first.
    return web.json_response({"ok": True, "note": reason})


async def agent_usage_handler(request: web.Request) -> web.Response:
    """What the API key has been spent on, per request. Owner-only.

    ⚠️ OWNER-ONLY BECAUSE IT IS BOTH A BILL AND A LOG OF OTHER PEOPLE'S
    ACTIVITY. Every chat turn appears here attributed to whoever sent it, which
    is the whole point — and is also exactly why a guest's session must not be
    able to read it. Same reasoning as `/agent-audit`.

    ⚠️ `?since=` IS A UNIX SECOND AND DEFAULTS TO EVERYTHING. The owner's
    question is "since I topped up", which is a moment only they know, so the
    window is theirs to choose rather than a period this endpoint imposes.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only the owner profile may read API usage.")
    from vesta.adapters import usage as reports_usage
    try:
        since = float(request.query.get("since") or 0)
    except (TypeError, ValueError):
        since = 0.0
    found = reports_usage.rows(since=since)
    return web.json_response({
        "summary": reports_usage.summary(since=since),
        # ⚠️ NEWEST FIRST AND CAPPED. The rows are the evidence behind the
        # totals; the totals are computed over the WHOLE window regardless, so
        # a truncated row list can never change a figure the owner reads.
        "rows": list(reversed(found))[:500],
        "truncated": len(found) > 500,
    })


async def agent_memory_get_handler(request: web.Request) -> web.Response:
    """What the villa believes about this property. TASK-110, REQ-056.

    ⚠️ THE SAME PAIR THAT MAY JUDGE A CONCERN OR A DRAFT. A memory is a claim
    the agent asserts into the context of every future run, so contradicting one
    is closer to approving a playbook than to dismissing an alert.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) not in TASK_ACK_ROLES:
        return deps.forbidden("Only an owner or facility manager may read or "
                          "correct the villa's memories.")
    from vesta.supervise.agent import memory as agent_memory
    return web.json_response({"memories": [
        {"subject_key": m.subject_key, "claim": m.claim, "source": m.source,
         "learned_at": m.learned_at, "review_after": m.review_after,
         "confidence": m.confidence, "state": m.state,
         "corrections": list(m.corrections)}
        for m in agent_memory.all_memories()]})


async def agent_memory_correct_handler(request: web.Request) -> web.Response:
    """A person overriding a claim. TASK-110.

    ⚠️ `memory.correct` WAS THE ONE PATH THAT SETS `corrected` AND NOTHING
    REACHED IT. `memory.write()` has always refused to overwrite a corrected
    memory and that is tested — so the guard protected a state nothing could
    enter, and REQ-056 ("a human correction outranks and is never overwritten")
    described a thing that could not happen. Found by `test_reachability`
    (TASK-109), after a row-by-row read of the requirement had ticked it.

    ⚠️ THE CORRECTION APPENDS AND THE ORIGINAL CLAIM SURVIVES. That is
    `memory.correct`'s rule, not this handler's, and it is why the villa's wrong
    conclusion stays traceable rather than merely gone.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) not in TASK_ACK_ROLES:
        return deps.forbidden("Only an owner or facility manager may correct a "
                          "memory.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        body = {}
    if not isinstance(body, dict):
        body = {}

    subject = str(body.get("subjectKey") or body.get("subject_key") or "")
    # ⚠️ BOUNDED. A correction is a sentence a person types, and it is asserted
    # into every future run's context — the same cap the concern feedback route
    # applies to its reason, for the same reason.
    text = str(body.get("text") or "")[:500].strip()
    if not subject or not text:
        return web.json_response(
            {"ok": False, "reason": "a subject and a correction are required"},
            status=400)

    from vesta.supervise.agent import memory as agent_memory
    # ⚠️ THE CORRECTOR IS THE SESSION'S ROLE, NEVER A FIELD IN THE BODY. "Who
    # told us this" is the half that makes a correction outrank the agent, and a
    # browser-supplied name is a claim about identity rather than a fact about
    # it.
    ok = agent_memory.correct(subject, by=str(deps.role_for(request) or "owner"),
                              text=text)
    if not ok:
        return web.json_response(
            {"ok": False, "reason": "no memory with that subject"}, status=404)
    return web.json_response({"ok": True})


async def agent_review_get_handler(request: web.Request) -> web.Response:
    """Playbook drafts awaiting a person. TASK-094.

    ⚠️ THE SAME PAIR THAT MAY JUDGE A CONCERN, AND FOR A STRONGER REASON.
    Approving a draft adds a procedure the agent consults on every future
    investigation of its class — the one output whose errors compound rather
    than being read once and closed. A guest may file a fault report; a guest
    may not teach the villa a method.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) not in TASK_ACK_ROLES:
        return deps.forbidden("Only an owner or facility manager may review "
                          "proposed playbooks.")
    from vesta.supervise.agent import review as agent_review
    return web.json_response({"drafts": [
        {"slug": d.slug, "title": d.title, "domain": d.domain,
         "description": d.description, "source": d.source,
         "proposedAt": d.proposed_at, "body": d.body}
        for d in agent_review.pending()]})


async def agent_review_decide_handler(request: web.Request) -> web.Response:
    """Approve or discard one draft.

    ⚠️ THE DECISION IS AN EXPLICIT ENUM, NEVER A DEFAULT. A malformed request
    must not be able to approve anything — that is the direction with the
    permanent consequence, and "approve" is exactly the value a truthy check
    would fall into.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    role = deps.role_for(request)
    if role not in TASK_ACK_ROLES:
        return deps.forbidden("Only an owner or facility manager may review "
                          "proposed playbooks.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "expected an object"}, status=400)

    slug = str(body.get("slug") or "").strip()
    decision = str(body.get("decision") or "").strip()
    if not slug:
        return web.json_response({"error": "no slug"}, status=400)
    if decision not in ("approve", "discard"):
        return web.json_response(
            {"error": "decision must be approve or discard"}, status=400)

    from vesta.supervise.agent import review as agent_review
    # ⚠️ THE ROLE IS THE ACTOR, NOT A NAME FROM THE BODY. A client-supplied
    # "approved_by" is a client-supplied audit trail, which is no audit trail.
    if decision == "approve":
        ok = agent_review.approve(
            slug, by=role, edited_body=str(body.get("body") or "")[:20000])
    else:
        ok = agent_review.discard(
            slug, by=role, reason=str(body.get("reason") or "")[:300])
    if not ok:
        return web.json_response({"error": "no such draft"}, status=400)
    return web.json_response({"ok": True,
                              "drafts": len(agent_review.pending())})


async def agent_proposals_handler(request: web.Request) -> web.Response:
    """High-harm actions waiting on a person. TASK-083.

    ⚠️ OWNER-ONLY, ON BOTH VERBS. These are the actions that can let somebody
    in or silence an alarm — the ones `policy` refuses to execute at any
    confidence, from any trigger. `manageFacility` is the pair that may judge a
    CONCERN; this is not a judgement, it is the act itself.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only the owner profile may confirm an action.")
    from vesta.supervise.agent import proposals as agent_proposals
    return web.json_response(
        {"proposals": agent_proposals.pending(),
         "ttlSeconds": agent_proposals.TTL_SECONDS},
        headers={"Cache-Control": "no-store"})


async def agent_confirm_handler(request: web.Request) -> web.Response:
    """A PERSON confirming or declining one proposed action.

    ⚠️ THIS ROUTE IS THE CONFIRM FLOW, AND ITS BEING A ROUTE IS THE DESIGN.
    There is no confirm TOOL — not a restricted one, not an owner-only one —
    because a flow the model can complete converts a refusal into a two-step
    execution while still looking like a safeguard. Consent arrives with a
    session cookie and a role, on a surface the model cannot reach.

    ⚠️ THE SERVICE CALL USES THE STORED PROPOSAL, NEVER THE REQUEST BODY. The
    body names WHICH proposal and says yes or no; entity, service and params
    come from what was proposed. Otherwise this endpoint would be a way to call
    an arbitrary service by quoting a proposal id — the very flow it exists to
    prevent, rebuilt through its own front door.

    ⚠️ AND THE DECISION IS AN EXPLICIT ENUM. A malformed request must not be
    able to confirm anything: `confirm` is the direction with the irreversible
    consequence, and it is exactly the value a truthy check falls into.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    role = deps.role_for(request)
    if role != "owner":
        return deps.forbidden("Only the owner profile may confirm an action.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "expected an object"}, status=400)

    key = str(body.get("actionKey") or "").strip()
    decision = str(body.get("decision") or "").strip()
    if not key:
        return web.json_response({"error": "no actionKey"}, status=400)
    if decision not in ("confirm", "decline"):
        return web.json_response(
            {"error": "decision must be confirm or decline"}, status=400)

    from vesta.supervise.agent import audit as agent_audit
    from vesta.supervise.agent import proposals as agent_proposals

    # ⚠️ THE ACTOR IS THE SESSION'S ROLE, never a name from the body. A
    # client-supplied author is not an audit trail.
    result = agent_proposals.decide(key, confirm=decision == "confirm", by=role)
    if not result.get("ok"):
        return web.json_response({"error": result.get("reason") or "refused",
                                  "state": result.get("state", "")}, status=400)
    if decision != "confirm":
        return web.json_response({"ok": True, "state": "declined"})

    proposal = result.get("proposal") or {}
    entity_id = str(proposal.get("entity_id") or "")
    service = str(proposal.get("service") or "")
    domain, _, verb = service.partition(".")
    if not verb:
        # A bare verb was proposed (`turn_off`), so the domain is the entity's.
        domain, verb = entity_id.split(".", 1)[0], service
    payload: Dict[str, Any] = dict(proposal.get("params") or {})
    payload["entity_id"] = entity_id

    # ⚠️ THE ADAPTER'S LIVE ADDRESS, not the proxy's module constant — this
    # handler moved out of the proxy (TASK-115 step 6) and an export points
    # `hass.configure()` somewhere else entirely.
    url = f"{hass_mod.REST_ROOT}/services/{domain}/{verb}"
    try:
        async with request.app["session"].post(
                url, headers=hass_mod.AUTH_HEADERS, json=payload) as response:
            ok = response.status in (200, 201)
            detail = "" if ok else (await response.text())[:200]
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        ok, detail = False, str(err)[:200]

    # ⚠️ THE OUTCOME IS RECORDED AGAINST THE SAME `action_key` THE PROPOSAL WAS
    # MINTED WITH, so the audit reads as one story: intended, proposed,
    # confirmed by a person, done or failed.
    try:
        agent_audit.record_outcome(
            str(proposal.get("run_id") or ""), action_key=key,
            outcome="done" if ok else "failed",
            detail=(f"confirmed by {role}" if ok else detail))
    except Exception as err:  # noqa: BLE001
        print(f"[supervise-api] confirm audit failed: {err}", flush=True)

    if not ok:
        return web.json_response(
            {"error": f"the service call failed: {detail}"}, status=502)
    return web.json_response({"ok": True, "state": "confirmed"})


async def agent_chats_handler(request: web.Request) -> web.Response:
    """The bot's private chats, named. Owner-only, because it enumerates who
    can talk to this villa.

    ⚠️ IT EXISTS SO NOBODY HAS TO COPY A NUMBER. The sender list keys on a
    Telegram user id, which an owner had to find in a raw event payload — asked
    for directly, and fair. In a PRIVATE chat the chat id and the user id are
    the same number, so the bot's own chat list is exactly the right menu; in a
    group they differ, and `chat.known_chats` excludes groups for that reason
    rather than offering an entry that could never match a sender.

    ⚠️ NEVER RAISES. A villa whose core is restarting gets an empty list and a
    panel that falls back to typing the number, which is the behaviour that
    existed before this route.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only the owner profile may list the bot's chats.")
    from vesta.supervise.agent import chat as agent_chat
    found = await agent_chat.known_chats(request.app["session"])
    return web.json_response({"chats": [
        {"id": c.chat_id, "name": c.name} for c in found]})


async def agent_runs_handler(request: web.Request) -> web.Response:
    """What the agent has been doing: one row per run, most recent last.

    ⚠️ READABLE BY ANY AUTHORISED SESSION, WHERE `/agent-audit` IS OWNER-ONLY,
    and the difference is what each carries. A run row says a run started and
    how it ended — the reader of a tablet is entitled to know the supervisor is
    alive. The audit carries argument digests, tool names and refusal reasons,
    which is a description of what the villa is being asked about.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    from vesta.supervise.agent import audit as agent_audit
    rows = [r for r in agent_audit.rows(500)
            if str(r.get("tool") or "").startswith("run:")]
    return web.json_response({"runs": rows[-100:],
                              "summary": agent_audit.summary()})


async def agent_audit_handler(request: web.Request) -> web.Response:
    """The append-only ledger, in full. Owner-only.

    ⚠️ AND `unfinished` IS THE FIELD WORTH READING. A pair with no outcome is an
    action that started and never reported back — a crash mid-action or one
    still running — and it is the single most useful number the ledger produces.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only the owner profile may read the agent audit.")
    from vesta.supervise.agent import audit as agent_audit
    return web.json_response({
        "rows": agent_audit.rows(500),
        "unfinished": agent_audit.unfinished(),
        "summary": agent_audit.summary(),
    })


async def _agent_drill(request: web.Request,
                       body: Dict[str, Any]) -> web.Response:
    """Raise ONE synthetic concern and carry it, with no model in the path.

    ⚠️ THIS EXISTS BECAUSE THE DELIVERY HALF COULD NOT BE TESTED ON PURPOSE.
    Tiers 1–3 end in two model judgements — triage decides whether to escalate,
    the investigation decides whether to raise — and both are instructed to
    conclude NOTHING rather than speak weakly. So "does a concern actually
    reach my phone and my to-do list?" was answerable only by waiting for the
    villa to genuinely go wrong. A fire alarm you cannot test is not a fire
    alarm. This is the test button: deterministic, because no model is asked.

    ⚠️ IT IS THE REAL PATH, NOT A REHEARSAL OF ONE. The concern goes through
    `tools.concern.writer` — the same sink the model's tool uses, so it
    inherits suppression and the `informational` stamp for the villa's mode —
    and then through `scheduler.dispatch`, which is the same routing, delivery,
    to-do and escalation sweep a scheduled pass runs. Nothing here duplicates a
    rule; if it passes, the real thing works.

    ⚠️ WHAT IT DOES NOT PROVE, SAID OUT LOUD SO NO REPORT CAN IMPLY IT: the
    document, triage and the investigation are NOT exercised. This starts at
    the concern. A drill that claimed to prove the whole pipeline would be a
    green light nobody had earned.

    ⚠️ THE MESSAGE ANNOUNCES ITSELF AS A DRILL, in the title, so a person
    reading it on a phone at 3am is never frightened by our test. And it is
    `topic:`-keyed, so it can never collide with a real device's subject.
    """
    from vesta.supervise.agent import concerns as agent_concerns
    from vesta.supervise.agent import contracts as agent_contracts
    from vesta.supervise.agent import policy as agent_policy
    from vesta.supervise.agent import scheduler as agent_scheduler
    from vesta.supervise.agent.tools import concern as concern_tool

    stored = deps.read_json_store(deps.agent_config_file, {})
    # ⚠️ THE OWNER CHOOSES THE SEVERITY, because it selects which downstream
    # rules run: only a `critical` pushes and only a `critical` is ever chased
    # by the escalation ladder. Defaulting to `warning` keeps the common drill
    # quiet-hours-respecting and un-chased; passing `critical` is how the
    # ladder itself gets tested.
    severity = str(body.get("severity") or "warning").lower()
    if severity not in agent_contracts.SEVERITY:
        return web.json_response(
            {"error": f"severity must be one of "
                      f"{sorted(agent_contracts.SEVERITY)}"}, status=400)

    subject = "vesta pipeline drill"
    subject_key = agent_contracts.subject_key(f"topic:{subject}")
    # ⚠️ A DRILL REPLACES THE LAST DRILL, AND WITHOUT THIS THE FEATURE EATS
    # ITSELF (2026-08-27, owner's finding). `raise_concern` refuses a second
    # concern on an open subject, so every re-run needed the previous one
    # settled first — and of the three buttons on the card only "not useful"
    # settles anything, which is also the DISMISSAL that `suppressed_subjects`
    # counts. Three dismissals suppress a subject permanently, and every drill
    # shares one key: on the third tidy-up the drill would have refused for
    # ever, silently, through the mechanism meant to silence noisy rules.
    #
    # Superseding is the escape `raise_concern` itself names ("either supersede
    # one, or say why this is a different condition"), it is the honest
    # description of what a re-run IS, and it needs no dismissal at all — so
    # the counter never advances and the drill stays repeatable indefinitely.
    supersedes = [str(r.get("id") or "")
                  for r in agent_concerns.open_for(subject_key)]
    concern = agent_concerns.Concern(
        subject_key=subject_key, supersedes=[s for s in supersedes if s],
        title="Pipeline drill — this is a test, nothing is wrong",
        body=("This message was produced by the villa's own end-to-end test. "
              "No equipment is affected and nothing needs doing. It exists to "
              "prove that an alert reaches you, and it can be dismissed."),
        severity=severity, audience="owner", confidence=1.0,
        # ⚠️ EVIDENCE IS REQUIRED BY `contracts.concern_errors` — "every claim
        # must cite a tool result" — and a drill's honest citation is itself.
        evidence=[{"tool": "drill", "args_digest": "-",
                   "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "summary": "synthetic concern raised by the pipeline test"}])

    with reports_log.pass_scope("drill"):
        reports_log.log("── drill begins ──")
        snapshot = agent_policy.for_run(stored, tool_names=[])
        raised, why = concern_tool.writer(snapshot, stored)(concern)
        carried = ""
        if raised:
            carried = await agent_scheduler.dispatch(
                request.app["session"], config=stored)
        reports_log.log("── drill ends ──")

    rows = [r for r in agent_concerns.read()
            if str(r.get("subject_key")) == concern.subject_key]
    latest = rows[-1] if rows else {}
    return web.json_response({
        "ok": bool(raised), "status": "drill",
        # ⚠️ THE REFUSAL REASON IS RETURNED VERBATIM. The likeliest one is that
        # a previous drill is still open — `raise_concern` refuses a second
        # concern on an open subject — which is the dedupe rule working, not a
        # failure, and the caller must be able to tell the two apart.
        "reason": why,
        "concern_id": str(latest.get("id") or ""),
        "severity": severity,
        "informational": bool(latest.get("informational")),
        "delivered_at": str(latest.get("delivered_at") or ""),
        "dispatch": carried.strip(" |") or "nothing was carried",
    })


async def agent_run_now_handler(request: web.Request) -> web.Response:
    """Start one run immediately. Owner-only, because it spends the budget.

    ⚠️ `{"preview": true}` ASSEMBLES THE VILLA DOCUMENT AND CALLS NO PROVIDER,
    which is the mode that matters before anything is switched on: it is how an
    operator reads what would be SENT to a model before agreeing to send it.
    The reports tab's own preview exists for the same reason and the wording
    here is deliberately the same, so the two panels teach one habit.

    ⚠️ IT DECLINES RATHER THAN FAILING WHEN NOTHING IS CONFIGURED. No key, no
    model, the master switch off and a spent budget are all correct outcomes
    with a reason a person can act on, and collapsing them into a 500 would make
    an unconfigured install look broken.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only the owner profile may start an agent run.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        body = {}
    if not isinstance(body, dict):
        body = {}

    document = await _agent_document_text()
    if body.get("preview"):
        # ⚠️ THE DOCUMENT ALREADY ASSEMBLED ON THE LINE ABOVE — this response
        # re-assembled it (journal read included) for no difference in content.
        return web.json_response({"ok": True, "preview": True,
                                  "document": document})

    # ⚠️ A TRIAGE PASS, NOT A CONVERSATION, WHEN ASKED FOR ONE. The two are
    # different products of the same machinery and only one of them RAISES A
    # CONCERN: a conversational run asks a question and returns prose, while
    # `scheduler.run_once` is the pass that escalates. The prose variant that
    # used to live here as `_agent_run` was deleted in 2.717.0 — it had been
    # unreachable since this line was written and was the last session-less
    # `build_registry()` in the tree. The button labelled "Check the villa
    # now" exists to put evidence into the record — so pointing it at the
    # conversation meant it could never do that, and the owner pressed it
    # twice and correctly reported that nothing changed.
    #
    # ⚠️ IT KEEPS EVERY GUARD. `run_once` re-checks enabled, the scheduled
    # trigger and the budget, and returns WHY it stopped
    # rather than a boolean — five causes that look identical from outside and
    # four of which are fine. That reason is handed straight back.
    if body.get("drill"):
        return await _agent_drill(request, body)

    if body.get("triage"):
        from vesta.supervise.agent import scheduler as agent_scheduler
        from vesta.supervise.agent.llm import anthropic_sdk
        # ⚠️ THE PROVIDER IS BUILT AND PASSED IN, because `run_once` does not
        # build one: it takes whatever the caller has and declines with "no
        # model provider configured" when that is None. The forever-task passes
        # its own, so the omission was invisible there and fatal here — four
        # presses of the button, four 76-byte refusals, and an owner correctly
        # reporting that nothing changed. The reason was in the response body
        # the whole time and the panel showed it; I did not ask for it and read
        # the add-on log instead, which is where the byte count gave it away.
        stored = deps.read_json_store(deps.agent_config_file, {})
        provider = anthropic_sdk.build(
            api_key=reports_secrets.get("anthropic") or "")
        # ⚠️ THE SAME SCOPE THE CLOCK USES, so a button press and a scheduled
        # pass are told apart in the log by the word AND by the id every tier
        # stamps its line with. Two passes can overlap — the button exists to be
        # pressed at a moment nobody chose relative to a six-hourly clock.
        with reports_log.pass_scope("manual"):
            agent_scheduler.describe_document(document)
            reason = await agent_scheduler.run_once(
                request.app["session"], config=stored, provider=provider,
                document=document,
                # ⚠️ NAMED, so the trace separates a button press from the clock.
                # "I pressed it and nothing changed" is unanswerable otherwise.
                trigger="manual")
            # ⚠️ THE HALF THIS BUTTON NEVER DID (2.768.0). `run_once` escalates,
            # investigates and mints a Concern; carrying that Concern to a phone
            # and onto the facility manager's list is `scheduler.dispatch`, which
            # was the tail of the SCHEDULED pass and had no other caller. So a
            # check an owner ran himself recorded a concern, showed it on the
            # tablet, and told nobody until the clock came round up to six hours
            # later — both halves correct, nothing joining them.
            reason += await agent_scheduler.dispatch(
                request.app["session"], config=stored)
        return web.json_response({"ok": not reason, "status": "triaged",
                                  "reason": reason})


async def agent_queue_get_handler(request: web.Request) -> web.Response:
    """Escalations waiting for a person. Owner-only, like every agent control.

    ⚠️ DERIVED FROM THE AUDIT, NOT FROM A QUEUE STORE. `agent.audit` already
    holds every fact this needs and is append-only; a second store would be the
    one that disagrees the first time either is written. See
    `audit.pending_escalations`.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only the owner profile may read the approval queue.")
    from vesta.supervise.agent import audit as agent_audit
    from vesta.supervise.agent import reason as agent_reason
    config = deps.read_json_store(deps.agent_config_file, {})
    return web.json_response({
        "pending": agent_audit.pending_escalations(),
        # ⚠️ THE MODE TRAVELS WITH THE QUEUE so the panel can say WHY the list is
        # empty. "Nothing is waiting" and "nothing waits, because this villa
        # investigates automatically" are different sentences and the second is
        # the one that stops an owner wondering whether it is broken.
        "mode": "auto" if agent_reason.auto(config) else "approve",
    })


async def agent_queue_post_handler(request: web.Request) -> web.Response:
    """Approve or dismiss one queued escalation. Owner-only — approving spends.

    ⚠️ THE BROWSER SENDS A RUN ID AND NOTHING ELSE. The subject is read back
    from the audit row that id names, so there is no field in which to ask for
    an investigation of something nobody escalated.
    """
    if not deps.authorized(request):
        return deps.unauthorized()
    if deps.role_for(request) != "owner":
        return deps.forbidden("Only the owner profile may approve an investigation.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        body = {}
    if not isinstance(body, dict):
        body = {}

    run_id = str(body.get("runId") or body.get("run_id") or "")
    action = str(body.get("action") or "approve").lower()
    if not run_id:
        return web.json_response({"ok": False, "reason": "no escalation named"},
                                 status=400)

    from vesta.supervise.agent import reason as agent_reason
    if action == "dismiss":
        ok, why = agent_reason.dismiss(run_id, reason=str(body.get("reason") or ""))
        return web.json_response({"ok": ok, "reason": why})

    from vesta.supervise.agent.llm import anthropic_sdk
    # ⚠️ THE PROVIDER IS BUILT AND PASSED IN — `run-now` above records the four
    # button presses and four refusals that came of assuming a callee builds
    # one. The document is assembled the same way every other agent entry point
    # assembles it, through `sources.build_document`.
    ran, why = await agent_reason.approve(
        run_id,
        provider=anthropic_sdk.build(api_key=reports_secrets.get("anthropic") or ""),
        config=deps.read_json_store(deps.agent_config_file, {}),
        # ⚠️ THE APP'S SESSION, so an APPROVED investigation reaches Home
        # Assistant's own tools exactly as the automatic arm does. Approval and
        # the scheduler share one body (`reason.investigate_subject`) precisely
        # so they cannot differ; handing one of them a session and not the other
        # would put the difference back one frame up.
        session=request.app["session"],
        document=await _agent_document_text())
    return web.json_response({"ok": ran, "reason": why})


async def _agent_document_text() -> str:
    """The Villa Document, or a sentence saying why there isn't one.

    ⚠️ THE SAME BUILDER THE SCHEDULER USES, and it must stay that way: this
    function and `scheduler._pass` each assembled the document themselves, with
    the same two argument-less calls to `snapshot.profile()`/`snapshot.delta()`,
    so the manual "run now" button and the clock both served a 480-character
    document about a property with no devices. Two assemblies is how they were
    wrong the same way; one builder is why a fix reaches both.
    """
    try:
        from vesta.supervise.agent import sources
        return sources.build_document()
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        print(f"[supervise-api] villa document failed: {err}", flush=True)
        return f"The villa document could not be assembled: {err}"


# ── /agent-mcp · the extraction seam ────────────────────────────────────────
# ⚠️ THE ONE ROUTE IN THIS FILE WITH NO SESSION CHECK AND NO RBAC, AND THAT IS
# NOT A GAP. Its caller is not a browser and holds no `vk_session`: it is
# another PROCESS — a relocated agent, a desktop client — authenticating with a
# bearer token from the 0600 secrets file. The rule that matters is downstream
# and unchanged: `agent/mcp_server.py` runs every call through the SAME
# `registry.invoke` the in-process agent uses, so the authority a caller gains
# by arriving over the wire is exactly none (ARCH-011).
async def agent_mcp_handler(request: web.Request) -> web.StreamResponse:
    from vesta.supervise.agent.mcp_server import http_handler
    return await http_handler(request)
