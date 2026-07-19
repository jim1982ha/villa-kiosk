// src/components/ErrorReport.tsx
// Full-screen, human-readable error panel with a one-tap "Copy details" button.
// Used by the render ErrorBoundary and the 3D canvas's failure/crash-loop
// states so a kiosk user (no devtools) can copy a rich report and paste it back
// for troubleshooting. Never leaves the app in a silent/looping broken state.

import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Copy, Check } from "lucide-react";

interface Props {
  title: string;
  /** Short, plain-language explanation of what likely happened. */
  hint?: ReactNode;
  /** The full copyable report (device + model + error + WebGL …). */
  detail: string;
  /** Optional action buttons (Reload / Try again / Upload …). */
  actions?: ReactNode;
}

export default function ErrorReport({ title, hint, detail, actions }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(detail);
      ok = true;
    } catch {
      // Clipboard API blocked (insecure context, kiosk lockdown, iOS quirks):
      // fall back to selecting the textarea + execCommand so copy still works.
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.select();
        try { ok = document.execCommand("copy"); } catch { ok = false; }
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (taRef.current) {
      // Last resort: select it so the user can copy manually.
      taRef.current.focus();
      taRef.current.select();
    }
  };

  return (
    <div
      className="center-overlay"
      style={{ alignItems: "stretch", justifyContent: "flex-start", overflow: "auto", padding: 24, gap: 14, textAlign: "left" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <AlertTriangle size={22} style={{ color: "var(--status-danger)", flexShrink: 0 }} />
        <h2 style={{ fontFamily: "var(--font-display)", color: "var(--status-danger)", margin: 0 }}>{title}</h2>
      </div>

      {hint && <div className="body-text" style={{ maxWidth: 640 }}>{hint}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn primary" onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {copied ? <Check size={18} /> : <Copy size={18} />}
          {copied ? "Copied!" : "Copy error details"}
        </button>
        {actions}
      </div>

      {/* Readonly, pre-selectable — so copy works even if the clipboard API is
          blocked (the user can tap → Select All → Copy). */}
      <textarea
        ref={taRef}
        readOnly
        value={detail}
        onFocus={(e) => e.currentTarget.select()}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 240,
          resize: "vertical",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-secondary)",
          background: "color-mix(in srgb, var(--text-primary) 6%, transparent)",
          border: "1px solid var(--hairline)",
          borderRadius: 10,
          padding: 12,
          whiteSpace: "pre",
          overflow: "auto",
        }}
      />
    </div>
  );
}
