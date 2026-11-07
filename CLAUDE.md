# CLAUDE.md (agent-dev: the VESTA Agent)

This branch holds only the VESTA Agent (`agent-host/`, `vesta-agent/`). The VESTA Kiosk and the project's shared
rules live on **`dev2`**: read `git show origin/dev2:CLAUDE.md` and `git show origin/dev2:rules/RULES.md` before work that touches the owner, the villa's system, wording or git. The Agent's own hard rules are
in `agent-host/CLAUDE.md`.

## Branches

All Agent work is committed on `agent-dev`. Never commit or push to `main`: CI writes `vesta-agent-dev/` there.
Once per clone: `git config core.hooksPath tools/hooks` (refuses commits and pushes to main).

## Commands

Python is `agent-host/.venv/bin/python` (3.13, gitignored; there is no `python` on this machine; rebuild:
`uv venv --python 3.13 agent-host/.venv` then install `pyyaml pytest pytest-xdist ruff -r agent-host/agent-src/requirements.txt`).

```bash
PY=agent-host/.venv/bin/python
$PY agent-host/tools/release.py gates               # every check (what CI runs before building the image)
(cd agent-host/agent-src && ../.venv/bin/python -m pytest tests/test_x.py -q)   # one test file
$PY agent-host/tools/release.py ship -F msg.txt     # release
```

**Release:** add an entry at the TOP of `vesta-agent/CHANGELOG.md` (what the owner will see, plain words; its
`## x.y.z` heading IS the version, the only version and the only change list), stage what ships by name, then `ship`.
It writes the version, runs the quick checks (seconds), commits, pushes `agent-dev` and waits for the store:
exit 0 = published, 3 = pushed but not published yet (read the CI run), 2 = refused. CI runs every gate first.

Commit messages: a subject of 72 characters at most, then a blank line and the detail.
