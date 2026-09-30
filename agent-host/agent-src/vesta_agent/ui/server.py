"""The VESTA Agent's UI: policy.yaml and the skills, edited from Home Assistant's sidebar.

It runs as its own process beside the agent (the manifest's `ui`), so a file
that stops the agent can still be fixed here. It never holds a secret: the host
gives it the folders, the port and nothing else.

⚠️ EVERY SAVE IS CHECKED BY THE AGENT'S OWN RULES before it is written:
policy.problems() for policy.yaml, the skill parser (skills._parse) for a skill,
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

import hashlib
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone

import yaml
from aiohttp import web

from .. import __version__, status
from ..config import Settings
from ..policy import problems as policy_problems
from ..skills import FILE_NAME, SKILL_NAME, SkillError, Skills, _parse
from ..state import State
from .policy_doc import apply_form, to_form

log = logging.getLogger("vesta.ui")

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
INGRESS_GATEWAY = "172.30.32.2"
TRASH = ".trash"
MAX_FILE = 512 * 1024

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


def rev(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _read(path: str) -> bytes:
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return b""


def _write(path: str, data: bytes) -> None:
    """Whole or not at all: a half-written policy.yaml would be read by the running agent."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".ui-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        if os.path.exists(path):
            shutil.copymode(path, tmp)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


class Refused(Exception):
    def __init__(self, problems: list[str], status: int = 400):
        super().__init__("; ".join(problems))
        self.problems, self.status = problems, status


