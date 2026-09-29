#!/usr/bin/env python3
"""The add-on manifest and the text an operator actually reads, kept in step.

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

No YAML library: the base image's python has no PyYAML, and these two blocks
are flat enough to read with a small parser. The parser is deliberately strict —
it fails loudly rather than returning an empty set, because an empty set here
would pass every check below.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
problems: list[str] = []


def tracked(path: str) -> bool:
    out = subprocess.run(["git", "ls-files", "--error-unmatch", path],
                         cwd=ROOT, capture_output=True)
    return out.returncode == 0


def top_block(text: str, key: str) -> dict[str, str]:
    """The `key:` mapping's immediate children, as {name: raw value}."""
    m = re.search(rf"^{key}:\s*$\n((?:(?:[ \t].*)?\n)*)", text, re.M)
    if not m:
        raise SystemExit(f"FATAL: no `{key}:` block in config.yaml — parser is wrong, not the file")
    out = {}
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        child = re.match(r"^  (\w+):(.*)$", line)
        if child:
            out[child.group(1)] = child.group(2).strip()
    return out


CFG = (ROOT / "villa-kiosk" / "config.yaml").read_text()
options = top_block(CFG, "options")
schema = top_block(CFG, "schema")

# A parser that silently found nothing would pass everything below it.
if len(options) < 3:
    raise SystemExit(f"FATAL: parsed only {len(options)} options — the parser is broken")

TR = ROOT / "villa-kiosk" / "translations" / "en.yaml"
if not TR.exists():
    raise SystemExit("FATAL: villa-kiosk/translations/en.yaml is missing entirely")
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
        problems.append(f"option `{key}` has no entry in translations/en.yaml — "
                        f"Supervisor will render the raw key with no explanation")

# 2. and nothing describes a field that no longer exists
for key in described:
    if key not in options:
        problems.append(f"translations/en.yaml describes `{key}`, which is not an option — "
                        f"a stale label for a field the operator cannot see")

# 3. options and schema are the same set, or Supervisor drops the odd one out
for key in options:
    if key not in schema:
        problems.append(f"option `{key}` has no schema entry — Supervisor will not persist it")
for key in schema:
    if key not in options:
        problems.append(f"schema declares `{key}` with no default in options")

# 4. every name/description pair is actually filled in
if len(named) != len(described) or len(described_desc) != len(described):
    problems.append(f"{len(described)} fields but {len(named)} `name:` and "
                    f"{len(described_desc)} `description:` lines — one entry is "
                    f"missing its label or its help text")

# 4b. a GROUP of options (a mapping, e.g. `vesta_agent`) is checked field by
#     field: its fields are the same set in options and schema, and each has a
#     label and help text under `fields:` in the translations — the three rules
#     above stop at the group's own name.
def group_fields(text: str, block: str, group: str) -> list[str]:
    body = re.search(rf"^{block}:\s*$\n((?:(?:[ \t].*)?\n)*)", text, re.M).group(1)
    m = re.search(rf"^  {group}:\s*$\n((?:    .*\n)*)", body, re.M)
    return re.findall(r"^    (\w+):", m.group(1), re.M) if m else []


groups = [k for k, v in options.items() if v == ""]
for g in groups:
    of, sf = group_fields(CFG, "options", g), group_fields(CFG, "schema", g)
    if not of:
        problems.append(f"option group `{g}` has no fields — the parser found nothing")
    if sorted(of) != sorted(sf):
        problems.append(f"option group `{g}`: options have {sorted(of)}, schema has {sorted(sf)}")
    tm = re.search(rf"^  {g}:\s*$\n((?:    .*\n|\s*\n)*)", tr, re.M)
    block = tm.group(1) if tm else ""
    fields_block = block.split("    fields:\n", 1)[1] if "    fields:\n" in block else ""
    labelled = re.findall(r"^      (\w+):\s*\n        name: .+\n        description:", fields_block, re.M)
    for f in of:
        if f not in labelled:
            problems.append(f"option `{g}.{f}` has no name and description under `fields:` in translations/en.yaml")
    for f in labelled:
        if f not in of:
            problems.append(f"translations/en.yaml describes `{g}.{f}`, which is not a field of the group")

# 4c. the manifest's defaults and ranges ARE the proxy's options table
#     (OPTIONS in supervisor-proxy.py, 2.496.223) — compared by VALUE. A
#     default changed in config.yaml alone used to disagree silently with the
#     reader's own copy of it.
def flat_block(text: str, block: str) -> dict[str, str]:
    """`block:` as {"name" or "group.field": raw value}."""
    body = re.search(rf"^{block}:\s*$\n((?:(?:[ \t].*)?\n)*)", text, re.M).group(1)
    out, group = {}, None
    for line in body.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        top = re.match(r"^  (\w+):(.*)$", line)
        sub = re.match(r"^    (\w+):(.*)$", line)
        if top:
            group = top.group(1) if not top.group(2).strip() else None
            if group is None:
                out[top.group(1)] = top.group(2).strip()
        elif sub and group:
            out[f"{group}.{sub.group(1)}"] = sub.group(2).strip()
    return out


