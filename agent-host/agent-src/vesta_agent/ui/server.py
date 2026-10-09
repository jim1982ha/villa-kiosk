"""The VESTA Agent's UI: policy.yaml and the skills, edited from Home Assistant's sidebar.

It runs as its own process beside the agent (the manifest's `ui`), so a file
that stops the agent can still be fixed here. It never holds a secret: the host
gives it the folders, the port and nothing else.

⚠️ EVERY SAVE IS CHECKED BY THE AGENT'S OWN RULES before it is written:
policy.problems() for policy.yaml, the skill parser (skills.parse_skill) for a skill,
Python's own compiler for a script. The UI cannot write a file the agent would
refuse or misread. A save names the version it started from (`rev`); if the
file changed since (someone else, Studio Code Server), it is refused, never
overwritten.

⚠️ WHO MAY CONNECT. In the Home Assistant app only Home Assistant's Ingress
gateway (172.30.32.2), which lets only signed-in administrators through (the
app's `panel_admin`). Not even a process inside the container: a skill script
must not be able to edit the rules that bind it. Standalone: loopback only.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

import yaml
from aiohttp import web

from .. import __version__, requests_box, status, tool_access
from ..config import STARTER_DIR, Settings
from ..history import History, file_change
from ..places import ORDER, PLACES, TABS
from ..policy import Policy, problems as policy_problems
from ..skills import FILE_NAME, REQUIRED_FILES, SKILL_NAME, TRASH, VILLA_CHOICES, Skills, parse_skill, switch_command, to_trash
from ..state import State
from . import setup_copy
from .changes import PageFiles, Refused, _read, _write, page_policy, rev, rules_problems, undoable
from .policy_doc import apply_form, to_form

log = logging.getLogger("vesta.ui")

HERE = os.path.dirname(os.path.abspath(__file__))
#: the page's places (one name per place, places.py), as the page reads them: "</" escaped, so no name can close the tag
PLACES_JSON = json.dumps({"places": PLACES, "order": ORDER}).replace("</", "<\\/")
STATIC = os.path.join(HERE, "static")
INGRESS_GATEWAY = "172.30.32.2"
MAX_FILE = 512 * 1024
MAX_SETUP = 6 * 1024 * 1024            # an imported setup (a zip of skills and rules), base64 in its JSON body

NEW_SKILL_MD = """---
name: {name}
description: What this skill is for, in one line.
---

# {name}

