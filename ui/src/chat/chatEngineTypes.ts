// Re-export the canonical PlannedToolCall from toolExecutor/types (single source of truth).
export type { PlannedToolCall } from './toolExecutor/types';

export type JSONSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatCompletionMessageParam =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ChatPhase = 'planning' | 'confirming' | 'executing' | 'refining';

export type TaskStep = {
  id: string;
  intent: string;
  dependsOn: string[];
};

// Used to pause and resume multi-step task execution across confirmation boundaries.
export type PendingTaskPlan = {
  rootMessage: string;
  steps: TaskStep[];
  nextStepIndex: number;
  contextSnippets: string[];
};