import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("proxy", ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py")
_proxy = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_proxy)
flat_opts, flat_schema = flat_block(CFG, "options"), flat_block(CFG, "schema")
if set(flat_opts) != set(_proxy.OPTIONS):
    problems.append(f"config.yaml offers {sorted(set(flat_opts) - set(_proxy.OPTIONS))} that the proxy's "
                    f"OPTIONS table lacks, and the table has {sorted(set(_proxy.OPTIONS) - set(flat_opts))} "
                    f"the manifest does not offer")


def manifest_default(raw: str):
    if raw in ("true", "false"):
        return raw == "true"
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    return raw.strip('"\'')


def manifest_schema(row) -> str:
    if row.kind == "bool":
        return "bool?"
    if row.kind == "int":
        return f"int({row.lo},{row.hi})?"
    if row.kind == "secret":
        return "password?"
    return f"match({row.pattern.pattern}|^$)?"


for name, row in _proxy.OPTIONS.items():
    if name not in flat_opts:
        continue
    got = manifest_default(flat_opts[name])
    if got != row.default or type(got) is not type(row.default):
        problems.append(f"option `{name}`: config.yaml's default is {got!r}, the proxy's is {row.default!r}")
    if flat_schema.get(name) != manifest_schema(row):
        problems.append(f"option `{name}`: config.yaml's schema is {flat_schema.get(name)!r}, "
                        f"the proxy's table means {manifest_schema(row)!r}")
    if row.kind == "int" and not row.lo <= row.default <= row.hi:
        problems.append(f"option `{name}`: its default {row.default} is outside {row.lo}..{row.hi}")

# 5. the version the two files must agree on
pkg = (ROOT / "package.json").read_text()
pkg_v = re.search(r'"version":\s*"([^"]+)"', pkg).group(1)
cfg_v = re.search(r'^version:\s*"?([^"\s]+)"?', CFG, re.M).group(1)
if pkg_v != cfg_v:
    problems.append(f"package.json is {pkg_v} but villa-kiosk/config.yaml is {cfg_v} — "
                    f"Home Assistant offers an update only when config.yaml's version "
                    f"CHANGES, so a mismatch ships a build nobody is offered")

# ⚠️ A THIRD SITE, AND IT WAS 400 RELEASES STALE. package-lock.json carries the
# version twice and no commit touched either; it read 2.79.1 against a
# package.json at 2.496.31. It is COPYied into the image and is one of the paths
# that triggers a build, so a lockfile nobody keeps current is a build input
# nobody is reading.
# Parsed, not regexed: a byte-offset guess at "which version fields are the
# root ones" matched three dependency versions on its first run.
import json
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

# 6. the release the operator is being offered must be the one the changelog
#    describes.
#
# ⚠️ SIX RELEASES SHIPPED WITHOUT AN ENTRY. villa-kiosk/CHANGELOG.md is what
# Supervisor renders in the Update dialog — the ONLY account of a release the
# owner ever reads. Its newest heading said 2.496.29 while the add-on offered
# 2.496.35, so the update dialog described work five releases old and every
# fix since was invisible. Nothing generates this file; it is written by hand,
# and a hand stops.
#
# This gate is why it cannot happen again, and it is checked here rather than
# in a commit hook because the version and the changelog are the same fact: a
# release is a number a user is offered PLUS what they are told it contains.
CHANGELOG = ROOT / "villa-kiosk" / "CHANGELOG.md"
if not CHANGELOG.exists():
    problems.append("villa-kiosk/CHANGELOG.md is missing — Supervisor renders it "
                    "in the Update dialog and would show nothing")
else:
    cl = CHANGELOG.read_text()
    headings = re.findall(r"^## (\S+)", cl, re.M)
    if not headings:
        problems.append("villa-kiosk/CHANGELOG.md has no `## <version>` headings — "
                        "the parser found nothing, so this check would pass on any file")
    elif headings[0] != cfg_v:
        problems.append(f"the changelog's newest entry is {headings[0]}, but this "
                        f"release is {cfg_v} — the Update dialog would describe "
                        f"{headings[0]} to an operator being offered {cfg_v}")
    # A heading with no prose under it is an entry in name only.
    body = cl.split("\n## ", 1)[0]
    if len(body.strip().splitlines()) < 3:
        problems.append(f"the {cfg_v} changelog entry has a heading and no content")

# 7. the manifest must not cite a guard that does not exist — the defect that
#    produced this file. Its own comment named tests/security_test.py.
for m in re.finditer(r"tests/[A-Za-z0-9_/.-]+\.(?:py|mjs|sh|ts)", CFG):
    if not tracked(m.group(0)):
        problems.append(f"config.yaml cites `{m.group(0)}`, which is not tracked — "
                        f"a comment promising a guard that does not exist is worse "
                        f"than no comment")

print(f"  {len(options)} options, {len(schema)} schema entries, {len(described)} described"
      + "".join(f", group `{g}`: {len(group_fields(CFG, 'options', g))} fields" for g in groups))
print(f"  {len(_proxy.OPTIONS)} options compared by value with the proxy's table")
print(f"  version: package.json {pkg_v} == config.yaml {cfg_v}")
if problems:
    print("\n".join(f"    FAIL  {p}" for p in problems))
    sys.exit(1)
print("  PASS  the manifest, its schema and its help text agree")
