"""The VESTA mark on every HTML page the agent sends.

A report is a single HTML file sent on Telegram and opened on a phone, printed
or saved, often with no internet: it has no server to fetch an icon from. A page
without one showed the browser's blank tab icon (owner, 2026-10-02). The mark
is therefore carried INSIDE the page, as data: URIs, and added here, on the
one path every document leaves the agent by (telegram.TelegramBot.send) — so
any skill's page gets it, today's reports and whatever a skill writes next,
with no skill to edit.

The icons are the VESTA Kiosk's own (public/favicon.svg, favicon-dark.svg,
icons/favicon-32x32.png), copied here because the agent's image does not
contain the Kiosk; tests/test_favicon.py fails the day the two drift apart.
"""

from __future__ import annotations

import re
from urllib.parse import quote

FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect width="100" height="100" rx="22" fill="#FFFDF9"></rect>\n  <g transform="translate(0 4) scale(1)">\n  <path d="M18 15 H33.5 L52 78 H44 Z" fill="#1F5C33"></path>\n  <path d="M84 15 H62.5 L44 78 H52 Z" fill="#4C9A5E"></path>\n  </g>\n</svg>'

FAVICON_DARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect width="100" height="100" rx="22" fill="#17191A"></rect>\n  <g transform="translate(0 4)">\n  <path d="M18 15 H33.5 L52 78 H44 Z" fill="#FFFFFF"></path>\n  <path d="M84 15 H62.5 L44 78 H52 Z" fill="#4C9A5E"></path>\n  </g>\n</svg>'

# For the browsers that ignore an SVG icon (Safari before 26, older WebViews).
FAVICON_PNG_32_B64 = (
    "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"
    "SUVORK5CYII="
)

_HTML = re.compile(r"\.html?$", re.I)
_HAS_ICON = re.compile(r"<link\b[^>]*\brel\s*=\s*[\"']?[^\"'>]*\bicon\b", re.I)
_HEAD = re.compile(r"<head\b[^>]*>", re.I)
_HTML_TAG = re.compile(r"<html\b[^>]*>", re.I)
_DOCTYPE = re.compile(r"<!doctype[^>]*>", re.I)


def _svg_uri(svg: str) -> str:
    # Quotes MUST be escaped (the URI sits in a double-quoted href) and `#`
    # too (it would start a fragment and cut the colour off).
    return "data:image/svg+xml," + quote(" ".join(svg.split()), safe=" =:/,.-")


def favicon_links() -> str:
    """The <link> tags: the mark in the reader's light or dark theme, then the PNG fallback."""
    return (
        f'<link rel="icon" type="image/svg+xml" media="(prefers-color-scheme: light)" href="{_svg_uri(FAVICON_SVG)}">'
        f'<link rel="icon" type="image/svg+xml" media="(prefers-color-scheme: dark)" href="{_svg_uri(FAVICON_DARK_SVG)}">'
        f'<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,{FAVICON_PNG_32_B64}">'
    )


def is_html(filename: str) -> bool:
    return bool(_HTML.search(filename or ""))


def with_favicon(html: str) -> str:
    """`html` with the VESTA mark at the top of its <head>.

    A page that declares its own icon keeps it: a skill may brand its page. A
    page without a <head> gets the links right after <html> (or its doctype),
    where a browser still reads them."""
    if _HAS_ICON.search(html):
        return html
    links = favicon_links()
    for tag in (_HEAD, _HTML_TAG, _DOCTYPE):
        m = tag.search(html)
        if m:
            return html[:m.end()] + links + html[m.end():]
    return links + html


def document_bytes(path: str) -> bytes:
    """The file as it is sent: an HTML page with the mark added, anything else untouched.

    A page that is not UTF-8 is sent as it is rather than risk mangling it."""
    with open(path, "rb") as f:
        data = f.read()
    if not is_html(path):
        return data
    try:
        return with_favicon(data.decode("utf-8")).encode("utf-8")
    except UnicodeDecodeError:
        return data
