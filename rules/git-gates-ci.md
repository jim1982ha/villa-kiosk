# Git, gates and CI

How changes are staged, checked and released so that what is reported is what shipped.

## Stage named files only

Stage tracked changes with `git add -u`, then each NEW file by its name. Before shipping, read
`git diff --cached --name-status` and account for every added file.

**Why:** a blanket staging line shipped an agent's throwaway probe database inside the app image.

**How to apply:** tell agents to write probes only under the scratchpad, never in the tree.

## Ask git what is tracked

Before saying a path ships or does not, run `git ls-files <path>` and `git check-ignore -v <file>`. Never infer it from
`.gitignore` or from a sentence in a document.

**Why:** `tests/` is gitignored and dozens of files under it are tracked anyway (negation rules); `.claude/` and the
security suite are genuinely untracked. Both mistakes were made, in opposite directions.

**How to apply:** a file shown as modified by `git status --short` is tracked by definition. A new `.sh` under `tests/`
is not tracked automatically.

## Searches that can be blind

When a search is evidence (proving something absent, auditing prose), make sure the tool can see the target: a `grep`
wrapper that honours `.gitignore` skips gitignored folders. Use `command grep`, name the file, or search in a script.

**Why:** a stale figure was declared "not there" by a search that could not open the file holding it.

## Stage before the gate

Checks that scan tracked files (`tests/hard-rules.py`) cannot see a new file until it is staged. `git add` new files
before running the gates, not after.

**Why:** a new module with placeholder ids passed the gate and turned it red only at the commit.

## The gate stops the commit

A check and the commit it guards are chained with `&&`, or run as separate steps whose exit status is read. Never pipe
a check into `tail` or `grep` inside a chain: the pipe's status is the filter's.

**Why:** a failing check piped into `tail` committed and pushed twice; `npm run build | grep` once matched the word
"error" and pushed a tree that did not compile.

**How to apply:** judge every command by its exit status, never by searching its output. The release command already
chains every gate; use it.

## CI is the gate

Local green is not evidence a release shipped. After a push, read the CI run for that commit and the published channel
manifest on `origin/main`.

**Why:** twelve releases built, tested and pushed in a row never reached the store while CI was red.

**How to apply:**
- The repository is public: runs, jobs and step conclusions read without a token through the GitHub API; logs do not,
  so emit a step's text as a `::warning` annotation and read the check-run annotations.
- The runner's environment is not yours: it installs only what the workflow names, and its checkout is shallow; a
  test that shells out to `git` tests the checkout. Compare collected test counts between a CI-shaped environment and
  yours.
- When fixing a CI failure, open the workflow, list every step of the job and run each one locally: steps stop at the
  first red, so a job is a stack of failures seen one at a time.

## Tests wait on events

In an async test, wait for an event or condition the code sets, with a generous timeout. Never wait with a fixed sleep
for work in another task, and never race a reload against a state change.

**Why:** fixed sleeps green hundreds of times locally failed on the slower runner and stopped releases (2026-10-07,
2026-10-24).

## Dates are locale-shaped

A check that compares rendered text never includes a formatted date or number: assert the claim, or build the
expectation with the same formatter.

**Why:** the runner formats dates en-US; a check green locally stopped a release.

**How to apply:** before removing an odd-looking fallback in an assertion, read its history.

## Diff the resolver config

When a build differs between machines, diff the package resolver's configuration (`npm config list`, `~/.npmrc`,
`npm_config_*` variables) before the tool versions.

**Why:** a personal `legacy-peer-deps=true` had resolved every committed lockfile; the runner was right. The repository
`.npmrc` now pins it off.

## Moving files silences guards

Moving or renaming a folder can turn checks into skips that still read as success. After a reorganisation, compare
skip counts, not the green.

**Why:** a reorganisation turned seven passing checks into seven skips and the suite stayed green.

**How to apply:** a blank result is not a pass: print the denominator.

## A killed mutation run

When a mutation run is killed, read its in-progress marker first: the named file may still carry its mutant, and a
green suite is not evidence the tree is clean. Repair by hand (assert the count, replace back), never with
`git checkout`, which also throws away uncommitted work.

**Why:** two killed runs left live mutants (one removed the line that clears a Telegram button) that every test passed.

**How to apply:** never `git add` while a mutation run is going; before a commit, `git diff --cached --name-only` and
account for every file. Try a git hook in a throwaway clone, never on the working branch.

## Scripted edits get a trial

Never let a scripted transform write the real file on its first run: write a trial beside it, run it, compare with a
capture taken before, then overwrite. A line-count change far larger than the edit is a stop.

**Why:** a greedy regex deleted every assertion in 30 files in one pass; a script that exited early discarded edits its
own output reported as applied.

**How to apply:** write after each successful replacement, or verify the file after. A gate that only parses does not
prove the code runs.

## Formats outlive their writer

Before changing the shape of anything the app writes into the owner's folders, ask what is already out there in the
old shape. A file the app wrote in a format it no longer reads is migrated (backed up and replaced); a file the owner
wrote is refused loudly, never overwritten.

**Why:** seeded skills written in an old format all failed to load after a format change, while a fresh install was
fine.

**How to apply:** a marker records WHAT was given, not THAT it happened. A new rule inside a nightly-built artefact is a
format change too: rebuild an older artefact at start-up. A changed default does nothing on an install that saved its
whole config: rename the key when its meaning or default changes.

## Placeholders, never real ids

In comments, docstrings and fixtures, write a shaped placeholder, never a real id from the villa, even while explaining
why real ids must not ship.

**Why:** the most vivid real id kept being written into tracked source, inside the very comment explaining the rule.
