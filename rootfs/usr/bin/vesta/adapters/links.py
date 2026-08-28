"""A link from a delivered brief back into the VESTA kiosk.

Asked for in one line: "you can add links in the report to link to relevant
pages in VESTA KIOSK (NEVER link to Home assistant directly)" — and then, on the
build: "while making sure this would respect the cybersecurity good practice".
Six decisions follow from that second sentence, and each one narrows what this
module is allowed to do.

⚠️ 1. IT NEVER LEAKS THE VILLA'S INTERNAL TOPOLOGY. Home Assistant knows two
URLs, and only one of them may travel. `external_url` is already public by
construction — it is what the owner published. `internal_url` is a LAN address
(`http://192.168.1.40:8123`), and putting that in a message bound for Telegram
tells a third-party server the shape of a private network, for a link that would
not resolve for the reader anyway. So: external only, and **no link at all**
when only the internal one exists. A missing link is a missing convenience; a
leaked one is permanent.

⚠️ 2. HTTPS ONLY. An `http://` external URL means credentials and session
cookies cross the internet in clear, and a brief that hands someone a plaintext
login link is teaching the wrong habit at the worst moment.

⚠️ 3. THE PATHS ARE A CLOSED SET, NEVER BUILT FROM DATA. `PAGES` is a literal
table. No entity id, room name, finding label or config value reaches a URL, so
there is no path traversal, no open redirect and no query-string injection —
because there is no user input in the construction at all. A future "link to
this device" feature must add a PAGE, not interpolate an id.

⚠️ 4. NO SECRET IS EVER IN THE URL. No token, no signature, no session handle.
The link is a plain address; Home Assistant authenticates the person when they
arrive, which is the only place that check belongs. A self-authenticating link
in a chat message is a bearer token in somebody's message history.

⚠️ 5a. AND PERCENT-ENCODED, BECAUSE APPENDING AFTER THE SANITISER WAS ONLY HALF
THE PROBLEM AND I SHIPPED THE OTHER HALF. Rule 5 below is right that the body
must be sanitised in full and this line added afterwards. What it missed is that
"after the sanitiser" also means "UNSANITISED" — the URL then reaches the
destination carrying a markup-active character, and the destination has a parser
too. A delivered brief proved it: `/api/hassio_ingress/…` arrived as
`/api/hassioingress/…`, the underscore consumed by the platform's own markdown,
producing a link that 404s. `inert` was innocent — it maps `_` to a SPACE and
would have produced "hassio ingress".

So every markup-active character in the URL is percent-encoded. That is a
URL-LEGAL transformation, decoded back by any HTTP server before routing, and it
is invisible to a markdown parser because `%5F` contains nothing to parse. It is
also the only fix that does not depend on which platform the owner configured.

⚠️ 5. IT IS APPENDED AFTER `style.inert()`, NOT EXEMPTED FROM IT. `inert()`
strips `_ * ~ ` [ ] < >` from the whole message, so an ingress path
(`/api/hassio_ingress/…`) arrives as "hassio ingress" — a dead link. The obvious
fix is to teach `inert()` to skip URLs, and it is the wrong one: that turns a
"remove every markup-active character" rule into "remove them unless the
surrounding text looks like a URL", and the villa's own device names are inside
that text. Instead the body is sanitised in full, and this module's output —
which is generated here from Home Assistant's own config and contains nothing a
villa can influence — is added afterwards. The dangerous text stays sanitised;
the trusted text never needed it.

⚠️ 6. IT NEVER REACHES A NARRATION PROVIDER. `PAYLOAD_ALLOWED_FIELDS` is an
allow-list built by looping over permitted names, so a URL cannot appear in a
payload without being added there — and it must not be. The provider writes
prose about numbers; a URL would hand an external service the address of the
owner's home instance for no benefit at all. `test_links` asserts it is absent.
"""

from __future__ import annotations

from typing import Any, Dict
from urllib.parse import urlsplit

#: Kiosk destinations a brief may point at. ⚠️ A CLOSED SET — see rule 3.
#: Keys are stable identifiers used by the renderer; values are paths inside the
#: kiosk SPA, which is what the add-on serves. Never a Home Assistant page.
PAGES: Dict[str, str] = {
    "cockpit": "",            # the kiosk opens on the villa view; Cockpit is a tab
}
#: ⚠️ ONE KEY, BECAUSE ONE LINK IS EVER BUILT. `footer()` is the only caller of
#: `kiosk_url` and it asks for "cockpit" — see its own docstring for why a
#: brief carries one address rather than one per section. "facility" and
#: "briefings" were decorative: both mapped to the same empty path, so they
#: could only ever have produced the identical URL, and nothing asked for them.
#: A key here is a PROMISE that a destination is reachable; an unused one is a
#: promise nobody checks. Adding one back is fine — it is a literal, which is
#: rule 3 — but it needs a caller in the same change.