What the agent should know and do with this skill, in plain words.
"""
NEW_SKILL_YAML = """description: What this skill is for, in one line.
# scripts:            the scripts in scripts/ the agent may run, and their options
#   check.py:
#     flags: {--what: text}
# schedule:           when the agent does this skill's job on its own
#   - when: "Mon 08:00"
#     prompt: >-
#       What to do at that time.
"""

















class UI:
    def __init__(self, settings: Settings, deployment: str = "ha_app"):
        self.s = settings
        self.allowed = {INGRESS_GATEWAY} if deployment == "ha_app" else {"127.0.0.1", "::1"}
        self.skills = Skills(settings.skills_dir, os.path.join(STARTER_DIR, "skills"),
                             off=lambda: page_policy(settings.policy_path).skills_off)
        self.history = History(settings.history_path)
        self.files = PageFiles(settings, self.history)     # every write, checked and recorded (changes.py)

    # ------------------------------------------------------------------ plumbing
    def app(self) -> web.Application:
        a = web.Application(middlewares=[self.guard], client_max_size=MAX_SETUP * 4 // 3 + 64 * 1024)
        r = a.router
        r.add_get("/", self.index)
        r.add_static("/static/", STATIC, follow_symlinks=False)
        # the same files under a path that names the version: a cache that ignores "?v=" (a proxy's setting)
        # cannot ignore a path — 0.12.2/0.12.3 still got old code with ?v= on the villa
        r.add_static(f"/static/{__version__}/", STATIC, follow_symlinks=False)
        r.add_get("/api/overview", self.overview)
        r.add_post("/api/client-error", self.client_error)
        r.add_get("/api/rules", self.rules_view)
        r.add_get("/api/policy", self.policy_get)
        r.add_put("/api/policy/form", self.policy_form)
        r.add_put("/api/policy/text", self.policy_text)
        r.add_get("/api/jobs", self.jobs)
        r.add_post("/api/jobs/missing", self.jobs_add_missing)
        r.add_get("/api/entities", self.entities)
        r.add_get("/api/costs", self.costs)
        r.add_get("/api/skills", self.skills_list)
        r.add_post("/api/skills", self.skill_create)
        r.add_delete("/api/skills/{name}", self.skill_delete)
        r.add_get("/api/skills/{name}/files", self.skill_files)
        r.add_get("/api/skills/{name}/file", self.file_get)
        r.add_put("/api/skills/{name}/file", self.file_put)
        r.add_delete("/api/skills/{name}/file", self.file_delete)
        # 0.6.42: what the AI can use, a fuller Skills tab, copying a setup, the changes and their Undo
        r.add_get("/api/tools", self.tools)
        r.add_post("/api/tools/refresh", self.tools_refresh)
        r.add_post("/api/tools/on", self.tool_on)
        r.add_get("/api/skills/{name}", self.skill_detail)
        r.add_put("/api/skills/{name}/on", self.skill_on)
        r.add_put("/api/skills/{name}/commands", self.skill_commands)
        r.add_get("/api/skills/{name}/compare", self.skill_compare)
        r.add_post("/api/skills/{name}/keep", self.skill_keep)
        r.add_post("/api/skills/{name}/take-release", self.skill_take_release)
        r.add_post("/api/skills/{name}/try", self.skill_try)
        r.add_get("/api/tries/{rid}", self.try_result)
        r.add_get("/api/history", self.history_list)
        r.add_post("/api/history/{id}/undo", self.history_undo)
        r.add_post("/api/setup/export", self.setup_export)
        r.add_post("/api/setup/import", self.setup_import)
        return a

    @web.middleware
    async def guard(self, request: web.Request, handler):
        if request.remote not in self.allowed:
            log.warning("UI: refused a connection from %s (only Home Assistant's sidebar may connect)", request.remote)
            return web.json_response({"problems": ["Open the VESTA Agent from Home Assistant's sidebar."]}, status=403)
        # A write must come from this page's own script: a JSON body and our header. A form
        # posted by another site (with the admin's Home Assistant session) carries neither.
        if request.method not in ("GET", "HEAD") and (
                request.headers.get("X-Vesta-UI") != "1" or request.content_type != "application/json"):
            return web.json_response({"problems": ["Refused: not sent by the VESTA Agent page."]}, status=403)
        try:
            resp = await handler(request)
        except Refused as e:
            return web.json_response({"problems": e.problems}, status=e.status)
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
            "connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'")
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Cache-Control"] = "no-store"
        return resp

    async def index(self, _request):
        # ⚠️ THE FILES' ADDRESSES CARRY THE VERSION (static/app.js?v=0.6.1): after an update no copy kept
        # anywhere between the app and the screen (Home Assistant's frame, a phone's web view) can serve
        # the previous page's code with the new data — seen on 0.12.0: no banner, no AI jobs card.
        with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
            html = f.read().replace("{static}", f"static/{__version__}").replace("{places}", PLACES_JSON)
        for key, name in TABS.items():                  # the top tabs' names (places.TABS)
            html = html.replace("{tab:%s}" % key, name)
        log.info("UI: page opened (agent %s)", __version__)
        return web.Response(text=html, content_type="text/html")

    async def client_error(self, request):
        body = await request.json()
        log.warning("UI: page error: %s (%s)", str(body.get("message") or "")[:300], str(body.get("agent") or "")[:120])
        return web.json_response({"ok": True})

    # ------------------------------------------------------------------ overview
    async def overview(self, _request):
        pol = rules_problems(_read(self.s.policy_path).decode("utf-8", "replace"))
        report = None
        if os.path.exists(self.s.state_path):
            try:
                from ..scheduler import job_label
                skills = self.skills.all()
                report = status.report(State(self.s.state_path), self.s.store_path, 24,
                                       label=lambda k: job_label(k, skills))
            except Exception as e:  # noqa: BLE001 — the overview shows what it can
                log.warning("UI: the agent's records could not be read (%s)", type(e).__name__)
        return web.json_response({"version": __version__, "app_version": os.environ.get("VESTA_APP_VERSION", ""),
                                  "instance": self.s.instance,
                                  "policy_problems": pol, "skills": self._skill_rows(), "last_24h": report,
                                  "jobs_not_set": [j["name"] for j in self._jobs() if not j["set"]],
                                  "setup": setup_copy.offer()})

    # ------------------------------------------------------------------ AI jobs
    def _jobs(self) -> list[dict]:
        """The AI jobs the skills declare, and whether policy.yaml sets their model and limit (else they do not run)."""
        from ..policy import Policy
        from ..skills import ai_jobs
        set_ = page_policy(self.s.policy_path).jobs
        from ..scheduler import describe
        listed = {t["name"]: t for t in (tool_access.read_list(self.s.data_dir) or {}).get("tools") or []}
        return [{"name": j["name"], "skill": sk.name, "when": j["when"], "to": j.get("to"),
                 "when_words": describe(j["when"])[0], "runs_per_month": describe(j["when"])[1],
                 "on_request": j.get("on_request", False), "description": j.get("description") or "",
                 "default": j.get("default") or {}, "set": j["name"] in set_, "current": set_.get(j["name"]),
                 # Rules › AI brains and limits › "AI tools": its skill's list (None: everything switched on)
                 "tools": None if sk.tools is None else [tool_access.label(t, listed) for t in sk.tools]}
                for sk, j in ai_jobs(self.skills.all())]

    async def jobs(self, _request):
        return web.json_response({"jobs": self._jobs()})

    async def jobs_add_missing(self, _request):
        """The banner's "Add them": every AI job policy.yaml does not set, with its skill's starter values — written
        here, through the same checks as a save (the page read, changed and wrote the whole form itself, review 8)."""
        missing = [j for j in self._jobs() if not j["set"]]
        if not missing:
            return web.json_response({"ok": True, "added": []})
        settings = to_form(self.files.policy_now()[0])["settings"]
        settings["jobs"] = {**settings["jobs"], **{j["name"]: dict(j["default"]) for j in missing}}
        names = [j["name"] for j in missing]
        self.files.edit_policy({"settings": settings}, f"AI jobs added: {', '.join(names)}")
        return web.json_response({"ok": True, "added": names})

    # ------------------------------------------------------------------ what the AI cost
    async def costs(self, request):
        """The Costs tab: every AI run of the last `days` (7, 30 or 90), from the agent's own records."""
        from zoneinfo import ZoneInfo
        from ..policy import Policy
        from ..routing import Routing
        days = request.query.get("days", "7")
        days = int(days) if days in ("7", "30", "90") else 7          # the Costs tab opens on the last 7 days
        if not os.path.exists(self.s.state_path):
            return web.json_response({"days": days, "runs": [], "none": True})
        try:
            zone = ZoneInfo(self.s.timezone)
        except Exception:  # noqa: BLE001 — an unknown zone: UTC days
            zone = None
        route = Routing(page_policy(self.s.policy_path))
        from ..policy import profile_labels
        return web.json_response({**status.costs(State(self.s.state_path), days, zone=zone,
                                                 chat_label=lambda cid: route.label(int(cid))),
                                  "profiles": profile_labels()})

    # ------------------------------------------------------------------ the villa's devices
    async def entities(self, _request):
        return web.json_response(self._entities())

    def _entities(self) -> dict:
        """Every entity of the knowledge pack (id, name, area), for the pickers of the rules: chosen by name, not
        typed as ids. The UI has no Home Assistant token: the pack is what the agent last read (nightly)."""
        from vesta_shared.knowledge_pack import KnowledgePack
        pack = KnowledgePack.read(self.s.pack_path)
        seen: dict[str, dict] = {}
        for r in pack.rows() if pack else []:
            if r["entity_id"] not in seen:
                seen[r["entity_id"]] = {"id": r["entity_id"], "name": r.get("name") or r["entity_id"], "area": r.get("area") or ""}
        return {"entities": sorted(seen.values(), key=lambda e: (e["name"].lower(), e["id"])),
                "built": pack.generated_at if pack else None}

    # ------------------------------------------------------------------ policy.yaml

    async def rules_view(self, _request):
        """The Rules tab in ONE answer (architecture review 9: four requests in a row, joined on the page): the file and
        its form, the AI jobs, the devices for the pickers, the tools. Built from a lenient reading of policy.yaml, so a
        broken file still answers, its problems named."""
        return web.json_response({**self._policy_doc(), "jobs": self._jobs(), **self._entities(), "tools": self._tools()})

    async def policy_get(self, _request):
        return web.json_response(self._policy_doc())

    def _policy_doc(self) -> dict:
        text, r = self.files.policy_now()
        probs = rules_problems(text)
        try:
            form = to_form(text)
        except yaml.YAMLError:
            form = None
        from ..policy import LANGUAGES, form_schema, profile_labels
        return {"text": text, "rev": r, "form": form, "problems": probs, "languages": LANGUAGES,
                "profiles": profile_labels(), "schema": form_schema()}


    async def policy_form(self, request):
        body = await request.json()
        text, _ = self.files.policy_now()
        form = body.get("form")
        if not isinstance(form, dict):
            raise Refused(["No form sent."])
        return web.json_response(self.files.save_policy(apply_form(text, form), str(body.get("rev") or "")))

    async def policy_text(self, request):
        body = await request.json()
        if not isinstance(body.get("text"), str):
            raise Refused(["No text sent."])
        return web.json_response(self.files.save_policy(body["text"], str(body.get("rev") or "")))

    # ------------------------------------------------------------------ skills
    def _skill_rows(self) -> list[dict]:
        loaded = self.skills.all(include_off=True)
        pol = page_policy(self.s.policy_path)
        rows = []
        try:
            names = sorted(os.listdir(self.s.skills_dir))
        except OSError:
            names = []
        for n in names:
            path = os.path.join(self.s.skills_dir, n)
            if not SKILL_NAME.match(n) or not os.path.isdir(path):
                continue
            sk = loaded.get(n)
            h = tool_access.health(pol, self._server_tools(), sk, self.skills.problems().get(n))
            rows.append({"name": n, "description": sk.description if sk else "", "ok": h["ok"],
                         "off": n in pol.skills_off, "state": self.skills.release_state(n)["state"], "problem": h["problem"],
                         "line": h["line"]})
        return rows

    def _server_tools(self) -> list[dict] | None:
        """HA MCP's tools as the agent last read them (the page holds no token), or None."""
        return tool_access.saved_server_tools(self.s.data_dir)

    async def skills_list(self, _request):
        return web.json_response({"skills": self._skill_rows()})





    async def skill_create(self, request):
        body = await request.json()
        name = str(body.get("name") or "")
        path = self.files.skill_dir(name, must_exist=False)
        if os.path.exists(path):
            raise Refused([f"A skill {name} already exists."], 409)
        os.makedirs(os.path.join(path, "scripts"))
        _write(os.path.join(path, "SKILL.md"), NEW_SKILL_MD.format(name=name).encode())
        _write(os.path.join(path, "skill.yaml"), NEW_SKILL_YAML.encode())
        log.info("UI: skill %s created", name)
        self.files.folder_change("Skills", f"{name} created", name, None, "present")
        return web.json_response({"name": name})

    async def skill_delete(self, request):
        name = request.match_info["name"]
        path = self.files.skill_dir(name)
        # Moved aside, not erased: a dot folder is never loaded, and a mistake can be undone (Overview › Page changes).
        dest = to_trash(self.s.skills_dir, path, name)
        log.info("UI: skill %s deleted (kept in skills/%s)", name, TRASH)
        self.files.folder_change("Skills", f"{name} deleted (kept in skills/{TRASH})", name, dest, None)
        return web.json_response({"deleted": name, "kept_in": f"{TRASH}/{os.path.basename(dest)}"})

    async def skill_files(self, request):
        folder = self.files.skill_dir(request.match_info["name"])
        out = []
        for root, dirs, files in os.walk(folder):
            dirs[:] = sorted(d for d in dirs if FILE_NAME.match(d) and d != "__pycache__")
            for f in sorted(files):
                if not FILE_NAME.match(f) or f.endswith(".pyc"):
                    continue
                p = os.path.join(root, f)
                rel = os.path.relpath(p, folder).replace(os.sep, "/")
                out.append({"path": rel, "size": os.path.getsize(p), "deletable": rel not in REQUIRED_FILES})
        return web.json_response({"files": out})

    async def file_get(self, request):
        folder = self.files.skill_dir(request.match_info["name"])
        rel = self.files.rel(request.query.get("path", ""))
        data = _read(os.path.join(folder, rel))
        if len(data) > MAX_FILE:
            raise Refused(["This file is too large for the editor."])
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise Refused(["Not a text file: it cannot be edited here."]) from None
        return web.json_response({"content": text, "rev": rev(data)})

    async def file_put(self, request):
        name = request.match_info["name"]
        self.files.skill_dir(name)                        # the skill must exist; text_change checks the rest
        rel = self.files.rel(request.query.get("path", ""))
        body = await request.json()
        content = body.get("content")
        if not isinstance(content, str):
            raise Refused(["No content sent."])
        data = content.encode("utf-8")
        if len(data) > MAX_FILE:
            raise Refused(["This file is too large."])
        self.files.text_change("Skills", lambda before: f"{name} › {file_change(rel, before, content)}",
                          {"kind": "file", "skill": name, "path": rel.replace(os.sep, "/")}, content,
                          base_rev=str(body.get("rev") or ""))
        log.info("UI: skill %s, %s saved", name, rel)
        return web.json_response({"rev": rev(data)})

    async def file_delete(self, request):
        name = request.match_info["name"]
        rel = self.files.rel(request.query.get("path", ""))
        if not os.path.isfile(os.path.join(self.files.skill_dir(name), rel)):
            raise Refused([f"No file {rel}."], 404)
        if rel in REQUIRED_FILES:
            raise Refused([f"{rel} is part of every skill: edit it, or delete the skill."])
        self.files.text_change("Skills", f"{name} › {rel} deleted", {"kind": "file", "skill": name, "path": rel}, None)
        log.info("UI: skill %s, %s deleted", name, rel)
        return web.json_response({"deleted": rel})

    # ------------------------------------------------------------------ what the AI can use (Rules)
    def _usage(self) -> dict[str, int]:
        if not os.path.exists(self.s.state_path):
            return {}
        try:
            return status.tool_usage(State(self.s.state_path), 7)
        except Exception:  # noqa: BLE001 — the switches show without their counts
            return {}

    async def tools(self, _request):
        return web.json_response(self._tools())

    def _tools(self) -> dict:
        """Rules › AI tools: Home Assistant's tools as the agent last read them, with this file's
        switches; the agent's own tools; the facility manager's groups."""
        return tool_access.catalog(page_policy(self.s.policy_path), tool_access.read_list(self.s.data_dir), self._usage())

    async def tools_refresh(self, _request):
        """"Read the list again": the agent asks HA MCP (the page itself never talks to Home Assistant)."""
        res = await requests_box.ask(self.s.data_dir, "refresh_tools", {}, timeout=45)
        if res is None:
            raise Refused(["The agent did not answer: it is stopped, or waiting for a setting (see its log)."], 503)
        if not res.get("ok"):
            raise Refused([res.get("error") or "Home Assistant's MCP server did not answer."], 502)
        return await self.tools(_request)

    async def tool_on(self, request):
        """A skill's "Switch … on": the tool it needs, switched on where tool_access says its switch is."""
        tool = str((await request.json()).get("tool") or "")
        if not tool:
            raise Refused(["No tool named."])
        self.files.edit_policy(tool_access.switch_on(to_form(self.files.policy_now()[0]), tool), f"{tool_access.label(tool)} switched on", "Skills")
        return web.json_response({"ok": True})


    # ------------------------------------------------------------------ a fuller Skills tab
    WHEN = {"critical_event": "a critical alert from a VESTA rule", "voice_message": "a voice message"}

    async def skill_detail(self, request):
        """Skills → one skill: its state against the release, the tools it needs, when it acts, its commands."""
        from ..scheduler import describe
        name = request.match_info["name"]
        self.files.skill_dir(name)
        pol = page_policy(self.s.policy_path)
        sk = self.skills.all(include_off=True).get(name)
        rel = self.skills.release_state(name)
        h = tool_access.health(pol, self._server_tools(), sk, self.skills.problems().get(name))
        if sk is None:
            return web.json_response({"name": name, "ok": False, "off": name in pol.skills_off, "release": rel,
                                      "problem": h["problem"]})
        listed = tool_access.read_list(self.s.data_dir)
        # ⚠️ ROWS, NOT SENTENCES (architecture review 8): each was "when — job" with "AI job" as a magic value, and the
        # page split it, renamed one sentence by a regex and moved the chats' row to the end. In the order shown:
        # the schedule, then what the skill answers, the chats last. `script`: the script a code step runs.
        def row(when, job=None, script=None, ai=False):
            return {"when": when, "job": job, "script": script.split()[0] if script else None,
                    "kind": "ai" if ai else "code" if script else None}
        acts = [row(describe(j["when"])[0], j.get("name"), j.get("run"), ai=bool(j.get("prompt")) and not j.get("run"))
                for j in sk.schedule]
        if sk.every_5_min:
            acts.append(row("every 5 minutes", script=sk.every_5_min))
        acts += [row(self.WHEN.get(ev, ev), script=cmd) for ev, cmd in sk.on_event.items()]
        if sk.on_reply:
            acts.append(row("an answer to one of its alerts", script=sk.on_reply))
        acts.append({**row("in a chat"), "note": "when a person asks about it"})
        scripts = [spec.view() for _, spec in sorted(sk.scripts.items())]      # skills.Script: one reading
        return web.json_response({
            "name": name, "ok": h["ok"], "off": name in pol.skills_off, "description": sk.description,
            "release": rel, "engine": __version__, "needs": tool_access.needs(pol, listed, sk) if sk.tools is not None else None,
            "acts": acts, "scripts": scripts, "without": h["without"],
            "out_files": self._out_files()})

    def _out_files(self, limit: int = 60) -> list[dict]:
        """The files an Offline Test offers for an option that takes one, newest first (compose.py fm-weekly --facts: the
        file facts.py wrote, 2026-10-06 "needs --facts"): {value, label} — the label says which report made it, and when."""
        from zoneinfo import ZoneInfo
        from vesta_shared.timeutil import day_time_label
        from ..skills import out_files
        zone = ZoneInfo(self.s.timezone)
        rows = []
        for value, at in out_files(self.s.out_dir)[:limit]:
            when = day_time_label(datetime.fromtimestamp(at, zone), weekday=True)
            if value.startswith("runs/"):
                run = value.split("/")[1].rsplit("-", 1)[0]          # ai_jobs.run_folder: <job>-<time>
                rows.append({"value": value, "label": f"{value.rsplit('/', 1)[1]} — {run} report, {when}"})
            else:
                rows.append({"value": value, "label": f"{value} — Offline Test, {when}"})
        return rows

    async def skill_on(self, request):
        name = request.match_info["name"]
        self.files.skill_dir(name)
        on = bool((await request.json()).get("on"))
        doc = to_form(self.files.policy_now()[0])
        off = [x for x in doc["skills_off"] if x != name] + ([] if on else [name])
        res = self.files.edit_policy({"skills_off": sorted(set(off))}, f"{name} switched {'on' if on else 'off'}", "Skills")
        log.info("UI: skill %s switched %s", name, "on" if on else "off")
        return web.json_response(res)

    async def skill_commands(self, request):
        """A command's checkbox: this villa's choice, in the skill's villa.skill.yaml (kept by updates, copied with it)."""
        name = request.match_info["name"]
        folder = self.files.skill_dir(name)
        body = await request.json()
        script, command, on = str(body.get("script") or ""), body.get("command"), bool(body.get("on"))
        sk = self.skills.all(include_off=True).get(name)
        spec = (sk.scripts.get(script) if sk else None)
        if not spec:
            raise Refused([f"{script} is not a script of {name}."])
        if command is not None and command not in (spec.commands or {}):
            raise Refused([f"{command} is not a command of {script}."])
        text = switch_command(folder, spec, command, on)          # skills.py writes the villa's choice, not this page
        rel = VILLA_CHOICES
        path = os.path.join(folder, rel)
        before = _read(path).decode("utf-8") if os.path.exists(path) else None
        if text is None and before is None:
            return web.json_response({"ok": True})
        label = f"{script}{' ' + command if command else ''}"
        self.files.text_change("Skills", f"{name} › {label} switched {'on' if on else 'off'} for the AI",
                          {"kind": "file", "skill": name, "path": rel}, text)
        log.info("UI: skill %s, %s switched %s", name, label, "on" if on else "off")
        return web.json_response({"ok": True})

    async def skill_compare(self, request):
        """An edited starter skill's file beside the release's, line against line."""
        import difflib
        name = request.match_info["name"]
        folder = self.files.skill_dir(name)
        rel = self.files.rel(request.query.get("path", ""))
        src = os.path.join(STARTER_DIR, "skills", name, rel)
        here = _read(os.path.join(folder, rel)).decode("utf-8", "replace").splitlines()
        there = _read(src).decode("utf-8", "replace").splitlines()
        rows = []
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=here, b=there, autojunk=False).get_opcodes():
            for k in range(max(i2 - i1, j2 - j1)):
                rows.append({"here": here[i1 + k] if i1 + k < i2 else None,
                             "release": there[j1 + k] if j1 + k < j2 else None, "same": tag == "equal"})
        return web.json_response({"rows": rows[:4000], "engine": __version__})

    async def skill_keep(self, request):
        name = request.match_info["name"]
        self.files.skill_dir(name)
        self.skills.keep_mine(name)
        log.info("UI: skill %s kept as edited here", name)
        return web.json_response({"ok": True})

    async def skill_take_release(self, request):
        name = request.match_info["name"]
        self.files.skill_dir(name)
        if self.skills.release_state(name)["state"] != "edited":
            raise Refused([f"{name} is not an edited starter skill."])
        dest = self.skills.take_release(name)
        self.files.folder_change("Skills", f"{name}: the release's version taken (the edited one kept in skills/{TRASH})",
                            name, dest, "present")
        log.info("UI: skill %s replaced by the release's version", name)
        return web.json_response({"ok": True})

    async def skill_try(self, request):
        """Skills › Offline Test: run by the agent (it holds the access), checked as when the AI asks; nothing sent."""
        name = request.match_info["name"]
        self.files.skill_dir(name)
        body = await request.json()
        try:
            payload = requests_box.try_request(name, body.get("script"), body.get("args") or [])
        except ValueError as e:
            raise Refused([str(e)]) from None
        # answered at once, the result asked for every second (/api/tries/<id>): a script running for minutes
        # (nightly.py) would outlive a page request — Cloudflare closes one after 100 s ("Error 524", 2026-10-06)
        rid = requests_box.submit(self.s.data_dir, "try", payload)
        return web.json_response({"pending": rid})

    async def try_result(self, request):
        state, data = requests_box.result(self.s.data_dir, request.match_info["rid"])
        if state == "done":
            return web.json_response(data)
        if state == "gone":
            raise Refused(["This try's answer is gone: the agent restarted, or it was read already. Run it again."], 404)
        return web.json_response({"pending": True, "started": state == "running"})

    # ------------------------------------------------------------------ changes made on these pages
    async def history_list(self, _request):
        return web.json_response({"changes": [{**c, "undoable": undoable(c)} for c in self.history.rows(200)]})

    async def history_undo(self, request):
        try:
            cid = int(request.match_info["id"])
        except ValueError:
            raise Refused(["No such change."], 404) from None
        self.files.undo(cid)
        return web.json_response({"ok": True})

    # ------------------------------------------------------------------ copy the setup to another villa
    async def setup_export(self, request):
        body = await request.json()
        parts = {k for k in setup_copy.PARTS if body.get(k)}
        data = setup_copy.export(self.s, self.skills, parts)
        name = f"vesta-agent-setup-{datetime.now(timezone.utc):%Y-%m-%d}.zip"
        log.info("UI: setup exported (%s)", ", ".join(sorted(parts)))
        return web.Response(body=data, content_type="application/zip",
                            headers={"Content-Disposition": f'attachment; filename="{name}"'})

    async def setup_import(self, request):
        import base64
        import binascii
        body = await request.json()
        try:
            data = base64.b64decode(str(body.get("zip") or ""), validate=True)
        except (binascii.Error, ValueError):
            raise Refused(["Not a setup file."]) from None
        if len(data) > MAX_SETUP:
            raise Refused(["This file is too large for a setup."])
        try:
            setup = setup_copy.read(data)
        except setup_copy.NotASetup as e:
            raise Refused([str(e)]) from None
        preview = setup_copy.preview(self.s, self.skills, setup, self._server_tools())
        if not body.get("apply"):
            return web.json_response(preview)
        if body.get("fingerprint") != preview["fingerprint"]:
            raise Refused(["Something changed since the preview: look at it again before applying."], 409)
        setup_copy.apply(self.files, setup, preview)      # changes.PageFiles: the same checks and history
        log.info("UI: setup imported (%s changes)", sum(1 for r in preview["rows"] if r["change"] != "same"))
        return web.json_response({"ok": True})


def main() -> None:
    from .. import config
    logging.basicConfig(level=os.environ.get("VESTA_LOG_LEVEL", "info").upper(),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = config.load()
    port = int(os.environ.get("VESTA_UI_PORT") or 8095)
    deployment = os.environ.get("VESTA_DEPLOYMENT", "ha_app")
    ui = UI(s, deployment)
    log.info("UI: listening on port %s (%s)", port,
             "Home Assistant sidebar only" if deployment == "ha_app" else "this machine only")
    web.run_app(ui.app(), host="0.0.0.0" if deployment == "ha_app" else "127.0.0.1", port=port,
                print=None, access_log=None, handle_signals=True)

