import { Component, type ErrorInfo, type ReactNode } from "react";

type AppFatalBoundaryProps = {
  children?: ReactNode;
};

type AppFatalBoundaryState = {
  error: Error | null;
};

export default class AppFatalBoundary extends Component<AppFatalBoundaryProps, AppFatalBoundaryState> {
  declare state: AppFatalBoundaryState;
  declare props: AppFatalBoundaryProps;

  constructor(props: AppFatalBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): AppFatalBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a console trail for pywebview/devtools sessions.
    console.error("[launcher-ui] fatal render error", error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      const message = String(error?.message || error || "Unknown UI error");
      return (
        <div className="flex h-full items-center justify-center bg-slate-950 text-slate-100">
          <div className="max-w-[90ch] rounded-lg border border-rose-700/60 bg-slate-900 p-4 text-sm">
            <div className="mb-2 font-semibold text-rose-300">Launcher UI crashed while rendering.</div>
            <pre className="whitespace-pre-wrap break-words text-slate-200">{message}</pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
