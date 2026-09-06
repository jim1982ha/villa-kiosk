"""The add-on's changelog must describe the version being shipped.

⚠️ IT WENT 21 RELEASES STALE AND NOTHING SAID SO (2.939.0 -> 2.960.0). Home
Assistant renders `villa-kiosk/CHANGELOG.md` in the Update dialog, so the owner
pressed Update on 2.960.0 and read release notes for 2.939.0 — the one surface
where the changelog is actually read, showing three weeks of nothing.

Every commit in this repository bumps the version in TWO files, and both bumps
were pinned. The third thing a release consists of was not, so the two pinned
halves stayed green while the half a human reads fell behind.

⚠️ THE CHANGELOG IS NOT GENERATED FROM COMMIT MESSAGES AND MUST NOT BE. A
commit message is written for whoever maintains this code; the Update dialog is
read by the villa's owner on their phone. They are different documents with
different readers, which is why this test asks whether an entry EXISTS and
never what it says.
"""

from __future__ import annotations

import os
import re
from typing import List

from conftest import REPO_ROOT

CHANGELOG = os.path.join(REPO_ROOT, "villa-kiosk", "CHANGELOG.md")
CONFIG = os.path.join(REPO_ROOT, "villa-kiosk", "config.yaml")
PACKAGE = os.path.join(REPO_ROOT, "package.json")

_HEADING = re.compile(r"^## (\d+\.\d+\.\d+)\s*$", re.MULTILINE)


def _versions() -> List[str]:
    with open(CHANGELOG, encoding="utf-8") as handle:
        return _HEADING.findall(handle.read())


def _shipping_version() -> str:
    with open(CONFIG, encoding="utf-8") as handle:
        match = re.search(r'^version:\s*"?([^"\s]+)"?', handle.read(), re.MULTILINE)
    assert match, "villa-kiosk/config.yaml declares no version"
    return match.group(1)


def test_the_changelog_describes_the_version_being_shipped() -> None:
    """⚠️ THE HEADING, NOT A MENTION. Supervisor shows the file from the top;
    an entry filed under an older heading is an entry the owner scrolls past."""
    shipping = _shipping_version()
    versions = _versions()
    assert versions, "villa-kiosk/CHANGELOG.md has no `## <version>` headings"
    assert versions[0] == shipping, (
        "the add-on ships %s and the changelog opens at %s. Home Assistant "
        "renders this file in the Update dialog, so the owner would press "
        "Update and read notes for a different release.\nAdd a `## %s` section "
        "at the TOP, written for the villa's owner rather than for a "
        "maintainer — what changed on the screens they use, and why it "
        "matters. The commit message is a separate document with a separate "
        "reader; do not paste it here." % (shipping, versions[0], shipping))


def test_the_three_halves_of_a_release_agree() -> None:
    """⚠️ TWO OF THESE WERE PINNED AND THE THIRD WAS NOT, which is exactly how
    the changelog fell 21 releases behind while every gate stayed green."""
    with open(PACKAGE, encoding="utf-8") as handle:
        match = re.search(r'"version":\s*"([^"]+)"', handle.read())
    assert match, "package.json declares no version"
    package_version = match.group(1)
    shipping = _shipping_version()
    assert package_version == shipping, (
        "package.json says %s and villa-kiosk/config.yaml says %s — Home "
        "Assistant offers an update only when config.yaml CHANGES, so these "
        "must move together." % (package_version, shipping))
    assert _versions()[0] == shipping, (
        "the changelog's top heading is %s, not %s" % (_versions()[0], shipping))


def test_the_changelog_has_no_duplicate_or_out_of_order_headings() -> None:
    """A repeated heading means two releases' notes are filed under one, and
    the second is unreachable from the dialog; a heading out of order means the
    newest notes are not at the top, which is the same failure by another
    route."""
    versions = _versions()
    duplicates = sorted({v for v in versions if versions.count(v) > 1})
    assert not duplicates, (
        "these versions have more than one heading, so one entry's notes are "
        "filed under another's: %s" % duplicates)

    def key(version: str) -> List[int]:
        return [int(part) for part in version.split(".")]

    out_of_order = [(a, b) for a, b in zip(versions, versions[1:])
                    if key(a) < key(b)]
    assert not out_of_order, (
        "the changelog is read from the top and these pairs run backwards: %s"
        % out_of_order)


def test_the_entry_for_the_shipping_version_is_not_empty() -> None:
    """⚠️ A HEADING ALONE SATISFIES THE TEST ABOVE. The cheapest way to pass a
    changelog gate is a version number with nothing under it, which reads to
    the owner as an update that did nothing."""
    with open(CHANGELOG, encoding="utf-8") as handle:
        text = handle.read()
    shipping = _shipping_version()
    start = text.index("## %s" % shipping)
    rest = text[start:]
    nxt = _HEADING.search(rest, pos=1)
    body = rest[:nxt.start()] if nxt else rest
    prose = [line for line in body.splitlines()[1:]
             if line.strip() and not line.startswith("#")]
    assert prose, (
        "`## %s` has a heading and no prose under it. The owner reads this in "
        "the Update dialog; a version number on its own says nothing about "
        "what they are installing." % shipping)
    assert sum(len(line) for line in prose) >= 80, (
        "`## %s`'s notes are %d characters — too short to tell the owner what "
        "changed on the screens they use."
        % (shipping, sum(len(line) for line in prose)))
