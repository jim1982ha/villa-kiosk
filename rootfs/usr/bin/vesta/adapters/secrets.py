"""Provider credentials, on disk, at 0600.

⚠️ A CREDENTIAL IS NOT CONFIGURATION, and the difference is the whole file. The
reports settings live in `reports-config.json`, which any authorized session can
GET — a guest's phone included. An API key in there would be readable by
everyone in the villa, so it lives in its own file that no handler serves.

Copies `supervisor-proxy.py`'s `_session_secret()` exactly: `/data`, created on
first use, `0600`, written through the same atomic path every other write here
uses. That precedent is cited by the plan for this phase and is followed rather
than improved upon.

⚠️ NOTHING HERE IS EVER LOGGED, RETURNED IN A DIAGNOSTIC, OR PUT IN AN ERROR.
`log.py` already refuses to print secrets; this module additionally never
carries the value anywhere it could be caught by a traceback formatter — the
key is read, used, and dropped. `configured()` answers "is there one" without
producing it, which is the only thing a UI or a diagnostic ever needs.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

from .log import swallow, warn
# ⚠️ THE MODULE, NOT THE NAME — `store.configure()` can repoint DATA_DIR after
# import, and a copy captured here would keep writing secrets to the old root.
from . import store as store_mod
from .store import write_json

SECRETS_FILE = f"{store_mod.DATA_DIR}/reports-secrets.json"

#: Owner-writable, nothing else. ⚠️ The MODE is the point of this module: the
#: same bytes in `reports-config.json` would be served to any signed-in session
#: by that store's open GET.
SECRET_MODE = 0o600


def _read() -> Dict[str, str]:
    """The stored credentials, or empty. Never raises, never logs a value."""
    try:
        with open(SECRETS_FILE, encoding="utf-8") as handle:
            raw: Any = json.load(handle)
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as err:
        # ⚠️ THE FILENAME AND THE ERROR CLASS, NEVER THE CONTENT. A JSON error
        # from a stdlib parser can quote the offending line, and the offending
        # line of this file is a credential.
        warn(f"could not read provider credentials ({type(err).__name__})")
        return {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if isinstance(v, str)}


def get(name: str) -> Optional[str]:
    """One credential, or None. The ONLY function that produces a value."""
    value = _read().get(name)
    return value or None


def configured(name: str) -> bool:
    """Is there a credential under this name?

    ⚠️ THE QUESTION A DIAGNOSTIC ACTUALLY HAS. Every caller that wants to say
    "a provider is set up" wants a boolean, and reaching for `get()` to test it
    puts the credential on the stack of whatever is asking — where a traceback,
    a repr or a debugger can pick it up. Two functions so the common case is
    the safe one.
    """
    return bool(_read().get(name))


def put(name: str, value: str) -> bool:
    """Store one credential. Returns whether it was written.

    ⚠️ 0600 IS APPLIED ON EVERY WRITE, not only on creation. A file created
    before this module existed, or restored from a backup that flattened
    permissions, would otherwise keep whatever mode it arrived with — and the
    failure is silent, because a too-permissive file reads back perfectly.
    """
    current = _read()
    if value:
        current[name] = value
    else:
        current.pop(name, None)
    try:
        write_json(SECRETS_FILE, current)
        os.chmod(SECRETS_FILE, SECRET_MODE)
        return True
    except Exception as err:  # noqa: BLE001 - never take a report down
        swallow("could not store provider credentials", err)
        return False


def redact(text: str) -> str:
    """Any stored credential, replaced. For anything about to be logged.

    ⚠️ A PROVIDER'S OWN ERROR TEXT IS THE LIKELIEST LEAK PATH, not our code.
    An HTTP client that fails mid-request routinely echoes the request — headers
    included — into the exception it raises, and that exception is exactly what
    a `swallow(...)` call is designed to write down. Passing provider errors
    through here is the difference between an add-on log and a credential in an
    add-on log an owner then pastes into a support thread.
    """
    out = text
    for value in _read().values():
        if value and len(value) >= 8:
            out = out.replace(value, "***")
    return out
