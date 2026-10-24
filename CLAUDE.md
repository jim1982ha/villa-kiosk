# CLAUDE.md

Guidance for Claude Code working in this repository — VESTA, a 3D villa kiosk
shipped as a Home Assistant add-on (React + TypeScript + Babylon.js, served by
nginx with a small Python supervisor proxy).

## Branches

⚠️ **The Kiosk has two branches: `main` and `dev2`; the VESTA Agent has
`agent-dev`.** (The former `dev` and `ai` branches, the AI layer and their
add-ons were deleted on 2026-09-26 at the owner's request. Do not reintroduce,
propose or cite them.)

* **`dev2`** — where ALL Kiosk work is committed and pushed, by every
  contributor (owner, 2026-10-25: a collaborator works on dev2 too). Its CI build publishes
  the **VESTA (dev2)** add-on so the owner can try a change on the wall tablet.
* **`main`** — the released **VESTA** add-on. It advances ONLY by merging
  `dev2` when the owner asks ("backport dev2 into main"). The hooks in
  `tools/hooks/` (`pre-commit`, `pre-push`) refuse commits/pushes to `main`;
  `VK_ALLOW_MAIN=1` is the deliberate escape hatch for that merge. ⚠️ A fresh
  clone runs them only after `git config core.hooksPath tools/hooks` (once).

## Commands

```bash
npm run dev          # https://localhost:5173
npm run build        # tsc -b (typecheck) + vite build — run before calling a change done
npm run typecheck    # tsc -b --noEmit, faster
npm run preview      # serve the production build

# The gates — listed ONCE, in tools/release.py (CI runs the same command):
npm run gates        # every gate, even after a red one, then a summary (off CI also the local-only ones)
npm run oracles:changed   # only the oracles naming a file changed since the last commit: seconds, before ship
npm run ship -- -F msg.txt   # release: see Releasing
```

**The proxy's security suite** — sessions, lockout, path traversal, the
REST/websocket allow-lists, store write rights (185 checks) — is deliberately
NOT tracked (it maps exactly what the auth boundary checks). It lives at
`.scratch/security/security_test.py`; run `python3
.scratch/security/security_test.py` after touching
`rootfs/usr/bin/supervisor-proxy.py`. ⚠️ Never move it under `tests/`: the
`!tests/*.py` rule there would make git track it.

`npm run dev`/`build`/`preview` run `npm run clean` first. There is no lint
script and no general JS test runner: `tsc -b` (strict, `noUnusedLocals`,
`noUnusedParameters`) plus the oracles are the automated gate. Path alias:
`@/*` → `src/*`.

