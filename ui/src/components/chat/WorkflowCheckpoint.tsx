import type { CompoundWorkflowState } from '../../chat/compoundWorkflow';

interface WorkflowCheckpointProps {
  workflow: CompoundWorkflowState;
  message: string;
  onContinue: () => void;
  onCancel: () => void;
}

export function WorkflowCheckpoint({
  workflow,
  message,
  onContinue,
  onCancel,
}: WorkflowCheckpointProps) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="mb-2 font-semibold text-amber-900">Workflow Paused</div>
      <div className="mb-2 text-amber-800">{message}</div>
      <div className="mb-3 text-xs text-amber-700">
        Workflow: {workflow.id} | Phase {workflow.completed_phases}/{workflow.total_phases}
      </div>
      <div className="flex gap-2">
        <button className="rounded bg-green-600 px-3 py-1 text-white" onClick={onContinue}>
          Continue
        </button>
        <button className="rounded bg-gray-300 px-3 py-1 text-gray-900" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
