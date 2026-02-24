import { Component, type ErrorInfo, type ReactNode } from "react";

type GraphErrorBoundaryProps = {
  children?: ReactNode;
};

type GraphErrorBoundaryState = {
  hasError: boolean;
  message: string;
  stack: string;
};

export default class GraphErrorBoundary extends Component<GraphErrorBoundaryProps, GraphErrorBoundaryState> {
  declare state: GraphErrorBoundaryState;
  declare props: GraphErrorBoundaryProps;
  declare setState: (state: Partial<GraphErrorBoundaryState>) => void;

  constructor(props: GraphErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "", stack: "" };
  }

  static getDerivedStateFromError(error: Error): Partial<GraphErrorBoundaryState> {
    return {
      hasError: true,
      message: error?.message ? String(error.message) : "Unknown graph error",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      stack: String(errorInfo?.componentStack || ""),
    });
    if (import.meta?.env?.DEV) {
      // Keep this in console for immediate diagnosis during launcher iterations.
      // eslint-disable-next-line no-console
      console.error("Graph render failure", error, errorInfo);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="m-2 rounded-md border border-rose-700/70 bg-rose-950/30 p-3 text-xs text-rose-100">
        <div className="font-semibold">Graph failed to render</div>
        <div className="mt-1 text-rose-200/90">{this.state.message}</div>
        {this.state.stack ? (
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-rose-800/60 bg-black/20 p-2 text-[11px] text-rose-100/90">
            {this.state.stack}
          </pre>
        ) : null}
      </div>
    );
  }
}
