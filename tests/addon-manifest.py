#!/usr/bin/env python3
"""The add-on manifests and the text an operator actually reads, kept in step.

⚠️ THIS GUARD WAS CITED BEFORE IT EXISTED. villa-kiosk/config.yaml says, in a
comment beside the options block: "Add a field there whenever you add one here
(security_test.py fails if you forget)." No file of that name is tracked on
this branch. So the rule was stated to every maintainer who opened the manifest, and
enforced by nothing.

WHY THE RULE MATTERS. Supervisor renders translations/en.yaml's `name` as each
field's label and `description` as the help text under it. A field missing from
that file does not fail, warn, or look broken — it renders as its raw key
("evidence_retention_days") with no explanation, on the one page an operator
configuring this add-on ever sees. That is also the page where the PINs are
set, so a missing description is a security control with no instructions.

⚠️ A LIST, NOT ONE ADD-ON, AND THE VERSION RULE IS PER-MANIFEST. This file was
hardcoded to `villa-kiosk/` in three places and asserted that package.json and
villa-kiosk/config.yaml carry the same number. That assertion is true of the
kiosk and only the kiosk: a second add-on in this repository is Python, has no
package.json of its own, and versions independently of the kiosk (a commit
touching only its code bumps only its manifest). So each entry in MANIFESTS
declares whether it is PAIRED with package.json; an unpaired one is held to
valid semver and to its own changelog instead, which is the whole of what the
pairing was standing in for.

No YAML library: the base image's python has no PyYAML, and these two blocks
are flat enough to read with a small parser. The parser is deliberately strict —
it fails loudly rather than returning an empty set, because an empty set here
would pass every check below.
"""
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent.parent
problems: list[str] = []

class Addon(NamedTuple):
    """One hand-written add-on manifest, and how its version is pinned."""
    dir: str
    # True: this manifest and package.json ship as one artifact and must carry
    # the same number. False: the manifest owns its own number, and is held to
    # semver + its own changelog instead.
    package_json: bool


# ⚠️ ADD AN ENTRY HERE, NOT A SECOND COPY OF THIS FILE. Every check below runs
# over every entry.
#
# ⚠️ HAND-WRITTEN ONLY. `villa-kiosk-dev/` and `villa-kiosk-dev2/` are tracked
# manifests too, and they are deliberately absent: CI GENERATES them on every
# push to a channel branch ("Never hand-edit villa-kiosk-dev/"), so they cannot
# drift from the source manifest without the generator drifting first, and the
# rules below would be checking a copy rather than an original.
MANIFESTS: list[Addon] = [
    Addon("villa-kiosk", package_json=True),
]

# A parser that silently found nothing would pass everything below it, so a
# manifest is required to have parsed at least this many options. It is a floor
# on the PARSER, not a rule about how many knobs an add-on may have.
MIN_OPTIONS = 3


def tracked(path: str) -> bool:
    out = subprocess.run(["git", "ls-files", "--error-unmatch", path],
                         cwd=ROOT, capture_output=True)
    return out.returncode == 0


def top_block(text: str, key: str, where: str) -> dict[str, str]:
    """The `key:` mapping's immediate children, as {name: raw value}."""
    m = re.search(rf"^{key}:\s*$\n((?:(?:[ \t].*)?\n)*)", text, re.M)
    if not m:
        raise SystemExit(f"FATAL: no `{key}:` block in {where} — parser is wrong, not the file")
    out = {}
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        child = re.match(r"^  (\w+):(.*)$", line)
        if child:
            out[child.group(1)] = child.group(2).strip()
    return out


# The version package.json names, read once — the paired manifests are all
# checked against this one string.
pkg = (ROOT / "package.json").read_text()
pkg_v = re.search(r'"version":\s*"([^"]+)"', pkg).group(1)


def check_lockfile() -> None:
    """The third site the release number lives at.

    ⚠️ AND IT WAS 400 RELEASES STALE. package-lock.json carries the version
    twice and no commit touched either; it read 2.79.1 against a package.json
    at 2.496.31. It is COPYied into the image and is one of the paths that
    triggers a build, so a lockfile nobody keeps current is a build input
    nobody is reading.

    Parsed, not regexed: a byte-offset guess at "which version fields are the
    root ones" matched three dependency versions on its first run.
    """
    lock = json.loads((ROOT / "package-lock.json").read_text())
    lock_versions = {
        "package-lock.json root": lock.get("version"),
        'package-lock.json packages[""]': lock.get("packages", {}).get("", {}).get("version"),
    }
    for where, got in lock_versions.items():
        if got != pkg_v:
            problems.append(f"{where} records {got}, not {pkg_v} — run `npm install` "
                            f"(it rewrites both root version fields) so the lockfile "
                            f"the image builds from names this release")


