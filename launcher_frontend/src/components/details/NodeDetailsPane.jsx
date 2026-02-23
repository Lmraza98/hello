import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function NodeDetailsPane({
  effectiveStatus,
  graphNode,
  statusRow,
  selectedCase,
  testMeta,
  activeRunId,
  attemptId,
  durationText,
  runResult,
  evidence,
  showMoreMeta,
  setShowMoreMeta,
  displayNodeId,
  fmtDuration,
  fmtTs,
  nodeDependencyAnalysis,
}) {
  const status = String(effectiveStatus || "not_run").toLowerCase();
  const statusText = status.replaceAll("_", " ").toUpperCase();
  const resolvedDurationText = durationText || (graphNode?.durationMs ? `${(graphNode.durationMs / 1000).toFixed(2)}s` : fmtDuration(statusRow.duration));
  const resolvedAttempt =
    attemptId && String(attemptId) !== "latest"
      ? attemptId
      : (runResult?.attempt ?? runResult?.attempt_id ?? runResult?.attemptId ?? attemptId);
  const hasRunData = Boolean(activeRunId || runResult || statusRow?.started_at || statusRow?.finished_at || statusRow?.lastRun);
  const blockedBy = Array.isArray(graphNode?.unmetDeps)
    ? graphNode.unmetDeps
    : Array.isArray(statusRow?.unmet_deps)
      ? statusRow.unmet_deps
      : Array.isArray(statusRow?.unmetDeps)
        ? statusRow.unmetDeps
        : [];
  const startedBeforeReady = Array.isArray(nodeDependencyAnalysis?.unsatisfied_planned_deps_at_start)
    ? nodeDependencyAnalysis.unsatisfied_planned_deps_at_start
    : [];
  const plannedDeps = Array.isArray(nodeDependencyAnalysis?.planned_deps) ? nodeDependencyAnalysis.planned_deps : [];
  const structuredOutputs = runResult?.outputs && typeof runResult.outputs === "object" ? runResult.outputs : null;
  const structuredInputs = runResult?.inputs && typeof runResult.inputs === "object" ? runResult.inputs : null;
  const toolCall = runResult?.tool_call && typeof runResult.tool_call === "object" ? runResult.tool_call : null;
  const toolResponse = runResult?.tool_response && typeof runResult.tool_response === "object" ? runResult.tool_response : null;
  const normalizedOutputHash = String(runResult?.normalized_output_hash || "").trim();
  const artifacts = Array.isArray(runResult?.artifacts) ? runResult.artifacts : [];
  const statusTone =
    status === "failed"
      ? "border-rose-500/50 bg-rose-950/40 text-rose-200"
      : status === "running"
        ? "border-cyan-500/50 bg-cyan-950/30 text-cyan-200"
        : status === "passed"
          ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-200"
          : "border-slate-700/70 bg-slate-900/70 text-slate-200";

  return (
    <div className="mt-4 space-y-2.5 text-xs">
      <div className={`rounded border px-2.5 py-2 ${statusTone}`}>
        <div className="text-[11px] font-semibold tracking-wide">{statusText}</div>
        {status === "not_run" ? (
          <div className="mt-0.5 text-[11px] text-slate-300">No execution observed in selected run.</div>
        ) : (
          <div className="mt-0.5 text-[11px] text-slate-300">
            Duration: <span className="text-slate-100">{resolvedDurationText}</span>
            {" "}
            Attempt: <span className="text-slate-100">{String(resolvedAttempt)}</span>
          </div>
        )}
      </div>

      {!hasRunData ? (
        <div className="rounded border border-slate-800/70 bg-slate-900/35 px-2.5 py-2 text-[11px] text-slate-300">
          No execution data for selected run.
        </div>
      ) : null}

      <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2.5 py-2">
        <div className="text-[11px] font-semibold text-slate-200">Runtime</div>
        <div>Status: <span className="text-slate-100">{effectiveStatus}</span></div>
        {resolvedDurationText !== "n/a" ? <div>Duration: <span className="text-slate-100">{resolvedDurationText}</span></div> : null}
        <div>Attempt: <span className="text-slate-100">{String(resolvedAttempt)}</span></div>
        {activeRunId ? <div>Run: <span className="text-slate-100">{activeRunId}</span></div> : null}
        {statusRow.lastRun || statusRow.updated_at || statusRow.started_at ? (
          <div>Last run: <span className="text-slate-100">{fmtTs(statusRow.lastRun || statusRow.updated_at || statusRow.started_at)}</span></div>
        ) : null}
        {evidence ? (
          <div>
            Evidence:
            <span className="text-slate-100"> {evidence.observed || "unknown"} (expected {evidence.expected || "unknown"})</span>
          </div>
        ) : null}
        {evidence?.flagged ? <div className="text-amber-300">Flag: missing live browser evidence</div> : null}
      </div>

      {blockedBy.length > 0 ? (
        <div className="space-y-1 rounded border border-rose-800/40 bg-rose-950/15 px-2.5 py-2">
          <div className="text-[11px] font-semibold text-rose-200">Why not run?</div>
          <div className="text-[11px] text-rose-100">Blocked by:</div>
          {blockedBy.slice(0, 5).map((dep) => (
            <div key={String(dep)} className="truncate text-[11px] text-rose-100/90">- {String(dep)}</div>
          ))}
        </div>
      ) : null}

      {nodeDependencyAnalysis ? (
        <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2.5 py-2">
          <div className="text-[11px] font-semibold text-slate-200">Dependency Drift</div>
          <div>Planned deps: <span className="text-slate-100">{plannedDeps.length}</span></div>
          <div>Started before deps ready: <span className="text-slate-100">{startedBeforeReady.length}</span></div>
          {startedBeforeReady.length > 0 ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-amber-300">Unsatisfied at start:</div>
              {startedBeforeReady.slice(0, 5).map((dep) => (
                <div key={String(dep)} className="truncate text-[10px] text-amber-200">- {String(dep)}</div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-emerald-300">All planned deps were satisfied at start.</div>
          )}
        </div>
      ) : null}

      {structuredOutputs || structuredInputs || toolCall || toolResponse || normalizedOutputHash || artifacts.length > 0 ? (
        <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2.5 py-2">
          <div className="text-[11px] font-semibold text-slate-200">Node Artifacts</div>
          {normalizedOutputHash ? (
            <div className="truncate">Output hash: <span className="text-slate-100" title={normalizedOutputHash}>{normalizedOutputHash}</span></div>
          ) : null}
          {artifacts.length > 0 ? (
            <div>
              Artifacts:
              <div className="mt-0.5 space-y-0.5">
                {artifacts.slice(0, 6).map((row, idx) => {
                  const p = typeof row?.path === "string" ? row.path : "";
                  return (
                    <div key={`${idx}:${p}`} className="truncate text-[10px] text-slate-300" title={p}>
                      - {String(row?.type || "file")}: {p || "n/a"}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {structuredInputs ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Input payload</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(structuredInputs, null, 2)}</pre>
            </div>
          ) : null}
          {toolCall ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Tool call</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(toolCall, null, 2)}</pre>
            </div>
          ) : null}
          {toolResponse ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Tool response</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(toolResponse, null, 2)}</pre>
            </div>
          ) : null}
          {structuredOutputs ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Normalized output</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(structuredOutputs, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2.5 py-2">
        <div className="text-[11px] font-semibold text-slate-200">Configuration</div>
        <div className="truncate">File: <span className="text-slate-100" title={graphNode?.filePath || selectedCase?.file_path || ""}>{graphNode?.filePath || selectedCase?.file_path || "n/a"}</span></div>
        <div>Suite: <span className="text-slate-100">{graphNode?.suiteId || testMeta?.suite_name || testMeta?.suite_id || "n/a"}</span></div>
      </div>

      <button type="button" onClick={() => setShowMoreMeta((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-slate-100">
        {showMoreMeta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Details
      </button>
      {showMoreMeta ? (
        <div className="space-y-1 text-slate-300">
          <div>Retries: <span className="text-slate-100">{testMeta?.retries ?? "-"}</span></div>
          <div>Timeout: <span className="text-slate-100">{testMeta?.timeout_sec ?? "-"}</span></div>
          <div>Tags: <span className="text-slate-100">{(testMeta?.tags || []).join(", ") || "-"}</span></div>
          <div>Enabled: <span className="text-slate-100">{String(testMeta?.enabled ?? "-")}</span></div>
          <div>Selection node ID: <span className="break-all text-slate-100">{displayNodeId || "n/a"}</span></div>
        </div>
      ) : null}
    </div>
  );
}
