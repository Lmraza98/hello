import React from "react";
import AppOrchestrationRoot from "./AppOrchestrationRoot";
import AppFatalBoundary from "./views/AppFatalBoundary";

export default function App() {
  return (
    <AppFatalBoundary>
      <AppOrchestrationRoot />
    </AppFatalBoundary>
  );
}