def _base(ha_config: Any, ingress_entry: str) -> str:
    """The kiosk's own address, or "" when it cannot be given out safely.

    ⚠️ EVERY REFUSAL HERE IS DELIBERATE AND SILENT-BY-DESIGN. There is no
    fallback to the internal URL and no downgrade to http: the caller renders
    nothing, and a brief without a link is exactly as correct as it was before
    links existed. Failing closed is the whole point of the rule set above.
    """
    if not isinstance(ha_config, dict):
        return ""
    external = str(ha_config.get("external_url") or "").strip()
    if not external:
        return ""
    parts = urlsplit(external)
    # Rule 2: https only. Rule 1: nothing else is offered as a substitute.
    if parts.scheme != "https" or not parts.netloc:
        return ""
    entry = str(ingress_entry or "").strip()
    if not entry.startswith("/"):
        return ""
    return f"{parts.scheme}://{parts.netloc}{entry.rstrip('/')}"


def reason(ha_config: Any, ingress_entry: str) -> str:
    """Why no link was produced — one short, FIXABLE sentence, or "".

    ⚠️ FAIL-CLOSED WITHOUT THIS IS FAIL-SILENT, AND THAT IS A DIFFERENT BUG.
    The owner ran a version that had links, received a brief with none, and
    asked where they were — the refusal was correct and unreadable. A rule that
    withholds something has to be able to say so, or the person who could
    satisfy it never learns it exists. Same principle as `capabilities_missing`:
    absence is stated, never implied.

    ⚠️ ONLY WHEN THE OWNER CAN ACT. "No ingress entry" means the Supervisor did
    not answer at boot — that is this add-on's problem, not theirs, and telling
    them would be noise they cannot use. An unset or plaintext external URL is a
    Home Assistant setting they own.
    """
    if not isinstance(ha_config, dict):
        return ""
    external = str(ha_config.get("external_url") or "").strip()
    if not external:
        # ⚠️ THE COMMON CASE ON THIS PRODUCT'S OWN TARGET, and worth saying
        # plainly: a villa with no WAN has no external URL, so it will never get
        # a link, and that is correct rather than broken. The alternative — the
        # LAN address — must not travel to a chat platform (rule 1).
        return ("No link to the kiosk is included: Home Assistant has no "
                "external URL set, and the local address must not be sent to a "
                "messaging service.")
    if urlsplit(external).scheme != "https":
        return ("No link to the kiosk is included: Home Assistant's external "
                "URL is not https, and a plaintext login link is not sent.")
    return ""


#: Characters a notify platform may parse as markup, percent-encoded so it
#: cannot. ⚠️ DERIVED FROM `style._MARKUP_ACTIVE` RATHER THAN RETYPED — the two
#: must name the same set, and a second hand-written list is how they drift.
def _safe_url(url: str) -> str:
    """A URL no markdown dialect can chew on.

    ⚠️ THE PATH AND QUERY ONLY. Percent-encoding the scheme or host would
    produce something no client resolves; those cannot contain a markup-active
    character in a valid URL anyway.
    """
    from vesta.shared.style import _MARKUP_ACTIVE
    parts = urlsplit(url)
    tail = "".join(f"%{ord(c):02X}" if c in _MARKUP_ACTIVE else c
                   for c in parts.path)
    return f"{parts.scheme}://{parts.netloc}{tail}"


def kiosk_url(page: str, ha_config: Any, ingress_entry: str) -> str:
    """An absolute link to one kiosk page, or "" if it cannot be built safely."""
    if page not in PAGES:
        return ""
    base = _base(ha_config, ingress_entry)
    if not base:
        return ""
    path = PAGES[page]
    return _safe_url(f"{base}/{path.lstrip('/')}" if path else base)


