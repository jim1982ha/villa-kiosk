#!/usr/bin/env python3
"""The two hard rules, checked against EVERYTHING THAT SHIPS.

⚠️ THE SCOPE IS THE FIX. The equivalent guard on the `dev` branch greps `src/`
only — so the CSP in `rootfs/etc/nginx/nginx.conf` granting `fonts.googleapis.com`
sat in shipped configuration for eight versions with a check running on every
push that could not see it. A guard scoped to where the last defect was found,
rather than to everything the rule applies to, is the "audit the applicable set"
failure happening inside the check written to prevent it.

⚠️ IT WALKS `git ls-files`. What ships is what is tracked, so a new top-level
directory is covered without anyone remembering to add it here.

⚠️ AND IT IS PYTHON, NOT SHELL, BECAUSE OF COMMENT STRIPPING. The first version
used `sed` and reported ten violations that were all prose — JSDoc continuation
lines and JSX `{/* … */}` blocks look exactly like code to a line-oriented
filter. A guard whose failures are noise is a guard that gets switched off.

Run: python3 tests/hard-rules.py   (also `npm run test:hard-rules`)
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Prose states what the code must not DO; a hostname quoted in a sentence is
#: not a dependency. Lock files and binaries carry no fetch. `.github/` is CI —
#: it is never in the image.
SKIP_FILES = re.compile(
    r"(^|/)(CHANGELOG\.md|DOCS\.md|README\.md|package-lock\.json)$|"
    r"\.(png|jpg|jpeg|ico|woff2|glb|wasm|svg|map)$|"
    r"^\.github/")

#: The LAN this add-on exists to talk to, plus one XML namespace identifier that
#: is never fetched. `github.com` is permitted ONLY in the two descriptors whose
#: job is to name the repository to Home Assistant.
LAN_OR_INERT = re.compile(
    r"localhost|127\.0\.0\.1|0\.0\.0\.0|w3\.org|//supervisor|homeassistant\.local",
    re.I)
REPO_LINK_OK = re.compile(r"(repository\.yaml|config\.yaml)$")

HOSTS = re.compile(r"https?://[A-Za-z0-9.-]+")
PROVIDERS = re.compile(
    r"https?://[A-Za-z0-9.-]*"
    r"(openai|anthropic|googleapis|azure|cohere|mistral|groq|openrouter)"
    r"[A-Za-z0-9.-]*", re.I)

DOMAINS = ("light|switch|sensor|binary_sensor|lock|cover|climate|camera|fan|"
           "media_player|scene|automation|script|input_boolean|vacuum|valve|"
           "water_heater|humidifier|alarm_control_panel|assist_satellite|"
           "update|number|select|button|todo|person|device_tracker")
ENTITY_ID = re.compile(rf'"({DOMAINS})\.[a-z0-9_]{{3,}}"')


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout
    return [f for f in out.split() if not SKIP_FILES.search(f)]


def strip_comments(src: str) -> str:
    """Blank out every comment, keeping line numbers intact.

    ⚠️ BLANKED, NOT DELETED — a reported line number that does not match the
    file is a finding nobody can act on. Handles `//`, `/* … */` across lines
    (which covers JSDoc) and JSX `{/* … */}`, because all three are how this
    repo writes its reasoning down and all three contain example ids.
    """
    out, i, n = [], 0, len(src)
    while i < n:
        if src.startswith("/*", i):
            end = src.find("*/", i + 2)
            end = n if end == -1 else end + 2
            out.append("".join(c if c == "\n" else " " for c in src[i:end]))
            i = end
        elif src.startswith("//", i):
            end = src.find("\n", i)
            end = n if end == -1 else end
            out.append(" " * (end - i))
            i = end
        else:
            out.append(src[i])
            i += 1
    return "".join(out)


def main() -> int:
    files = tracked()
    fail = 0
    print(f"  scanning {len(files)} tracked, shipped files\n")

    # ── 1 & 2: what may be fetched ────────────────────────────────────────
    providers: list[str] = []
    third_party: list[str] = []
    for rel in files:
        try:
            text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for num, line in enumerate(text.split("\n"), 1):
            for m in PROVIDERS.finditer(line):
                providers.append(f"{rel}:{num}  {m.group(0)}")
            for m in HOSTS.finditer(line):
                host = m.group(0)
                if LAN_OR_INERT.search(host):
                    continue
                if "github.com" in host and REPO_LINK_OK.search(rel):
                    continue          # the descriptor's whole job is this link
                third_party.append(f"{rel}:{num}  {host}")

    # ── 3: no villa hardcoded into a redistributable add-on ───────────────
    # ⚠️ THE SHAPE ONLY, AND IN CODE ONLY. A generic example inside a comment is
    # how this repo documents itself; the same string in an expression is one
    # property baked into an add-on meant for any of them.
    ids: list[str] = []
    for rel in files:
        if not rel.startswith("src/") or not rel.endswith((".ts", ".tsx")):
            continue
        code = strip_comments((ROOT / rel).read_text(encoding="utf-8"))
        for num, line in enumerate(code.split("\n"), 1):
            if ENTITY_ID.search(line):
                ids.append(f"{rel}:{num}")

    # ── 4: the five clauses no regex can find ─────────────────────────────
    # ⚠️ THE TOKEN LIST IS LOCAL AND UNTRACKED, BECAUSE WRITING IT HERE WOULD BE
    # THE LEAK. Put the property's name, its Home Assistant hostname, its model
    # filename and anything else site-specific in `.scratch/forbidden-tokens.txt`,
    # one per line. The rule names six clauses — entity_id, room name, device
    # count, villa dimension, per-site constant, business value — and only the
    # first has a shape. This is how the other five get checked.
    # ⚠️ HASHES, SO THE CHECK CAN RUN WHERE THE PLAINTEXT CANNOT. The list of
    # tokens is gitignored — writing it into the repository would BE the leak —
    # so on every CI runner `.scratch/forbidden-tokens.txt` does not exist,
    # `exists()` was False by construction, and this clause printed SKIP and
    # exited 0. The one guard protecting the villa's name and hostname in a
    # PUBLIC repository had never run anywhere but one laptop, for the life of
    # the branch, while the line below correctly called SKIP "not a pass".
    #
    # SHA-256 of each token is tracked instead. It reveals nothing, and it works
    # because the comparison is WORD-WISE: every word-like run in a tracked file
    # is hashed and looked up. That catches a name, a hostname or a filename —
    # which is what the five unfindable clauses are made of — and deliberately
    # does not catch a token glued inside a longer identifier, which is the
    # price of not shipping the words themselves.
    token_file = ROOT / ".scratch" / "forbidden-tokens.txt"
    hash_file = ROOT / "tests" / "forbidden-token-hashes.txt"
    leaks: list[str] = []
    checked_tokens = 0
    token_hashes: set[str] = set()
    max_ngram = 1
    if hash_file.exists():
        raw_hashes = hash_file.read_text()
        token_hashes = {ln.strip() for ln in raw_hashes.split("\n")
                        if ln.strip() and not ln.startswith("#")}
        m = re.search(r"^# max-ngram: (\d+)", raw_hashes, re.M)
        # How many words the longest token has. A length is not a leak, and
        # without it the scan cannot know how wide a window to build.
        max_ngram = int(m.group(1)) if m else 1
    if token_file.exists():
        tokens = [t.strip() for t in token_file.read_text().split("\n")
                  if t.strip() and not t.startswith("#")]
        checked_tokens = len(tokens)
        # ⚠️ EVERY TRACKED FILE, NOT THE FILTERED SET. The prose exemption above
        # is right for a hostname quoted in an explanatory sentence and WRONG
        # for the villa's own identity: `villa-kiosk/CHANGELOG.md` is shipped in
        # the image AND rendered by the Supervisor in the add-on's Update
        # dialog, in a public repository. The first version of this guard
        # inherited the exemption and reported a clean pass over two real leaks.
        every = subprocess.run(["git", "ls-files"], cwd=ROOT,
                               capture_output=True, text=True,
                               check=True).stdout.split()
        for rel in every:
            try:
                text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            low = text.lower()
            for tok in tokens:
                if tok.lower() in low:
                    leaks.append(f"{rel}  ← a villa-specific token")
                    break

    def report(title: str, rows: list[str], ok_note: str) -> None:
        nonlocal fail
        if rows:
            print(f"  FAIL  {title}")
            for r in rows[:40]:
                print(f"          {r}")
            if len(rows) > 40:
                print(f"          … and {len(rows) - 40} more")
            fail += 1
        else:
            print(f"  PASS  {ok_note}")

    report("an LLM provider is reachable from shipped source", providers,
           "no provider host anywhere shipped")
    report("a third-party host is named in shipped source", third_party,
           "no third-party host anywhere shipped")
    report("an entity_id is hardcoded in executable code", ids,
           "no entity_id in executable code")

    if token_file.exists():
        report("a villa-specific token is in a shipped file", leaks,
               f"none of the {checked_tokens} villa tokens appears in a shipped file")
    elif token_hashes:
        # The hash path: hash every word-like run in every tracked file and look
        # it up. Same question as the plaintext path, asked without the words.
        every = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True,
                               text=True, check=True).stdout.split()
        hashed_leaks: list[str] = []
        for rel in every:
            fp = ROOT / rel
            if not fp.is_file():
                continue
            try:
                body = fp.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            # ⚠️ n-GRAMS, NOT SINGLE WORDS. A multi-word token — a property's
            # name, say — has no distinctive single word to catch when every
            # part is short and generic, so a word-wise scan misses it entirely.
            # Found by planting a real token and watching this check pass.
            words = [w.lower() for w in re.findall(r"[A-Za-z0-9_.-]+", body)]
            cands = set(words)
            for n in range(2, max_ngram + 1):
                for i in range(len(words) - n + 1):
                    cands.add(" ".join(words[i:i + n]))
            for cand in cands:
                if hashlib.sha256(cand.encode()).hexdigest() in token_hashes:
                    # The MATCH is not printed — that would put the villa's own
                    # vocabulary into a public CI log, which is the leak this
                    # clause exists to prevent. The filename is enough to find it.
                    hashed_leaks.append(f"{rel}: a villa-specific token")
                    break
        report("a villa-specific token is in a shipped file", hashed_leaks,
               f"none of the {len(token_hashes)} villa tokens appears in a tracked file")
    else:
        # ⚠️ NOT A PASS, AND IN CI NOT EVEN A SKIP. An instrument that reports
        # success when it did not run is the failure this repository has
        # recorded five times over — and this clause did exactly that on every
        # runner until the hash list existed.
        print("  SKIP  the villa's own vocabulary is UNCHECKED — neither "
              f"{token_file.relative_to(ROOT)} nor "
              f"{hash_file.relative_to(ROOT)} is present.")
        print("        This is not a pass. The five clauses a regex cannot "
              "find were not looked at.")
        if os.environ.get("CI"):
            print("  FAIL  ...and this is CI, where the hash list is the only "
                  "way this clause can run at all.")
            fail += 1

    print()
    print("✅ both hard rules hold" if fail == 0 else "❌ A HARD RULE IS BROKEN")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
