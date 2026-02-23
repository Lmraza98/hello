import type { CompoundWorkflowState } from '../../chat/compoundWorkflow';
import { UnifiedCard } from './UnifiedCard';

interface WorkflowProgressProps {
  workflow: CompoundWorkflowState;
}

function pct(workflow: CompoundWorkflowState): number {
  if (!workflow.total_phases) return 0;
  return Math.max(0, Math.min(100, Math.round((workflow.completed_phases / workflow.total_phases) * 100)));
}

export function WorkflowProgress({ workflow }: WorkflowProgressProps) {
  const percent = pct(workflow);
  return (
    <UnifiedCard
      title="Compound Workflow"
      statusLabel={workflow.status}
      statusClass={
        workflow.status === 'completed'
          ? 'bg-emerald-100 text-emerald-800'
          : workflow.status === 'failed'
            ? 'bg-red-100 text-red-800'
            : 'bg-amber-100 text-amber-800'
      }
    >
      <div className="mb-2 h-2 w-full rounded bg-gray-100">
        <div className="h-2 rounded bg-blue-600" style={{ width: `${percent}%` }} />
      </div>
      <div className="text-xs text-gray-600">
        {workflow.completed_phases}/{workflow.total_phases} phases complete | Browser calls: {workflow.browser_calls_used}
      </div>
      {workflow.current_phase_id ? (
        <div className="mt-1 text-xs text-gray-500">Current phase: {workflow.current_phase_id}</div>
      ) : null}
    </UnifiedCard>
  );
}
