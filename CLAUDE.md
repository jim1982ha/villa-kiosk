# CLAUDE.md

VESTA: a 3D villa kiosk shipped as a Home Assistant add-on (React + TypeScript + Babylon.js, served by nginx with a
small Python proxy, `rootfs/usr/bin/supervisor-proxy.py`). Path alias `@/*` → `src/*`.

## Commands

```bash
npm run dev                  # https://localhost:5173
npm run build                # tsc -b + vite build: run before calling a change done
npm run gates                # every check (what CI runs)
npm run test:oracles         # the Node checks in tests/oracles/
npm run ship -- -F msg.txt   # release (below)
npm run backport -- --owner-asked   # dev2 → main, only on the owner's word
```

The proxy's security suite is deliberately untracked: `python3 .scratch/security/security_test.py` after touching
the proxy (`ship` runs it when the proxy is staged). Never move it under `tests/`.

## Branches and releasing

- **`dev2`**: all Kiosk work, every contributor. **`main`**: the released add-on; it changes only by
  `npm run backport -- --owner-asked`, when the owner says so in that prompt. **`agent-dev`**: the VESTA Agent.
- The hooks refuse commits and pushes to `main` (`git config core.hooksPath tools/hooks` once per clone).
- **Release**: write the new entry at the top of `villa-kiosk/CHANGELOG.md` (what the owner will see, plain words; its
  `## x.y.z` heading is the version), stage what ships by name, then `npm run ship -- -F msg.txt`. Exit 0 means the
  store offers it; anything else is not shipped. CI runs every check before the image is built.
- Commit messages: a subject of at most 72 characters, a blank line, then the body.

## Hard rules

- **The siren needs a person.** No siren ever sounds without a person's own press made for that sounding (Approve on
  VESTA's request, the tablet's confirmation, the villa's own control). Silence, expiry or refusal is never a yes;
  stopping needs no one. Anything that could reach a siren counts, and a change touching one comes with a test.
- **Nothing villa-specific ships.** No entity id, room name, device count, dimension, per-site tuning or contract value
  in shipped code; derive from live data; empty defaults for user-editable lists (a seed resurrects deleted entries).
  Placeholders in comments and fixtures (`<domain>.<room>_window`). `tests/hard-rules.py` scans tracked files: stage a
  new file before relying on it. The villa's ids live in `.scratch/villa-site/` only.
- **No internet dependency.** The tablet may have only a LAN path to the villa: no CDN, webfont or remote asset.
  Before using a Babylon feature, check it does not fetch lazily (loading screen, default environment, lens flares,
  KTX2 defaults).
- **Never name the platform** in text a person reads: "the villa's system", never "Home Assistant" or "HA"
  (`no_platform_name.mjs`).

## Private folders

`docs/` (local, `.git/info/exclude`: the owner's bake pipeline, blueprint copies, ADRs) and `.scratch/` (gitignored:
villa data, the security suite, issue notes) never reach the repository. `tests/` is gitignored with tracked
exceptions: ask `git ls-files` / `git check-ignore -v`, never `.gitignore` or memory. Stage named files only.

## Rules

Every other standing rule (working with the owner, UI wording, cards, decided questions, Kiosk, villa system and Agent
code) is in `rules/RULES.md`, each said once. Read it before UI, text or villa-system work; a new rule goes there.
