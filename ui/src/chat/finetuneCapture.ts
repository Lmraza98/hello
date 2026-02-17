import type { ToolCall } from './chatEngineTypes';
import { TOOLS } from './tools';

const STORAGE_KEY = 'tool_finetune_failures_v1';
const LEGACY_STORAGE_KEY = 'functiongemma_finetune_failures_v1';
const LABELS_STORAGE_KEY = 'tool_finetune_labels_v1';
const LEGACY_LABELS_STORAGE_KEY = 'functiongemma_finetune_labels_v1';
const MAX_ITEMS = 500;
const DEFAULT_TEST_RATIO = 0.2;
const DEFAULT_SEED = 42;
const DEFAULT_SYSTEM_MSG = 'You are a model that can do function calling with the following functions';

export interface ToolFailureCapture {
  id: string;
  timestamp: string;
  planner_model?: string;
  user_message: string;
  conversation_tail: Array<{ role: string; content: string | null }>;
  route_reason: string;
  selected_tools: string[];
  executed_tools?: string[];
  raw_content: string | null;
  native_tool_calls: ToolCall[];
  token_tool_calls: Array<{ name: string; args: Record<string, unknown> }>;
  failure_reason: string;
  outcome?: 'success' | 'recovered_by_gemma' | 'failed';
  recovered_by_gemma: boolean;
}

export interface ToolFailureLabel {
  id: string;
  tool_name: string;
  tool_arguments_json: string;
  skip: boolean;
  notes?: string;
  updated_at: string;
}

export interface ToolLabeledSample {
  capture: ToolFailureCapture;
  label: ToolFailureLabel;
}

export interface ToolSftExample {
  messages: Array<Record<string, unknown>>;
  tools: typeof TOOLS;
  metadata: {
    capture_id: string;
    timestamp: string;
    failure_reason: string;
    notes?: string;
  };
}

export interface ToolSftSplit {
  train: ToolSftExample[];
  test: ToolSftExample[];
  invalid: Array<{ capture_id: string; reason: string }>;
  skipped: number;
}