class UI:
    def __init__(self, settings: Settings, deployment: str = "ha_app"):
        self.s = settings
        self.allowed = {INGRESS_GATEWAY} if deployment == "ha_app" else {"127.0.0.1", "::1"}
        self.skills = Skills(settings.skills_dir)

    # ------------------------------------------------------------------ plumbing
    def app(self) -> web.Application:
        a = web.Application(middlewares=[self.guard], client_max_size=MAX_FILE + 64 * 1024)
        r = a.router
        r.add_get("/", self.index)
        r.add_static("/static/", STATIC, follow_symlinks=False)
        r.add_get("/api/overview", self.overview)
        r.add_get("/api/policy", self.policy_get)
        r.add_put("/api/policy/form", self.policy_form)
        r.add_put("/api/policy/text", self.policy_text)
        r.add_get("/api/skills", self.skills_list)
        r.add_post("/api/skills", self.skill_create)
        r.add_delete("/api/skills/{name}", self.skill_delete)
        r.add_get("/api/skills/{name}/files", self.skill_files)
        r.add_get("/api/skills/{name}/file", self.file_get)
        r.add_put("/api/skills/{name}/file", self.file_put)
        r.add_delete("/api/skills/{name}/file", self.file_delete)
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
        return web.FileResponse(os.path.join(STATIC, "index.html"))

    # ------------------------------------------------------------------ overview
    async def overview(self, _request):
        text = _read(self.s.policy_path).decode("utf-8", "replace")
        try:
            pol = policy_problems(yaml.safe_load(text) if text else {})
        except yaml.YAMLError as e:
            pol = [f"The file cannot be read as YAML: {e}"]
        report = None
        if os.path.exists(self.s.state_path):
            try:
                report = status.report(State(self.s.state_path), self.s.store_path, 24)
            except Exception as e:  # noqa: BLE001 — the overview shows what it can
                log.warning("UI: the agent's records could not be read (%s)", type(e).__name__)
        return web.json_response({"version": __version__, "instance": self.s.instance,
                                  "policy_problems": pol, "skills": self._skill_rows(), "last_24h": report})

    # ------------------------------------------------------------------ policy.yaml
    def _policy(self) -> tuple[str, str]:
        data = _read(self.s.policy_path)
        return data.decode("utf-8"), rev(data)

    async def policy_get(self, _request):
        text, r = self._policy()
        try:
            form, probs = to_form(text), policy_problems(yaml.safe_load(text) if text else {})
        except yaml.YAMLError as e:
            form, probs = None, [f"The file cannot be read as YAML: {e}"]
        return web.json_response({"text": text, "rev": r, "form": form, "problems": probs})

    def _save_policy(self, new_text: str, base_rev: str) -> dict:
        text, r = self._policy()
        if base_rev != r:
            raise Refused(["policy.yaml changed since you opened it (another window, Studio Code Server). "
                           "Reload to see the current file; your change was not saved."], 409)
        try:
            raw = yaml.safe_load(new_text) if new_text.strip() else {}
        except yaml.YAMLError as e:
            raise Refused([f"Not valid YAML: {e}"]) from None
        probs = policy_problems(raw)
        if probs:
            raise Refused(probs)
        data = new_text.encode("utf-8")
        _write(self.s.policy_path, data)
        log.info("UI: policy.yaml saved")
        return {"rev": rev(data), "text": new_text, "form": to_form(new_text)}

    async def policy_form(self, request):
        body = await request.json()
        text, _ = self._policy()
        form = body.get("form")
        if not isinstance(form, dict):
            raise Refused(["No form sent."])
        return web.json_response(self._save_policy(apply_form(text, form), str(body.get("rev") or "")))

    async def policy_text(self, request):
        body = await request.json()
        if not isinstance(body.get("text"), str):
            raise Refused(["No text sent."])
        return web.json_response(self._save_policy(body["text"], str(body.get("rev") or "")))

    # ------------------------------------------------------------------ skills
    def _skill_rows(self) -> list[dict]:
        loaded = self.skills.all()
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
            rows.append({"name": n, "description": sk.description if sk else "", "ok": sk is not None,
                         "problem": None if sk else (self.skills.problems().get(n) or "switched off")})
        return rows

    async def skills_list(self, _request):
        return web.json_response({"skills": self._skill_rows()})

    def _skill_dir(self, name: str, must_exist: bool = True) -> str:
        if not SKILL_NAME.match(name or ""):
            raise Refused(["A skill name is lower-case letters, digits, - and _ (for example pool-care)."])
        path = os.path.join(self.s.skills_dir, name)
        if must_exist and not os.path.isdir(path):
            raise Refused([f"No skill {name}."], 404)
        return path

    def _rel(self, path: str) -> str:
        """A file inside a skill: each part a plain file name, at most 4 levels deep."""
        parts = (path or "").split("/")
        if not path or len(parts) > 4 or not all(FILE_NAME.match(p) for p in parts):
            raise Refused([f"{path!r} is not a file name this editor accepts (letters, digits, . - _; no leading dot)."])
        return os.path.join(*parts)

    def _check_skill(self, name: str, folder: str) -> None:
        """The skill as the agent would read it, from a copy with the change applied."""
        if not os.path.isfile(os.path.join(folder, "SKILL.md")) or not os.path.isfile(os.path.join(folder, "skill.yaml")):
            raise Refused(["A skill needs both SKILL.md and skill.yaml."])
        try:
            _parse(name, folder)
        except (SkillError, yaml.YAMLError, OSError) as e:
            raise Refused([f"The agent would switch this skill off: {e}"]) from None

    def _change(self, name: str, rel: str, content: bytes | None) -> None:
        """Write (or delete, content None) one file of a skill, only if the skill still loads after."""
        folder = self._skill_dir(name)
        with tempfile.TemporaryDirectory() as tmp:
            trial = os.path.join(tmp, name)
            shutil.copytree(folder, trial, ignore=shutil.ignore_patterns("__pycache__"))
            target = os.path.join(trial, rel)
            if content is None:
                os.unlink(target)
            else:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "wb") as f:
                    f.write(content)
            self._check_skill(name, trial)
        real = os.path.join(folder, rel)
        if content is None:
            os.unlink(real)
        else:
            _write(real, content)

    async def skill_create(self, request):
        body = await request.json()
        name = str(body.get("name") or "")
        path = self._skill_dir(name, must_exist=False)
        if os.path.exists(path):
            raise Refused([f"A skill {name} already exists."], 409)
        os.makedirs(os.path.join(path, "scripts"))
        _write(os.path.join(path, "SKILL.md"), NEW_SKILL_MD.format(name=name).encode())
        _write(os.path.join(path, "skill.yaml"), NEW_SKILL_YAML.encode())
        log.info("UI: skill %s created", name)
        return web.json_response({"name": name})

    async def skill_delete(self, request):
        name = request.match_info["name"]
        path = self._skill_dir(name)
        # Moved aside, not erased: a dot folder is never loaded, and a mistake can be undone by hand.
        dest = os.path.join(self.s.skills_dir, TRASH, f"{name}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.move(path, dest)
        log.info("UI: skill %s deleted (kept in skills/%s)", name, TRASH)
        return web.json_response({"deleted": name, "kept_in": f"{TRASH}/{os.path.basename(dest)}"})

    async def skill_files(self, request):
        folder = self._skill_dir(request.match_info["name"])
        out = []
        for root, dirs, files in os.walk(folder):
            dirs[:] = sorted(d for d in dirs if FILE_NAME.match(d) and d != "__pycache__")
            for f in sorted(files):
                if not FILE_NAME.match(f) or f.endswith(".pyc"):
                    continue
                p = os.path.join(root, f)
                out.append({"path": os.path.relpath(p, folder).replace(os.sep, "/"), "size": os.path.getsize(p)})
        return web.json_response({"files": out})

    async def file_get(self, request):
        folder = self._skill_dir(request.match_info["name"])
        rel = self._rel(request.query.get("path", ""))
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
        folder = self._skill_dir(name)
        rel = self._rel(request.query.get("path", ""))
        body = await request.json()
        content = body.get("content")
        if not isinstance(content, str):
            raise Refused(["No content sent."])
        data = content.encode("utf-8")
        if len(data) > MAX_FILE:
            raise Refused(["This file is too large."])
        current = os.path.join(folder, rel)
        if os.path.exists(current) and body.get("rev") != rev(_read(current)):
            raise Refused([f"{rel} changed since you opened it. Reload it; your change was not saved."], 409)
        if not os.path.exists(current) and body.get("rev"):
            raise Refused([f"{rel} was deleted since you opened it."], 409)
        if rel.endswith(".py"):
            try:
                compile(content, rel, "exec")
            except SyntaxError as e:
                raise Refused([f"{rel}, line {e.lineno}: {e.msg}. Not saved."]) from None
        if rel.endswith((".yaml", ".yml")):
            try:
                yaml.safe_load(content)
            except yaml.YAMLError as e:
                raise Refused([f"{rel} is not valid YAML: {e}"]) from None
        self._change(name, rel, data)
        log.info("UI: skill %s, %s saved", name, rel)
        return web.json_response({"rev": rev(data)})

    async def file_delete(self, request):
        name = request.match_info["name"]
        rel = self._rel(request.query.get("path", ""))
        if not os.path.isfile(os.path.join(self._skill_dir(name), rel)):
            raise Refused([f"No file {rel}."], 404)
        self._change(name, rel, None)
        log.info("UI: skill %s, %s deleted", name, rel)
        return web.json_response({"deleted": rel})


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

