"""Everything the VESTA Agent page writes, checked and recorded in one place (architecture review 9: it lived inside
the page server's HTTP class, and importing a setup called that class's methods).

PageFiles is the one way a text (policy.yaml, instructions.md, a skill's file) or a skill folder changes from the
page: the version the person opened (rev), the check by kind (the rules' problems, a script that compiles, YAML that
reads, a skill that still loads from a trial copy), the atomic write, the history row, and Undo from where a change
left things. The page server's handlers and setup_copy both call it; nothing here knows HTTP — a refusal is Refused,
which the server turns into an answer.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile

import yaml

from ..config import Settings
from ..history import History, policy_change
from ..policy import Policy, problems as policy_problems
from ..skills import FILE_NAME, SKILL_NAME, SkillError, parse_skill, to_trash
from .policy_doc import apply_form, to_form

log = logging.getLogger("vesta.ui")


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


TEXT_KINDS = ("policy", "instructions", "file")    # what Undo writes back as text (UI.text_change)


def undoable(ch: dict) -> bool:
    """Whether Undo is offered for this change: the one answer for the Page changes list and the Undo itself
    (architecture review 8: the page kept its own list and hid Undo for the instructions, which Undo does handle).
    Whether the text is still what the change left is asked at the press (another save may have come since)."""
    return ch["place"] != "Release" and not ch["undone_by"] and ch["target"]["kind"] in (*TEXT_KINDS, "folder")


def rules_problems(text: str) -> list[str]:
    """What is wrong with policy.yaml's text, in words ([] when nothing): one reading for the Overview, Rules and
    every write."""
    try:
        return policy_problems(yaml.safe_load(text) if text and text.strip() else {})
    except yaml.YAMLError as e:
        return [f"The file cannot be read as YAML: {e}. Until it is fixed, the agent keeps the last rules it could read."]
    except Exception as e:  # noqa: BLE001 — named on the page, never an error 500 (architecture review 17)
        return [f"The file holds a value the agent cannot read ({type(e).__name__}): check the values written by hand."]


class Refused(Exception):
    def __init__(self, problems: list[str], status: int = 400):
        super().__init__("; ".join(problems))
        self.problems, self.status = problems, status


def page_policy(path: str) -> Policy:
    """policy.yaml as the page reads it: a file that cannot be read counts as one that sets nothing, its problem shown
    by rules_problems (architecture review 9: an unparseable file made api/jobs, api/overview and api/skills answer 500,
    and Rules (file) — the one place to repair it — hung on "Loading…"). The agent's own reading is its own (policy.py)."""
    try:
        return Policy.load(path)
    except (yaml.YAMLError, OSError, ValueError, TypeError):
        return Policy({})


