// src/ha/HAWebSocket.ts
// Robust HA WebSocket client: auth, message-id tracking, event subscriptions,
// exponential-backoff reconnect with re-subscription. (3Dash-informed patterns.)

import type { HassEntity, HassServiceTarget } from "@/types/ha.types";
import { isIngress, ingressWsUrl } from "./ingress";

type Resolver = (result: unknown) => void;
type Rejecter = (err: Error) => void;
type EventCallback = (event: unknown) => void;
export type ConnectionState = "disconnected" | "connecting" | "authenticating" | "connected";

interface PendingSubscription {
  eventType: string;
  callback: EventCallback;
  id: number;
}

export class HAWebSocket {
  private ws: WebSocket | null = null;
  private messageId = 1;
  private url = "";
  private token = "";
  private pending = new Map<number, { resolve: Resolver; reject: Rejecter; timer?: ReturnType<typeof setTimeout> }>();
  private subscriptions = new Map<number, PendingSubscription>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manuallyClosed = false;
  private state: ConnectionState = "disconnected";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  onStateChange: (state: ConnectionState) => void = () => {};
  /** Every failed service call is reported here (panels fire-and-forget). */
  onServiceError: (err: Error) => void = () => {};

  constructor() {
    // A phone that slept or roamed Wi-Fi kills the TCP socket without firing
    // onclose for minutes — the app still says "connected" but every tap goes
    // into a black hole. Waking the tab / regaining network is the moment to
    // health-check and, if needed, reconnect NOW instead of on backoff delay.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.checkHealth();
      });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.checkHealth());
    }
  }

  /** Ping a live-looking connection (dead sockets fail fast via the pong
   *  timeout) or, when down, skip the backoff delay and reconnect now. */
  private checkHealth() {
    if (this.manuallyClosed || !this.url) return;
    if (this.state === "connected") {
      this.sendPing();
    } else if (!["connecting", "authenticating"].includes(this.state)) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectAttempts = 0;
      this.openSocket().catch(() => this.scheduleReconnect());
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  private setState(s: ConnectionState) {
    if (this.state !== s) {
      this.state = s;
      this.onStateChange(s);
    }
  }

  /** Build a ws(s):// URL from an http(s):// base. */
  private wsUrl(httpUrl: string): string {
    // As an add-on, route through the same-origin Supervisor proxy, which adds
    // the SUPERVISOR_TOKEN server-side — so the URL/token args are irrelevant.
    if (isIngress()) return ingressWsUrl();
    const u = httpUrl.replace(/^http/i, "ws").replace(/\/+$/, "");
    return `${u}/api/websocket`;
  }

  connect(url: string, token: string): Promise<void> {
    // Ignore duplicate connects to the same target while already up/connecting
    // (e.g. React StrictMode double-invoke) to avoid racing sockets.
    if (
      (this.state === "connected" || this.state === "connecting" || this.state === "authenticating") &&
      this.url === url &&
      this.token === token
    ) {
      return Promise.resolve();
    }
    if (this.ws) {
      this.manuallyClosed = true;
      this.ws.close();
      this.ws = null;
    }
    this.url = url;
    this.token = token;
    this.manuallyClosed = false;
    return this.openSocket();
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState("connecting");
      let settled = false;
      // Guarantee the connect() promise always settles, so callers never hang
      // if HA is unreachable or the socket closes before authentication.
      const timeout = setTimeout(() => finish(() => reject(new Error("Connection timed out — check the HA URL and that the device is reachable."))), 10000);
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        action();
      };

      try {
        this.ws = new WebSocket(this.wsUrl(this.url));
      } catch (err) {
        finish(() => reject(err as Error));
        this.scheduleReconnect();
        return;
      }

      this.ws.onmessage = (ev) => {
        // Send replies on the SAME socket that received the message (not this.ws,
        // which may have been replaced by a concurrent reconnect → "still in
        // CONNECTING state" errors).
        const socket = ev.target as WebSocket;
        // JSON.parse returns `any` (the deserialization boundary); a non-JSON
        // frame should never reach us from HA, so ignore it rather than letting
        // the exception kill this onmessage handler.
        let msg: ReturnType<typeof JSON.parse>;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (msg.type) {
          case "auth_required":
            this.setState("authenticating");
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "auth", access_token: this.token }));
            }
            break;
          case "auth_ok":
            this.setState("connected");
            this.reconnectAttempts = 0;
            this.resubscribeAll();
            this.startHeartbeat();
            finish(() => resolve());
            break;
          case "auth_invalid":
            this.manuallyClosed = true; // bad token: do not loop forever
            finish(() => reject(new Error(msg.message ?? "Authentication failed — check your token.")));
            this.ws?.close();
            break;
          case "result":
            this.handleResult(msg);
            break;
          case "event":
            this.subscriptions.get(msg.id)?.callback(msg.event);
            break;
          case "pong":
            if (this.pongTimer) {
              clearTimeout(this.pongTimer);
              this.pongTimer = null;
            }
            break;
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.setState("disconnected");
        this.rejectAllPending(new Error("Connection closed"));
        // If we never authenticated, settle the connect() promise as a failure.
        finish(() => reject(new Error("Could not reach Home Assistant at this URL.")));
        if (!this.manuallyClosed) this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose will follow; nothing extra needed.
      };
    });
  }

  private handleResult(msg: { id: number; success: boolean; result?: unknown; error?: { message: string } }) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.success) p.resolve(msg.result);
    else p.reject(new Error(msg.error?.message ?? "Service call failed"));
  }

  private rejectAllPending(err: Error) {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(err);
    });
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manuallyClosed) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000); // 1,2,4..max 30s
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private nextId(): number {
    return this.messageId++;
  }

  // ---- Heartbeat: detect dead sockets the browser won't report -----------
  // HA answers {type:"ping"} with {type:"pong"}. A socket that swallows the
  // ping without answering within 5s is dead (slept phone, Wi-Fi roam): force
  // close so onclose fires and the normal reconnect path takes over. Without
  // this the app can sit "connected" for minutes while every tap does nothing.
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendPing(), 25000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private sendPing() {
    if (this.state !== "connected" || !this.ws || this.pongTimer) return;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.ws?.close(); // dead socket → onclose → reconnect
    }, 5000);
    try {
      this.ws.send(JSON.stringify({ id: this.nextId(), type: "ping" }));
    } catch {
      this.ws?.close();
    }
  }

  /** Send a command and resolve with its result. */
  sendMessage<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.state !== "connected" || !this.ws) {
        reject(new Error("Not connected to Home Assistant"));
        return;
      }
      const id = this.nextId();
      // A reply that never comes (socket died mid-flight) must not hang the
      // caller forever — settle with a clear error after 10s.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error("Home Assistant did not respond"));
          this.sendPing(); // probe the socket — a dead one reconnects in ≤5s
        }
      }, 10000);
      this.pending.set(id, { resolve: resolve as Resolver, reject, timer });
      this.ws.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  /** Subscribe to an event type. Returns a subscription id usable for unsubscribe. */
  async subscribeEvents(eventType: string, callback: EventCallback): Promise<number> {
    const id = this.nextId();
    this.subscriptions.set(id, { eventType, callback, id });
    // We must send subscribe with the SAME id that events come back on.
    return new Promise((resolve, reject) => {
      if (!this.ws || this.state !== "connected") {
        // Will be (re)subscribed on next auth_ok.
        resolve(id);
        return;
      }
      this.pending.set(id, {
        resolve: () => resolve(id),
        reject,
      });
      this.ws.send(JSON.stringify({ id, type: "subscribe_events", event_type: eventType }));
    });
  }

  private resubscribeAll() {
    // Re-issue every active subscription after a reconnect (ids preserved).
    this.subscriptions.forEach((sub) => {
      this.ws?.send(JSON.stringify({ id: sub.id, type: "subscribe_events", event_type: sub.eventType }));
    });
  }

  async getStates(): Promise<HassEntity[]> {
    return this.sendMessage<HassEntity[]>("get_states");
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown> = {},
    target?: HassServiceTarget,
  ): Promise<void> {
    try {
      await this.sendMessage("call_service", {
        domain,
        service,
        service_data: data,
        ...(target ? { target } : {}),
      });
    } catch (err) {
      // Every button in the app fires service calls without awaiting them; a
      // silently swallowed rejection is exactly the "I tap and nothing
      // happens" bug. Route failures to one place (the HUD toast) instead of
      // throwing at callers that never catch.
      this.onServiceError(err as Error);
    }
  }

  disconnect() {
    this.stopHeartbeat();
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setState("disconnected");
  }
}
