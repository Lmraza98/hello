import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import ScreenshotViewer from "./ScreenshotViewer";

export default function NodeDetailsPane({
  bridge,
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
  fallbackRunResult,
}) {
  function toFileUrl(path) {
    const raw = String(path || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw) || /^file:\/\//i.test(raw)) return raw;
    const normalized = raw.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
    return "";
  }

  function pickScreenshotFromRunResult(row) {
    if (!row || typeof row !== "object") return null;
    const outputs = row?.outputs && typeof row.outputs === "object" ? row.outputs : {};
    const screenshotFromOutputs = outputs?.screenshot;
    if (typeof screenshotFromOutputs === "string" && screenshotFromOutputs.trim()) {
      const raw = screenshotFromOutputs.trim();
      const url = toFileUrl(raw);
      if (url) return { url, path: raw, annotations: [] };
      if (/^[A-Za-z]:[\\/]/.test(raw)) return { url: toFileUrl(raw), path: raw, annotations: [] };
      return { url: raw, path: "", annotations: [] };
    }
    if (screenshotFromOutputs && typeof screenshotFromOutputs === "object") {
      const urlRaw = String(screenshotFromOutputs.url || screenshotFromOutputs.path || "").trim();
      const b64 = String(screenshotFromOutputs.base64 || screenshotFromOutputs.screenshot_base64 || "").trim();
      if (urlRaw) {
        const url = toFileUrl(urlRaw) || urlRaw;
        return { url, path: urlRaw, annotations: [] };
      }
      if (b64) {
        const mime = String(screenshotFromOutputs.mime || "image/png");
        return { url: `data:${mime};base64,${b64}`, annotations: [] };
      }
    }
    const b64 = String(outputs?.screenshot_base64 || "").trim();
    if (b64) {
      const mime = String(outputs?.screenshot_mime || "image/png");
      return { url: `data:${mime};base64,${b64}`, annotations: [] };
    }
    const artifacts = Array.isArray(row?.artifacts) ? row.artifacts : [];
    for (const art of artifacts) {
      const p = String(art?.path || "").trim();
      const t = String(art?.type || "").toLowerCase();
      if (!p) continue;
      const isImageType = t.includes("image") || t.includes("screenshot") || t === "png" || t === "jpg" || t === "jpeg";
      const isImagePath = /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(p);
      if (!isImageType && !isImagePath) continue;
      const url = toFileUrl(p);
      if (url) return { url, annotations: [] };
      if (/^[A-Za-z]:[\\/]/.test(p)) return { url: toFileUrl(p), path: p, annotations: [] };
    }
    return null;
  }

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
  const artifactSource = runResult || fallbackRunResult || null;
  const structuredOutputsAny = structuredOutputs || (artifactSource?.outputs && typeof artifactSource.outputs === "object" ? artifactSource.outputs : null);
  const structuredInputsAny = structuredInputs || (artifactSource?.inputs && typeof artifactSource.inputs === "object" ? artifactSource.inputs : null);
  const toolCallAny = toolCall || (artifactSource?.tool_call && typeof artifactSource.tool_call === "object" ? artifactSource.tool_call : null);
  const toolResponseAny = toolResponse || (artifactSource?.tool_response && typeof artifactSource.tool_response === "object" ? artifactSource.tool_response : null);
  const normalizedOutputHashAny = normalizedOutputHash || String(artifactSource?.normalized_output_hash || "").trim();
  const artifactsAny = artifacts.length > 0 ? artifacts : (Array.isArray(artifactSource?.artifacts) ? artifactSource.artifacts : []);
  const nodeScreenshot = pickScreenshotFromRunResult(runResult) || pickScreenshotFromRunResult(fallbackRunResult);
  const [resolvedScreenshotUrl, setResolvedScreenshotUrl] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    const path = String(nodeScreenshot?.path || "").trim();
    if (!path || !bridge || typeof bridge.resolve_artifact_image !== "function") {
      setResolvedScreenshotUrl("");
      return () => {
        alive = false;
      };
    }
    const run = async () => {
      try {
        const out = await bridge.resolve_artifact_image(path);
        if (!alive) return;
        const url = String(out?.url || "").trim();
        setResolvedScreenshotUrl(out?.ok && url ? url : "");
      } catch {
        if (!alive) return;
        setResolvedScreenshotUrl("");
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [bridge, nodeScreenshot?.path]);
  const effectiveScreenshot = nodeScreenshot
    ? { ...nodeScreenshot, url: String(resolvedScreenshotUrl || nodeScreenshot.url || "").trim() }
    : null;
  const statusTone =
    status === "failed"
      ? "border-rose-500/50 bg-rose-950/40 text-rose-200"
      : status === "running"
        ? "border-cyan-500/50 bg-cyan-950/30 text-cyan-200"
        : status === "passed"
          ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-200"
          : "border-slate-700/70 bg-slate-900/70 text-slate-200";

  return (
    <div className="mt-2.5 space-y-2 text-xs">
      <div className={`rounded border px-2 py-1.5 ${statusTone}`}>
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
        <div className="rounded border border-slate-800/70 bg-slate-900/35 px-2 py-1.5 text-[11px] text-slate-300">
          No execution data for selected run.
        </div>
      ) : null}

      <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2 py-1.5">
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

      {structuredOutputsAny || structuredInputsAny || toolCallAny || toolResponseAny || normalizedOutputHashAny || artifactsAny.length > 0 ? (
        <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2 py-1.5">
          <div className="text-[11px] font-semibold text-slate-200">Node Artifacts</div>
          {effectiveScreenshot ? (
            <ScreenshotViewer screenshot={effectiveScreenshot} title="Captured Screenshot" />
          ) : null}
          {normalizedOutputHashAny ? (
            <div className="truncate">Output hash: <span className="text-slate-100" title={normalizedOutputHashAny}>{normalizedOutputHashAny}</span></div>
          ) : null}
          {artifactsAny.length > 0 ? (
            <div>
              Artifacts:
              <div className="mt-0.5 space-y-0.5">
                {artifactsAny.slice(0, 6).map((row, idx) => {
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
          {structuredInputsAny ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Input payload</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(structuredInputsAny, null, 2)}</pre>
            </div>
          ) : null}
          {toolCallAny ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Tool call</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(toolCallAny, null, 2)}</pre>
            </div>
          ) : null}
          {toolResponseAny ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Tool response</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(toolResponseAny, null, 2)}</pre>
            </div>
          ) : null}
          {structuredOutputsAny ? (
            <div className="space-y-0.5">
              <div className="text-[10px] text-slate-400">Normalized output</div>
              <pre className="max-h-28 overflow-auto rounded border border-slate-800/70 bg-slate-950/70 p-1 text-[10px] text-slate-300">{JSON.stringify(structuredOutputsAny, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {blockedBy.length > 0 ? (
        <div className="space-y-1 rounded border border-rose-800/40 bg-rose-950/15 px-2 py-1.5">
          <div className="text-[11px] font-semibold text-rose-200">Why not run?</div>
          <div className="text-[11px] text-rose-100">Blocked by:</div>
          {blockedBy.slice(0, 5).map((dep) => (
            <div key={String(dep)} className="truncate text-[11px] text-rose-100/90">- {String(dep)}</div>
          ))}
        </div>
      ) : null}

      {nodeDependencyAnalysis ? (
        <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2 py-1.5">
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

      <div className="space-y-1 rounded border border-slate-800/70 bg-slate-900/20 px-2 py-1.5">
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
