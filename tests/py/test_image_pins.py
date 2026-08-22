"""The SDK is pinned while the base tags float, and that must stay true.

⚠️ THE INCONSISTENCY IS DELIBERATE AND THEREFORE FRAGILE. A reader tidying the
Dockerfile could reasonably "fix" one to match the other, in either direction,
and both directions are wrong: a floating base takes security patches
automatically, a floating SDK means the villa's supervision changes because a
package was published, with no release here to explain it.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCKERFILE = os.path.join(REPO_ROOT, "Dockerfile")


def _source() -> str:
    with open(DOCKERFILE, encoding="utf-8") as handle:
        return handle.read()


def test_the_anthropic_sdk_is_pinned_to_an_exact_version() -> None:
    """⚠️ `==`, never `>=` or `~=`. The SDK decides retry behaviour, streaming
    and tool-call shapes; a range means agent behaviour can move without a
    release, and the eval corpus never gets run against the change."""
    source = _source()
    assert "anthropic" in source, "the SDK is not installed at all"
    pin = re.search(r"anthropic\s*==\s*([0-9]+\.[0-9]+\.[0-9]+)", source)
    assert pin, (
        "anthropic must be pinned with `==` and a full version. A range or a "
        "bare name lets agent behaviour change because a package was published.")
    for loose in (r"anthropic\s*>=", r"anthropic\s*~=", r"anthropic\s*>",
                  r"anthropic['\"]\s*$"):
        assert not re.search(loose, source, re.MULTILINE), (
            f"anthropic is installed loosely ({loose}) — pin it")


def test_pip_is_available_for_that_install() -> None:
    assert "py3-pip" in _source(), (
        "pip install needs py3-pip from apk; without it the build fails at the "
        "layer, which is loud, but the reason is two lines away")


def test_only_ONE_pip_dependency_is_installed() -> None:
    """⚠️ TASK-030's constraint: do not add any other dependency here. The
    backend has had exactly one third-party dependency for its whole life, and
    each addition is a decision worth making on its own."""
    installs = re.findall(r"pip install[^\n]*", _source())
    assert len(installs) <= 1, f"more than one pip install line: {installs}"
    if installs:
        named = re.findall(r"'([a-zA-Z0-9_.-]+)==", installs[0])
        assert named == ["anthropic"], (
            f"only the SDK may be pip-installed here; found {named}")


def test_the_base_tags_still_FLOAT() -> None:
    """The other half of the inconsistency. Pinning these would silently stop
    the image taking security patches."""
    source = _source()
    assert "base:latest" in source, "the HA base tag must stay floating"
    assert "node:24-alpine" in source, "the build stage tag must stay floating"
    assert "@sha256:" not in source, (
        "a digest pin on a base image stops security patches arriving")


def test_the_deliberate_inconsistency_is_EXPLAINED_in_the_file() -> None:
    """⚠️ Otherwise the next reader tidies it. The comment is what makes this
    survive a cleanup."""
    source = _source()
    assert "PINNED, WHILE THE BASE TAGS ABOVE DELIBERATELY FLOAT" in source
