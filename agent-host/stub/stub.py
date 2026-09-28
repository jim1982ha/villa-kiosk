"""The stub: stands in for the VESTA Agent until it is delivered (SPEC 2).

It follows the rules placed on the real agent (SPEC 8): configuration only from
the environment contract, logs to stdout, no secret printed, stops on SIGTERM,
never contacts Telegram while VESTA_TELEGRAM_ENABLED is false. The host has
already run the self-test before starting it.

With VESTA_STUB_HEARTBEAT=true it exercises the whole VESTA Kiosk loop, end to
end, so it can be checked from the Kiosk's own screen before the real agent
exists:
  * a heartbeat every minute, so the Kiosk keeps showing the agent online
    (a single heartbeat would read "online" for a few minutes, then lapse);
  * ONE demo message with two buttons, posted at start-up;
  * the answer read back through /agent/v1/choices and written to this log —
    the path a real agent's decision takes.
Every start posts one new demo message; the Kiosk prunes them with its
message retention setting.
"""
import json
import os
import signal
import threading
import time
import urllib.error
import urllib.request

HEARTBEAT_EVERY = 60
#: How often the demo checks for an answer. Short, because a person is
#: standing at the Kiosk waiting to see it land in this log.
CHOICES_EVERY = 15
CONTRACT = (
    "ANTHROPIC_API_KEY", "VESTA_HA_URL", "VESTA_HA_TOKEN", "VESTA_HA_MCP_URL",
    "VESTA_HA_MCP_SECRET", "VESTA_KIOSK_URL", "VESTA_KIOSK_TOKEN",
    "VESTA_CF_ACCESS_CLIENT_ID", "VESTA_CF_ACCESS_CLIENT_SECRET",
    "VESTA_TELEGRAM_ENABLED", "VESTA_SKILLS_DIR", "VESTA_AGENT_CONFIG_DIR",
    "VESTA_DATA_DIR", "VESTA_LOG_LEVEL", "TZ", "VESTA_DEPLOYMENT", "VESTA_INSTANCE",
)
DEMO_MESSAGE = {
    "kind": "message",
    "severity": "info",
    "title": "Test message from the VESTA Agent stub",
    "body": ("This message checks the connection between the VESTA Agent host and "
             "this Kiosk. Press a button: the stub writes your answer in the VESTA "
             "Agent app's log within about 15 seconds.\n\n"
             "It is sent once each time the app starts with **Stub heartbeat** on."),
    "buttons": [{"id": "looks_good", "label": "Looks good"},
                {"id": "not_now", "label": "Not now"}],
}

stop = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())


def say(msg):
    print(f"stub: {msg}", flush=True)


def kiosk(method, path, body=None):
    """(status, parsed JSON or None) — never raises; the stub must keep going."""
    url = os.environ["VESTA_KIOSK_URL"].rstrip("/") + path
    headers = {"Authorization": f"Bearer {os.environ.get('VESTA_KIOSK_TOKEN', '')}",
               "Content-Type": "application/json"}
    cid = os.environ.get("VESTA_CF_ACCESS_CLIENT_ID")
    if cid:
        headers["CF-Access-Client-Id"] = cid
        headers["CF-Access-Client-Secret"] = os.environ.get("VESTA_CF_ACCESS_CLIENT_SECRET", "")
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read() or b"", e.code
    except OSError as e:
        return f"unreachable ({type(e).__name__})", None
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, None


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

    demo = os.environ.get("VESTA_STUB_HEARTBEAT") == "true" and os.environ.get("VESTA_KIOSK_TOKEN")
    if not demo:
        say("no heartbeat (stub_heartbeat off or no Kiosk token)")
        stop.wait()
        say("stopped")
        return

    say(f"heartbeat every {HEARTBEAT_EVERY} s")
    status, body = kiosk("POST", "/agent/v1/messages", DEMO_MESSAGE)
    message_id = body.get("id") if status == 201 and isinstance(body, dict) else None
    if message_id:
        say(f"demo message posted ({message_id}) — answer it in the Kiosk's VESTA Agent area")
    else:
        say(f"demo message not posted: {status if isinstance(status, str) else f'HTTP {status}'}")

    last_beat, last_beat_outcome, answered = 0.0, None, False
    while not stop.is_set():
        now = time.monotonic()
        if now - last_beat >= HEARTBEAT_EVERY:
            status, _ = kiosk("POST", "/agent/v1/heartbeat", {"status": "stub"})
            outcome = status if isinstance(status, str) else f"HTTP {status}"
            if outcome != last_beat_outcome:      # log changes, not every minute
                say(f"heartbeat: {outcome}")
                last_beat_outcome = outcome
            last_beat = now
        if message_id and not answered:
            status, body = kiosk("GET", "/agent/v1/choices?since=0")
            for c in (body or {}).get("choices", []) if status == 200 else []:
                if isinstance(c, dict) and c.get("message_id") == message_id:
                    say(f"answer received: \"{c.get('button_id')}\" pressed by "
                        f"{c.get('profile')} at {c.get('at')}")
                    answered = True
                    break
        if stop.wait(CHOICES_EVERY if message_id and not answered else HEARTBEAT_EVERY):
            break
    say("stopped")


if __name__ == "__main__":
    main()
