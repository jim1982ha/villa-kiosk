"""Make `import reports` work from the test suite.

In production the package resolves for free: the s6 service runs
`python3 /usr/bin/supervisor-proxy.py`, so `sys.path[0]` is `/usr/bin` and
`reports/` sits right there. Nothing about that helps here, where the tree is a
git checkout and pytest's rootdir is the repository.

This is the ONLY place the path is stated for tests. A test that inserts its
own would work until the layout moved, and then fail in a way that looks like a
missing module rather than a stale path.
"""

from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKAGE_PARENT = os.path.join(REPO_ROOT, "rootfs", "usr", "bin")

if PACKAGE_PARENT not in sys.path:
    # Appended, not inserted at 0: this directory will hold more modules as the
    # subsystem grows, and putting it ahead of the standard library means any
    # future file named after a stdlib module silently shadows it for the whole
    # test session. The package we want is not a stdlib name, so last is fine.
    sys.path.append(PACKAGE_PARENT)


def code_of(obj: "Any") -> str:
    """The CODE of `obj`, with every comment and docstring removed.

    Reading source and testing a substring against it is how this suite pins a
    cross-artefact contract that no type checker can see. It has one failure
    mode and the suite has hit it four times: the needle matches inside a
    COMMENT. Each time, the assertion was measuring prose — passing because a
    remark mentioned the identifier, or failing because a remark explained the
    history of the very thing it forbids.

    Six files had already invented their own regex to dodge it.
    That regex is wrong twice: it leaves DOCSTRINGS, which is where this
    codebase keeps most of its prose, and it eats any `#` inside a string
    literal. So the trap survived in the places that had noticed it.

    `tokenize` is what removes prose correctly: comments are a token type, and
    a docstring is the first statement of a module, class or function. Neither
    is guessable with a regex over text.
    """
    import inspect
    return strip_prose(inspect.getsource(obj))


def strip_prose(source: str) -> str:
    """`code_of` for text already in hand — a file read, or a sliced body.

    Comments and docstrings are BLANKED IN PLACE rather than removed, so every
    other character keeps its exact column. The first version rebuilt the code
    with `tokenize.untokenize`, which is canonical rather than faithful: it
    returned `buttons_mod .reconcile` and `def handle (event :Mapping [...]`,
    and every existing pin that spelled a call the way a human writes it
    stopped matching. A stripper that reformats is a stripper nobody can use.
    """
    import ast
    import io
    import tokenize

    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError):
        # A sliced body need not tokenize; drop whole-line comments only, which
        # is still better than the raw text and never worse.
        return "\n".join("" if line.lstrip().startswith("#") else line
                          for line in source.splitlines())

    docstrings = set()
    try:
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, (ast.Module, ast.ClassDef,
                                     ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            body = getattr(node, "body", None)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                docstrings.add((body[0].lineno, body[0].col_offset))
    except (SyntaxError, IndentationError):
        pass

    lines = source.splitlines(keepends=True)
    for tok in tokens:
        if tok.type != tokenize.COMMENT and not (
                tok.type == tokenize.STRING and tok.start in docstrings):
            continue
        (r1, c1), (r2, c2) = tok.start, tok.end
        for row in range(r1, r2 + 1):
            line = lines[row - 1]
            begin = c1 if row == r1 else 0
            end = c2 if row == r2 else len(line.rstrip("\n"))
            keep_nl = "\n" if line.endswith("\n") and row != r2 else ""
            lines[row - 1] = (line[:begin] + " " * (end - begin)
                              + line[end:] if row == r2
                              else line[:begin] + " " * (end - begin) + keep_nl)
    return "".join(lines)


def strip_tsx_prose(code: str) -> str:
    """A `.ts`/`.tsx` file with its comments removed, layout preserved.

    ⚠️ THE SAME TRAP AS `strip_prose`, ON THE OTHER SIDE OF THE TREE. A pin that
    greps a component for an identifier matches inside the ⚠️ paragraphs this
    codebase writes above almost every rule — passing because a remark mentions
    the thing, or failing because a remark explains the history of the thing it
    bans. Both have happened.

    ⚠️ TWO FILES HAD ALREADY INVENTED IT INDEPENDENTLY, which is what a missing
    shared tool looks like: `test_no_internal_ids_on_screen` and
    `test_module_conventions` each carry a private `_strip_comments`.

    ⚠️ ONLY A LINE THAT *STARTS* WITH `//` GOES. A trailing `//` cannot be
    removed safely by a regex — `https://…` inside a string literal is the
    obvious casualty — and the block form is enough for this codebase, whose
    prose is block comments and JSX `{/* … */}`.
    """
    import re as _re

    code = _re.sub(r"/\*[\s\S]*?\*/", "", code)
    return "\n".join("" if line.lstrip().startswith("//") else line
                     for line in code.splitlines())


# ── shared fixtures ─────────────────────────────────────────────────────────

@pytest.fixture()
def isolated_stores(tmp_path, monkeypatch):
    """Point every `/data` store at a throwaway directory.

    ⚠️ TWENTY-ONE FILES HAND-ROLLED THIS, AND THEY ISOLATED DIFFERENT SUBSETS.
    `_isolated` in `test_agent_escalation_wiring` repoints seven constants;
    the one in `test_agent_outbox` repoints ONE, so `audit.AUDIT_FILE` and
    `usage.USAGE_PATH` stayed at their `/data/vesta/...` defaults while that
    file exercised the Chase sweep. "Which stores must be repointed before this
    module writes" had 21 conflicting answers and no home.

    ⚠️ DERIVED, NOT LISTED. It walks the loaded `vesta.*` modules for path
    constants exactly as `store._repoint` does, so a store added tomorrow is
    isolated everywhere the day it is added rather than the day somebody
    remembers. That is the same reasoning that made `configure()` a walk.
    """
    import importlib
    import pkgutil
    import sys as _sys

    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")
    for mod in pkgutil.walk_packages([root], prefix="vesta."):
        if ".llm." in mod.name:
            continue                       # optional provider SDKs
        try:
            importlib.import_module(mod.name)
        except Exception:                  # pragma: no cover - unmet optional dep
            pass

    from vesta.adapters import store as store_mod

    moved = []
    for name, module in list(_sys.modules.items()):
        if not (name == "vesta" or name.startswith("vesta.")) or module is None:
            continue
        for attr, value in list(vars(module).items()):
            if not attr.endswith(store_mod._PATH_SUFFIXES):
                continue
            if not isinstance(value, str) or not value.startswith("/data"):
                continue
            monkeypatch.setattr(
                module, attr, str(tmp_path) + value[len("/data"):], raising=False)
            moved.append("%s.%s" % (name, attr))
    assert moved, "no store was isolated — the walk found nothing to repoint"
    return tmp_path
