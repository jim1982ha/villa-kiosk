#!/usr/bin/env python3
"""The VESTA Agent host's app manifest, checked the way the Supervisor reads it.

⚠️ THE SUPERVISOR SKIPS A BAD FIELD SILENTLY. An invalid `map:` entry is logged
and dropped, an option missing from translations renders as its raw key, and a
schema type it cannot parse makes the whole app vanish from the store. None of
that fails a build, so it is checked here, before an image is pushed.

The schema regex is copied from the Supervisor (supervisor/apps/options.py,
RE_SCHEMA_ELEMENT, read 2026-09-28), not re-invented.

Run: python3 agent-host/tests/check_manifest.py [manifest-dir]   (default vesta-agent)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "vesta-agent")

RE_SCHEMA_ELEMENT = re.compile(
    r"^(?:"
    r"|bool"
    r"|email"
    r"|url"
    r"|port"
    r"|device(?:\((?P<filter>subsystem=[a-z]+)\))?"
    r"|str(?:\((?P<s_min>\d+)?,(?P<s_max>\d+)?\))?"
    r"|password(?:\((?P<p_min>\d+)?,(?P<p_max>\d+)?\))?"
    r"|int(?:\((?P<i_min>-?\d+)?,(?P<i_max>-?\d+)?\))?"
    r"|float(?:\((?P<f_min>-?\d*\.?\d+)?,(?P<f_max>-?\d*\.?\d+)?\))?"
    r"|match\((?P<match>.*)\)"
    r"|list\((?P<list>.+)\)"
    r")\??$"
)

problems: list[str] = []
cfg = yaml.safe_load((DIR / "config.yaml").read_text())
schema: dict = cfg.get("schema") or {}
options: dict = cfg.get("options") or {}

for key in ("name", "version", "slug", "description", "arch", "image"):
    if not cfg.get(key):
        problems.append(f"config.yaml has no `{key}`")
if not re.fullmatch(r"\d+\.\d+\.\d+", str(cfg.get("version", ""))):
    problems.append(f"version {cfg.get('version')!r} is not x.y.z")
if set(cfg.get("arch") or []) != {"aarch64", "amd64"}:
    problems.append(f"arch is {cfg.get('arch')}, CI builds aarch64 + amd64")
if "{arch}" not in str(cfg.get("image", "")):
    problems.append("image has no {arch} placeholder — the Supervisor would pull one arch everywhere")
if cfg.get("init") is not False:
    problems.append("init must be false: s6-overlay in the base image is the init")
if not 10 <= int(cfg.get("timeout", 10)) <= 300:
    problems.append("timeout must be within 10–300 s (Supervisor range)")

# SPEC H3/H4: no local-only privileges, nothing listens. The EFFECTIVE value is
# what the Supervisor grants: absent is false (Home Assistant's add-on linter
# refuses the key written out at its default — agent-host/tools/addon_lint.py),
# and anything that grants it fails here.
for key in ("homeassistant_api", "hassio_api"):
    if cfg.get(key, False) is not False:
        problems.append(f"{key} must not be granted (SPEC H3): leave it out")
for key in ("ports", "host_network", "privileged", "full_access", "docker_api"):
    if cfg.get(key):
        problems.append(f"`{key}` is set — SPEC H4 forbids anything listening or privileged")
# H4 as amended (owner, 2026-09-30): Home Assistant's Ingress is the one way in, for
# the agent's UI, administrators only, on the port the UI listens on.
if cfg.get("ingress"):
    if cfg.get("panel_admin", True) is not True:   # absent = the Supervisor's default, true
        problems.append("ingress without panel_admin: true — the UI edits what the agent may do, admins only (H4)")
    if cfg.get("ingress_port") != 8095:
        problems.append("ingress_port must be 8095, the UI's port (vesta_host.contract.UI_PORT)")

maps = cfg.get("map") or []
if not any(isinstance(m, dict) and m.get("type") == "addon_config"
           and m.get("read_only") is False for m in maps):
    problems.append("map has no writable addon_config entry — VESTA Skills need /config (SPEC H6)")

for key, spec in schema.items():
    if not RE_SCHEMA_ELEMENT.match(str(spec)):
        problems.append(f"schema `{key}: {spec}` is not a type the Supervisor accepts")
    required = not str(spec).endswith("?")
    if required and key not in options:
        problems.append(f"schema `{key}` is required but has no default in options")
for key in options:
    if key not in schema:
        problems.append(f"option `{key}` has no schema entry")
for key, spec in schema.items():
    if str(spec).startswith("password") and key in options:
        problems.append(f"secret `{key}` has a default in options — secrets start empty")

tr_path = DIR / "translations" / "en.yaml"
if not tr_path.exists():
    problems.append("translations/en.yaml is missing — every field shows as its raw key")
else:
    tr = (yaml.safe_load(tr_path.read_text()) or {}).get("configuration") or {}
    for key in schema:
        if key not in tr or not tr[key].get("name"):
            problems.append(f"translations/en.yaml has no label for `{key}`")
    for key in tr:
        if key not in schema:
            problems.append(f"translations/en.yaml describes `{key}`, which is not in the schema")

changelog = DIR / "CHANGELOG.md"
if changelog.exists():
    m = re.search(r"^## (\S+)", changelog.read_text(), re.M)
    if not m or m.group(1) != str(cfg.get("version")):
        problems.append(f"CHANGELOG.md's top entry is {m.group(1) if m else 'missing'}, "
                        f"config.yaml is {cfg.get('version')} — the update dialog shows the top entry")
else:
    problems.append("CHANGELOG.md is missing")

for name in ("icon.png", "logo.png", "DOCS.md"):
    if not (DIR / name).exists():
        problems.append(f"{name} is missing")

print(f"  {DIR.relative_to(ROOT)}: {cfg.get('name')} {cfg.get('version')}, "
      f"{len(schema)} schema fields")
if problems:
    for p in problems:
        print(f"  FAIL  {p}")
    sys.exit(1)
print("  PASS  manifest agrees with what the Supervisor reads")
