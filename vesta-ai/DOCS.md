# VESTA AI Layer

A suggest-only layer that watches a property through Home Assistant and says
what needs attention. It has no user interface: everything it knows it publishes
as Home Assistant entities, and everything it has to say it sends through Home
Assistant's own notify services.

## What this release does

It installs, starts, connects, and reports its own health. There are no alerts,
no reports and no model behind it yet — those arrive in later releases. What you
can check today is that it is running and that both of its connections are up.

## Before you start

Install and configure the **ha-mcp** add-on, and set `auto_update: false` on it.
Everything this layer asks about your property goes through ha-mcp; it ships
roughly every two weeks with no deprecation policy and moves its tool set in
minor releases, so an unattended update can change the contract underneath this
add-on.

## Configuration

Every option is empty or safe by default. The two that matter today are the
**ha-mcp address** and its **secret** — paste both from that add-on's own
configuration. The layer starts without them and tells you what it is missing,
in the attributes of its own status entity, rather than refusing to start.

The Anthropic API key is not used by this release at all.

## What you should see

A sensor called `VESTA AI Layer` appears in Home Assistant. Its state is one of:

| State | Meaning |
|---|---|
| `ok` | Both connections are up. |
| `degraded` | One connection is up and the other is not — read the `reason` attribute. |
| `down` | Neither connection is up. |
| `unavailable` | The add-on is stopped. |

Its attributes carry the two connections separately (`gateway`, `listener`), the
reason for anything that is not up, how many events it has been told about, and
the token meter's figures — which read zero in this release because nothing
calls a model.

`degraded` is deliberately not rounded up to `ok`. The gateway being down means
questions fail while events still arrive; a single healthy/unhealthy flag cannot
say that, and a half-working layer that looks healthy is worse than one that
looks broken.

## Where its state lives

In this add-on's own `/data` volume, as JSON files, which the Supervisor backs
up with the add-on. They are readable with `cat` on a property with no tooling —
which is the point.
