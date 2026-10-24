# Working with the villa's system

How to read and change the villa's automation platform through its MCP server, generically. The villa's own ids,
names and notes stay in a private, gitignored folder and never enter the repository.

## The MCP tools only

Read and change the villa's system only through the MCP tools in the session. Never call the MCP from a script, never
read the client's own configuration file to find its address or token, and never repeat a secret in a reply.

**Why:** the owner's standing rule: one audited path to the live system.

**How to apply:** read installed app versions with the installed-apps listing (`source="installed"`), not by guessing
a slug.

## Write the config yourself

Blueprints are written with the blueprint tool's save (overwrite), never handed to the owner to paste. After ANY
blueprint change, check its consumers: none unavailable, the "used by" count, and the system log for a blueprint that
failed to generate.

**Why:** a long blueprint pasted by hand was cut mid-file and every safety alert built on it went unavailable at once.

**How to apply:** if the owner must edit by hand, give a short diff, never a whole file.

## Edit the villa's copy

Always read a blueprint from the villa (the blueprint tool's `get`, or the file read) and edit THAT text; local copies
are out of date. This holds for reading too: to explain what an automation does, read the installed version.

**Why:** an edit made from a local copy was saved over the villa's newer one.

**How to apply:** get, edit the returned YAML, save with overwrite, read it back and compare. The blueprint's "used by"
comes from its `get`: a config search does not look inside blueprint paths.

## Blueprint texts are short

A blueprint's own description says what it is for in three lines at most, each field one meaningful sentence. History,
dates and mechanics go in the one `HISTORY.md` beside the blueprints. Layout: an open "Common" section, then one
collapsed section per mode named "<X> mode", the mode select's labels matching.

**Why:** owner, 2026-10-20: changelog-heavy descriptions "clutter massively the UI". The save strips `#` comments and
rejects extra keys, hence the separate history file.

**How to apply:** input names and defaults never change; prove each automation renders identically after an edit.

## Helpers live in package files

Never create a helper (number, boolean, template sensor, history stats…) through the UI or the storage API. Every
helper is defined in a file under the config's `packages/`, named for its feature, and everything one feature creates
shares one prefix.

**Why:** owner, 2026-10-18: "make sure there is always a file that creates it in the packages folder". A file shows the
whole definition, survives, and can be reviewed.

**How to apply:** write the file with the managed YAML tool (preview, then confirm), let the configuration check pass,
then reload or restart. Changing a helper's VALUE is fine; creating or redefining one is a file change. A new YAML
number starts at its minimum: set it once after the restart.

## Know what a reload resets

Before a reload (templates, automations, a blueprint save, which reloads its automations), list what it resets: a
template reload re-creates every template entity, so each one's "last changed" becomes now, and anything judging
"quiet for N hours" from it restarts its clock. When behaviour is unchanged, write the file, pass the check, and let
the next restart apply it.

**Why:** 2026-10-24, two reloads made the villa read "not empty" for an hour each while nobody was in.

**How to apply:** say the side effect before the reload. After changing the words a villa message sends, read the
Agent's log at the next such alert for lines that stayed untranslated.

## Fetch what you know

When the target is known, fetch it: one blueprint by its path (an automation's config names it), one entity, a history
window near the moment with a small limit. Never list everything first.

**Why:** a 59 KB list and a 54 KB get to read one field; a 4-day history read cost about 25k tokens to answer "when did
it come back?".

## Read the logbook in day windows

Read the logbook in 24-hour windows with an explicit end time. Never call something "missing from the logbook" from
one long read.

**Why:** an 80-hour read returned only the first day with no sign of being cut; the instrument cut, not the platform.

## The suffix is not the duplicate

When two registrations share a name, the `_2` one may be the live one: the platform adds `_2` to whichever came
second. Compare app and software versions and the last real change before calling one redundant; after deleting a
device or registration, re-read every person that tracked it.

**Why:** the live phone was removed as "the duplicate", and deleting the dead one also removed its tracker from a
person, which would have stopped presence from ever reading empty.

## Use the platform's own features

Before building any reporting, history, activity, alert or analytics feature, check whether the villa's system already
provides it, and consume its API rather than re-deriving it. Fetch, filter to what the profile may see, and render in
the app's own UI; embedding the platform's own panels is usually wrong (separate sign-in, no role filtering).

**Why:** owner, 2026-08-04: "always make sure you never re-code/invent a feature that is already developed and
maintained in Home Assistant."

## App packaging facts

- The watchdog switch defaults to off; when on, the Supervisor restarts an app whose container is failed, stopped or
  unhealthy. Health is a Docker `HEALTHCHECK` (the old `watchdog:` key is obsolete).
- The add-on linter refuses any key written at its default value; our own checks read the effective value.
- Changing a default port changes every install that never set it, on its next update.
- Base images are not pinned (owner, 2026-10-05): floating, plus a start-up test in CI.