**Oracles** (`tests/oracles/*.mjs`) are plain Node scripts — Node strips the
types, imports go through `tests/consistency/alias-hook.mjs`. Prefer checks
that DRIVE VALUES through a pure module over regexes on source (markup shape: `tests/consistency/jsx.mjs`
reads elements, props and their `&&` guards from the compiler's tree); when a check
is added, prove it can fail: `npm run mutate -- FILE 'old' 'new' -- CMD` (RED = it catches it;
the file always comes back; `--restore` after a killed run).

⚠️ **`tests/` is gitignored and 83 files under it are tracked anyway** (5 at
`tests/`, 76 in `tests/oracles/`, 2 in `tests/consistency/`), by negation
patterns in `.gitignore`. A new `.sh` is NOT tracked automatically (the old
`tests/preflight.sh` and `tests/ship.sh` were lost that way; the release now
lives in the tracked `tools/release.py`). Verify with
`git ls-files`, never by reading `.gitignore`.

## Releasing

⚠️ **Release with `npm run ship -- -F msg.txt`** (dev2 worktree), never by hand.
Write the new entry at the TOP of `villa-kiosk/CHANGELOG.md` (what the owner
will SEE, in plain words) — its `## x.y.z` heading IS the version — stage what
ships by name, then `ship`: it writes the version to `package.json`,
`villa-kiosk/config.yaml` and the lockfile, runs every gate on what is staged,
commits, pushes `HEAD:dev2`, and exits **0 only when `villa-kiosk-dev2/` on
`main` names the version** (3 = pushed, not published: read CI). It refuses
main, unstaged tracked changes, and a changelog entry not above the release.
`--dry-run` shows the plan. Never hand-edit `villa-kiosk-dev2/`.

The VESTA Agent has the same module on `agent-dev`:
`agent-host/tools/release.py gates|ship` (app version = top of
`vesta-agent/CHANGELOG.md`; engine version = top of
`agent-host/agent-src/CHANGELOG.md`, required when agent-src changes). Its
tests run with `agent-host/.venv/bin/python` (gitignored, Python 3.13; how to
rebuild it is at `PY` in `release.py`); there is no `python` on this machine.

**Backport to main** (only on the owner's word): `npm run backport --
--owner-asked` (dev2 worktree; `--dry-run` shows the plan). It merges
`origin/dev2` `--no-ff` into `origin/main` in a temporary worktree, refuses
unless the tree equals dev2 apart from main's own folders (found, not named:
`villa-kiosk-dev2/`, `vesta-agent-dev/`), runs every gate on the merged tree
with this checkout's `node_modules`/`.scratch` linked, pushes with
`VK_ALLOW_MAIN=1`, and exits **0 only when the merge's CI runs are green**
(3 = pushed, not confirmed). Never by hand.

## The hard rule: nothing villa-specific ships

This is a redistributable Home Assistant add-on, not a bespoke dashboard for
one villa. **No entity_id, room name, device count, villa dimension, per-site
tuning constant, or business/contract-specific value may be hardcoded.** Such
a value works on the machine it was written against and silently breaks every
other install.

Derive from live HA/scene/floor-plan data; match rooms/entities through generic
config lookups; prefer an **empty** default over a seeded one for any
user-editable config slice (a seed spread under stored config resurrects
deleted entries on reload). `EntityMap.ts`, `TeleportPoints.ts`,
`Sh3dCalibration.ts`, `ThresholdConfig.ts` and `fm/fmTypes.ts` ship with
deliberately empty tables for this reason. Reading real entities through HA to
DEBUG is fine; that data must never become a literal in shipped code.

Enforced by `tests/hard-rules.py`, which freezes the set of entity ids in
TRACKED source and fails on any new one until someone classifies it. It scans
tracked files only, so stage a new file before relying on it.

⚠️ The villa's own ids, entity ids and notify targets live in
`.scratch/villa-site/PROPERTY.md` (gitignored). Never copy them anywhere
tracked.

## The second hard rule: no internet dependency, ever

The target is **an iPad mounted in a villa that may have no internet at all** —
only a LAN path to Home Assistant. Anything fetched from a third-party host
works on a developer's desk and is missing on the wall (`hard-rules.py` refuses
a third-party host in shipped source).

Currently clean, a state to preserve: self-hosted variable webfonts
(`/fonts/*.woff2`); Draco decoder WASM bundled from `@babylonjs/core` and wired
through `DracoCompression.Configuration` (`babylon/ModelLoader.ts`); a
procedurally generated IBL (`RenderEnhancements.buildGradientEnv`); a service
worker precaching the shell and hashed assets; KTX2 via
`KhronosTextureContainer2.URLConfig` with the transcoder vendored in
`src/assets/ktx2/` (ETC1S only — the UASTC entries stay `null`). The
`assets.babylonjs.com`/`cdn.babylonjs.com` strings in the bundle are inert
defaults for APIs this app never calls — do not call them.

**Before adding any Babylon feature, check whether it lazily fetches an
asset.** Known traps: `displayLoadingUI`/`DefaultLoadingScreen`,
`CreateDefaultEnvironment`/`EnvironmentHelper`, lens flares, KTX2 defaults.

## The shared rules

⚠️ **ONE SET OF RULES FOR EVERY CONTRIBUTOR'S CLAUDE** (owner, 2026-10-25).
`rules/` holds every standing rule of how this repository is worked on (the
owner's decisions, how to verify a claim, git and gates, the villa's system,
Kiosk and Agent code, review). Read the index below; open a rule's file when its
hook matches the task. A new rule goes into `rules/` (on `dev2`; `agent-dev`
copies it, its release checks they match), never only into a private memory.
Nothing villa-specific goes in (the hard rule below; `hard-rules.py` scans them).

@rules/INDEX.md

## Agent skills and local folders

The development workflow is the **`mattpocock-skills`** plugin
(`/grill-with-docs`, `/to-spec`, `/to-tickets`, `/implement`, `/tdd`,
`/triage`, `/diagnosing-bugs`, `/improve-codebase-architecture`, …). Several
of its skills run only when the owner types them — check a skill's frontmatter
(`disable-model-invocation`), not the skills list.

* **Never pushed** (check with `git check-ignore -v`, not from memory): `docs/`
  (`.git/info/exclude`), `.scratch/` (gitignored). `CLAUDE.md` and `rules/` ARE
  tracked (2026-10-25).
* `docs/agents/` — the plugin's settings (mattpocock-skills 1.3.1), local like
  all of `docs/`: on another machine, the plugin's own setup writes them, with
  these choices:
  * Issue tracker: local markdown under `.scratch/<feature>/` (gitignored).
    See `docs/agents/issue-tracker.md`.
  * Triage labels: the five defaults. See `docs/agents/triage-labels.md`.
  * Domain docs: single-context. See `docs/agents/domain.md`.
* `GLOSSARY.md` does not exist yet; `/domain-modeling` creates it lazily when
  a term needs recording, and it IS tracked. ADRs live in `docs/adr/` (local
  only, like the rest of `docs/`). Absence of either is not a gap.
* `docs/` is local and NEVER published (owner's rule): `.git/info/exclude`
  hides it from git in every worktree. `docs/helpers/` holds the owner's
  Blender/GLB pipeline (`blender_pipeline.py`, whose `_BAKE_JOBS` is the source
  of truth — no JSON sidecar), `docs/assets/` its assets, `docs/generated/`
  frozen deliverables (their REQ-/ARCH-/TEST- ids resolve to nothing),
  `docs/blueprint/` OLD copies of the villa's blueprints, possibly out of date: edit the villa's own copy, read
  through the MCP. Not a documentation system.
* `rules/coding-standards.md` — the judgement calls a reviewer checks on a diff. Read it when reviewing.