def line(prompt: str, ha_config: Any, ingress_entry: str) -> str:
    """`<prompt> VESTA: <url>` — the ONE shape every notification uses, or "".

    ⚠️ ONE RULE FOR EVERY MESSAGE (owner, 2026-08-28: "make sure all the
    notification uses this same rule"). A brief said "Open VESTA Kiosk:" and an
    alert said something else; two shapes for one destination is two things to
    keep in step and two ways for a reader to learn the same tap.

    ⚠️ THE WORD "VESTA" IS NOT A HYPERLINK, AND CANNOT BE HERE. The owner asked
    for one — "do the hyperlink on VESTA" — and it needs `[VESTA](url)` or an
    `<a href>`, which needs the message PARSED. Two rules paid for with real
    field failures stand against it, and both are in this repository's history:

      * `deliver` sets `parse_mode` to each service's NO-PARSING option, because
        the reference villa's Telegram defaults to markdown and silently ate the
        underscores out of delivered device names (`criticalschedule---poolpump`
        for `critical_schedule---pool_pump`). Turning parsing back on to gain a
        link re-opens that for every villa-derived word in the same message.
      * `style.inert` STRIPS `[ ] < >` from the body for the same reason, after
        a real friendly name opened an italic that never closed and cost a day
        of failed deliveries (HTTP 500 from the notify platform).

    Escaping instead would mean a per-dialect table (markdown / markdownv2 /
    html), which `discovery._plain_mode`'s own comment names as the platform
    table this design exists to avoid. So the URL travels as itself — Telegram
    auto-links a bare URL with parsing OFF, which is why the current one is
    tappable — and the sentence in front of it is as short as it can be.
    """
    url = kiosk_url("cockpit", ha_config, ingress_entry)
    text = " ".join(str(prompt or "").split())
    return f"{text} VESTA: {url}" if url and text else ""


def html_line(prompt: str, ha_config: Any, ingress_entry: str) -> str:
    """`<prompt> <a href="url">VESTA</a>` — the same line, as a real hyperlink.

    ⚠️ ONLY FOR A TRANSPORT WHOSE PARSE MODE WE SET OURSELVES, which today means
    `buttons._send_one` (`telegram_bot.send_message` publishes a `parse_mode`
    field; `notify.send_message` publishes none, so on that path the villa's own
    integration setting decides and this markup would arrive as literal tags).
    `line()` remains the plain form for exactly that reason.

    ⚠️ HTML, NEVER MARKDOWN, AND THAT IS MEASURED RATHER THAN PREFERRED
    (2026-08-28, three probes to the owner's phone). Markdown with a real device
    name and this very URL returned **HTTP 500** — `Timmerflotte_8343` and the
    ingress path both carry underscores, and one unclosed italic kills the whole
    message. The same content as HTML rendered bold, a tappable VESTA, and the
    name INTACT: in HTML an underscore is an ordinary character. That is the
    entire reason this function exists and the reason it may not be "improved"
    into markdown.

    ⚠️ THE URL IS ALREADY PERCENT-ENCODED by `_safe_url`, so it carries no `"`
    to close the attribute early, and the prompt is our own literal. Nothing
    villa-derived reaches this line — the body it is appended to is escaped by
    the caller.
    """
    url = kiosk_url("cockpit", ha_config, ingress_entry)
    text = " ".join(str(prompt or "").split())
    return f'{text} <a href="{url}">VESTA</a>' if url and text else ""


def html_escape(text: str) -> str:
    """Make villa-derived text safe inside an HTML-parsed message.

    ⚠️ THREE CHARACTERS, ONE DIALECT, NO TABLE. `discovery._plain_mode` rejects
    escaping because it would mean knowing which dialect each platform speaks —
    true when the mode is the villa's to choose. Where WE set the mode there is
    exactly one dialect, and HTML's is the smallest: `&` first (or it would
    double-escape the others), then `<` and `>`.

    ⚠️ IT DOES NOT REPLACE `style.inert`, which still runs at the routing
    boundary for every transport. This is the belt to that braces: inert has
    already removed `<` and `>` from villa strings, and this catches an `&` it
    does not touch, plus anything a future renderer adds after it.
    """
    return (str(text or "").replace("&", "&amp;")
            .replace("<", "&lt;").replace(">", "&gt;"))


def footer(ha_config: Any, ingress_entry: str) -> str:
    """The one line a brief appends, or "" when no safe link exists.

    ⚠️ ONE LINK, NOT ONE PER SECTION. A notification is read in a list preview
    and skimmed on a lock screen; a link after every heading is noise that makes
    the brief harder to read, which is the opposite of why it was asked for. The
    kiosk opens on the villa and its tabs are one tap away, so one address does
    the job of nine.
    """
    return line("Open", ha_config, ingress_entry)
