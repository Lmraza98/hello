import React from "react";
import BridgeState from "../components/BridgeState";
import AppShellView from "./views/AppShellView";
import { useAppOrchestrationRoot } from "./hooks/useAppOrchestrationRoot";

export default function AppOrchestrationRoot() {
  const vm = useAppOrchestrationRoot();
  if (!vm.chrome.bridge) return <BridgeState bridgeError={vm.chrome.bridgeError} />;
  return <AppShellView chrome={vm.chrome} topBar={vm.topBar} testsView={vm.testsView} graphView={vm.graphView} />;
}
