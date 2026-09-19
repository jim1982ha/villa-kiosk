#!/usr/bin/env python3
"""Proof that the manifest gate is capable of failing.

⚠️ A GATE THAT HAS NEVER GONE RED IS NOT A GATE. This repository has shipped a
check that printed SKIP and exited 0 on every runner, and another whose regex
collapsed nine labels into one element and still said PASS. Both were green for
their whole lives. So each rule in `addon-manifest.py` is broken here on
purpose, one at a time, and the gate is required to go red AND to say why: an
expected fragment must appear in its output, or "red" could be red for an
unrelated reason.

It is a script rather than a paragraph in a ticket because a transcribed
procedure goes stale against the file it describes, silently. Run it:

    npm run test:manifest:mutations

HOW IT WORKS. Each mutation edits real files in place, runs the gate as a
subprocess, then restores the exact original bytes in a `finally`. Nothing is
left behind even if a mutation raises — but the sweep does write to tracked
files while it runs, so do not interrupt it mid-mutation and then commit
without checking `git status`.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATE = ROOT / "tests" / "addon-manifest.py"
CFG = ROOT / "villa-kiosk" / "config.yaml"
TR = ROOT / "villa-kiosk" / "translations" / "en.yaml"
CL = ROOT / "villa-kiosk" / "CHANGELOG.md"
PKG = ROOT / "package.json"
LOCK = ROOT / "package-lock.json"

# A scratch manifest for the rules that only apply to an add-on with no
# package.json of its own. The list in the gate has one entry today, so the
# unpaired path has nothing real to run against until the second add-on lands —
# and an unexercised branch is exactly what this file exists to refuse.
FAKE = ROOT / "zz-mutation-addon"

failures: list[str] = []
run_count = 0


def run_gate() -> tuple[int, str]:
    p = subprocess.run([sys.executable, str(GATE)], cwd=ROOT,
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def newest_heading() -> str:
    """The version villa-kiosk/CHANGELOG.md currently leads with.

    ⚠️ READ, NEVER TYPED. Two mutations below used the literal "## 2.496.50".
    `sub` replaces the FIRST match, so the day the repo bumped to 2.496.51 that
    literal stopped matching the newest heading and matched the historic entry
    further down instead — mutating a release nobody is being offered, leaving
    the newest heading correct, and turning this step green on a defect it was
    written to catch. It would have gone wrong on the very next release.
    """
    m = re.search(r"^## (\S+)", CL.read_text(), re.M)
    if not m:
        raise SystemExit("FATAL: villa-kiosk/CHANGELOG.md has no `## <version>` "
                         "heading to mutate — this sweep is stale against it")
    return m.group(1)


def sub(path: Path, old: str, new: str) -> None:
    """Replace `old` with `new` once, failing loudly if it is not there."""
    text = path.read_text()
    if text.count(old) < 1:
        raise SystemExit(f"FATAL: mutation target not found in {path.name}: {old!r} "
                         f"— this sweep is stale against the file it mutates")
    path.write_text(text.replace(old, new, 1))


def mutate(name: str, edits, expect: str) -> None:
    """Apply `edits`, require the gate to go red for `expect`, then restore."""
    global run_count
    run_count += 1
    saved = {p: p.read_text() for p in (GATE, CFG, TR, CL, PKG, LOCK)}
    try:
        edits()
        code, out = run_gate()
        if code == 0:
            failures.append(f"{name}: gate PASSED — it does not see this defect")
        elif expect not in out:
            failures.append(f"{name}: gate failed, but for something else "
                            f"(no {expect!r} in its output)")
        else:
            print(f"  RED   {name}")
    finally:
        for p, text in saved.items():
            p.write_text(text)
        if FAKE.exists():
            shutil.rmtree(FAKE)


def write_fake(version: str, changelog_version: str) -> None:
    """A second, unpaired manifest, and the gate entry that reaches it."""
    (FAKE / "translations").mkdir(parents=True, exist_ok=True)
    (FAKE / "config.yaml").write_text(
        f'name: Mutation\nversion: "{version}"\nslug: mutation\n'
        "options:\n  a: \"\"\n  b: \"\"\n  c: \"\"\n"
        "schema:\n  a: str?\n  b: str?\n  c: str?\n")
    (FAKE / "translations" / "en.yaml").write_text(
        "configuration:\n"
        + "".join(f"  {k}:\n    name: {k}\n    description: {k}\n" for k in "abc"))
    (FAKE / "CHANGELOG.md").write_text(
        f"# Changelog\n\n## {changelog_version}\n\n- one\n- two\n- three\n")
    sub(GATE, 'Addon("villa-kiosk", package_json=True),',
        'Addon("villa-kiosk", package_json=True),\n'
        '    Addon("zz-mutation-addon", package_json=False),')


# ── The gate must be green before any of this means anything ────────────────
code, out = run_gate()
if code != 0:
    raise SystemExit(f"FATAL: the gate is already red before any mutation:\n{out}")

# ── 1. help text an operator reads ──────────────────────────────────────────
mutate("a missing translation entry",
       lambda: sub(TR, "  superadmin_pin:\n", "  zz_not_an_option:\n"),
       "no entry in translations/en.yaml")

mutate("a translation for a field that no longer exists",
       lambda: sub(TR, "configuration:\n",
                   "configuration:\n  zz_ghost:\n    name: Ghost\n    description: Ghost\n"),
       "which is not an option")

mutate("a label with no help text",
       lambda: sub(TR, "    name: Guest passcode (4 digits)\n", ""),
       "missing its label or its help text")

# ── 2. options and schema ───────────────────────────────────────────────────
mutate("an option with no schema entry",
       lambda: sub(CFG, "  superadmin_pin: match(^[0-9]{6}$|^$)?\n", ""),
       "Supervisor will not persist it")

mutate("a schema entry with no option",
       lambda: sub(CFG, "schema:\n", "schema:\n  zz_orphan: str?\n"),
       "with no default in options")

# ── 3. the version rule, paired ─────────────────────────────────────────────
mutate("package.json and config.yaml disagree",
       lambda: sub(CFG, "\nversion: ", "\nversion: \"9.9.9\"  # "),
       "so a mismatch ships a build nobody is offered")

mutate("the lockfile names an older release",
       lambda: sub(LOCK, '"version": "', '"version": "0.0.1",\n  "_was": "'),
       "run `npm install`")

# ── 4. the changelog ────────────────────────────────────────────────────────
mutate("the newest changelog heading is missing",
       lambda: sub(CL, f"## {newest_heading()}", "Unreleased"),
       "villa-kiosk: the changelog's newest entry")

mutate("the changelog has no version headings at all",
       lambda: CL.write_text("# Changelog\n\nnothing here\n"),
       "no `## <version>` headings")

mutate("a changelog heading with no entry under it",
       lambda: CL.write_text(CL.read_text().split("\n## ", 1)[0].split("## ")[0]
                             + f"## {newest_heading()}\n\n## 0.0.0\n\n- x\n- y\n- z\n"),
       "heading and no content")

mutate("the changelog is missing entirely",
       lambda: CL.unlink(),
       "Supervisor renders it")

# ── 5. the manifest citing a guard that does not exist ──────────────────────
mutate("config.yaml cites an untracked guard",
       lambda: sub(CFG, "tests/addon-manifest.py", "tests/security_test.py"),
       "which is not tracked")

# ── 6. the version rule, unpaired — the branch the second add-on will use ───
mutate("an unpaired manifest whose version is not semver",
       lambda: write_fake("2026.9-beta", "2026.9-beta"),
       "which is not MAJOR.MINOR.PATCH")

mutate("an unpaired manifest whose changelog names another release",
       lambda: write_fake("0.2.0", "0.1.0"),
       # ⚠️ NAMED, NOT JUST "the Update dialog would describe". That sentence is
       # emitted by the changelog rule for EVERY manifest, so the bare fragment
       # would have let this mutation pass on villa-kiosk's changelog breaking
       # — green for a failure in the half of the gate it does not test.
       "zz-mutation-addon: the changelog's newest entry")

mutate("an unpaired manifest is held to every other rule too",
       lambda: (write_fake("0.2.0", "0.2.0"),
                sub(FAKE / "translations" / "en.yaml", "  c:\n", "  zz_ghost:\n")),
       "zz-mutation-addon: option `c`")

# ── 7. and the gate's own sanity floors ─────────────────────────────────────
mutate("the list of manifests is empty",
       lambda: sub(GATE, '    Addon("villa-kiosk", package_json=True),\n', ""),
       "MANIFESTS is empty")

mutate("the options parser finds nothing",
       lambda: sub(CFG, "\noptions:\n", "\noptions_renamed:\n"),
       "no `options:` block")

print()
if failures:
    print("\n".join(f"    FAIL  {f}" for f in failures))
    print(f"  {len(failures)} of {run_count} mutations did not turn the gate red")
    sys.exit(1)
print(f"  PASS  all {run_count} mutations turned the manifest gate red")
