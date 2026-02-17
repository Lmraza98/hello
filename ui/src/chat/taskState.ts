// ── Task State Machine ──────────────────────────────────────
// Pure types and functions for tracking multi-turn task state
// across chat turns.  All mutations return new objects.

// ── Core Types ──────────────────────────────────────────────

export type TaskStatus =
  | 'collecting'   // Waiting for user to provide missing params
  | 'ready'        // All params collected, awaiting confirmation or auto-execute
  | 'executing'    // Steps are running
  | 'paused'       // Hit a confirmation gate or user changed topic mid-execution
  | 'completed'    // All steps finished successfully
  | 'failed'       // Unrecoverable error
  | 'cancelled';   // User or system cancelled

export type ParamRequest = {
  name: string;
  description: string;        // Human-readable: "Campaign description"
  type: 'string' | 'number' | 'boolean' | 'entity_ref';
  required: boolean;
  default?: unknown;
};

export type DataSource = {
  origin: 'user_input' | 'tool_result' | 'session_entity' | 'database_lookup';
  toolName?: string;
  confidence: number;         // 0–1
  timestamp: number;
};

export type TaskStep = {
  id: string;
  intent: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  dependsOn: string[];
};

export type TaskEvent =
  | { type: 'created'; goal: string; timestamp: number }
  | { type: 'param_collected'; name: string; value: unknown; source: DataSource; timestamp: number }
  | { type: 'step_started'; stepId: string; timestamp: number }
  | { type: 'step_completed'; stepId: string; result: unknown; timestamp: number }
  | { type: 'step_failed'; stepId: string; error: string; timestamp: number }
  | { type: 'confirmation_requested'; summary: string; timestamp: number }
  | { type: 'confirmation_received'; approved: boolean; timestamp: number }
  | { type: 'user_message'; content: string; timestamp: number }
  | { type: 'status_change'; from: TaskStatus; to: TaskStatus; reason: string; timestamp: number };

export type ConfirmationPolicy = 'ask_every' | 'ask_writes' | 'auto';

export type Task = {
  id: string;
  goal: string;                                // Original user request
  status: TaskStatus;
  params: Record<string, unknown>;             // Collected so far
  missingParams: ParamRequest[];               // What we still need
  steps: TaskStep[];                           // Execution plan (may be empty initially)
  currentStepIndex: number;
  confirmationPolicy: ConfirmationPolicy;
  provenance: Record<string, DataSource>;      // Where each param value came from
  createdAt: number;
  updatedAt: number;
  history: TaskEvent[];                        // Full audit trail
};

// ── Pure helper functions ───────────────────────────────────

export function createTask(goal: string, policy?: ConfirmationPolicy): Task {
  const now = Date.now();
  return {
    id: `task-${now}-${Math.random().toString(36).slice(2, 8)}`,
    goal,
    status: 'collecting',
    params: {},
    missingParams: [],
    steps: [],
    currentStepIndex: 0,
    confirmationPolicy: policy ?? 'ask_writes',
    provenance: {},
    createdAt: now,
    updatedAt: now,
    history: [{ type: 'created', goal, timestamp: now }],
  };
}

export function transitionTask(task: Task, newStatus: TaskStatus, reason: string): Task {
  const now = Date.now();
  return {
    ...task,
    status: newStatus,
    updatedAt: now,
    history: [
      ...task.history,
      { type: 'status_change', from: task.status, to: newStatus, reason, timestamp: now },
    ],
  };
}

export function collectParam(task: Task, name: string, value: unknown, source: DataSource): Task {
  const now = Date.now();
  const updated: Task = {
    ...task,
    params: { ...task.params, [name]: value },
    missingParams: task.missingParams.filter((p) => p.name !== name),
    provenance: { ...task.provenance, [name]: source },
    updatedAt: now,
    history: [
      ...task.history,
      { type: 'param_collected', name, value, source, timestamp: now },
    ],
  };
  // Auto-transition to 'ready' when all required params are collected
  const stillRequired = updated.missingParams.filter((p) => p.required);
  if (stillRequired.length === 0 && updated.status === 'collecting') {
    return transitionTask(updated, 'ready', 'all_required_params_collected');
  }
  return updated;
}

export function isTaskActive(task: Task | undefined): boolean {
  if (!task) return false;
  return !['completed', 'failed', 'cancelled'].includes(task.status);
}

export function taskNeedsInput(task: Task): boolean {
  return task.status === 'collecting' || task.status === 'paused';
}

export function taskSummary(task: Task): string {
  const paramsList = Object.entries(task.params)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
  const missingList = task.missingParams
    .filter((p) => p.required)
    .map((p) => p.description || p.name)
    .join(', ');
  return (
    `Task: ${task.goal}\n` +
    `Status: ${task.status}\n` +
    (paramsList ? `Collected: ${paramsList}\n` : '') +
    (missingList ? `Still needed: ${missingList}\n` : '')
  );
}