def check_manifest(addon: Addon) -> str:
    """Every rule, for one add-on. Returns the version it declares."""
    d = addon.dir
    cfg_path = ROOT / d / "config.yaml"
    if not cfg_path.exists():
        raise SystemExit(f"FATAL: {d}/config.yaml is missing entirely")
    CFG = cfg_path.read_text()
    options = top_block(CFG, "options", f"{d}/config.yaml")
    schema = top_block(CFG, "schema", f"{d}/config.yaml")

    if len(options) < MIN_OPTIONS:
        raise SystemExit(f"FATAL: parsed only {len(options)} options in {d}/config.yaml "
                         f"— the parser is broken")

    TR = ROOT / d / "translations" / "en.yaml"
    if not TR.exists():
        raise SystemExit(f"FATAL: {d}/translations/en.yaml is missing entirely")
    tr = TR.read_text()
    described = set(re.findall(r"^  (\w+):\s*$", tr, re.M))
    # ⚠️ A COUNT, NOT A SET. This was `set(re.findall(...))`, and every match is
    # the identical string "    name:", so nine labels collapsed to one element
    # and the check reported a missing label on a complete file.
    named = re.findall(r"^    name:", tr, re.M)
    described_desc = re.findall(r"^    description:", tr, re.M)

    # 1. every option has help text an operator can read
    for key in options:
        if key not in described:
            problems.append(f"{d}: option `{key}` has no entry in translations/en.yaml — "
                            f"Supervisor will render the raw key with no explanation")

    # 2. and nothing describes a field that no longer exists
    for key in described:
        if key not in options:
            problems.append(f"{d}: translations/en.yaml describes `{key}`, which is not an "
                            f"option — a stale label for a field the operator cannot see")

    # 3. options and schema are the same set, or Supervisor drops the odd one out
    for key in options:
        if key not in schema:
            problems.append(f"{d}: option `{key}` has no schema entry — "
                            f"Supervisor will not persist it")
    for key in schema:
        if key not in options:
            problems.append(f"{d}: schema declares `{key}` with no default in options")

    # 4. every name/description pair is actually filled in
    if len(named) != len(described) or len(described_desc) != len(described):
        problems.append(f"{d}: {len(described)} fields but {len(named)} `name:` and "
                        f"{len(described_desc)} `description:` lines — one entry is "
                        f"missing its label or its help text")

    # 5. the number this release is offered under
    cfg_v = re.search(r'^version:\s*"?([^"\s]+)"?', CFG, re.M).group(1)
    if addon.package_json:
        # Paired: this manifest and package.json are one artifact.
        if pkg_v != cfg_v:
            problems.append(f"package.json is {pkg_v} but {d}/config.yaml is {cfg_v} — "
                            f"Home Assistant offers an update only when config.yaml's version "
                            f"CHANGES, so a mismatch ships a build nobody is offered")
    elif not re.fullmatch(r"\d+\.\d+\.\d+", cfg_v):
        # Unpaired: nothing else in the repo carries this number, so the only
        # thing that can be said about it is that Supervisor can compare it.
        # It compares semver, and a version it cannot parse is an add-on it
        # never offers an update for.
        problems.append(f"{d}/config.yaml declares version `{cfg_v}`, which is not "
                        f"MAJOR.MINOR.PATCH — nothing else in this repo carries this "
                        f"number, so semver is the whole of what can be checked")

    # 6. the release the operator is being offered must be the one the changelog
    #    describes.
    #
    # ⚠️ SIX RELEASES SHIPPED WITHOUT AN ENTRY. <dir>/CHANGELOG.md is what
    # Supervisor renders in the Update dialog — the ONLY account of a release the
    # owner ever reads. Its newest heading said 2.496.29 while the add-on offered
    # 2.496.35, so the update dialog described work five releases old and every
    # fix since was invisible. Nothing generates this file; it is written by hand,
    # and a hand stops.
    #
    # This gate is why it cannot happen again, and it is checked here rather than
    # in a commit hook because the version and the changelog are the same fact: a
    # release is a number a user is offered PLUS what they are told it contains.
    # For an unpaired manifest it is also half the version rule: with no
    # package.json to agree with, the changelog is the only other place that
    # names the release at all.
    CHANGELOG = ROOT / d / "CHANGELOG.md"
    if not CHANGELOG.exists():
        problems.append(f"{d}/CHANGELOG.md is missing — Supervisor renders it "
                        f"in the Update dialog and would show nothing")
    else:
        cl = CHANGELOG.read_text()
        headings = re.findall(r"^## (\S+)", cl, re.M)
        if not headings:
            problems.append(f"{d}/CHANGELOG.md has no `## <version>` headings — "
                            f"the parser found nothing, so this check would pass on any file")
        elif headings[0] != cfg_v:
            problems.append(f"{d}: the changelog's newest entry is {headings[0]}, but this "
                            f"release is {cfg_v} — the Update dialog would describe "
                            f"{headings[0]} to an operator being offered {cfg_v}")
        # A heading with no prose under it is an entry in name only.
        body = cl.split("\n## ", 1)[0]
        if len(body.strip().splitlines()) < 3:
            problems.append(f"{d}: the {cfg_v} changelog entry has a heading and no content")

    # 7. the manifest must not cite a guard that does not exist — the defect that
    #    produced this file. Its own comment named tests/security_test.py.
    for m in re.finditer(r"tests/[A-Za-z0-9_/.-]+\.(?:py|mjs|sh|ts)", CFG):
        if not tracked(m.group(0)):
            problems.append(f"{d}: config.yaml cites `{m.group(0)}`, which is not tracked — "
                            f"a comment promising a guard that does not exist is worse "
                            f"than no comment")

    print(f"  {d}: {len(options)} options, {len(schema)} schema entries, "
          f"{len(described)} described, version {cfg_v}"
          + (f" == package.json {pkg_v}" if addon.package_json else " (independent)"))
    return cfg_v


if not MANIFESTS:
    raise SystemExit("FATAL: MANIFESTS is empty — this gate would pass on anything")

for addon in MANIFESTS:
    check_manifest(addon)

# ⚠️ ONCE, BESIDE THE LOOP, NOT INSIDE IT. package-lock.json is a fact about
# package.json rather than about any one manifest: run per paired manifest it
# would report the same defect twice the day a second paired add-on arrives,
# and disappear entirely the day none is paired.
if any(a.package_json for a in MANIFESTS):
    check_lockfile()

if problems:
    print("\n".join(f"    FAIL  {p}" for p in problems))
    sys.exit(1)
print(f"  PASS  {len(MANIFESTS)} manifest(s): schema and help text agree")
