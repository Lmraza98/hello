import { useCallback, useEffect, useState } from 'react';

export type CompoundWorkflowStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CompoundWorkflowEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface CompoundWorkflowState {
  id: string;
  status: CompoundWorkflowStatus;
  current_phase_id?: string | null;
  total_phases: number;
  completed_phases: number;
  browser_calls_used: number;
  events: CompoundWorkflowEvent[];
  error?: Record<string, unknown> | null;
}

export function useCompoundWorkflow(workflowId: string | null, pollMs = 2000) {
  const [state, setState] = useState<CompoundWorkflowState | null>(null);

  useEffect(() => {
    if (!workflowId) {
      setState(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/compound_workflow/${encodeURIComponent(workflowId)}/status`);
        const json = await res.json();
        if (cancelled || !json?.ok) return;
        setState({
          id: String(json.id || workflowId),
          status: String(json.status || 'pending') as CompoundWorkflowStatus,
          current_phase_id: json.current_phase_id || null,
          total_phases: Number(json.total_phases || 0),
          completed_phases: Number(json.completed_phases || 0),
          browser_calls_used: Number(json.browser_calls_used || 0),
          events: Array.isArray(json.events) ? json.events : [],
          error: json.error || null,
        });
      } catch {
        // ignore transient polling errors
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), Math.max(500, pollMs));
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [workflowId, pollMs]);

  const continueWorkflow = useCallback(async () => {
    if (!workflowId) return null;
    const res = await fetch(`/api/compound_workflow/${encodeURIComponent(workflowId)}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json();
  }, [workflowId]);

  const cancelWorkflow = useCallback(async () => {
    if (!workflowId) return null;
    const res = await fetch(`/api/compound_workflow/${encodeURIComponent(workflowId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json();
  }, [workflowId]);

  return { state, continueWorkflow, cancelWorkflow };
}
