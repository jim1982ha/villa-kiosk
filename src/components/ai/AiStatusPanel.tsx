// src/components/ai/AiStatusPanel.tsx
// Whether the AI layer is working, said the way the layer itself says it.

import { STATUS_COLOR } from "@/utils/stateColors";
import type { AiStatus, LinkState } from "@/ai/aiLayer";

/** ⚠️ THE TWO CONNECTIONS ARE DRAWN SEPARATELY, AND THAT IS THE POINT.
 *  docs/adr/0012 splits the layer's contact with Home Assistant in two — a
 *  gateway it asks through and a socket it listens on — because they fail
 *  independently: the gateway can be down while events still arrive. The
 *  engine is careful never to round that up to "healthy"; a single green dot
 *  here would throw the distinction away at the last step. */
const LINK_LABEL: Record<LinkState, string> = {
  up: "Connected",
  down: "Not connected",
  unknown: "Not checked yet",
};

/** ⚠️ THE SHARED VOCABULARY, NOT NEW COLOURS. The four status colours live
 *  once in STATUS_COLOR and the Map colours legend documents what each MEANS;
 *  inventing a fifth here would make this screen disagree with the legend the
 *  owner can open two clicks away. `unavailable` is "contact lost, state
 *  genuinely unknown", which is exactly a connection nobody has established
 *  yet — not `idle`, which means "nothing to report". */
const linkColor = (s: LinkState) =>
  s === "up" ? STATUS_COLOR.active
    : s === "down" ? STATUS_COLOR.alert
      : STATUS_COLOR.unavailable;

function Link({ name, what, state, detail }: {
  name: string; what: string; state: LinkState; detail: string;
}) {
  return (
    <div className="ai-link">
      <span className="ai-dot" style={{ background: linkColor(state) }} aria-hidden />
      <div className="ai-link-text">
        <div className="ai-link-name">{name}</div>
        <div className="ai-link-what">{what}</div>
        <div className="ai-link-state">
          {LINK_LABEL[state]}{detail ? ` — ${detail}` : ""}
        </div>
      </div>
    </div>
  );
}

const Figure = ({ label, value }: { label: string; value: string }) => (
  <div className="ai-figure">
    <div className="ai-figure-value">{value}</div>
    <div className="ai-figure-label">{label}</div>
  </div>
);

export default function AiStatusPanel({ status }: { status: AiStatus | null }) {
  // ⚠️ "HAS NEVER SPOKEN" IS NOT "IS DOWN". A layer that has published nothing
  // and a layer reporting a failure are different situations with different
  // fixes, and collapsing them is the mistake this whole screen is careful
  // about everywhere else.
  if (!status) {
    return (
      <div className="ai-empty">
        <div className="settings-section-title" style={{ marginTop: 0 }}>Not reporting</div>
        <p>
          The AI layer has not published anything yet. It runs inside this add-on,
          so give it a moment after a restart — if this persists, its lines are in
          this add-on&apos;s log.
        </p>
      </div>
    );
  }

  const spend = status.unpricedCalls > 0
    ? `$${status.usdToday.toFixed(4)} + ${status.unpricedCalls} unpriced`
    : `$${status.usdToday.toFixed(4)}`;

  return (
    <div className="ai-status">
      {status.needsConfiguring && (
        <div className="ai-notice">
          <strong>Not configured yet.</strong> Fill in{" "}
          <code>{status.needsConfiguring}</code> on this add-on&apos;s
          Configuration page in Home Assistant. Until then the layer runs, reports
          its own health, and does nothing else.
        </div>
      )}

      <div className="settings-section-title" style={{ marginTop: 0 }}>
        Connections
      </div>
      <Link
        name="Gateway" what="Everything it asks about the property"
        state={status.gateway} detail={status.gatewayDetail}
      />
      <Link
        name="Listener" what="Being told when something changes"
        state={status.listener} detail={status.listenerDetail}
      />

      <div className="settings-section-title">What it has seen</div>
      <div className="ai-figures">
        <Figure
          label="Devices on the property"
          // null means it could not ask — which is not zero devices.
          value={status.entitiesSeen === null ? "—" : String(status.entitiesSeen)}
        />
        <Figure label="Changes observed" value={String(status.eventsSeen ?? 0)} />
      </div>

      <div className="settings-section-title">What it has spent today</div>
      <div className="ai-figures">
        <Figure label="Spend" value={spend} />
        <Figure label="Model calls" value={String(status.calls)} />
        <Figure
          label="Tokens in / out"
          value={`${status.inputTokens.toLocaleString()} / ${status.outputTokens.toLocaleString()}`}
        />
      </div>
      <p className="ai-note">
        ⚠️ This is measured by the layer itself, call by call — it is the only
        cost figure to quote. A model it cannot price is counted as
        &quot;unpriced&quot;, never as free.
      </p>

      <div className="ai-version">Layer version {status.version || "unknown"}</div>
    </div>
  );
}