function loadCaptures(): ToolFailureCapture[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ToolFailureCapture[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCaptures(items: ToolFailureCapture[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
  } catch {
    // ignore storage errors
  }
}

function loadLabels(): ToolFailureLabel[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LABELS_STORAGE_KEY) || window.localStorage.getItem(LEGACY_LABELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ToolFailureLabel[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLabels(items: ToolFailureLabel[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
  } catch {
    // ignore storage errors
  }
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededSort<T>(items: T[], seed: number, keyFn: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ha = hashString(`${seed}:${keyFn(a)}`);
    const hb = hashString(`${seed}:${keyFn(b)}`);
    return ha - hb;
  });
}

function toJsonl(items: unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n');
}

export function recordToolFailure(
  partial: Omit<ToolFailureCapture, 'id' | 'timestamp'>
): void {
  const current = loadCaptures();
  const next: ToolFailureCapture = {
    id: `fgf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...partial,
  };
  current.push(next);
  saveCaptures(current);
}

export function getFunctionGemmaFailures(): FunctionGemmaFailureCapture[] {
  return loadCaptures();
}

export function clearFunctionGemmaFailures(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getFunctionGemmaLabels(): FunctionGemmaFailureLabel[] {
  return loadLabels();
}

export function upsertFunctionGemmaLabel(
  partial: Omit<ToolFailureLabel, 'updated_at'> & { updated_at?: string }
): void {
  const current = loadLabels();
  const next: ToolFailureLabel = {
    ...partial,
    updated_at: partial.updated_at || new Date().toISOString(),
  };
  const idx = current.findIndex((item) => item.id === partial.id);
  if (idx >= 0) {
    current[idx] = next;
  } else {
    current.push(next);
  }
  saveLabels(current);
}

export function clearFunctionGemmaLabels(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LABELS_STORAGE_KEY);
}

export function getFunctionGemmaLabeledSamples(): ToolLabeledSample[] {
  const captures = loadCaptures();
  const labels = loadLabels();
  const labelMap = new Map(labels.map((item) => [item.id, item]));
  return captures
    .map((capture) => ({ capture, label: labelMap.get(capture.id) }))
    .filter((item): item is ToolLabeledSample => Boolean(item.label));
}

export function buildFunctionGemmaFailuresJsonl(): string {
  return loadCaptures()
    .map((item) => JSON.stringify(item))
    .join('\n');
}

export function downloadFunctionGemmaFailuresJsonl(): void {
  if (typeof window === 'undefined') return;
  const jsonl = buildFunctionGemmaFailuresJsonl();
  const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `functiongemma_failures_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadFunctionGemmaTrainingBundle(): void {
  if (typeof window === 'undefined') return;
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    tools: TOOLS,
    failures: loadCaptures(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `functiongemma_training_bundle_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildFunctionGemmaSftSplit(
  testRatio = DEFAULT_TEST_RATIO,
  seed = DEFAULT_SEED
): ToolSftSplit {
  const labeled = getFunctionGemmaLabeledSamples();
  const invalid: Array<{ capture_id: string; reason: string }> = [];
  const valid: ToolSftExample[] = [];
  let skipped = 0;

  for (const { capture, label } of labeled) {
    if (label.skip) {
      skipped += 1;
      continue;
    }
    if (!label.tool_name.trim()) {
      invalid.push({ capture_id: capture.id, reason: 'missing_tool_name' });
      continue;
    }

    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(label.tool_arguments_json || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        invalid.push({ capture_id: capture.id, reason: 'tool_arguments_must_be_object' });
        continue;
      }
      args = parsed as Record<string, unknown>;
    } catch {
      invalid.push({ capture_id: capture.id, reason: 'invalid_tool_arguments_json' });
      continue;
    }

    valid.push({
      messages: [
        { role: 'developer', content: DEFAULT_SYSTEM_MSG },
        { role: 'user', content: capture.user_message },
        {
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              function: {
                name: label.tool_name.trim(),
                arguments: args,
              },
            },
          ],
        },
      ],
      tools: TOOLS,
      metadata: {
        capture_id: capture.id,
        timestamp: capture.timestamp,
        failure_reason: capture.failure_reason,
        notes: label.notes,
      },
    });
  }

  const shuffled = seededSort(valid, seed, (item) => item.metadata.capture_id);
  const boundedRatio = Math.max(0, Math.min(0.5, testRatio));
  const testCount =
    shuffled.length <= 1 ? 0 : Math.max(1, Math.floor(shuffled.length * boundedRatio));
  const test = shuffled.slice(0, testCount);
  const train = shuffled.slice(testCount);

  return { train, test, invalid, skipped };
}

export function downloadFunctionGemmaSftJsonlSplit(
  testRatio = DEFAULT_TEST_RATIO,
  seed = DEFAULT_SEED
): ToolSftSplit {
  const split = buildFunctionGemmaSftSplit(testRatio, seed);
  if (typeof window === 'undefined') return split;

  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const trainBlob = new Blob([toJsonl(split.train)], { type: 'application/x-ndjson' });
  const testBlob = new Blob([toJsonl(split.test)], { type: 'application/x-ndjson' });

  const trainUrl = URL.createObjectURL(trainBlob);
  const testUrl = URL.createObjectURL(testBlob);

  const trainA = document.createElement('a');
  trainA.href = trainUrl;
  trainA.download = `functiongemma_sft_train_${now}.jsonl`;
  trainA.click();

  const testA = document.createElement('a');
  testA.href = testUrl;
  testA.download = `functiongemma_sft_test_${now}.jsonl`;
  testA.click();

  URL.revokeObjectURL(trainUrl);
  URL.revokeObjectURL(testUrl);

  return split;
}

export type FunctionGemmaFailureCapture = ToolFailureCapture;
export type FunctionGemmaFailureLabel = ToolFailureLabel;
export type FunctionGemmaLabeledSample = ToolLabeledSample;
export type FunctionGemmaSftExample = ToolSftExample;
export type FunctionGemmaSftSplit = ToolSftSplit;

export function recordFunctionGemmaFailure(
  partial: Omit<ToolFailureCapture, 'id' | 'timestamp'>
): void {
  recordToolFailure(partial);
}

if (typeof window !== 'undefined') {
  (window as Window & {
    exportFunctionGemmaFailures?: () => void;
    exportFunctionGemmaTrainingBundle?: () => void;
    exportFunctionGemmaSftJsonlSplit?: () => FunctionGemmaSftSplit;
    clearFunctionGemmaFailures?: () => void;
    clearFunctionGemmaLabels?: () => void;
    getFunctionGemmaFailures?: () => FunctionGemmaFailureCapture[];
    getFunctionGemmaLabels?: () => FunctionGemmaFailureLabel[];
  }).exportFunctionGemmaFailures = downloadFunctionGemmaFailuresJsonl;
  (window as Window & { exportFunctionGemmaTrainingBundle?: () => void }).exportFunctionGemmaTrainingBundle =
    downloadFunctionGemmaTrainingBundle;
  (window as Window & { exportFunctionGemmaSftJsonlSplit?: () => FunctionGemmaSftSplit }).exportFunctionGemmaSftJsonlSplit =
    () => downloadFunctionGemmaSftJsonlSplit();
  (window as Window & { clearFunctionGemmaFailures?: () => void }).clearFunctionGemmaFailures =
    clearFunctionGemmaFailures;
  (window as Window & { clearFunctionGemmaLabels?: () => void }).clearFunctionGemmaLabels =
    clearFunctionGemmaLabels;
  (window as Window & {
    getFunctionGemmaFailures?: () => FunctionGemmaFailureCapture[];
  }).getFunctionGemmaFailures = getFunctionGemmaFailures;
  (window as Window & {
    getFunctionGemmaLabels?: () => FunctionGemmaFailureLabel[];
  }).getFunctionGemmaLabels = getFunctionGemmaLabels;
}
