// src/components/ErrorBoundary.tsx
// Catches render-time errors so the kiosk shows a readable, copyable report
// instead of a blank screen or a silent reload loop. (Error boundaries must be
// class components — React provides no hook equivalent — so this is the one
// intentional class in the app.)

import { Component, type ErrorInfo, type ReactNode } from "react";
import ErrorReport from "./ErrorReport";
import { captureError, buildReport, type CapturedError } from "@/utils/diagnostics";

interface Props {
  children: ReactNode;
}
interface State {
  captured: CapturedError | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { captured: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { captured: captureError("RENDER_EXCEPTION", error, "react-render") };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Vesta Kiosk] render error:", error, info);
  }

  override render(): ReactNode {
    const { captured } = this.state;
    if (!captured) return this.props.children;
    return (
      <ErrorReport
        title="Something went wrong"
        hint="The app hit an unexpected error while rendering. Copy the details below and send them over so it can be diagnosed."
        detail={buildReport(captured)}
        actions={<button className="btn ghost" onClick={() => location.reload()}>Reload</button>}
      />
    );
  }
}
