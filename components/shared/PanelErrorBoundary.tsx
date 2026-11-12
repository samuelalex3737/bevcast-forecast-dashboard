"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  attempt: number;
}

/** Isolates a dashboard panel: a crash shows a readable message and Retry; the rest keeps working. */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[BevCast] Panel "${this.props.name}" failed:`, error.message, info.componentStack?.split("\n").slice(0, 3).join(" "));
  }

  retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-danger/40 bg-danger-soft/60 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-danger">
            <AlertTriangle className="size-4" aria-hidden />
            {this.props.name} could not be displayed
          </div>
          <p className="text-muted-foreground">{this.state.error.message || "Unexpected error."} The other panels are unaffected.</p>
          <Button size="sm" variant="outline" onClick={this.retry}>
            <RotateCcw className="size-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      );
    }
    return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
  }
}
