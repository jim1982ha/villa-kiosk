"""The stub: stands in for the VESTA Agent until it is delivered (SPEC 2).

It follows the rules placed on the real agent (SPEC 8): configuration only from
the environment contract, logs to stdout, no secret printed, stops on SIGTERM,
never contacts Telegram while VESTA_TELEGRAM_ENABLED is false. It does nothing
else: the host has already run the self-test before starting it.

With VESTA_STUB_HEARTBEAT=true it posts a heartbeat to the VESTA Kiosk every
minute, so the Kiosk keeps showing the agent online — the end-to-end presence
test. A single heartbeat would read "online" for a few minutes and then lapse.
"""
import json
import os
import signal
import threading
import urllib.error
import urllib.request

INTERVAL = 60
CONTRACT = (
    "ANTHROPIC_API_KEY", "VESTA_HA_URL", "VESTA_HA_TOKEN", "VESTA_HA_MCP_URL",
    "VESTA_HA_MCP_SECRET", "VESTA_KIOSK_URL", "VESTA_KIOSK_TOKEN",
    "VESTA_CF_ACCESS_CLIENT_ID", "VESTA_CF_ACCESS_CLIENT_SECRET",
    "VESTA_TELEGRAM_ENABLED", "VESTA_SKILLS_DIR", "VESTA_AGENT_CONFIG_DIR",
    "VESTA_DATA_DIR", "VESTA_LOG_LEVEL", "TZ", "VESTA_DEPLOYMENT", "VESTA_INSTANCE",
)

stop = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())


def say(msg):
    print(f"stub: {msg}", flush=True)


def heartbeat():
    url = os.environ["VESTA_KIOSK_URL"].rstrip("/") + "/agent/v1/heartbeat"
    headers = {"Authorization": f"Bearer {os.environ.get('VESTA_KIOSK_TOKEN', '')}",
               "Content-Type": "application/json"}
    cid = os.environ.get("VESTA_CF_ACCESS_CLIENT_ID")
    if cid:
        headers["CF-Access-Client-Id"] = cid
        headers["CF-Access-Client-Secret"] = os.environ.get("VESTA_CF_ACCESS_CLIENT_SECRET", "")
    req = urllib.request.Request(url, data=json.dumps({"status": "stub"}).encode(),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    except OSError as e:
        return f"unreachable ({type(e).__name__})"


def main():
    # Names and set/empty only — never a value.
    missing = [n for n in CONTRACT if n not in os.environ]
    empty = [n for n in CONTRACT if n in os.environ and not os.environ[n]]
    say(f"environment contract received: {len(CONTRACT) - len(missing)}/{len(CONTRACT)} "
        f"variables present, {len(empty)} empty")
    if missing:
        say(f"MISSING from the contract: {', '.join(missing)}")
    telegram = os.environ.get("VESTA_TELEGRAM_ENABLED") == "true"
    if not telegram and "VESTA_TELEGRAM_BOT_TOKEN" in os.environ:
        say("ERROR: a Telegram token was given while Telegram is disabled")
    say(f"Telegram {'enabled' if telegram else 'disabled — no token received, no call made'}")

    beating = os.environ.get("VESTA_STUB_HEARTBEAT") == "true" and os.environ.get("VESTA_KIOSK_TOKEN")
    say(f"heartbeat every {INTERVAL} s" if beating else "no heartbeat (stub_heartbeat off or no Kiosk token)")
    last = None
    while True:
        if beating:
            outcome = heartbeat()
            if outcome != last:          # log changes, not every minute
                say(f"heartbeat: {outcome}")
                last = outcome
        if stop.wait(INTERVAL):
            break
    say("stopped")


if __name__ == "__main__":
    main()
