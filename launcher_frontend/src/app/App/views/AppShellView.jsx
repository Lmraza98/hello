import React from "react";
import HeaderBar from "../../../components/HeaderBar";
import TopActionsBar from "../../../components/TopActionsBar";
import IssuesDrawer from "../../../components/IssuesDrawer";
import LogsPanel from "../../../components/LogsPanel";
import TestsView from "./TestsView";
import GraphView from "./GraphView";

export default function AppShellView({ chrome, topBar, testsView, graphView }) {
  const { startup, tab, logs, showIssuesDrawer, setShowIssuesDrawer } = chrome;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <HeaderBar startup={startup} onOpenIssues={() => setShowIssuesDrawer(true)} />

      <TopActionsBar {...topBar} />

      {tab === "logs" ? <LogsPanel logs={logs} /> : null}
      {tab === "tests" ? <TestsView {...testsView} /> : null}
      {tab === "graph" ? <GraphView {...graphView} /> : null}

      {showIssuesDrawer ? <IssuesDrawer startup={startup} onClose={() => setShowIssuesDrawer(false)} /> : null}
    </div>
  );
}
