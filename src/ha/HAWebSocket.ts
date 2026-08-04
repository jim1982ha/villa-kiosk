// src/ha/HAWebSocket.ts
// Robust HA WebSocket client: auth, message-id tracking, event subscriptions,
// exponential-backoff reconnect with re-subscription. (3Dash-informed patterns.)

import type {
  EnergyPrefs, HassAreaRegistryEntry, HassDeviceRegistryEntry, HassEntity, HassEntityRegistryEntry,
  HassServiceTarget, RawLogbookEntry, StatisticIdInfo, StatisticPeriod,
} from "@/types/ha.types";
import { ingressWsUrl } from "./ingress";
import { captureError } from "@/utils/diagnostics";

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
  private pending = new Map<number, { resolve: Resolver; reject: Rejecter; timer?: ReturnType<typeof setTimeout> }>();
  private subscriptions = new Map<number, PendingSubscription>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manuallyClosed = false;
  private state: ConnectionState = "disconnected";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against reporting the same auth_invalid streak to telemetry on
   *  every ~30s retry forever — see the auth_invalid handler. Reset on the
   *  next successful auth so a LATER, separate occurrence still reports. */
  private authInvalidReported = false;

  onStateChange: (state: ConnectionState) => void = () => {};
  /** Every failed service call is reported here (panels fire-and-forget). */
  onServiceError: (err: Error) => void = () => {};

  // Stored so disconnect() can remove them — anonymous inline handlers would
  // leak (and keep this whole client, its socket and timers, reachable) if
  // the provider that owns this ever unmounts.
  private onVisibility = () => { if (!document.hidden) this.checkHealth(); };
  private onOnline = () => this.checkHealth();

  constructor() {
    // A phone that slept or roamed Wi-Fi kills the TCP socket without firing
    // onclose for minutes — the app still says "connected" but every tap goes
    // into a black hole. Waking the tab / regaining network is the moment to
    // health-check and, if needed, reconnect NOW instead of on backoff delay.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
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

  connect(): Promise<void> {
    // Always route through the same-origin Supervisor proxy, which adds the
    // SUPERVISOR_TOKEN server-side — so we authenticate token-less (the in-band
    // auth message below sends an empty token the proxy rewrites). Ignore
    // duplicate connects while already up/connecting (e.g. React StrictMode
    // double-invoke) to avoid racing sockets.
    const url = ingressWsUrl();
    if (
      (this.state === "connected" || this.state === "connecting" || this.state === "authenticating") &&
      this.url === url
    ) {
      return Promise.resolve();
    }
    if (this.ws) {
      this.manuallyClosed = true;
      this.ws.close();
      this.ws = null;
    }
    this.url = url;
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
        this.ws = new WebSocket(this.url);
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
              // Empty token on purpose: the Supervisor proxy rewrites the auth
              // message's access_token to the real SUPERVISOR_TOKEN server-side.
              socket.send(JSON.stringify({ type: "auth", access_token: "" }));
            }
            break;
          case "auth_ok":
            this.setState("connected");
            this.reconnectAttempts = 0;
            this.authInvalidReported = false;
            this.resubscribeAll(socket);
            this.startHeartbeat();
            finish(() => resolve());
            break;
          case "auth_invalid":
            // Should not happen on a healthy system — the proxy injects a
            // valid Supervisor token server-side — but treating it as a
            // PERMANENT failure (this used to set manuallyClosed = true) was
            // itself the bug behind a real field report: a kiosk PWA left
            // running for days eventually showed a stuck "Not connected to
            // Home Assistant" that never recovered without someone manually
            // reloading it — impossible for an unattended wall-mounted
            // tablet. A Supervisor/HA-core restart (nightly backup, an
            // add-on update, a network blip mid-restart) can plausibly cause
            // exactly one transient auth hiccup, and the old code treated
            // that indistinguishably from "this will never work", silently
            // disabling every future reconnect attempt for the rest of the
            // session.
            //
            // Falling through to the same closure handling as any other
            // disconnect (below) means this now self-heals like every other
            // transient failure already does in this client — the capped
            // exponential backoff (scheduleReconnect) keeps retrying at a
            // cheap, bounded cadence (never faster than 30s) instead of
            // ever giving up, so it costs nothing extra in CPU or memory to
            // leave running 24/7, and a genuinely misconfigured add-on just
            // keeps failing visibly (the connection dot, and any attempted
            // service call) rather than doing so silently forever.
            //
            // Still worth knowing about if it DOES happen, so report it once
            // per streak (not on every ~30s retry — that would just spam the
            // add-on's telemetry endpoint for no extra signal) via the same
            // capture path field crashes already use.
            if (!this.authInvalidReported) {
              this.authInvalidReported = true;
              captureError("HA_AUTH_INVALID", new Error(msg.message ?? "auth_invalid"), "HAWebSocket");
            }
            finish(() => reject(new Error(msg.message ?? "Home Assistant rejected the add-on's authentication.")));
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

  /** Re-issue every active subscription after a reconnect (ids preserved).
   *
   *  Takes the socket that authenticated rather than reading `this.ws`, for
   *  the same reason every other reply in onmessage does: a concurrent
   *  reconnect may already have replaced `this.ws` with a NEWER socket that is
   *  still CONNECTING, and `send()` on that throws. This one call site was
   *  missed when that rule was introduced, and the consequences were larger
   *  than a failed subscribe: the throw escaped mid-`forEach`, so the
   *  remaining subscriptions were never re-registered AND the rest of the
   *  auth_ok branch — startHeartbeat() and the connect promise's resolve() —
   *  never ran either. A phone reported it in the field as
   *  "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state";
   *  the visible symptom is entities that stop updating after a reconnect
   *  until the app is reloaded.
   *
   *  Each send is also isolated, so one failure can't cost the others their
   *  subscription. Anything not sent here is not lost: it stays in
   *  `subscriptions` and is re-issued on the next auth_ok. */
  private resubscribeAll(socket: WebSocket) {
    if (socket.readyState !== WebSocket.OPEN) return;
    this.subscriptions.forEach((sub) => {
      try {
        socket.send(JSON.stringify({
          id: sub.id, type: "subscribe_events", event_type: sub.eventType,
        }));
      } catch { /* next auth_ok re-issues it */ }
    });
  }

  async getStates(): Promise<HassEntity[]> {
    return this.sendMessage<HassEntity[]>("get_states");
  }

  /** Entity registry rows (hidden_by, area_id, etc.) — NOT included in
   *  get_states, which only reports live state/attributes. */
  async getEntityRegistry(): Promise<HassEntityRegistryEntry[]> {
    return this.sendMessage<HassEntityRegistryEntry[]>("config/entity_registry/list");
  }

  /** Device registry rows — only their id + area_id, to resolve the area an
   *  entity INHERITS when its own registry row has no area_id of its own
   *  (see HAStateStore's entityAreaNames). */
  async getDeviceRegistry(): Promise<HassDeviceRegistryEntry[]> {
    return this.sendMessage<HassDeviceRegistryEntry[]>("config/device_registry/list");
  }

  /** Area registry rows — id → human-readable name, this installation's own
   *  live data (never shipped/assumed by this app). */
  async getAreaRegistry(): Promise<HassAreaRegistryEntry[]> {
    return this.sendMessage<HassAreaRegistryEntry[]>("config/area_registry/list");
  }

  /** Logbook events since `startTime` (ISO string) — verified against a live
   *  instance to be the reliable path (matches what HA's own frontend
   *  logbook uses); the classic REST `/api/logbook/<timestamp>` endpoint did
   *  not return usable data in the same test. Each entry's `when` is epoch
   *  SECONDS, not ms or ISO — see HALogbookAPI.ts's RawLogbookEntry. */
  async getLogbookEvents(startTime: string): Promise<RawLogbookEntry[]> {
    return this.sendMessage<RawLogbookEntry[]>("logbook/get_events", { start_time: startTime });
  }

  /** The Energy Dashboard's own configuration — which statistic IDs it
   *  considers "the grid" / per-device consumption. Config only, not values;
   *  see getStatisticsDuringPeriod for the actual numbers. Resolves to an
   *  object with (at least) `energy_sources`/`device_consumption` on a
   *  configured install; a fresh install with no Energy Dashboard set up at
   *  all returns them as empty arrays, not an error. */
  async getEnergyPrefs(): Promise<EnergyPrefs> {
    return this.sendMessage<EnergyPrefs>("energy/get_prefs");
  }

  /** Which statistic IDs actually have recorded data — an Energy Dashboard
   *  source can reference one that no longer resolves (e.g. after an
   *  unrelated entity rename left the OLD name as the recorded statistic_id
   *  while the dashboard still points at the new entity_id), so callers
   *  cross-check against this before trusting a configured source. */
  async listStatisticIds(statisticType: "sum" | "mean" = "sum"): Promise<StatisticIdInfo[]> {
    return this.sendMessage<StatisticIdInfo[]>("recorder/list_statistic_ids", { statistic_type: statisticType });
  }

  /** Pre-aggregated statistics for one or more statistic IDs — `change` is
   *  the consumption WITHIN each returned bucket (HA computes this; no
   *  client-side sum-of-cumulative-readings math needed). Keyed by
   *  statistic_id in the response; a statistic with no data in range is
   *  simply absent from the result, not an empty array. */
  async getStatisticsDuringPeriod(
    statisticIds: string[],
    startTime: string,
    period: "5minute" | "hour" | "day" | "week" | "month" = "day",
    endTime?: string,
  ): Promise<Record<string, StatisticPeriod[]>> {
    return this.sendMessage<Record<string, StatisticPeriod[]>>("recorder/statistics_during_period", {
      start_time: startTime,
      ...(endTime ? { end_time: endTime } : {}),
      statistic_ids: statisticIds,
      period,
      types: ["change"],
    });
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
    this.rejectAllPending(new Error("Disconnected"));
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
    }
    this.setState("disconnected");
  }
}