class PageFiles:
    def __init__(self, settings: Settings, history: History):
        self.s, self.history = settings, history

    def policy_now(self) -> tuple[str, str]:
        data = _read(self.s.policy_path)
        return data.decode("utf-8"), rev(data)

    def save_policy(self, new_text: str, base_rev: str, place: str = "Rules", what: str | None = None) -> dict:
        text, _ = self.policy_now()
        data = new_text.encode("utf-8")
        self.text_change(place, what or policy_change(text, new_text), {"kind": "policy"}, new_text, base_rev=base_rev)
        log.info("UI: policy.yaml saved")
        return {"rev": rev(data), "text": new_text, "form": to_form(new_text)}

    def edit_policy(self, change: dict, what: str, place: str = "Rules") -> dict:
        """One section of policy.yaml changed by a switch on the page: through the same checks as a save."""
        text, r = self.policy_now()
        return self.save_policy(apply_form(text, change), r, place, what)

    def skill_dir(self, name: str, must_exist: bool = True) -> str:
        if not SKILL_NAME.match(name or ""):
            raise Refused(["A skill name is lower-case letters, digits, - and _ (for example pool-care)."])
        path = os.path.join(self.s.skills_dir, name)
        if must_exist and not os.path.isdir(path):
            raise Refused([f"No skill {name}."], 404)
        return path

    def rel(self, path: str) -> str:
        """A file inside a skill: each part a plain file name, at most 4 levels deep."""
        parts = (path or "").split("/")
        if not path or len(parts) > 4 or not all(FILE_NAME.match(p) for p in parts):
            raise Refused([f"{path!r} is not a file name this editor accepts (letters, digits, . - _; no leading dot)."])
        return os.path.join(*parts)

    def check_skill(self, name: str, folder: str) -> None:
        """The skill as the agent would read it, from a copy with the change applied."""
        if not os.path.isfile(os.path.join(folder, "SKILL.md")) or not os.path.isfile(os.path.join(folder, "skill.yaml")):
            raise Refused(["A skill needs both SKILL.md and skill.yaml."])
        try:
            parse_skill(name, folder)
        except (SkillError, yaml.YAMLError, OSError) as e:
            raise Refused([f"The agent would switch this skill off: {e}"]) from None

    def change(self, name: str, rel: str, content: bytes | None) -> None:
        """Write (or delete, content None) one file of a skill, only if the skill still loads after."""
        folder = self.skill_dir(name)
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
            self.check_skill(name, trial)
        real = os.path.join(folder, rel)
        if content is None:
            os.unlink(real)
        else:
            _write(real, content)

    # ------------------------------------------------------------------ every recorded change goes through here
    # ⚠️ WRITTEN AND RECORDED IN ONE PLACE (architecture review, 2026-10-06): the history was recorded by hand at
    # eleven places, and one of them (a setup's instructions) recorded a kind Undo did not know. A text — the
    # rules, the instructions, a skill's file — goes through text_change, a skill folder through folder_change.
    def text_path(self, t: dict) -> str:
        if t["kind"] == "policy":
            return self.s.policy_path
        if t["kind"] == "instructions":
            return self.s.instructions_path
        return os.path.join(self.skill_dir(t["skill"]), self.rel(t["path"]))

    def text_now(self, t: dict) -> str | None:
        path = self.text_path(t)
        return _read(path).decode("utf-8", "replace") if os.path.exists(path) else None

    def text_change(self, place: str, what, target: dict, text: str | None, base_rev: str | None = None) -> str | None:
        """Write one text (None: delete it) and record the change, when there is one. `what` is the line the
        history shows, or a function of the text before. Returns the text before.

        ⚠️ VALID WHOEVER WRITES IT (architecture review 6, 2026-10-07): the rules' problems were checked only by a
        save from Rules, a script's syntax only by a save from the editor — an Undo (Overview › Page changes) or an
        imported setup wrote either unchecked. Every text is checked here, by its kind (_check_text); a skill's
        file is written only if the skill still loads (_change). `base_rev`: the version the person opened —
        refused when the file changed since (another window, Studio Code Server)."""
        before = self.text_now(target)
        if base_rev is not None:
            self.check_rev(target, before, base_rev)
        if text is not None:
            self.check_text(target, text)
        data = text.encode("utf-8") if text is not None else None
        if target["kind"] == "file":
            self.change(target["skill"], self.rel(target["path"]), data)
        elif data is None:
            if os.path.exists(self.text_path(target)):
                os.unlink(self.text_path(target))
        else:
            _write(self.text_path(target), data)
        if before != text:
            self.history.record(place, what(before) if callable(what) else what, target, before, text)
        return before

    def check_rev(self, target: dict, before: str | None, base_rev: str) -> None:
        name = "policy.yaml" if target["kind"] == "policy" else target.get("path") or target["kind"]
        if before is None and base_rev:
            raise Refused([f"{name} was deleted since you opened it."], 409)
        if before is not None and base_rev != rev(before.encode("utf-8")):
            raise Refused([f"{name} changed since you opened it (another window, Studio Code Server). Reload it "
                           "to see the current file; your change was not saved."], 409)

    def check_text(self, target: dict, text: str) -> None:
        """What a text of this kind must be before it is written: the rules without problems, a script that
        compiles, YAML that reads."""
        if target["kind"] == "policy":
            probs = rules_problems(text)
            if probs:
                raise Refused(probs)
            return
        rel = str(target.get("path") or "")
        if rel.endswith(".py"):
            try:
                compile(text, rel, "exec")
            except SyntaxError as e:
                raise Refused([f"{rel}, line {e.lineno}: {e.msg}. Not saved."]) from None
        if rel.endswith((".yaml", ".yml")):
            try:
                yaml.safe_load(text)
            except yaml.YAMLError as e:
                raise Refused([f"{rel} is not valid YAML: {e}"]) from None

    def folder_change(self, place: str, what: str, skill: str, before: str | None, after: str | None) -> None:
        """A skill folder created, deleted, replaced or imported (the move is the caller's): recorded. `before` is
        where the previous folder was kept (skills/.trash), `after` "present" or None."""
        self.history.record(place, what, {"kind": "folder", "skill": skill}, before, after)

    def undo_folder(self, name: str, ch: dict) -> None:
        """A skill created, deleted, replaced by the release's version or imported: its folder put back."""
        path = os.path.join(self.s.skills_dir, name)
        old = ch["before"]
        if ch["after"] is None:                         # deleted: it comes back from the trash
            if os.path.exists(path) or not old or not os.path.isdir(old):
                raise Refused([f"{name} cannot come back: a skill of that name exists, or its copy is gone."], 409)
            shutil.move(old, path)
            self.folder_change("Undo", f"Undo: {ch['what']}", name, None, "present")
            return
        if not os.path.isdir(path) or (old and not os.path.isdir(old)):
            raise Refused(["The skill or its previous copy is gone: nothing to put back."], 409)
        dest = to_trash(self.s.skills_dir, path, name)
        if old:
            shutil.move(old, path)
        self.folder_change("Undo", f"Undo: {ch['what']}", name, dest, "present" if old else None)

    def undo(self, cid: int) -> None:
        """Undo one recorded change: from where it left the text or the folder, never over a later change."""
        ch = self.history.get(cid)
        if ch and ch["undone_by"]:
            raise Refused(["Already undone."], 409)
        if not ch or not undoable(ch):
            raise Refused(["This change cannot be undone here."], 404)
        t = ch["target"]
        if t["kind"] in TEXT_KINDS:
            # ⚠️ ONLY FROM WHERE THE CHANGE LEFT IT, the same rule for every text (history.py)
            if self.text_now(t) != ch["after"]:
                raise Refused(["Something changed since (another save, or Studio Code Server): undo the later "
                               "change first."], 409)
            self.text_change("Undo", f"Undo: {ch['what']}", t, ch["before"])
        elif t["kind"] == "folder":
            self.undo_folder(t["skill"], ch)
        self.history.mark_undone(cid, max(r["id"] for r in self.history.rows(1)))
        log.info("UI: change #%s undone", cid)
