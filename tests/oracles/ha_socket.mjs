// The Home Assistant socket's lifecycle (src/ha/HAWebSocket.ts, 608 lines,
// untested until round 10, 2.496.160): the handshake, a subscription, and
// what a reconnect restores — driven against a fake socket playing Home
// Assistant, with the browser globals it touches stubbed.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

// ── the browser, as little of it as the socket touches ──────────────────────
const noop = () => {};
globalThis.window = { addEventListener: noop, removeEventListener: noop, location: { protocol: "http:", host: "localhost", origin: "http://localhost", pathname: "/" },
  innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.document = { hidden: false, addEventListener: noop, removeEventListener: noop, querySelector: () => null };
globalThis.screen = { width: 1024, height: 768 };
Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: () => true, onLine: true }, configurable: true });
globalThis.fetch = async () => ({ status: 200 });

/** A socket that plays Home Assistant: asks for auth, accepts it, answers
 *  requests and records every frame the client sends. */
const sockets = [];
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) {
    this.url = url; this.readyState = FakeSocket.CONNECTING; this.sent = [];
    sockets.push(this);
    setTimeout(() => { this.readyState = FakeSocket.OPEN; this.onopen?.({}); this.emit({ type: "auth_required" }); }, 0);
  }
  emit(msg) { this.onmessage?.({ data: JSON.stringify(msg), target: this }); }
  send(raw) {
    const m = JSON.parse(raw); this.sent.push(m);
    if (m.type === "auth") setTimeout(() => this.emit({ type: "auth_ok" }), 0);
    else if (m.id !== undefined && m.type !== "pong") setTimeout(() => this.emit({ id: m.id, type: "result", success: true, result: m.type === "get_states" ? [] : null }), 0);
  }
  close(code = 1000) { this.serverClose(code); }
  serverClose(code) { if (this.readyState === FakeSocket.CLOSED) return; this.readyState = FakeSocket.CLOSED; this.onclose?.({ code, reason: "", wasClean: code === 1000 }); }
}
globalThis.WebSocket = FakeSocket;

const { HAWebSocket } = await import("@/ha/HAWebSocket");
const { onSessionLost } = await import("@/auth/sessionLost");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const until = async (pred, ms = 5000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); return pred(); };

const ws = new HAWebSocket();
const states = [];
ws.onStateChange = (s) => states.push(s);
await ws.connect();
ck("the handshake: connecting → authenticating → connected, answering auth on the socket that asked",
   states.join(",").endsWith("connecting,authenticating,connected") && sockets[0].sent[0].type === "auth", states);
const subId = await ws.subscribeEvents("state_changed", () => {});
ck("a subscription goes out on the live socket", sockets[0].sent.some((m) => m.type === "subscribe_events" && m.id === subId));

sockets[0].serverClose(1006);                               // the link drops
ck("a dropped link reads as disconnected", states.at(-1) === "disconnected");
const back = await until(() => states.at(-1) === "connected" && sockets.length === 2);
ck("it reconnects by itself (on its backoff) with a NEW socket", back, { states, sockets: sockets.length });
ck("  ...and re-issues the subscription on the new socket, under the SAME id (events come back on it)",
   sockets[1].sent.some((m) => m.type === "subscribe_events" && m.id === subId && m.event_type === "state_changed"));

let lost = null;
const off = onSessionLost((src) => { lost = src; });
sockets[1].serverClose(4401);                               // the proxy ends the session
ck("the proxy's 4401 'session ended' is reported to the profile's owner", lost === "socket 4401", lost);
off();
ws.disconnect();

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ the socket's lifecycle, checked");
process.exit(0);
