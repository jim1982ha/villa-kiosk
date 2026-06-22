// src/components/ErrorBoundary.tsx
// Catches render-time errors so the kiosk shows a readable message instead of a
// blank screen. (Error boundaries must be class components — React provides no
// hook equivalent — so this is the one intentional class in the app.)

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Villa Kiosk] render error:", error, info);
    this.setState({ info: info.componentStack ?? "" });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-overlay" style={{ alignItems: "flex-start", overflow: "auto", padding: 24 }}>
        <h2 style={{ fontFamily: "var(--font-display)", color: "var(--status-danger)" }}>
          Something went wrong
        </h2>
        <p className="body-text">{this.state.error.message}</p>
        <pre style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap", maxWidth: "100%" }}>
          {this.state.error.stack}
        </pre>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
